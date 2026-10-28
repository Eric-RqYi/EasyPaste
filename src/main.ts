import { Editor, MarkdownView, Notice, Plugin, TFile, arrayBufferToBase64, requestUrl } from 'obsidian';
import { convertRules } from './rules';
import { EditTarget } from './target';
import { isProtectedContext } from './context';
import { convertWithApi, type ConversionMode } from './api';
import { PreviewModal } from './preview';
import { EasyPasteSettingTab } from './settings-tab';
import { loadSettings, type EasyPasteSettings } from './settings';

export default class EasyPaste extends Plugin {
  declare settings: EasyPasteSettings;
  private modal?: PreviewModal;
  private saveQueue: Promise<void> = Promise.resolve();
  async onload(): Promise<void> {
    this.settings = loadSettings(await this.loadData());
    this.addSettingTab(new EasyPasteSettingTab(this.app, this));
    const commands: { id: string; name: string; mode: 'rules' | ConversionMode }[] = [
      { id: 'clean-selection', name: '离线清洗', mode: 'rules' },
      { id: 'convert-selection', name: '智能转换', mode: 'text' },
      { id: 'ocr-image', name: '图片 OCR → Markdown / LaTeX', mode: 'image' }
    ];
    commands.forEach(command => this.addCommand({
      id: command.id, name: command.name,
      editorCheckCallback: (checking, editor, view) => {
        const available = this.settings.shortcuts && !this.modal && Boolean(view.file) && (command.mode === 'image' || Boolean(editor.getSelection()));
        if (available && !checking) {
          const active = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (active) void this.manual(command.mode, editor, active);
        }
        return available;
      }
    }));
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.editor !== editor || !info.file) return;
      for (const command of commands) menu.addItem(item => item.setTitle(`EasyPaste：${command.name}`).setIcon(command.mode === 'image' ? 'scan-text' : 'wand-sparkles')
        .setDisabled(Boolean(this.modal) || (command.mode !== 'image' && !editor.getSelection()))
        .onClick(() => void this.manual(command.mode, editor, view)));
    }));
    this.registerEvent(this.app.workspace.on('editor-paste', (event, editor, info) => {
      if (event.defaultPrevented || !this.settings.autoPaste || this.modal || !info.file) return;
      const data = event.clipboardData;
      // Let Obsidian handle rich/image pastes unless this is a text-only cleanup.
      if (!data || data.files.length || [...data.items].some(item => item.type.startsWith('image/'))) return;
      const text = data.getData('text/plain');
      if (!text || text.length > this.settings.maxAutoChars) return;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.editor !== editor) return;
      const before = editor.getRange({ line: 0, ch: 0 }, editor.getCursor('from'));
      if (isProtectedContext(before)) return;
      const result = convertRules(text, this.settings.rules);
      if (result.text === text) return;
      event.preventDefault();
      const target = this.target(editor, view);
      this.openPreview({ source: text, result: this.atCursor(result.text, editor, true), reasons: result.reasons,
        apply: value => target.apply(value), pasteOriginal: () => target.apply(text) });
    }));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || !this.mime(file.extension)) return;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.file) return;
      menu.addItem(item => item.setTitle('EasyPaste：识别图片并插入当前笔记').setIcon('scan-text').setDisabled(Boolean(this.modal))
        .onClick(() => void this.manual('image', view.editor, view, file)));
    }));
  }
  onunload(): void { this.modal?.close(); }
  saveSettings(): Promise<void> {
    // Serialize writes so rapid setting edits cannot persist out of order.
    const snapshot = structuredClone(this.settings);
    this.saveQueue = this.saveQueue.catch(() => {}).then(() => this.saveData(snapshot));
    return this.saveQueue;
  }
  private target(editor: Editor, view: MarkdownView): EditTarget {
    const file = view.file;
    return new EditTarget(editor, () => this.app.workspace.getActiveViewOfType(MarkdownView) === view && view.file === file);
  }
  private openPreview(options: Omit<ConstructorParameters<typeof PreviewModal>[1], 'closed'>): void {
    if (this.modal) { new Notice('请先完成或关闭当前 EasyPaste 预览。'); return; }
    this.modal = new PreviewModal(this.app, { ...options, closed: () => { this.modal = undefined; } });
    this.modal.open();
  }
  /** The first line already has the editor's prefix; indent subsequent lines accordingly. */
  private atCursor(text: string, editor: Editor, insertion: boolean): string {
    if (!insertion || !text.includes('\n')) return text;
    const pos = editor.getCursor('from');
    const prefix = editor.getLine(pos.line).slice(0, pos.ch);
    if (!/^[ \t]*$/.test(prefix) || !prefix.length) return text;
    return text.split('\n').map((line, i) => i && line ? prefix + line : line).join('\n');
  }
  private async manual(mode: 'rules' | ConversionMode, editor: Editor, view: MarkdownView, imageFile?: TFile): Promise<void> {
    if (this.modal) return;
    const target = this.target(editor, view);
    const selection = target.original;
    if (mode !== 'image' && !selection) { new Notice('请先选中需要转换的文本。'); return; }
    if (selection.length > 200000) { new Notice('请分段转换：单次最多 200,000 个字符。'); return; }
    if (mode === 'rules') {
      const result = convertRules(selection, this.settings.rules);
      if (result.text === selection) { new Notice('未检测到需要清洗的模式。可添加词表或手动使用智能清洗。'); return; }
      this.openPreview({ source: selection, result: result.text, reasons: result.reasons, apply: text => target.apply(text) });
      return;
    }
    const providerId = mode === 'image' ? this.settings.visionProvider : this.settings.textProvider;
    const savedProvider = this.settings.providers.find(p => p.id === providerId);
    if (!savedProvider) { new Notice('请在 EasyPaste 设置中选择供应商。'); return; }
    const provider = { ...savedProvider };
    const model = mode === 'image' ? provider.visionModel : provider.textModel;
    let image = '';
    if (mode === 'image') {
      // A selected local embed can be recognized without reading system clipboard.
      const embed = /^!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(selection.trim())
        ?? /^!\[[^\]]*\]\(([^)]+)\)$/.exec(selection.trim());
      if (!imageFile && embed) {
        let path = embed[1];
        try { path = decodeURIComponent(path.replace(/^<|>$/g, '')); } catch { /* use literal path */ }
        imageFile = this.app.metadataCache.getFirstLinkpathDest(path, view.file?.path ?? '') ?? undefined;
      }
      if (imageFile) {
        const mime = this.mime(imageFile.extension);
        if (!mime || imageFile.stat.size > 10 * 1024 * 1024) { new Notice('请选择不超过 10 MB 的 PNG、JPEG、WebP 或 GIF 图片。'); return; }
        try { image = `data:${mime};base64,${arrayBufferToBase64(await this.app.vault.readBinary(imageFile))}`; }
        catch { new Notice('无法读取图片文件。'); return; }
      }
    }
    // Freeze non-secret request configuration for the lifetime of this preview.
    const instructions = this.settings.extraInstructions;
    const timeoutSeconds = this.settings.timeoutSeconds;
    this.openPreview({
      source: selection, image: mode === 'image' ? image : undefined,
      remoteLabel: `${provider.name} · ${provider.baseUrl} · ${model || '模型未配置'}`,
      generate: async (signal, pickedImage) => convertWithApi({
        provider, key: this.app.secretStorage.getSecret(provider.secretName) ?? '', mode,
        input: mode === 'image' ? pickedImage! : selection, instructions, timeoutSeconds, signal,
        request: async request => {
          const response = await requestUrl(request);
          return { status: response.status, json: response.status >= 200 && response.status < 300 ? response.json : null };
        }
      }),
      apply: text => target.apply(this.atCursor(text, editor, mode === 'image' && !selection))
    });
  }
  private mime(extension: string): string | undefined {
    return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>)[extension.toLowerCase()];
  }
}
