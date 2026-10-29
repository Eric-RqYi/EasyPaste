import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, loadSettings, migrateApiSecrets } from '../src/settings';

const text = { id: 'text', baseUrl: 'https://text.example/v1', textModel: 'text-model', visionModel: '', secretName: 'old-text-key' };
const vision = { id: 'vision', baseUrl: 'https://vision.example/v1', textModel: '', visionModel: 'vision-model', secretName: 'old-vision-key' };

test('base prompts and temporary requirements persist independently, including intentional clearing', () => {
  const settings = loadSettings({ textApi: { prompt: 'Text instructions' }, imageApi: { prompt: '' }, temporaryInstructions: '' });
  assert.equal(settings.textApi.prompt, 'Text instructions');
  assert.equal(settings.imageApi.prompt, '');
  assert.equal(settings.temporaryInstructions, '');
  assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(settings))), settings);
  assert.notEqual(DEFAULT_SETTINGS.textApi.prompt, DEFAULT_SETTINGS.imageApi.prompt);
});

test('legacy extra instructions migrate once into temporary requirements and clearing survives reload', () => {
  const settings = loadSettings({ extraInstructions: 'Keep headings' });
  assert.equal(settings.temporaryInstructions, 'Keep headings');
  assert.equal('extraInstructions' in settings, false);
  assert.equal(loadSettings({ extraInstructions: 'old', temporaryInstructions: '' }).temporaryInstructions, '');
  settings.temporaryInstructions = '';
  assert.equal(loadSettings(JSON.parse(JSON.stringify(settings))).temporaryInstructions, '');
});

test('fresh settings have independent blank API configurations', () => {
  const settings = loadSettings(null);
  assert.deepEqual(settings.textApi, DEFAULT_SETTINGS.textApi);
  assert.deepEqual(settings.imageApi, DEFAULT_SETTINGS.imageApi);
  settings.textApi.model = 'changed';
  assert.equal(settings.imageApi.model, '');
  assert.equal(DEFAULT_SETTINGS.textApi.model, '');
});

test('migration retains each selected endpoint, model and secret reference', () => {
  const settings = loadSettings({ providers: [vision, text], textProvider: 'text', visionProvider: 'vision' });
  assert.deepEqual(settings.textApi, { ...DEFAULT_SETTINGS.textApi, baseUrl: text.baseUrl, model: 'text-model', secretName: 'old-text-key' });
  assert.deepEqual(settings.imageApi, { ...DEFAULT_SETTINGS.imageApi, baseUrl: vision.baseUrl, model: 'vision-model', secretName: 'old-vision-key' });
  for (const key of ['api', 'providers', 'textProvider', 'visionProvider']) assert.equal(key in settings, false);
  assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(settings))), settings);
});

test('migration retains distinct models when the old provider was shared', () => {
  const shared = { ...text, visionModel: 'vision-model' };
  const settings = loadSettings({ providers: [shared], textProvider: text.id, visionProvider: text.id });
  assert.equal(settings.textApi.model, 'text-model');
  assert.equal(settings.imageApi.model, 'vision-model');
});

test('migration falls back to a provider configured for the relevant mode', () => {
  const custom = { ...text, id: 'custom-1' };
  const settings = loadSettings({ providers: [vision, custom], textProvider: 'missing', visionProvider: 'missing' });
  assert.equal(settings.textApi.model, 'text-model');
  assert.equal(settings.imageApi.model, 'vision-model');
  assert.deepEqual(loadSettings({ providers: [] }), DEFAULT_SETTINGS);
});

test('shared API configuration initializes both sections without sharing objects', () => {
  const api = { baseUrl: text.baseUrl, model: 'shared-model', secretName: 'shared-secret' };
  const settings = loadSettings({ api, providers: [text], textProvider: text.id });
  assert.deepEqual(settings.textApi, { ...DEFAULT_SETTINGS.textApi, ...api });
  assert.deepEqual(settings.imageApi, { ...DEFAULT_SETTINGS.imageApi, ...api });
  settings.imageApi.baseUrl = vision.baseUrl;
  assert.equal(settings.textApi.baseUrl, text.baseUrl);
});

test('separate API settings take precedence, including intentionally cleared fields', () => {
  const api = { baseUrl: '', model: '', secretName: 'saved-secret' };
  const settings = loadSettings({ textApi: api, imageApi: { model: 'image-model' }, api: { model: 'old-model' } });
  assert.deepEqual(settings.textApi, { ...DEFAULT_SETTINGS.textApi, ...api });
  assert.deepEqual(settings.imageApi, { ...DEFAULT_SETTINGS.imageApi, model: 'image-model' });
});

