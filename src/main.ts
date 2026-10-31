import { createTranslator, UserFacingError, type MessageKey, type Translator } from './i18n';
import { Editor, MarkdownView, Notice, Plugin, TFile, arrayBufferToBase64, htmlToMarkdown, requestUrl } from 'obsidian';
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
  get t(): Translator { return createTranslator(this.settings.language); }
  private localizedCommands: { command: { name: string }; key: MessageKey; prefix: string }[] = [];
  private modal?: PreviewModal;
  private saveQueue: Promise<void> = Promise.resolve();
  private settingsListeners = new Set<() => void>();
  private settingTab!: EasyPasteSettingTab;
  async onload(): Promise<void> {
    this.settings = loadSettings(await this.loadData());
    migrateApiSecrets(this.settings, this.app.secretStorage);
    // Persist prompt defaults and migrations alongside the model configuration.
    await this.saveSettings();
    this.settingTab = new EasyPasteSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    const commands: { id: string; key: MessageKey; mode: 'rules' | 'smart' }[] = [
      { id: 'clean-selection', key: 'command.clean', mode: 'rules' },
      { id: 'convert-selection', key: 'command.smart', mode: 'smart' }
    ];
    commands.forEach(command => {
      const name = this.t(command.key);
      const registered = this.addCommand({
        id: command.id, name,
        editorCheckCallback: (checking, editor, view) => {
          const available = this.settings.shortcuts && !this.modal && Boolean(view.file) && (command.mode === 'smart' || Boolean(editor.getSelection()));
          if (available && !checking) {
            const active = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (active) void this.manual(command.mode, editor, active);
          }
          return available;
        }
      });
      // Preserve any plugin-name prefix supplied by the host.
      const prefix = registered.name.endsWith(name) ? registered.name.slice(0, -name.length) : '';
      this.localizedCommands.push({ command: registered, key: command.key, prefix });
    });
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.editor !== editor || !info.file) return;
      for (const command of commands) menu.addItem(item => item.setTitle(this.t('common.menuTitle', { name: this.t(command.key) })).setIcon('wand-sparkles')
        .setDisabled(Boolean(this.modal) || (command.mode === 'rules' && !editor.getSelection()))
        .onClick(() => void this.manual(command.mode, editor, view)));
    }));
    this.registerEvent(this.app.workspace.on('editor-paste', (event, editor, info) => {
      if (event.defaultPrevented || !this.settings.autoPaste || this.modal || !info.file) return;
      const data = event.clipboardData;
      // Image/file pastes stay with Obsidian; rich text is normalized before cleanup.
      if (!data || data.files.length || [...data.items].some(item => item.type.startsWith('image/'))) return;
      let text = data.getData('text/plain');
      const html = data.getData('text/html');
      // Slides' plain text often omits the markers/blank lines created by HTML paste.
      // Use Obsidian's converter so rules inspect the Markdown that would be inserted.
      if (html && /<[a-z][\s\S]*>/i.test(html)) {
        // Do not consume rich pastes containing images or embedded media.
        if (/<(?:img|svg|video|audio|iframe|object|embed)\b/i.test(html)) return;
        if (html.length > this.settings.maxAutoChars * 20) return;
        try { text = htmlToMarkdown(html); }
        catch { return; } // Keep native paste available if HTML conversion fails.
      }
      if (!text || text.length > this.settings.maxAutoChars) return;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      // The paste event owns its editor; rendered/embedded editors may differ from view.editor.
      if (!view || info.file !== view.file) return;
      const position = { ...editor.getCursor('from') };
      const lineBeforeCursor = editor.getLine(position.line).slice(0, position.ch);
      const before = editor.getRange({ line: 0, ch: 0 }, position);
      if (isProtectedContext(before)) return;
      const result = convertRules(text, this.settings.rules, { beforeCursor: before, lineBeforeCursor }, this.t);
      // Compare the complete pipeline output, including enabled custom regex rules.
      if (result.text === text) return;
      event.preventDefault();
      const target = this.target(editor, info);
      const insertionPosition = { ...target.from };
      this.openPreview({ ...this.rulePreviewOptions(view.file?.path ?? '', value => this.atCursor(value, editor, true, insertionPosition), before, lineBeforeCursor),
        source: text, result: this.atCursor(result.text, editor, true, insertionPosition), reasons: result.reasons,
        apply: value => target.apply(value), pasteOriginal: () => target.apply(text) });
    }));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || !this.mime(file.extension)) return;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.file) return;
      menu.addItem(item => item.setTitle(this.t('common.menuTitle', { name: this.t('command.smart') })).setIcon('wand-sparkles').setDisabled(Boolean(this.modal))
        .onClick(() => void this.manual('smart', view.editor, view, file)));
    }));
  }
  onunload(): void { this.modal?.close(); }
  saveSettings(): Promise<void> {
    // Serialize writes so rapid setting edits cannot persist out of order.
    for (const { command, key, prefix } of this.localizedCommands) command.name = prefix + this.t(key);
    const snapshot = structuredClone(this.settings);
    this.settingsListeners.forEach(listener => listener());
    this.saveQueue = this.saveQueue.catch(() => {}).then(() => this.saveData(snapshot));
    return this.saveQueue;
  }
  private target(editor: Editor, owner: { file: TFile | null }): EditTarget {
    const file = owner.file;
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = activeView?.file;
    return new EditTarget(editor, () => this.app.workspace.getActiveViewOfType(MarkdownView) === activeView && activeView?.file === activeFile && owner.file === file, this.t);
  }
  private openPreview(options: Omit<ConstructorParameters<typeof PreviewModal>[1], 'closed'>): void {
    if (this.modal) { new Notice(this.t('preview.alreadyOpen')); return; }
    this.modal = new PreviewModal(this.app, { t: this.t, ...options, closed: () => { this.modal = undefined; } });
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
    if (mode === 'rules' && !selection) { new Notice(this.t('input.selectText')); return; }
    if (selection.length > 200000) { new Notice(this.t('input.tooLong')); return; }
    if (mode === 'rules') {
      const before = editor.getRange({ line: 0, ch: 0 }, target.from);
      const result = convertRules(selection, this.settings.rules, { beforeCursor: before }, this.t);
      this.openPreview({ ...this.rulePreviewOptions(view.file?.path ?? '', text => text, before), source: selection, result: result.text, reasons: result.reasons, apply: text => target.apply(text) });
      return;
    }
    this.openPreview({
      ...this.smartPreviewOptions(view.file?.path ?? ''),
      source: imageFile ? `![[${imageFile.path}]]` : selection,
      apply: text => target.apply(this.atCursor(text, editor, !selection, target.from))
    });
  }
  private rulePreviewOptions(sourcePath: string, format: (text: string) => string = text => text, beforeCursor = '', lineBeforeCursor?: string): Pick<PreviewOptions, 'rules' | 'generate' | 'temporaryInstructions'> {
    const t = this.t;
    const smart = this.smartPreviewOptions(sourcePath);
    return {
      ...smart,
      generate: async (signal, input, instructions) => format(await smart.generate(signal, input, instructions)),
      rules: {
        get: () => this.settings.rules,
        convert: source => {
          const result = convertRules(source, this.settings.rules, { beforeCursor, lineBeforeCursor }, t);
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
          if (!settings) { new Notice(t('preview.openSettingsHint')); return; }
          settings.open();
          settings.openTabById(this.manifest.id);
          this.settingTab.focusRules();
        }
      }
    };
  }
  private smartPreviewOptions(sourcePath: string): Required<Pick<PreviewOptions, 'generate' | 'temporaryInstructions'>> {
    const t = this.t;
    const currentApi = (mode: 'text' | 'image') => mode === 'image' ? this.settings.imageApi : this.settings.textApi;
    return {
      temporaryInstructions: {
        get: () => this.settings.temporaryInstructions,
        save: async value => { this.settings.temporaryInstructions = value; await this.saveSettings(); }
      },
      generate: async (signal, input, instructions) => {
        const resolved = await resolveConversionInput(input, path => this.readImage(path, sourcePath, t), t);
        const mode = conversionMode(resolved);
        // Read the latest configuration at send time, including the editable base prompt.
        const api = { ...currentApi(mode) };
        const timeoutSeconds = this.settings.timeoutSeconds;
        return convertWithApi({
          t, api, key: this.app.secretStorage.getSecret(api.secretName) ?? '', mode,
          input: resolved.text, images: resolved.images, instructions, timeoutSeconds, signal,
          request: async request => {
            const response = await requestUrl(request);
            return { status: response.status, json: response.status >= 200 && response.status < 300 ? response.json : null };
          }
        });
      }
    };
  }
  private async readImage(path: string, sourcePath: string, t: Translator = this.t): Promise<string> {
    if (/^https:\/\//i.test(path)) {
      let url: URL;
      try { url = new URL(path); }
      catch { throw new UserFacingError('image.invalidUrl', {}, t); }
      if (url.username || url.password) throw new UserFacingError('image.urlCredentials', {}, t);
      return url.toString();
    }
    const dataImage = /^data:image\/(?:png|jpeg|webp|gif);base64,([a-z\d+/]+=*)$/i.exec(path);
    if (dataImage) {
      const bytes = dataImage[1].length * 3 / 4 - (dataImage[1].match(/=+$/)?.[0].length ?? 0);
      if (bytes > 10 * 1024 * 1024) throw new UserFacingError('image.tooLarge', {}, t);
      return path;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(path)) throw new UserFacingError('image.sourceRequired', {}, t);
    try { path = decodeURIComponent(path); } catch { /* use literal path */ }
    const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (!file) throw new UserFacingError('image.notFound', {}, t);
    const mime = this.mime(file.extension);
    if (!mime || !file.stat.size || file.stat.size > 10 * 1024 * 1024) throw new UserFacingError('image.invalidFile', {}, t);
    try { return `data:${mime};base64,${arrayBufferToBase64(await this.app.vault.readBinary(file))}`; }
    catch { throw new UserFacingError('image.readFileFailed', {}, t); }
  }
  private mime(extension: string): string | undefined {
    return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>)[extension.toLowerCase()];
  }
}
