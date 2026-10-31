import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  createTranslator, defaultT, errorText, isLocaleReady, normalizeLocale, placeholders,
  UserFacingError, type Catalog, type CatalogRegistry, type MessageKey, type Translator
} from '../src/i18n';
import zhCN from '../src/locales/zh-CN.json';
import en from '../src/locales/en.json';
import ko from '../src/locales/ko.json';
import legacyRuleNames from '../src/legacy-rule-names.json';
import { DEFAULT_SETTINGS, EXAMPLE_RULES, loadSettings, regexError, ruleName } from '../src/settings';
import { completionUrl, convertWithApi, extractCompletion } from '../src/api';
import { resolveConversionInput } from '../src/input';
import { EditTarget } from '../src/target';
import { convertRules } from '../src/rules';

// Diagnostic markers distinguish translation wiring from the copy itself.
const marked: Translator = (key, params) => `⟦${key}⟧${defaultT(key, params)}`;

test('old, invalid and saved language settings migrate safely and survive reload', () => {
  assert.equal(loadSettings(null).language, 'zh-CN');
  for (const value of [undefined, null, '', 'fr', 'en-US', 123, {}]) {
    assert.equal(normalizeLocale(value), 'zh-CN');
    assert.equal(loadSettings({ language: value as any }).language, 'zh-CN');
  }
  for (const language of ['zh-CN', 'en', 'ko'] as const) {
    const saved = loadSettings({ language, textApi: { prompt: 'user prompt' }, temporaryInstructions: 'user request' });
    assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(saved))), saved);
    assert.equal(saved.textApi.prompt, 'user prompt');
    assert.equal(saved.temporaryInstructions, 'user request');
  }
});

test('only reviewed complete dictionaries are selectable; missing messages fall back to Chinese', () => {
  assert.equal(isLocaleReady('zh-CN'), true);
  assert.equal(isLocaleReady('en'), true);
  assert.equal(isLocaleReady('ko'), true);
  const registry: CatalogRegistry = { en: { 'common.cancel': '⟦common.cancel⟧' } };
  assert.equal(isLocaleReady('en', registry), false);
  const t = createTranslator('en', registry);
  assert.equal(t('common.cancel'), '⟦common.cancel⟧');
  assert.equal(t('preview.apply'), zhCN['preview.apply']);
  assert.equal(createTranslator('ko', {})('preview.apply'), zhCN['preview.apply']);
  assert.equal(createTranslator('ko')('preview.apply'), ko['preview.apply']);
  assert.equal(createTranslator('invalid')('preview.apply'), zhCN['preview.apply']);
  const complete = Object.fromEntries(Object.entries(zhCN).map(([key, text]) => [key, `⟦${key}⟧${text}`])) as Catalog;
  assert.equal(isLocaleReady('en', { en: complete }), true);
  assert.equal(isLocaleReady('en', { en: { ...complete, 'preview.apply': '' } }), false);
  assert.equal(isLocaleReady('en', { en: { ...complete, 'rule.dragLabel': '{wrong}' } }), false);
  assert.equal(createTranslator('en', { en: { 'rule.dragLabel': '{wrong}' } })('rule.dragLabel', { name: 'x' }), defaultT('rule.dragLabel', { name: 'x' }));
});

test('named interpolation preserves user text and translators have independent locales', () => {
  const name = '$& $1 {index} <script> 中文';
  const t = createTranslator('en', { en: { 'rule.customRow': '{name} / {index}' } });
  assert.equal(t('rule.customRow', { name, index: 3 }), `${name} / 3`);
  assert.equal(defaultT('rule.customRow', { name, index: 3 }), `3. ${name}`);
  assert.deepEqual(placeholders('{name} {index} {name}'), ['index', 'name']);
  assert.equal(defaultT('rule.customRow'), '{index}. {name}');
});