test('secret migration isolates both keys and persists without repeating the migration', () => {
  const settings = loadSettings({ api: { baseUrl: text.baseUrl, model: 'shared-model', secretName: 'shared-secret' } });
  const secrets = new Map([['shared-secret', 'test-key']]);
  const storage = { getSecret: (name: string) => secrets.get(name) ?? null, setSecret: (name: string, key: string) => { secrets.set(name, key); } };
  assert.equal(migrateApiSecrets(settings, storage), true);
  assert.equal(storage.getSecret(settings.textApi.secretName), 'test-key');
  assert.equal(storage.getSecret(settings.imageApi.secretName), 'test-key');
  storage.setSecret(settings.textApi.secretName, 'changed-key');
  assert.equal(storage.getSecret(settings.imageApi.secretName), 'test-key');
  storage.setSecret(settings.imageApi.secretName, '');
  assert.equal(storage.getSecret(settings.textApi.secretName), 'changed-key');
  const saved = JSON.stringify(settings);
  assert.equal(saved.includes('test-key'), false);
  assert.equal(saved.includes('changed-key'), false);
  assert.equal(migrateApiSecrets(loadSettings(JSON.parse(saved)), storage), false);
});

test('separate legacy secrets are migrated to the matching section', () => {
  const settings = loadSettings({ providers: [text, vision], textProvider: text.id, visionProvider: vision.id });
  const secrets = new Map([['old-text-key', 'text-key'], ['old-vision-key', 'vision-key']]);
  const storage = { getSecret: (name: string) => secrets.get(name) ?? null, setSecret: (name: string, key: string) => { secrets.set(name, key); } };
  migrateApiSecrets(settings, storage);
  assert.equal(storage.getSecret(settings.textApi.secretName), 'text-key');
  assert.equal(storage.getSecret(settings.imageApi.secretName), 'vision-key');
});

test('legacy offline switches survive pipeline migration', () => {
  const rules = { ...DEFAULT_SETTINGS.rules, words: false, lists: false, joinWrappedLines: true };
  delete rules.pipeline;
  const settings = loadSettings({ rules });
  assert.deepEqual(settings.rules.pipeline, DEFAULT_SETTINGS.rules.pipeline);
  assert.equal(settings.rules.words, false);
  assert.equal(settings.rules.lists, false);
  assert.equal(settings.rules.joinWrappedLines, true);
});

test('pipeline order and custom rules survive saving; missing builtins are restored once', () => {
  const rules = structuredClone(DEFAULT_SETTINGS.rules);
  rules.pipeline = [
    { kind: 'builtin', id: 'lists' },
    { kind: 'regex', id: 'custom', name: 'Example', enabled: true, pattern: '(a)', replacement: '$1b', flags: 'g' },
    { kind: 'builtin', id: 'lists' }
  ];
  const settings = loadSettings({ rules });
  assert.deepEqual(settings.rules.pipeline?.map(rule => rule.id), ['lists', 'custom', 'words', 'spelling', 'joinWrappedLines', 'pasteIntoCallout']);
  assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(settings))), settings);
});

test('examples migrate once and remain edited or deleted after reload', () => {
  const rules = structuredClone(DEFAULT_SETTINGS.rules);
  delete rules.examplesVersion;
  rules.pipeline = [{ kind: 'builtin', id: 'words' }];
  const migrated = loadSettings({ rules });
  assert.equal(migrated.rules.pipeline?.filter(rule => rule.kind === 'regex').length, 2);
  const example = migrated.rules.pipeline!.find(rule => rule.kind === 'regex');
  if (example?.kind === 'regex') example.pattern = 'edited';
  assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(migrated))), migrated);
  migrated.rules.pipeline = migrated.rules.pipeline!.filter(rule => rule.kind !== 'regex');
  assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(migrated))), migrated);
});


test('older settings gain the enabled callout builtin once while retaining rule order', () => {
  const rules = structuredClone(DEFAULT_SETTINGS.rules);
  delete (rules as Partial<typeof rules>).pasteIntoCallout;
  rules.pipeline = rules.pipeline!.filter(rule => rule.id !== 'pasteIntoCallout');
  const migrated = loadSettings({ rules });
  assert.equal(migrated.rules.pasteIntoCallout, true);
  assert.equal(migrated.rules.pipeline!.at(-1)!.id, 'pasteIntoCallout');
  migrated.rules.pasteIntoCallout = false;
  assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(migrated))), migrated);
});
