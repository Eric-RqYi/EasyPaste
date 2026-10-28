import { App, ButtonComponent, Component, MarkdownRenderer, Modal, Notice } from 'obsidian';
import { diffWordsWithSpace } from 'diff';

export interface PreviewOptions {
  source: string;
  result?: string;
  reasons?: string[];
  image?: string;
  remoteLabel?: string;
  generate?: (signal: AbortSignal, image?: string) => Promise<string>;
  apply: (text: string) => void;
  pasteOriginal?: () => void;
  closed: () => void;
}
export class PreviewModal extends Modal {
  private result: string | undefined;
  private image: string | undefined;
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
    this.image = options.image;
  }
  onOpen(): void {
    this.renderer.load();
    this.modalEl.addClass('easypaste-modal');
    this.setTitle('EasyPaste');
    const root = this.contentEl;
    root.createEl('p', { cls: 'easypaste-subtitle', text: this.options.generate
      ? '转换结果先预览，确认后写入笔记。' : '本地规则转换 · 确认后写入笔记' });
    if (this.options.remoteLabel) {
      root.createEl('p', { cls: 'easypaste-disclosure', text: `点击「发送并转换」将把下方内容发送至 ${this.options.remoteLabel}。` });
    }
    if (this.options.reasons?.length) {
      const tags = root.createDiv('easypaste-tags');
      this.options.reasons.forEach(reason => tags.createSpan({ text: reason }));
    }
    if (this.options.image !== undefined) this.buildImageInput(root);
    if (this.options.source) {
      const source = root.createEl('details', { cls: 'easypaste-original' });
      source.createEl('summary', { text: '查看原文' });
      source.createEl('pre', { text: this.options.source });
    }
    this.status = root.createEl('p', { cls: 'easypaste-status', attr: { role: 'status', 'aria-live': 'polite' } });
    const tabs = root.createDiv('easypaste-tabs');
    const panels = root.createDiv();
    this.workspace = panels.createDiv('easypaste-diff');
    this.workspace.setAttribute('aria-label', '改动对比：绿色为新增，红色删除线为删除');
    this.textarea = panels.createEl('textarea', { cls: 'easypaste-editor', attr: { 'aria-label': '编辑转换结果', spellcheck: 'false' } });
    this.textarea.hidden = true;
    const rendered = panels.createDiv('easypaste-rendered markdown-rendered');
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
        if (i === 2) {
          const version = ++this.renderVersion;
          rendered.empty();
          // Render only on explicit user action. No source is injected as HTML.
          void MarkdownRenderer.render(this.app, this.result ?? '', rendered, '', this.renderer).catch(() => {
            if (!this.closed && version === this.renderVersion) rendered.setText('排版预览失败，请查看编辑结果。');
          });
        }
      });
    }
    this.textarea.addEventListener('input', () => {
      this.result = this.textarea.value;
      this.applyButton.setDisabled(!this.result.length);
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
        if (this.result === undefined || !this.result.length || this.controller) return;
        this.options.apply(this.result);
        this.close();
        new Notice('EasyPaste：已应用，可用撤销恢复');
      } catch (e) { this.showError(e); }
    });
    this.textarea.value = this.result ?? '';
    this.drawDiff();
  }
  private buildImageInput(root: HTMLElement): void {
    const zone = root.createDiv('easypaste-image-input');
    zone.tabIndex = 0;
    zone.setAttribute('aria-label', '图片输入区，可粘贴图片或选择文件');
    zone.createEl('p', { text: '在此粘贴图片，或选择 PNG / JPEG / WebP / GIF（最多 10 MB）' });
    const picker = zone.createEl('input', { type: 'file', attr: { accept: 'image/png,image/jpeg,image/webp,image/gif', 'aria-label': '选择图片' } });
    const thumbnail = zone.createEl('img', { cls: 'easypaste-thumbnail', attr: { alt: '待识别图片' } });
    thumbnail.hidden = !this.image;
    if (this.image) thumbnail.src = this.image;
    const setImage = async (file: File) => {
      if (this.controller) return;
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024 || !file.size) {
        this.showError(new Error('请选择不超过 10 MB 的 PNG、JPEG、WebP 或 GIF 图片。')); return;
      }
      try {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('无法读取图片。'));
          reader.readAsDataURL(file);
        });
        if (this.closed || this.controller) return;
        this.image = data;
        thumbnail.src = data;
        thumbnail.hidden = false;
        this.result = undefined;
        this.textarea.value = '';
        this.applyButton.setDisabled(true);
        this.drawDiff();
        this.status.setText('图片已就绪，点击「发送并转换」开始识别。');
      } catch (e) { this.showError(e); }
    };
    picker.addEventListener('change', () => { if (picker.files?.[0]) void setImage(picker.files[0]); });
    this.contentEl.addEventListener('paste', event => {
      const file = [...(event.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/'));
      if (file) { event.preventDefault(); void setImage(file); }
    });
    zone.focus();
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
    const changes = diffWordsWithSpace(this.options.source, this.result, { timeout: 100, maxEditLength: 4000 });
    if (!changes) {
      pre.createEl('del', { text: this.options.source, cls: 'easypaste-removed' });
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
    if (this.controller || !this.options.generate) return;
    if (this.options.image !== undefined && !this.image) { this.showError(new Error('请先粘贴或选择一张图片。')); return; }
    this.controller = new AbortController();
    this.status.removeClass('easypaste-error');
    this.status.setText('正在转换… 关闭窗口可停止等待。');
    this.generateButton?.setDisabled(true);
    this.applyButton.setDisabled(true);
    this.textarea.disabled = true;
    try {
      const result = await this.options.generate(this.controller.signal, this.image);
      if (this.closed) return;
      this.result = result;
      this.textarea.value = result;
      this.drawDiff();
      this.status.setText('转换完成。请检查文字、公式与格式，再确认应用。');
    } catch (e) { if (!this.closed) this.showError(e); }
    finally {
      this.controller = undefined;
      if (!this.closed) {
        this.generateButton?.setDisabled(false);
        this.applyButton.setDisabled(!this.result?.length);
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
