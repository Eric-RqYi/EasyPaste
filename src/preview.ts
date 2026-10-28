import { App, ButtonComponent, Component, MarkdownRenderer, Modal, Notice } from 'obsidian';
import { diffWordsWithSpace } from 'diff';
import { type ConversionInput } from './input';

export interface PreviewOptions {
  source: string;
  result?: string;
  reasons?: string[];
  remoteLabel?: (input: ConversionInput) => string;
  generate?: (signal: AbortSignal, input: ConversionInput) => Promise<string>;
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
  private disclosure?: HTMLElement;
  private rendered!: HTMLElement;
  private pendingImageReads = 0;
  private controller?: AbortController;
  private status!: HTMLElement;
  private workspace!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private applyButton!: ButtonComponent;
  private generateButton?: ButtonComponent;
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
    this.setTitle(this.options.generate ? 'EasyPaste：智能转换' : 'EasyPaste');
    const root = this.contentEl;
    root.createEl('p', { cls: 'easypaste-subtitle', text: this.options.generate
      ? '转换结果先预览，确认后写入笔记。' : '本地规则转换 · 确认后写入笔记' });
    if (this.options.remoteLabel) {
      this.disclosure = root.createEl('p', { cls: 'easypaste-disclosure' });
    }
    if (this.options.reasons?.length) {
      const tags = root.createDiv('easypaste-tags');
      this.options.reasons.forEach(reason => tags.createSpan({ text: reason }));
    }
    if (this.options.generate) this.buildInput(root);
    else if (this.options.source) {
      const source = root.createEl('details', { cls: 'easypaste-original' });
      source.createEl('summary', { text: '查看原文' });
      source.createEl('pre', { text: this.options.source });
    }
    this.status = root.createEl('p', { cls: 'easypaste-status', attr: { role: 'status', 'aria-live': 'polite' } });
    const tabs = root.createDiv('easypaste-tabs');
    const panels = root.createDiv();
    this.workspace = panels.createDiv('easypaste-diff');
    // this.workspace.setAttribute('aria-label', '改动对比：绿色为新增，红色删除线为删除');
    this.textarea = panels.createEl('textarea', { cls: 'easypaste-editor', attr: { 'aria-label': '编辑转换结果', spellcheck: 'false' } });
    this.textarea.hidden = true;
    const rendered = panels.createDiv('easypaste-rendered markdown-rendered');
    this.rendered = rendered;
    rendered.hidden = true;
    const tabButtons: HTMLButtonElement[] = [];
    for (const [i, title] of ['改动对比', '编辑结果', '排版预览'].entries()) {
      const button = tabs.createEl('button', { text: title });
      tabButtons.push(button);
      button.setAttribute('aria-pressed', String(i === 0));
      button.addEventListener('click', () => {
        this.workspace.hidden = i !== 0;
        this.textarea.hidden = i !== 1;
        rendered.hidden = i !== 2;
        tabButtons.forEach((b, n) => b.setAttribute('aria-pressed', String(n === i)));
        if (i === 0) this.drawDiff();
        if (i === 1) this.textarea.focus();
        if (i === 2) this.renderMarkdown();
      });
    }
    this.textarea.addEventListener('input', () => {
      this.result = this.textarea.value;
      this.updateInputState();
      clearTimeout(this.diffTimer);
      this.diffTimer = setTimeout(() => this.drawDiff(), 180);
    });
    const footer = root.createDiv('easypaste-actions');
    new ButtonComponent(footer).setButtonText('取消').onClick(() => this.close());
    if (this.options.pasteOriginal) new ButtonComponent(footer).setButtonText('粘贴原文').onClick(() => {
      try { this.options.pasteOriginal!(); this.close(); } catch (e) { this.showError(e); }
    });
    if (this.options.generate) {
      this.generateButton = new ButtonComponent(footer).setButtonText('发送并转换').onClick(() => void this.generate());
    }
    this.applyButton = new ButtonComponent(footer).setButtonText('确认应用').setCta().setDisabled(this.result === undefined || !this.result.length).onClick(() => {
      try {
        if (this.result === undefined || !this.result.length || this.controller || this.pendingImageReads) return;
        this.options.apply(this.result);
        this.close();
        new Notice('EasyPaste：已应用，可用撤销恢复');
      } catch (e) { this.showError(e); }
    });
    this.textarea.value = this.result ?? '';
    this.updateInputState();
    this.drawDiff();
    this.sourceInput?.focus();
  }
  private input(): ConversionInput {
    return { text: this.source, images: this.images.map(image => image.data) };
  }
  private updateInputState(): void {
    if (this.options.remoteLabel) this.disclosure?.setText(`点击「发送并转换」将把输入内容发送至所配置的远程模型`);
    const busy = Boolean(this.controller) || this.pendingImageReads > 0;
    this.generateButton?.setDisabled(busy || (!this.source.trim() && !this.images.length));
    this.applyButton.setDisabled(busy || !this.result?.length);
    this.inputRoot?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input, textarea, button')
      .forEach(control => { control.disabled = Boolean(this.controller); });
  }
  private invalidateResult(): void {
    this.result = undefined;
    this.textarea.value = '';
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
  private renderMarkdown(): void {
    const version = ++this.renderVersion;
    this.rendered.empty();
    // Render only when the user opens the preview tab. Never inject source HTML.
    void MarkdownRenderer.render(this.app, this.result ?? '', this.rendered, '', this.renderer).catch(() => {
      if (!this.closed && version === this.renderVersion) this.rendered.setText('排版预览失败，请查看编辑结果。');
    });
  }
  private drawDiff(): void {
    if (this.closed) return;
    this.workspace.empty();
    if (this.result === undefined) {
      this.workspace.createEl('p', { text: '转换后将在这里显示结果与修改。' }); return;
    }
    const legend = this.workspace.createDiv('easypaste-legend');
    legend.createSpan({ text: '＋ 新增', cls: 'easypaste-added' });
    legend.createSpan({ text: '− 删除', cls: 'easypaste-removed' });
    const pre = this.workspace.createEl('pre');
    const changes = diffWordsWithSpace(this.source, this.result, { timeout: 100, maxEditLength: 4000 });
    if (!changes) {
      pre.createEl('del', { text: this.source, cls: 'easypaste-removed' });
      pre.createEl('ins', { text: this.result, cls: 'easypaste-added' });
      this.workspace.createEl('p', { text: '改动较大，已高亮完整替换。', cls: 'easypaste-status' });
      return;
    }
    for (const part of changes) pre.createEl(part.added ? 'ins' : part.removed ? 'del' : 'span', {
      text: part.value, cls: part.added ? 'easypaste-added' : part.removed ? 'easypaste-removed' : ''
    });
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
      const result = await this.options.generate(this.controller.signal, this.input());
      if (this.closed) return;
      this.result = result;
      this.textarea.value = result;
      this.drawDiff();
      if (!this.rendered.hidden) this.renderMarkdown();
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
    this.controller?.abort();
    this.renderer.unload();
    clearTimeout(this.diffTimer);
    this.contentEl.empty();
    this.options.closed();
  }
}
