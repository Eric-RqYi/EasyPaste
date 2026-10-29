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
  assert.equal(clean('state-of-the-art and well-\nknown'), 'state-of-the-art and well-known');
});
test('splits only explicit or uniquely supported glued words; preserves capitalization', () => {
  assert.equal(clean('Ofthe neuralnetwork and languageprocessing.'), 'Of the neural network and language processing.');
  assert.equal(clean('another Attention unknownword'), 'another Attention unknown word');
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
  assert.equal(clean('- First  \n  continued\n- Second'), '- First  \n  continued\n- Second');
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

for (const marker of ['-', '–', '—', '−', '•', '●', '·', '◦', '○', '▪', '▫', '‣', '⁃', '∙', '*', '+']) {
  for (const anchored of [true, false]) {
    test(`restores collapsed ${JSON.stringify(marker)} bullets (${anchored ? 'with' : 'without'} a line-start marker) after word repair`, () => {
      const prefix = anchored ? '' : '简介 ';
      const source = `${prefix}${marker} infor-\nmation ${marker} repre-sentation ${marker} neural-network`;
      const expected = `${anchored ? '' : '简介\n'}- information\n- representation\n- neural-network`;
      assert.equal(clean(source), expected);
      assert.equal(clean(expected), expected);
    });
  }
}

test('infers multiple inline bullet styles by first appearance and returns to known levels', () => {
  const source = '简介 • infor-mation — representation · language · processing — learning • evaluation';
  assert.equal(clean(source), '简介\n- information\n    - representation\n        - language\n        - processing\n    - learning\n- evaluation');
  assert.equal(clean('简介 • Parent ○ Child • Next ▪ Deep ○ Child two ▪ Deep two'),
    '简介\n- Parent\n    - Child\n- Next\n        - Deep\n    - Child two\n        - Deep two');
});

test('line-start styles seed levels before inline-only styles, including symbols glued to text', () => {
  assert.equal(clean('• Parent ◦Child one ◦Child two ·Deep one ·Deep two\n• Next'),
    '- Parent\n    - Child one\n    - Child two\n        - Deep one\n        - Deep two\n- Next');
  assert.equal(clean('• Parent ◦ Child one\n▪ Anchored child ◦ Child two\n• Next'),
    '- Parent\n        - Child one\n    - Anchored child\n        - Child two\n- Next');
  assert.equal(clean('简介•甲项•乙项'), '简介\n- 甲项\n- 乙项');
});

test('restores decoder slide bullets when typographic dashes touch the preceding item', () => {
  const input = '• For the decoder:– At inference (= test) time, it does not have access to the future (because it hasnot generated it yet)– At training time, predicting the next token while having access to it would makethe task trivial (no learning is needed if you can peek into the future!)• Solution: simulate decoding mode during training by masking out futuretokens (known as causal masking)';
  const expected = '- For the decoder:\n    - At inference (= test) time, it does not have access to the future (because it has not generated it yet)\n    - At training time, predicting the next token while having access to it would make the task trivial (no learning is needed if you can peek into the future!)\n- Solution: simulate decoding mode during training by masking out future tokens (known as causal masking)';
  assert.equal(clean(input), expected);
  assert.equal(clean(expected), expected);
  const opts = options(); opts.words = false;
  assert.equal(convertRules(input, opts).text, expected.replace('has not', 'hasnot').replace('make the', 'makethe').replace('future tokens', 'futuretokens'));
});

test('restores Transformer attention bullets glued to the preceding text while keeping Luong-style', () => {
  const input = 'In Transformer attention:- the score function is bilinear (Luong-style) with separate linear projectionsfor the two interacting hidden states- attention scores must be scaled by √𝑑𝑘 (square root of the keydimensionality) to make their variance independent of dimensionality';
  const expected = 'In Transformer attention:\n- the score function is bilinear (Luong-style) with separate linear projections for the two interacting hidden states\n- attention scores must be scaled by √𝑑𝑘 (square root of the keydimensionality) to make their variance independent of dimensionality';
  assert.equal(clean(input), expected);
  assert.equal(clean(expected), expected);
  const opts = options(); opts.words = false;
  assert.equal(convertRules(input, opts).text, expected.replace('projections for', 'projectionsfor'));
});

test('restores attached hyphen bullets at existing and nested levels after word repair', () => {
  assert.equal(clean('- First item- Second item'), '- First item\n- Second item');
  assert.equal(clean('• Parent:- infor-\nmation and repre-sentation.- Next child• Next parent'),
    '- Parent:\n    - information and representation.\n    - Next child\n- Next parent');
  const opts = options(); opts.words = false;
  for (const sign of ['+', '*', '−']) {
    const input = `left${sign} First right${sign} Second`;
    assert.equal(convertRules(input, opts).text, input);
  }
});

for (const dash of ['-', '–', '—']) {
  test(`restores repeated ${dash} bullets without preceding whitespace while preserving ambiguous prose and ranges`, () => {
    assert.equal(clean(`• Parent:${dash} First item)${dash} Second item!• Next`),
      '- Parent:\n    - First item)\n    - Second item!\n- Next');
    assert.equal(clean(`简介 • Parent:${dash} First item)${dash} Second item!• Next`),
      '简介\n- Parent:\n    - First item)\n    - Second item!\n- Next');
    const opts = options(); opts.words = false;
    for (const input of [
      `A thought${dash} with an aside`,
      `10${dash} 20${dash} 30`,
      `a${dash} b${dash} c`,
      `self${dash}attention and cross${dash}attention`,
      `• Ranges: 10${dash} 20 and 30${dash} 40`,
      `• Parent: \\${dash} First)\\${dash} Second`,
      `• Parent: \`first${dash} One)${dash} Two\``
    ]) assert.equal(convertRules(input, opts).text, input.replace(/^• /, '- '));
  });
}

test('an anchored symbol confirms a single inline occurrence; unanchored symbols require varied repeated contexts', () => {
  assert.equal(clean('• First • Second'), '- First\n- Second');
  assert.equal(clean('简介 • First'), '简介 • First');
  assert.equal(clean('相同 • 同项 相同 • 同项'), '相同 • 同项 相同 • 同项');
  assert.equal(clean('前文 • First\n\n后文 • Second'), '前文 • First\n\n后文 • Second');
  assert.equal(clean('- A - B'), '- A\n- B');
  assert.equal(clean('简介 - A - B'), '简介\n- A\n- B');
});

test('restores consecutive inline numeric, alphabetic, roman and CJK ordered markers', () => {
  assert.equal(clean('简介 9) Nine 10) Ten 11) Eleven'), '简介\n9. Nine\n10. Ten\n11. Eleven');
  assert.equal(clean('简介 1、甲项 2、乙项'), '简介\n1. 甲项\n2. 乙项');
  assert.equal(clean('简介 1．甲项 2．乙项'), '简介\n1. 甲项\n2. 乙项');
  assert.equal(clean('简介 1) Parent a) Child b) Child two 2) Parent two'),
    '简介\n1. Parent\n    1. Child\n    2. Child two\n2. Parent two');
  assert.equal(clean('简介 1) Parent i) One ii) Two iii) Three 2) Next'),
    '简介\n1. Parent\n    1. One\n    2. Two\n    3. Three\n2. Next');
});

test('uses explicit numeric ancestry for nested ordered lists and returns to parent siblings', () => {
  for (const suffix of ['', '.']) {
    const source = `简介 1. Parent 1.1${suffix} Child 1.1.1${suffix} Deep 1.1.2${suffix} Deep two 1.2${suffix} Child two 2. Next 2.1${suffix} Only child`;
    const expected = '简介\n1. Parent\n    1. Child\n        1. Deep\n        2. Deep two\n    2. Child two\n2. Next\n    1. Only child';
    assert.equal(clean(source), expected);
    assert.equal(clean(expected), expected);
  }
  assert.equal(clean('1. Parent\n1.1 Child\n1.1.1 Deep\n2. Next'),
    '1. Parent\n    1. Child\n        1. Deep\n2. Next');
  assert.equal(clean('简介 1. Parent 1.1 Child 1.2 Child two'),
    '简介\n1. Parent\n    1. Child\n    2. Child two');
});

test('restores ordered lists inside collapsed unordered lists, with and without line-start evidence', () => {
  for (const prefix of ['', '简介 ']) {
    const source = `${prefix}• infor-mation 1) First a) Deep b) Deep two 2) Second • repre-\nsentation 1) Third 2) Fourth`;
    const expected = `${prefix ? '简介\n' : ''}- information\n    1. First\n        1. Deep\n        2. Deep two\n    2. Second\n- representation\n    1. Third\n    2. Fourth`;
    assert.equal(clean(source), expected);
    assert.equal(clean(expected), expected);
  }
  assert.equal(clean('• Parent 1. First 1.1 Child 2. Second • Next'),
    '- Parent\n    1. First\n        1. Child\n    2. Second\n- Next');
});

test('preserves explicit mixed-list indentation and aligns children after wide ordered markers', () => {
  assert.equal(clean('• Parent\n  1) First 2) Second\n• Next'),
    '- Parent\n    1. First\n    2. Second\n- Next');
  const opts = options(); opts.indentSize = 2;
  const source = '10) Parent a) Child b) Child two 11) Next';
  const expected = '10. Parent\n    1. Child\n    2. Child two\n11. Next';
  assert.equal(convertRules(source, opts).text, expected);
  assert.equal(convertRules(expected, opts).text, expected);
  assert.equal(clean('- Parent\n    - Child - Child two\n- Next'),
    '- Parent\n    - Child\n    - Child two\n- Next');
});

test('avoids punctuation, arithmetic, ranges, decimals, versions, escapes and nonconsecutive inline numbers', () => {
  const opts = options(); opts.words = false;
  for (const source of [
    'state-of-the-art and neural-network',
    'a - b - c', '10 - 20 - 30', '10 – 20 – 30', '2 · 3 · 4',
    '价格 1.2 元和 1.3 元', 'version 1.2.3 and 1.2.4', '日期 2026.10.28',
    '参考 1. 第一节及 3. 第三节', 'See section 2. Notes follow.',
    'Jean·Luc and A·B', '*emphasis* and **bold**', '原文 \\• First \\• Second'
  ]) assert.equal(convertRules(source, opts).text, source);
});

test('does not scan protected syntax or structural Markdown for inline list evidence', () => {
  const source = '简介 `• One • Two` $1. One 2. Two$ [link](https://example.com) • Real • Next';
  assert.equal(clean(source), '简介 `• One • Two` $1. One 2. Two$ [link](https://example.com)\n- Real\n- Next');
  assert.equal(clean('`label` • First • Second'), '`label`\n- First\n- Second');
  const structural = '# Heading • First • Second\n\n> quote • First • Second\n\n| cell • First • Second |\n\n```text\n• First • Second\n```';
  assert.equal(clean(structural), structural);
});

test('list restoration respects disabled rules, CRLF and optional paragraph joining', () => {
  const opts = options(); opts.words = false;
  assert.equal(convertRules('• infor-mation • repre-sentation', opts).text, '- infor-mation\n- repre-sentation');
  opts.words = true; opts.lists = false;
  assert.equal(convertRules('• infor-mation • repre-sentation', opts).text, '• information • representation');
  opts.lists = true; opts.joinWrappedLines = true;
  assert.equal(convertRules('简介\r\n• infor-\r\nmation • representation 1) First 2) Second', opts).text,
    '简介\r\n- information\r\n- representation\r\n    1. First\r\n    2. Second');
});

test('regex rules run in order with builtins, captures and toggles', () => {
  const opts = options();
  const regex = { kind: 'regex' as const, id: 'custom', name: 'test', enabled: true, pattern: '(FOO)', replacement: '$1ofthe', flags: 'gi' };
  opts.pipeline = [regex, { kind: 'builtin', id: 'words' }];
  regex.replacement = 'ofthe';
  assert.equal(convertRules('foo FOO', opts).text, 'of the of the');
  opts.pipeline.reverse();
  assert.equal(convertRules('foo FOO', opts).text, 'ofthe ofthe');
  regex.pattern = '(foo)'; regex.replacement = '[$1]';
  assert.equal(convertRules('foo FOO', opts).text, '[foo] [FOO]');
  regex.enabled = false;
  assert.equal(convertRules('foo FOO', opts).text, 'foo FOO');
});

test('invalid regex is skipped and broad regex cannot corrupt protected Markdown', () => {
  const opts = options();
  const regex = { kind: 'regex' as const, id: 'custom', name: 'test', enabled: true, pattern: '[', replacement: '', flags: 'g' };
  opts.pipeline = [regex];
  assert.deepEqual(convertRules('abc', opts), { text: 'abc', reasons: [] });
  regex.pattern = '[\\s\\S]+';
  assert.equal(convertRules('abc `code` def $math$ ghi', opts).text, '`code`$math$');
  regex.flags = 'gg';
  assert.equal(convertRules('abc', opts).text, 'abc');
});

test('Slides examples remove paired standalone markers and blank lines between list items', () => {
  assert.equal(clean('**\n\n- First\n\n- Second\n\n**'), '- First\n- Second');
  assert.equal(clean('\\*\\*\n- First\n\n- Second\n\\*\\*'), '- First\n- Second');
  assert.equal(clean('**bold**\n\nParagraph\n\n- First'), '**bold**\n\nParagraph\n\n- First');
  assert.equal(clean('**\n- First'), '**\n- First');
  assert.equal(clean('**\r\n- First\r\n\r\n- Second\r\n**'), '- First\r\n- Second');
  assert.equal(clean('```\n**\n- First\n\n- Second\n**\n```'), '```\n**\n- First\n\n- Second\n**\n```');
});

test('replacement escape sequences create real whitespace and allow literal backslashes', () => {
  const opts = options();
  opts.pipeline = [{ kind: 'regex', id: 'escape', name: 'escape', enabled: true, pattern: '(x)', replacement: String.raw`$1\n\t\\n`, flags: 'g' }];
  assert.equal(convertRules('x', opts).text, 'x\n\t\\n');
});

test('callout paste prefixes every continuation line including blank lines, nested quotes and CRLF', () => {
  const opts = options();
  assert.equal(convertRules('First\n\nSecond\n', opts, { beforeCursor: '> [!note]\n> ' }).text, 'First\n> \n> Second\n> ');
  assert.equal(convertRules('First\nSecond', opts, { beforeCursor: '> >' }).text, ' First\n> > Second');
  assert.equal(convertRules('First\r\n\r\nSecond', opts, { beforeCursor: '> ' }).text, 'First\r\n> \r\n> Second');
  opts.pasteIntoCallout = false;
  assert.equal(convertRules('First\n\nSecond', opts, { beforeCursor: '> ' }).text, 'First\n\nSecond');
});

test('callout paste also prefixes protected code and math without modifying their content', () => {
  const source = '```\nofthe\n\ncode\n```\n\n$$\na\nb\n$$';
  assert.equal(convertRules(source, options(), { beforeCursor: '> ' }).text,
    '```\n> ofthe\n> \n> code\n> ```\n> \n> $$\n> a\n> b\n> $$');
});

test('callout rule needs a quote-only line prefix and does not change a single-line paste', () => {
  for (const beforeCursor of ['', 'ordinary > ', '> existing text ', '> [!note]', '    ']) {
    assert.equal(convertRules('First\n\nSecond', options(), { beforeCursor }).text, 'First\n\nSecond');
  }
  assert.equal(convertRules('First', options(), { beforeCursor: '> ' }).text, 'First');
});