test('all Chinese copy is extracted and every static message key exists', () => {
  for (const [key, value] of Object.entries(zhCN)) assert.ok(value.trim(), key);
  for (const file of readdirSync('src').filter(file => file.endsWith('.ts'))) {
    const source = readFileSync(`src/${file}`, 'utf8');
    assert.doesNotMatch(source, /[\p{Script=Han}]/u, `Hard-coded Chinese in ${file}`);
    for (const match of source.matchAll(/(?:\bt|\bdefaultT|new UserFacingError)\('([^']+)'/g)) {
      assert.ok(Object.hasOwn(zhCN, match[1]), `${file}: ${match[1]}`);
    }
  }
});

test('regex errors are localized without leaking engine messages or expressions', () => {
  assert.equal(regexError('x', 'g', marked), null);
  assert.equal(regexError('', 'g', marked), marked('rule.patternRequired'));
  for (const flags of ['gg', 'z', 'uv']) assert.equal(regexError('x', flags, marked), marked('rule.invalidFlags'));
  assert.equal(regexError('[private-source', 'g', marked), marked('rule.invalidPattern'));
});

test('default example and unnamed rule labels translate while edited names and content survive', () => {
  assert.equal(ruleName(EXAMPLE_RULES[0], marked), marked('rule.exampleSlides'));
  const rule = { kind: 'regex' as const, id: 'user', name: '', enabled: true, pattern: 'abc', replacement: 'user output', flags: 'g' };
  assert.equal(ruleName(rule, marked), marked('rule.custom'));
  assert.equal(ruleName({ ...rule, name: 'My {name}' }, marked), 'My {name}');
  assert.equal(ruleName({ ...EXAMPLE_RULES[0], kind: 'regex', name: 'Edited', enabled: true, pattern: '', replacement: '', flags: '' }, marked), 'Edited');
  const rules = { ...DEFAULT_SETTINGS.rules, pipeline: [rule] };
  const converted = convertRules('abc', rules, undefined, marked);
  assert.equal(converted.text, 'user output');
  assert.deepEqual(converted.reasons, [marked('reason.regex', { name: marked('rule.custom') })]);
});

test('legacy example names migrate to language-neutral defaults without changing renamed rules', () => {
  const rules = structuredClone(DEFAULT_SETTINGS.rules);
  rules.pipeline = rules.pipeline!.map(rule => rule.kind === 'regex' && rule.id in legacyRuleNames
    ? { ...rule, name: legacyRuleNames[rule.id as keyof typeof legacyRuleNames] } : rule);
  const migrated = loadSettings({ rules });
  const examples = migrated.rules.pipeline!.filter(rule => rule.kind === 'regex');
  for (const rule of examples) {
    assert.equal(rule.kind === 'regex' && rule.name, '');
    assert.match(ruleName(rule, marked), /^⟦rule.example/);
  }
  assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(migrated))), migrated);
  const renamed = rules.pipeline.find(rule => rule.kind === 'regex');
  if (renamed?.kind === 'regex') renamed.name = 'user-defined name';
  assert.equal(loadSettings({ rules }).rules.pipeline!.find(rule => rule.id === renamed?.id)?.kind === 'regex'
    && ruleName(loadSettings({ rules }).rules.pipeline!.find(rule => rule.id === renamed?.id)!, marked), 'user-defined name');
});

test('localized failures retain stable keys and unknown exceptions never reach users', () => {
  const error = new UserFacingError('api.timeout');
  assert.equal(errorText(error, marked), marked('api.timeout'));
  for (const error of [new Error('SECRET source'), 'SECRET', null]) assert.equal(errorText(error, marked), marked('common.operationFailed'));
  assert.throws(() => completionUrl('not a url', marked), { message: marked('api.invalidUrl') });
  assert.throws(() => extractCompletion({ choices: [] }, marked), { message: marked('api.emptyOutput') });
  const editor = { getValue: () => '', getRange: () => '', getCursor: () => ({ line: 0, ch: 0 }), replaceRange() {} };
  assert.throws(() => new EditTarget(editor, () => false, marked).apply('x'), { message: marked('preview.targetChanged') });
});

