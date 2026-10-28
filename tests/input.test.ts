import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversionMode, imageReferences, resolveConversionInput } from '../src/input';

test('routes plain text and an empty composer to text, and image attachments to vision', () => {
  assert.equal(conversionMode({ text: 'hello', images: [] }), 'text');
  assert.equal(conversionMode({ text: '', images: [] }), 'text');
  assert.equal(conversionMode({ text: 'caption', images: ['data:image/png;base64,AA=='] }), 'image');
});

test('detects multiple wiki and Markdown images inside a mixed selection in source order', () => {
  const text = 'Before ![[folder/a.png|300]] between ![plot](<folder/b c.jpg> "title") after ![](plot(1).webp)';
  assert.deepEqual(imageReferences(text), ['folder/a.png', 'folder/b c.jpg', 'plot(1).webp']);
  assert.equal(conversionMode({ text, images: [] }), 'image');
  assert.deepEqual(imageReferences('![[a.png]] ![[a.png|200]] ![[note]] ![[paper.pdf]]'), ['a.png']);
  assert.deepEqual(imageReferences('![alt](https://example.com/img.png?x=1) ![](my\\(plot\\).png)'), ['https://example.com/img.png?x=1', 'my(plot).png']);
});

test('ignores escaped embeds and image syntax in inline and fenced code', () => {
  const text = '\\![[escaped.png]] `![[code.png]]`\n```md\n![](fenced.jpg)\n```\n![[real.gif]]';
  assert.deepEqual(imageReferences(text), ['real.gif']);
  assert.equal(conversionMode({ text: '`![[code.png]]`', images: [] }), 'text');
});

test('resolves all selected images without dropping accompanying text or added images', async () => {
  const text = 'Heading\n![[one.png]]\nexplanation\n![](two.jpg)';
  const resolved = await resolveConversionInput({ text, images: ['added-image'] }, async path => `data:${path}`);
  assert.deepEqual(resolved, { text, images: ['data:one.png', 'data:two.jpg', 'added-image'] });
});

test('rejects empty, oversized or unresolved input rather than silently falling back to text', async () => {
  const read = async () => { throw new Error('missing image'); };
  await assert.rejects(resolveConversionInput({ text: '  ', images: [] }, read), /粘贴文本/);
  await assert.rejects(resolveConversionInput({ text: 'x'.repeat(200001), images: [] }, read), /200,000/);
  await assert.rejects(resolveConversionInput({ text: 'text ![[missing.png]]', images: [] }, read), /missing image/);
});
