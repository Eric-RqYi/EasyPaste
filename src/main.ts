import { Editor, MarkdownView, Notice, Plugin, TFile, arrayBufferToBase64, requestUrl } from 'obsidian';
import { convertRules } from './rules';
import { EditTarget } from './target';
import { isProtectedContext } from './context';
import { convertWithApi } from './api';
import { conversionMode, resolveConversionInput } from './input';
import { PreviewModal, type PreviewOptions } from './preview';
import { EasyPasteSettingTab } from './settings-tab';
import { loadSettings, migrateApiSecrets, type EasyPasteSettings } from './settings';

export default class EasyPaste extends Plugin {
  declare settings: EasyPasteSettings;
  private modal?: PreviewModal;
  private saveQueue: Promise<void> = Promise.resolve();
  private settingsListeners = new Set<() => void>();
  private settingTab!: EasyPasteSettingTab;
  async onload(): Promise<void> {
    this.settings = loadSettings(await this.loadData());
    if (migrateApiSecrets(this.settings, this.app.secretStorage)) await this.saveSettings();
    this.settingTab = new EasyPasteSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    const commands: { id: string; name: string; mode: 'rules' | 'smart' }[] = [
      { id: 'clean-selection', name: '离线清洗', mode: 'rules' },
      { id: 'convert-selection', name: '智能转换', mode: 'smart' }
    ];
    commands.forEach(command => this.addCommand({
      id: command.id, name: command.name,
      editorCheckCallback: (checking, editor, view) => {
        const available = this.settings.shortcuts && !this.modal && Boolean(view.file) && (command.mode === 'smart' || Boolean(editor.getSelection()));
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
      for (const command of commands) menu.addItem(item => item.setTitle(`EasyPaste：${command.name}`).setIcon('wand-sparkles')
        .setDisabled(Boolean(this.modal) || (command.mode === 'rules' && !editor.getSelection()))
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
      const insertionPosition = { ...target.from };
      this.openPreview({ ...this.rulePreviewOptions(view.file?.path ?? '', value => this.atCursor(value, editor, true, insertionPosition)),
        source: text, result: this.atCursor(result.text, editor, true, insertionPosition), reasons: result.reasons,
        apply: value => target.apply(value), pasteOriginal: () => target.apply(text) });
    }));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || !this.mime(file.extension)) return;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.file) return;
      menu.addItem(item => item.setTitle('EasyPaste：智能转换').setIcon('wand-sparkles').setDisabled(Boolean(this.modal))
        .onClick(() => void this.manual('smart', view.editor, view, file)));
    }));
  }
  onunload(): void { this.modal?.close(); }
  saveSettings(): Promise<void> {
    // Serialize writes so rapid setting edits cannot persist out of order.
    const snapshot = structuredClone(this.settings);
    this.settingsListeners.forEach(listener => listener());
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
  private atCursor(text: string, editor: Editor, insertion: boolean, pos = editor.getCursor('from')): string {
    if (!insertion || !text.includes('\n')) return text;
    const prefix = editor.getLine(pos.line).slice(0, pos.ch);
    if (!/^[ \t]*$/.test(prefix) || !prefix.length) return text;
    return text.split('\n').map((line, i) => i && line ? prefix + line : line).join('\n');
  }
  private async manual(mode: 'rules' | 'smart', editor: Editor, view: MarkdownView, imageFile?: TFile): Promise<void> {
    if (this.modal) return;
    const target = this.target(editor, view);
    const selection = target.original;
    if (mode === 'rules' && !selection) { new Notice('请先选中需要转换的文本。'); return; }
    if (selection.length > 200000) { new Notice('请分段转换：单次最多 200,000 个字符。'); return; }
    if (mode === 'rules') {
      const result = convertRules(selection, this.settings.rules);
      this.openPreview({ ...this.rulePreviewOptions(view.file?.path ?? ''), source: selection, result: result.text, reasons: result.reasons, apply: text => target.apply(text) });
      return;
    }
    this.openPreview({
      ...this.smartPreviewOptions(view.file?.path ?? ''),
      source: imageFile ? `![[${imageFile.path}]]` : selection,
      apply: text => target.apply(this.atCursor(text, editor, !selection, target.from))
    });
  }
  private rulePreviewOptions(sourcePath: string, format: (text: string) => string = text => text): Pick<PreviewOptions, 'rules' | 'generate' | 'remoteLabel'> {
    const smart = this.smartPreviewOptions(sourcePath);
    return {
      ...smart,
      generate: async (signal, input) => format(await smart.generate(signal, input)),
      rules: {
        get: () => this.settings.rules,
        convert: source => {
          const result = convertRules(source, this.settings.rules);
          return { ...result, text: format(result.text) };
        },
        save: () => this.saveSettings(),
        subscribe: listener => {
          this.settingsListeners.add(listener);
          return () => { this.settingsListeners.delete(listener); };
        },
        openSettings: () => {
          // Obsidian's settings navigator is exposed by the host, outside App's public type.
          const settings = (this.app as typeof this.app & { setting?: { open(): void; openTabById(id: string): void } }).setting;
          if (!settings) { new Notice('请在 Obsidian 设置中打开 EasyPaste 的「离线规则」。'); return; }
          settings.open();
          settings.openTabById(this.manifest.id);
          this.settingTab.focusRules();
        }
      }
    };
  }
  private smartPreviewOptions(sourcePath: string): Required<Pick<PreviewOptions, 'generate' | 'remoteLabel'>> {
    // Freeze request configuration for the lifetime of this preview.
    const apis = { text: { ...this.settings.textApi }, image: { ...this.settings.imageApi } };
    const instructions = this.settings.extraInstructions;
    const timeoutSeconds = this.settings.timeoutSeconds;
    return {
      remoteLabel: input => {
        const mode = conversionMode(input);
        const api = apis[mode];
        return `${mode === 'image' ? '视觉 API（图片转换）' : '文本 API（智能转换）'}：${api.baseUrl || '地址未配置'} · ${api.model || '模型未配置'}`;
      },
      generate: async (signal, input) => {
        const resolved = await resolveConversionInput(input, path => this.readImage(path, sourcePath));
        const mode = conversionMode(resolved);
        const api = apis[mode];
        return convertWithApi({
          api, key: this.app.secretStorage.getSecret(api.secretName) ?? '', mode,
          input: resolved.text, images: resolved.images, instructions, timeoutSeconds, signal,
          request: async request => {
            const response = await requestUrl(request);
            return { status: response.status, json: response.status >= 200 && response.status < 300 ? response.json : null };
          }
        });
      }
    };
  }
  private async readImage(path: string, sourcePath: string): Promise<string> {
    if (/^https:\/\//i.test(path)) {
      const url = new URL(path);
      if (url.username || url.password) throw new Error('图片 URL 不能包含凭据。');
      return url.toString();
    }
    const dataImage = /^data:image\/(?:png|jpeg|webp|gif);base64,([a-z\d+/]+=*)$/i.exec(path);
    if (dataImage) {
      const bytes = dataImage[1].length * 3 / 4 - (dataImage[1].match(/=+$/)?.[0].length ?? 0);
      if (bytes > 10 * 1024 * 1024) throw new Error('图片不能超过 10 MB。');
      return path;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(path)) throw new Error('请选择笔记库内图片或 HTTPS 图片链接。');
    try { path = decodeURIComponent(path); } catch { /* use literal path */ }
    const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (!file) throw new Error('无法找到选中内容中的图片，请检查嵌入路径，或移除引用后添加图片文件。');
    const mime = this.mime(file.extension);
    if (!mime || !file.stat.size || file.stat.size > 10 * 1024 * 1024) throw new Error('请选择不超过 10 MB 的 PNG、JPEG、WebP 或 GIF 图片。');
    try { return `data:${mime};base64,${arrayBufferToBase64(await this.app.vault.readBinary(file))}`; }
    catch { throw new Error('无法读取图片文件。'); }
  }
  private mime(extension: string): string | undefined {
    return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>)[extension.toLowerCase()];
  }
}