test('input and API errors honor the injected translator, including status and timeout handling', async () => {
  await assert.rejects(resolveConversionInput({ text: '', images: [] }, async () => '', marked), { message: marked('input.empty') });
  const options = {
    api: { ...DEFAULT_SETTINGS.textApi, baseUrl: 'https://example.com', model: 'test-model' },
    key: 'secret', mode: 'text' as const, input: 'private', instructions: '', timeoutSeconds: 0.01,
    signal: new AbortController().signal, t: marked,
    request: async () => ({ status: 401, json: { error: 'SECRET' } })
  };
  await assert.rejects(convertWithApi(options), { message: marked('api.requestFailed', { status: 401, hint: marked('api.status401') }) });
  await assert.rejects(convertWithApi({ ...options, request: async () => { throw new Error('SECRET'); } }), { message: marked('api.connectionFailed') });
  await assert.rejects(convertWithApi({ ...options, request: () => new Promise(() => {}) }), { message: marked('api.timeout') });
  await assert.rejects(convertWithApi({ ...options, signal: AbortSignal.abort() }), { message: marked('api.cancelled') });
});


test('bundled English and Korean catalogs match every Chinese key, placeholder and regex escape', () => {
  for (const [locale, catalog] of Object.entries({ en, ko })) {
    assert.deepEqual(Object.keys(catalog), Object.keys(zhCN), locale);
    assert.equal(isLocaleReady(locale as 'en' | 'ko'), true);
    for (const key of Object.keys(zhCN) as MessageKey[]) {
      assert.ok(catalog[key].trim(), `${locale}: ${key}`);
      assert.deepEqual(placeholders(catalog[key]), placeholders(zhCN[key]), `${locale}: ${key}`);
      assert.equal(createTranslator(locale)(key), catalog[key], `${locale}: ${key}`);
      assert.doesNotMatch(catalog[key], /[\p{Script=Han}]/u, `${locale}: ${key}`);
    }
    for (const escape of [String.raw`\n`, String.raw`\t`, String.raw`\\`]) {
      assert.ok(catalog['rule.replacementDesc'].includes(escape), `${locale}: ${escape}`);
    }
    assert.doesNotMatch(catalog['rule.replacementDesc'], /[\n\t]/);
  }
  for (const key of ['language.description', 'preview.rulesUpdated', 'reason.separator']) {
    assert.equal(Object.hasOwn(zhCN, key), false, key);
    for (const file of ['src/settings-tab.ts', 'src/preview.ts']) assert.ok(!readFileSync(file, 'utf8').includes(key), `${file}: ${key}`);
  }
});

test('real locales translate API configuration, nested status hints and input errors', async () => {
  for (const [locale, catalog] of Object.entries({ en, ko })) {
    const t = createTranslator(locale);
    const options = {
      api: { ...DEFAULT_SETTINGS.imageApi, baseUrl: 'https://example.com', model: 'vision-model' },
      key: 'secret', mode: 'image' as const, input: 'data:image/png;base64,AA==', instructions: '', timeoutSeconds: 1,
      signal: new AbortController().signal, t, request: async () => ({ status: 429, json: {} })
    };
    await assert.rejects(convertWithApi(options), { message: t('api.requestFailed', { status: 429, hint: catalog['api.status429'] }) });
    await assert.rejects(convertWithApi({ ...options, api: { ...options.api, model: '' } }), { message: t('api.modelMissing', { section: catalog['api.imageSection'] }) });
    await assert.rejects(resolveConversionInput({ text: '', images: [] }, async () => '', t), { message: catalog['input.empty'] });
    assert.equal(errorText(new UserFacingError('preview.targetChanged'), t), catalog['preview.targetChanged']);
  }
});
