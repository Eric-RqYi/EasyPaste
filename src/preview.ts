import { App, ButtonComponent, Component, MarkdownRenderer, Modal, Notice } from 'obsidian';
import { renderRuleList } from './rule-list';
import type { RuleOptions } from './settings';
import type { RuleResult } from './rules';
import { diffWordsWithSpace } from 'diff';
import { type ConversionInput } from './input';

export interface PreviewOptions {
  source: string;
  result?: string;
  reasons?: string[];
  generate?: (signal: AbortSignal, input: ConversionInput, instructions: string) => Promise<string>;
  temporaryInstructions?: {
    get: () => string;
    save: (value: string) => Promise<void>;
  };
  rules?: {
    get: () => RuleOptions;
    convert: (source: string) => RuleResult;
    save: () => Promise<void>;
    subscribe: (listener: () => void) => () => void;
    openSettings: () => void;
  };
  apply: (text: string) => void;
  pasteOriginal?: () => void;
  closed: () => void;
}
export class PreviewModal extends Modal {
  private result: string | undefined;
  private source: string;
  private images: { data: string; name: string }[] = [];
  private inputRoot?: HTMLElement;
  private sourceInput?: HTMLTextAreaElement;
  private instructionsRoot?: HTMLElement;
  private instructionsInput?: HTMLTextAreaElement;
  private reasonTags?: HTMLElement;
  private rendered!: HTMLElement;
  private pendingImageReads = 0;
  private controller?: AbortController;
  private status!: HTMLElement;
  private original!: HTMLElement;
  private highlights!: HTMLElement;
  private editorPane!: HTMLElement;
  private originalPane!: HTMLElement;
  private renderedPane!: HTMLElement;
  private layout!: HTMLElement;
  private rulePanel?: HTMLElement;
  private ruleList?: HTMLElement;
  private ruleSignature = '';
  private unsubscribeRules?: () => void;
  private view: 'diff' | 'preview' = 'diff';
  private composing = false;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private markdownComponent?: Component;
  private textarea!: HTMLTextAreaElement;
  private applyButton!: ButtonComponent;
  private generateButton?: ButtonComponent;
  private enterButton?: ButtonComponent;
  private closed = false;
  private diffTimer?: ReturnType<typeof setTimeout>;
  private renderVersion = 0;
  private readonly renderer = new Component();
  constructor(app: App, private options: PreviewOptions) {
    super(app);
    this.result = options.result;
    this.source = options.source;
  }
  onOpen(): void {
    this.renderer.load();
    this.modalEl.addClass('easypaste-modal');
    this.setTitle(this.options.rules ? 'EasyPaste：规则转换' : 'EasyPaste：智能转换');
    const root = this.contentEl;
    this.reasonTags = root.createDiv('easypaste-tags');
    this.setReasons(this.options.reasons ?? []);
    if (this.options.generate && !this.options.rules) this.buildInput(root);
    if (this.options.generate && this.options.temporaryInstructions) this.buildInstructions(root);
    this.status = root.createEl('p', { cls: 'easypaste-status', attr: { role: 'status', 'aria-live': 'polite' } });
    const toolbar = root.createDiv('easypaste-preview-toolbar');
    const tabs = toolbar.createDiv('easypaste-tabs');
    const tabButtons: HTMLButtonElement[] = [];
    for (const [index, title] of ['差异', '预览'].entries()) {
      const button = tabs.createEl('button', { text: title, attr: { type: 'button', 'aria-pressed': String(index === 0) } });
      tabButtons.push(button);
      button.addEventListener('click', () => {
        this.view = index === 0 ? 'diff' : 'preview';
        this.originalPane.hidden = index !== 0;
        this.renderedPane.hidden = index !== 1;
        this.layout.toggleClass('easypaste-preview-mode', index === 1);
        this.editorPane.firstElementChild?.setText(index === 0 ? '转换结果 · 可编辑 · 绿色为新增' : 'Markdown · 可编辑');
        tabButtons.forEach((b, n) => b.setAttribute('aria-pressed', String(n === index)));
        this.drawDiff();
        if (index === 1) this.renderMarkdown();
        body.focus();
      });
    }
    const body = root.createDiv({ cls: 'easypaste-preview-body', attr: {
      tabindex: '0', role: 'region', 'aria-label': '转换预览'
    } });
    this.layout = body.createDiv('easypaste-preview-layout');
    this.originalPane = this.layout.createDiv('easypaste-pane easypaste-original-pane');
    this.originalPane.createDiv({ cls: 'easypaste-pane-title', text: '原文 · 红色删除线表示删除' });
    this.original = this.originalPane.createEl('pre', { cls: 'easypaste-original-text' });
    this.editorPane = this.layout.createDiv('easypaste-pane easypaste-result-pane');
    this.editorPane.createDiv({ cls: 'easypaste-pane-title', text: '转换结果 · 可编辑 · 绿色为新增' });
    const editor = this.editorPane.createDiv('easypaste-editor-stack');
    this.highlights = editor.createEl('pre', { cls: 'easypaste-editor-highlights', attr: { 'aria-hidden': 'true' } });
    this.textarea = editor.createEl('textarea', { cls: 'easypaste-editor', attr: {
      'aria-label': '编辑转换结果', spellcheck: 'false', wrap: 'soft'
    } });
    this.textarea.addEventListener('scroll', () => this.syncEditorScroll());
    this.textarea.addEventListener('compositionstart', () => { this.composing = true; });
    this.textarea.addEventListener('compositionend', () => { this.composing = false; this.resultEdited(); });
    this.textarea.addEventListener('input', () => this.resultEdited());
    this.renderedPane = this.layout.createDiv('easypaste-pane easypaste-rendered-pane');
    this.renderedPane.hidden = true;
    this.renderedPane.createDiv({ cls: 'easypaste-pane-title', text: '实时排版' });
    this.rendered = this.renderedPane.createDiv('easypaste-rendered markdown-rendered');
    if (this.options.rules) {
      const configure = new ButtonComponent(toolbar).setButtonText('配置规则').onClick(() => {
        const expanded = this.rulePanel!.hidden;
        this.rulePanel!.hidden = !expanded;
        configure.buttonEl.setAttribute('aria-expanded', String(expanded));
        this.modalEl.toggleClass('easypaste-with-rules', expanded);
      });
      configure.buttonEl.addClass('easypaste-configure-rules');
      configure.buttonEl.setAttribute('aria-expanded', 'false');
      configure.buttonEl.setAttribute('aria-controls', 'easypaste-preview-rules');
      this.rulePanel = this.modalEl.createEl('aside', { cls: 'easypaste-rule-panel', attr: { id: 'easypaste-preview-rules', 'aria-label': '快速配置规则' } });
      this.rulePanel.hidden = true;
      this.rulePanel.createEl('h3', { text: '规则配置' });
      this.rulePanel.createEl('p', { cls: 'easypaste-subtitle', text: '从上到下执行。更改规则会从原文重新生成结果，覆盖手动编辑。' });
      this.ruleList = this.rulePanel.createDiv('easypaste-quick-rules');
      const settings = this.rulePanel.createDiv('easypaste-rule-panel-footer');
      new ButtonComponent(settings).setIcon('settings').setButtonText('打开规则设置').onClick(() => this.options.rules!.openSettings());
      this.ruleSignature = JSON.stringify(this.options.rules.get());
      this.drawRules();
      this.unsubscribeRules = this.options.rules.subscribe(() => {
        const signature = JSON.stringify(this.options.rules!.get());
        if (signature === this.ruleSignature) return;
        this.ruleSignature = signature;
        this.drawRules();
        this.refreshRules();
      });
    }
    const footer = root.createDiv('easypaste-actions');
    new ButtonComponent(footer).setButtonText('取消').onClick(() => this.close());
    if (this.options.pasteOriginal) new ButtonComponent(footer).setButtonText('粘贴原文').onClick(() => {
      try { this.options.pasteOriginal!(); this.close(); } catch (e) { this.showError(e); }
    });
    if (this.options.generate) {
      this.generateButton = new ButtonComponent(footer).setButtonText(this.options.rules ? '使用 LLM 智能转换' : '发送并转换').onClick(() => void this.generate());
    }
    this.applyButton = new ButtonComponent(footer).setButtonText('确认应用').setCta().setDisabled(this.result === undefined || !this.result.length).onClick(() => {
      try {
        if (this.result === undefined || !this.result.length || this.controller || this.pendingImageReads) return;
        this.options.apply(this.result);
        this.close();
        new Notice('EasyPaste：已应用，可用撤销恢复');
      } catch (e) { this.showError(e); }
    });
    const isPreviewTarget = (target: EventTarget | null): target is HTMLElement => {
      const element = target as HTMLElement | null;
      return !!element && body.contains(element)
        && !element.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="textbox"]');
    };
    body.addEventListener('click', event => {
      if (isPreviewTarget(event.target)) body.focus({ preventScroll: true });
    });
    const handleEnter = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isPreviewTarget(event.target)) return;
      if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing || event.keyCode === 229 || this.composing || this.closed) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) this.enterButton?.buttonEl.click();
      return false;
    };
    // Obsidian routes shortcuts through the modal scope before DOM listeners.
    this.scope.register([], 'Enter', handleEnter);
    body.addEventListener('keydown', handleEnter, true);
    this.textarea.value = this.result ?? '';
    this.updateInputState();
    this.drawDiff();
    if (this.sourceInput) this.sourceInput.focus();
    else body.focus();
  }
  private input(): ConversionInput {
    return { text: this.source, images: this.images.map(image => image.data) };
  }
  private updateInputState(): void {
    const busy = Boolean(this.controller) || this.pendingImageReads > 0;
    this.generateButton?.setDisabled(busy || (!this.source.trim() && !this.images.length));
    this.applyButton.setDisabled(busy || !this.result?.length);
    this.enterButton = busy ? undefined
      : this.options.rules || this.result !== undefined ? this.applyButton : this.generateButton;
    if (this.enterButton?.buttonEl.disabled) this.enterButton = undefined;
    for (const button of [this.generateButton, this.applyButton]) {
      if (!button) continue;
      const active = button === this.enterButton;
      button.buttonEl.toggleClass('easypaste-enter-action', active);
      button.buttonEl.setAttribute('aria-keyshortcuts', active ? 'Enter' : '');
    }
    this.textarea.disabled = Boolean(this.controller);
    if (this.ruleList) this.ruleList.inert = Boolean(this.controller);
    this.inputRoot?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input, textarea, button')
      .forEach(control => { control.disabled = Boolean(this.controller); });
    this.instructionsRoot?.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>('textarea, button')
      .forEach(control => { control.disabled = Boolean(this.controller); });
  }
  private buildInstructions(root: HTMLElement): void {
    const zone = this.instructionsRoot = root.createDiv('easypaste-temporary-instructions');
    const label = zone.createEl('label', { text: '智能转换临时要求' });
    const row = label.createDiv('easypaste-instructions-row');
    const input = this.instructionsInput = row.createEl('textarea', { attr: {
      'aria-label': '智能转换临时要求', rows: '2', placeholder: '例如：保留英文原文，只整理列表和公式。', spellcheck: 'false'
    } });
    input.value = this.options.temporaryInstructions!.get();
    const save = () => {
      void this.options.temporaryInstructions!.save(input.value).catch(() => {
        if (!this.closed) this.showError(new Error('临时要求保存失败，请重试。'));
      });
    };
    input.addEventListener('input', save);
    const clear = new ButtonComponent(row).setIcon('x').setTooltip('清空临时要求').onClick(() => {
      if (this.controller) return;
      input.value = '';
      save();
      input.focus();
    });
    clear.buttonEl.setAttribute('aria-label', '清空临时要求');
  }
  private invalidateResult(): void {
    clearTimeout(this.diffTimer);
    clearTimeout(this.renderTimer);
    this.result = undefined;
    this.textarea.value = '';
    if (this.markdownComponent) this.renderer.removeChild(this.markdownComponent);
    this.markdownComponent = undefined;
    this.renderVersion++;
    this.rendered.empty();
    this.drawDiff();
    this.updateInputState();
    this.status.removeClass('easypaste-error');
    this.status.setText('输入已更新，点击「发送并转换」生成结果。');
  }
  private buildInput(root: HTMLElement): void {
    const zone = this.inputRoot = root.createDiv('easypaste-input');
    const label = zone.createEl('label', { text: '待转换内容（可粘贴文本或图片）' });
    this.sourceInput = label.createEl('textarea', { cls: 'easypaste-source', attr: {
      'aria-label': '待转换文本', placeholder: '在此粘贴文本，或添加图片。', spellcheck: 'false'
    } });
    this.sourceInput.value = this.source;
    this.sourceInput.addEventListener('input', () => {
      this.source = this.sourceInput!.value;
      this.invalidateResult();
    });
    zone.createEl('p', { cls: 'easypaste-subtitle', text: '图片支持 PNG / JPEG / WebP / GIF，每张最多 10 MB。' });
    const picker = zone.createEl('input', { type: 'file', attr: { multiple: '', accept: 'image/png,image/jpeg,image/webp,image/gif', 'aria-label': '添加图片' } });
    const thumbnails = zone.createDiv('easypaste-images');
    const drawImages = () => {
      thumbnails.empty();
      this.images.forEach((image, index) => {
        const card = thumbnails.createDiv('easypaste-image-input');
        card.createEl('img', { cls: 'easypaste-thumbnail', attr: { src: image.data, alt: image.name } });
        new ButtonComponent(card).setButtonText(`移除图片 ${index + 1}`).onClick(() => {
          if (this.controller) return;
          this.images.splice(index, 1);
          drawImages();
          this.invalidateResult();
        });
      });
    };
    const addImages = async (files: File[]) => {
      if (this.controller || !files.length) return;
      if (files.some(file => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024 || !file.size)) {
        this.showError(new Error('请选择不超过 10 MB 的 PNG、JPEG、WebP 或 GIF 图片。')); return;
      }
      this.pendingImageReads++;
      this.invalidateResult();
      this.status.setText('正在读取图片…');
      try {
        const images = await Promise.all(files.map(async file => ({ name: file.name || '粘贴的图片', data: await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('无法读取图片。'));
          reader.onabort = () => reject(new Error('图片读取已取消。'));
          reader.readAsDataURL(file);
        }) })));
        if (this.closed) return;
        this.images.push(...images);
        drawImages();
        this.invalidateResult();
      } catch (e) { if (!this.closed) this.showError(e); }
      finally {
        this.pendingImageReads--;
        if (!this.closed) this.updateInputState();
      }
    };
    picker.addEventListener('change', () => {
      void addImages([...(picker.files ?? [])]);
      picker.value = '';
    });
    this.contentEl.addEventListener('paste', event => {
      const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'));
      if (files.length) { event.preventDefault(); void addImages(files); }
    });
  }
  private setReasons(reasons: string[]): void {
    this.reasonTags?.empty();
    if (!this.reasonTags) return;
    this.reasonTags.hidden = !reasons.length;
    reasons.forEach(text => this.reasonTags!.createSpan({ text }));
  }
  private syncEditorScroll(): void {
    this.highlights.scrollTop = this.textarea.scrollTop;
    this.highlights.scrollLeft = this.textarea.scrollLeft;
  }
  private resultEdited(): void {
    this.result = this.textarea.value;
    this.renderVersion++;
    this.updateInputState();
    clearTimeout(this.diffTimer);
    clearTimeout(this.renderTimer);
    if (this.composing) return;
    this.diffTimer = setTimeout(() => this.drawDiff(), 120);
    if (this.view === 'preview') this.renderTimer = setTimeout(() => this.renderMarkdown(), 180);
  }
  private drawRules(): void {
    if (!this.ruleList || !this.options.rules || this.closed) return;
    renderRuleList(this.ruleList, this.options.rules.get(), () => {
      // Local controls already reflect the edit. Keep their focus while saving;
      // only external settings changes need to rebuild the sidebar.
      this.ruleSignature = JSON.stringify(this.options.rules!.get());
      this.refreshRules();
      void this.options.rules!.save().catch(error => { if (!this.closed) this.showError(error); });
    });
  }
  private refreshRules(): void {
    if (this.closed || !this.options.rules || this.controller) return;
    const result = this.options.rules.convert(this.source);
    this.setResult(result.text);
    this.setReasons(result.reasons);
    this.status.removeClass('easypaste-error');
    this.status.setText(result.reasons.length ? `已实时更新：${result.reasons.join('；')}` : '当前规则没有改变原文。');
  }
  private setResult(text: string): void {
    clearTimeout(this.diffTimer);
    clearTimeout(this.renderTimer);
    this.result = text;
    this.textarea.value = text;
    this.drawDiff();
    if (this.view === 'preview') this.renderMarkdown();
    this.updateInputState();
  }
  private renderMarkdown(): void {
    clearTimeout(this.renderTimer);
    const version = ++this.renderVersion;
    // Render offscreen: a slow previous render must never overwrite a newer edit.
    const staging = this.rendered.ownerDocument.createElement('div');
    const component = new Component();
    this.renderer.addChild(component);
    void MarkdownRenderer.render(this.app, this.result ?? '', staging, '', component).then(() => {
      if (this.closed || version !== this.renderVersion) { this.renderer.removeChild(component); return; }
      if (this.markdownComponent) this.renderer.removeChild(this.markdownComponent);
      this.markdownComponent = component;
      this.rendered.replaceChildren(...Array.from(staging.childNodes));
    }).catch(() => {
      this.renderer.removeChild(component);
      if (!this.closed && version === this.renderVersion) this.rendered.setText('排版预览失败，请在左侧编辑结果。');
    });
  }
  private drawDiff(): void {
    if (this.closed) return;
    this.original.empty();
    this.highlights.empty();
    if (this.result === undefined) {
      this.original.setText(this.source);
      this.textarea.placeholder = '转换后可在这里编辑结果。';
      return;
    }
    const changes = diffWordsWithSpace(this.source, this.result, { timeout: 100, maxEditLength: 4000 }) ?? [
      { value: this.source, removed: true, added: false }, { value: this.result, added: true, removed: false }
    ];
    for (const part of changes) {
      if (!part.added) this.original.createEl(part.removed ? 'del' : 'span', {
        text: part.value, cls: part.removed ? 'easypaste-removed' : ''
      });
      if (!part.removed) this.highlights.createSpan({
        text: part.value, cls: part.added && this.view === 'diff' ? 'easypaste-added' : ''
      });
    }
    // Keep the last empty line the same height as the textarea's last line.
    this.highlights.createSpan({ text: '\u200b' });
    this.syncEditorScroll();
  }
  private showError(error: unknown): void {
    this.status.setText(error instanceof Error ? error.message : '操作失败，请重试。');
    this.status.addClass('easypaste-error');
  }
  private async generate(): Promise<void> {
    if (this.controller || this.pendingImageReads || !this.options.generate) return;
    if (!this.source.trim() && !this.images.length) { this.showError(new Error('请先粘贴文本或添加图片。')); return; }
    this.controller = new AbortController();
    this.status.removeClass('easypaste-error');
    this.status.setText('正在转换… 关闭窗口可停止等待。');
    this.updateInputState();
    this.textarea.disabled = true;
    try {
      const result = await this.options.generate(this.controller.signal, this.input(), this.instructionsInput?.value ?? '');
      if (this.closed) return;
      this.setResult(result);
      this.setReasons(['LLM 智能转换']);
      this.status.setText('转换完成。请检查文字、公式与格式，再确认应用。');
    } catch (e) { if (!this.closed) this.showError(e); }
    finally {
      this.controller = undefined;
      if (!this.closed) {
        this.updateInputState();
        this.textarea.disabled = false;
      }
    }
  }
  onClose(): void {
    this.closed = true;
    this.renderVersion++;
    this.unsubscribeRules?.();
    this.controller?.abort();
    this.renderer.unload();
    clearTimeout(this.diffTimer);
    clearTimeout(this.renderTimer);
    this.contentEl.empty();
    this.options.closed();
  }
}
