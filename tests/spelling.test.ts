import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { convertSpelling } from '../src/spelling';
import { convertRules } from '../src/rules';
import { DEFAULT_SETTINGS, loadSettings } from '../src/settings';
import pairs from '../.generated/spelling.json';

test('converts explicit or/our and ize/ise forms in both directions, preserving case', () => {
  const us = "Color colors COLORED coloring honor honorable favors favorite flavor organize organized organization realization colorize";
  const gb = "Colour colours COLOURED colouring honour honourable favours favourite flavour organise organised organisation realisation colourise";
  assert.equal(convertSpelling(us, 'gb'), gb);
  assert.equal(convertSpelling(gb, 'us'), us);
  assert.equal(convertSpelling("The color's flavor and colour’s organisation", 'gb'), "The colour's flavour and colour’s organisation");
});

test('ambiguous, shared, unlisted and out-of-scope spellings remain untouched', () => {
  const unchanged = 'actor doctor major size sizes sized sizing prize prizes prized prizing prise prises prised prising practice practise license licence program programme check cheque meter metre analyze analyse center centre gray grey traveling travelling advertise exercise surprise';
  for (const target of ['us', 'gb'] as const) assert.equal(convertSpelling(unchanged, target), unchanged);
  assert.equal(convertSpelling('my_color color2 MyColor COLOR_PICKER colorÉ 中文color', 'gb'), 'my_color color2 MyColor COLOR_PICKER colorÉ 中文color');
});

test('all generated pairs are reciprocal and stable, without chained replacements', () => {
  assert.ok(pairs.length > 1000);
  const us = pairs.map(pair => pair[0]).join(' ');
  const gb = pairs.map(pair => pair[1]).join(' ');
  assert.equal(convertSpelling(us, 'gb'), gb);
  assert.equal(convertSpelling(gb, 'us'), us);
  assert.equal(convertSpelling(gb, 'gb'), gb);
  assert.equal(convertSpelling(us, 'us'), us);
});

test('protected spellings are case-insensitive and changes invalidate their cache', () => {
  assert.equal(convertSpelling('Color color organize', 'gb', 'COLOR\norganize'), 'Color color organize');
  assert.equal(convertSpelling('Color color organize', 'gb'), 'Colour colour organise');
});

test('rule is off by default and independent from word repair, with Markdown and CRLF protection', () => {
  const options = structuredClone(DEFAULT_SETTINGS.rules);
  const input = 'color organize';
  assert.deepEqual(convertRules(input, options), { text: input, reasons: [] });
  options.spelling = true; options.spellingTarget = 'gb'; options.words = false;
  assert.equal(convertRules(input, options).text, 'colour organise');
  const protectedText = '---\nlabel: color\n---\n```text\ncolor\n```\n`organize` $color$ [color](https://example.com/color) ![[color]]';
  assert.equal(convertRules(protectedText, options).text, protectedText);
  assert.equal(convertRules('color\r\norganize', options).text, 'colour\r\norganise');
  options.spellingTarget = 'us';
  assert.equal(convertRules('colour organise', options).text, input);
});

test('word repair precedes spelling by default and reordered pipelines are respected', () => {
  const options = structuredClone(DEFAULT_SETTINGS.rules);
  options.spelling = true;
  assert.equal(convertRules('colo-\nr organizethe', options).text, 'colour organise the');
  options.pipeline = [{ kind: 'builtin', id: 'spelling' }, { kind: 'builtin', id: 'words' }];
  assert.equal(convertRules('colo-\nr organizethe', options).text, 'color organize the');
  options.pipeline.reverse(); options.spellingProtectedWords = 'color';
  assert.equal(convertRules('colo-\nr organizethe', options).text, 'color organise the');
});

test('older settings gain a disabled rule after word repair without losing existing ordering', () => {
  const options = structuredClone(DEFAULT_SETTINGS.rules);
  options.pipeline = [{ kind: 'builtin', id: 'lists' }, { kind: 'builtin', id: 'words' }];
  delete (options as Partial<typeof options>).spelling;
  const settings = loadSettings({ rules: options });
  assert.equal(settings.rules.spelling, false);
  assert.deepEqual(settings.rules.pipeline!.slice(0, 3).map(rule => rule.id), ['lists', 'words', 'spelling']);
  assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(settings))), settings);
  settings.rules.spelling = true; settings.rules.spellingTarget = 'us'; settings.rules.spellingProtectedWords = 'colour';
  assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(settings))), settings);
});

test('standalone browser bundle uses no Node, dictionary or NLP dependency', async () => {
  const bundled = await build({ entryPoints: ['src/spelling.ts'], bundle: true, write: false, platform: 'browser',
    format: 'iife', target: 'es2022', globalName: 'Spelling', metafile: true });
  assert.ok(Object.keys(bundled.metafile!.inputs).every(path => !path.includes('node_modules') && !path.endsWith('english.json')));
  const context = { fetch() { throw new Error('Spelling conversion must stay offline'); } };
  runInNewContext(bundled.outputFiles[0].text, context);
  assert.equal(runInNewContext("Spelling.convertSpelling('color organize practice', 'gb')", context), 'colour organise practice');
});
