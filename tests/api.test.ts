import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionUrl, convertWithApi, extractCompletion } from '../src/api';
import { DEFAULT_SETTINGS } from '../src/settings';
import type { Request } from '../src/api';

test('accepts provider roots and full endpoint without duplicate suffixes', () => {
  assert.equal(completionUrl('https://api.tokenfactory.nebius.com/v1/'), 'https://api.tokenfactory.nebius.com/v1/chat/completions');
  assert.equal(completionUrl('https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions');
  assert.equal(completionUrl('https://example.com/v1/chat/completions/'), 'https://example.com/v1/chat/completions');
  assert.equal(completionUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1/chat/completions');
  for (const url of ['http://public.example/v1', 'https://user:secret@example.com', 'https://example.com?key=x', 'file:///tmp/a']) assert.throws(() => completionUrl(url));
});
const api = { ...DEFAULT_SETTINGS.textApi, baseUrl: 'https://example.com/v1', model: 'user-model' };
const invoke = (request: Request, overrides = {}) => convertWithApi({ api, key: 'test-key', mode: 'text', input: 'source', instructions: '', timeoutSeconds: 1, signal: new AbortController().signal, request, ...overrides });
test('text request uses standard Chat Completions and no vision payload', async () => {
  const output = await invoke(async request => {
    assert.equal(request.headers.Authorization, 'Bearer test-key');
    assert.equal(request.url, 'https://example.com/v1/chat/completions');
    const body = JSON.parse(request.body);
    assert.equal(body.model, 'user-model');
    assert.equal(body.messages[1].content, 'source');
    assert.equal(body.stream, false);
    assert.equal(body.temperature, undefined);
    return { status: 200, json: { choices: [{ message: { content: '**result**' } }] } };
  });
  assert.equal(output, '**result**');
});
test('vision request uses its own endpoint, key and model with an image_url payload', async () => {
  const imageApi = { ...DEFAULT_SETTINGS.imageApi, baseUrl: 'https://vision.example.com/v1', model: 'vision-model' };
  await invoke(async request => {
    assert.equal(request.url, 'https://vision.example.com/v1/chat/completions');
    assert.equal(request.headers.Authorization, 'Bearer vision-key');
    const body = JSON.parse(request.body);
    assert.equal(body.model, 'vision-model');
    assert.equal(body.messages[1].content[1].image_url.url, 'data:image/png;base64,AA==');
    return { status: 200, json: { choices: [{ message: { content: '$x^2$' } }] } };
  }, { api: imageApi, key: 'vision-key', mode: 'image', input: 'data:image/png;base64,AA==' });
});
test('mixed text and multiple images are sent together to the vision API', async () => {
  await invoke(async request => {
    const body = JSON.parse(request.body);
    assert.equal(body.model, 'vision-model');
    const content = body.messages[1].content;
    assert.match(content[0].text, /caption and !\[\[one.png\]\]/);
    assert.deepEqual(content.slice(1), [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
      { type: 'image_url', image_url: { url: 'https://example.com/two.jpg' } }
    ]);
    return { status: 200, json: { choices: [{ message: { content: 'converted' } }] } };
  }, { api: { ...api, model: 'vision-model' }, mode: 'image', input: 'caption and ![[one.png]]', images: ['data:image/png;base64,AA==', 'https://example.com/two.jpg'] });
});
test('invalid config and pre-cancel do not send data', async () => {
  let calls = 0;
  const request = async () => { calls++; throw new Error(); };
  await assert.rejects(invoke(request, { key: '' }), /API Key/);
  await assert.rejects(invoke(request, { api: { ...api, model: '' } }), /Model Name/);
  await assert.rejects(invoke(request, { api: { ...api, baseUrl: '' } }), /Base URL/);
  await assert.rejects(invoke(request, { signal: AbortSignal.abort() }), /取消/);
  assert.equal(calls, 0);
});
test('rejects empty, truncated and filtered outputs, preserves code fences', () => {
  assert.throws(() => extractCompletion({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }), /截断/);
  assert.throws(() => extractCompletion({ choices: [{ message: { content: null } }] }), /未返回/);
  assert.throws(() => extractCompletion({ choices: [{ message: { refusal: 'no' } }] }), /未能/);
  assert.equal(extractCompletion({ choices: [{ message: { content: '```js\ncode\n```' } }] }), '```js\ncode\n```');
});
test('does not expose raw transport errors or provider error bodies', async () => {
  await assert.rejects(invoke(async () => { throw new Error('Bearer test-key SOURCE'); }), error => error instanceof Error && !error.message.includes('test-key') && /无法连接/.test(error.message));
  await assert.rejects(invoke(async () => ({ status: 401, json: { error: 'test-key' } })), /401/);
});
test('cancelled pending request never produces an applicable result', async () => {
  const controller = new AbortController();
  let resolve!: (value: { status: number; json: unknown }) => void;
  const promise = invoke(() => new Promise(r => { resolve = r; }), { signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, /取消/);
  resolve({ status: 200, json: { choices: [{ message: { content: 'late' } }] } });
});
test('timeout stops waiting', async () => {
  await assert.rejects(invoke(() => new Promise(() => {}), { timeoutSeconds: 0.01 }), /超时/);
});
