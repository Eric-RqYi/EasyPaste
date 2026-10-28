import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertRules } from '../src/rules';
import { DEFAULT_SETTINGS } from '../src/settings';

const options = () => structuredClone(DEFAULT_SETTINGS.rules);
const clean = (text: string) => convertRules(text, options()).text;
test('repairs known PDF hyphenation and soft hyphens, keeps genuine compounds', () => {
  assert.equal(clean('infor-\nmation and repre-\nsentation'), 'information and representation');
  assert.equal(clean('infor\u00AD\nmation'), 'information');
  assert.equal(clean('infor-mation and neural-network'), 'information and neural-network');
  assert.equal(clean('state-of-the-art and well-\nknown'), 'state-of-the-art and well-\nknown');
});
test('splits only explicit or uniquely supported glued words; preserves capitalization', () => {
  assert.equal(clean('Ofthe neuralnetwork and languageprocessing.'), 'Of the neural network and language processing.');
  assert.equal(clean('another Attention unknownword'), 'another Attention unknownword');
  const opts = options(); opts.vocabulary = 'abcdef abc def abcd ef';
  assert.equal(convertRules('abcdef', opts).text, 'abcdef');
});
test('ambiguity does not cause arbitrary segmentation', () => {
  const opts = options(); opts.vocabulary = 'abc defghi abcd efghi';
  assert.equal(convertRules('abcdefghi', opts).text, 'abcdefghi');
});
test('normalizes bullets, infers nested symbols, returns to parent, aligns continuation', () => {
  const text = '· Parent\nwrap\n○ Child\nchild wrap\n· Parent two';
  assert.equal(clean(text), '- Parent\n  wrap\n    - Child\n      child wrap\n- Parent two');
});
test('preserves explicit indentation and numbered item content width', () => {
  assert.equal(clean('  • A\n    ◦ B\n    wrap\n  • C'), '  - A\n      - B\n        wrap\n  - C');
  assert.equal(clean('9) nine\n10) ten\nwrapped'), '9. nine\n10. ten\n    wrapped');
});
test('numeric/alpha/roman markers support mixed nesting and parent reset', () => {
  assert.equal(clean('1) Parent\na) Child\nb) Child two\n2) Parent two'), '1. Parent\n    1. Child\n    2. Child two\n2. Parent two');
  assert.equal(clean('i) one\nii) two\niii) three'), '1. one\n2. two\n3. three');
  assert.equal(clean('I. one\nII. two\nIII. three'), '1. one\n2. two\n3. three');
  assert.equal(clean('1、你好\n2．再见'), '1. 你好\n    2. 再见');
});
test('already valid Markdown is idempotent', () => {
  const input = '- First\n  continued\n    - Nested\n      nested wrap\n- Second\n\n1. One\n2. Two';
  assert.equal(clean(input), input);
  const dirty = '· Parent\n○ Child\n· Parent two';
  assert.equal(clean(clean(dirty)), clean(dirty));
});
test('protects fenced code, inline code, LaTeX, links, YAML, and HTML', () => {
  const input = '---\nname: ofthe\n---\n\n```text\n· code ofthe\n```\n\n`ofthe` $ofthe$ $$\n· ofthe\n$$\n\\[ofthe\\] \\(ofthe\\)\n[ofthe](https://example.com/ofthe) ![[ofthe]]\n<a title="ofthe">\n\n· text ofthe';
  assert.equal(clean(input), input.slice(0, input.lastIndexOf('· text ofthe')) + '- text of the');
});
test('blank lines stop accidental continuation; horizontal rules remain', () => {
  assert.equal(clean('· item\n\nA new paragraph\n---'), '- item\n\nA new paragraph\n---');
  assert.equal(clean('---\n***\n___'), '---\n***\n___');
});
test('rules can be independently disabled', () => {
  const opts = options(); opts.words = false; opts.lists = false;
  assert.equal(convertRules('· ofthe', opts).text, '· ofthe');
  opts.joinWrappedLines = true;
  assert.equal(convertRules('ordinary\nparagraph\n\nnext', opts).text, 'ordinary paragraph\n\nnext');
});
test('does not auto-open unchanged content', () => {
  assert.deepEqual(convertRules('正常的粘贴，without problems.', options()), { text: '正常的粘贴，without problems.', reasons: [] });
  assert.deepEqual(convertRules('Windows text\r\nsecond line', options()), { text: 'Windows text\r\nsecond line', reasons: [] });
});
