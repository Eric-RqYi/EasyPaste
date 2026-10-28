import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditTarget } from '../src/target';
import { isProtectedContext } from '../src/context';
const editor = () => ({
  value: 'hello world', getValue() { return this.value; },
  getRange() { return 'world'; }, getCursor(which?: 'from' | 'to') { return { line: 0, ch: which === 'from' ? 6 : 11 }; },
  replaceRange(text: string) { this.value = 'hello ' + text; }
});
test('applies only to unchanged original editor', () => {
  const e = editor(); const target = new EditTarget(e, () => true);
  target.apply('clean'); assert.equal(e.value, 'hello clean');
});
test('blocks edits and note switches during preview', () => {
  const e = editor(); const target = new EditTarget(e, () => true);
  e.value = 'user edit'; assert.throws(() => target.apply('wrong'), /已编辑/);
  assert.equal(e.value, 'user edit');
  assert.throws(() => new EditTarget(editor(), () => false).apply('wrong'), /已编辑/);
});
test('automatic paste skips code, frontmatter, inline and display math', () => {
  for (const input of ['```ts\n', '~~~\nabc', '---\nkey: ', 'text `code ', '$x', '$$\nx', '\\[\nx', '\\(x']) assert.equal(isProtectedContext(input), true, input);
  for (const input of ['plain text', '```\ncode\n```\n', '---\nkey: value\n---\n', '$x$ text ', '$$\nx\n$$\n']) assert.equal(isProtectedContext(input), false, input);
});
