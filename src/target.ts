export interface TextEditor {
  getValue(): string;
  getRange(from: {line: number; ch: number}, to: {line: number; ch: number}): string;
  getCursor(which?: 'from' | 'to'): {line: number; ch: number};
  replaceRange(text: string, from: {line: number; ch: number}, to: {line: number; ch: number}): void;
}
/** A snapshot prevents an async response overwriting edits or another note. */
export class EditTarget {
  private readonly document: string;
  readonly from: {line: number; ch: number};
  readonly to: {line: number; ch: number};
  readonly original: string;
  constructor(private readonly editor: TextEditor, private readonly valid: () => boolean) {
    this.document = editor.getValue();
    this.from = { ...editor.getCursor('from') };
    this.to = { ...editor.getCursor('to') };
    this.original = editor.getRange(this.from, this.to);
  }
  apply(text: string): void {
    if (!this.valid() || this.editor.getValue() !== this.document) {
      throw new Error('原笔记已编辑、关闭或切换，请重新选择内容后转换。转换结果仍保留在预览中。');
    }
    this.editor.replaceRange(text, this.from, this.to);
  }
}
