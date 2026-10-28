import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import type { EasyPasteSettings } from '../src/settings';

// A small Obsidian host double runs the actual bundled command and modal code.
class Element {
  children: Element[] = [];
  attributes: Record<string, string> = {};
  events: Record<string, (event?: any) => void> = {};
  text = ''; value = ''; hidden = false; disabled = false;
  files: { name: string; type: string; size: number }[] = [];
  constructor(readonly tag = 'div') {}
  createEl(tag: string, options: any = {}): Element {
    const el = new Element(tag);
    el.text = options.text ?? '';
    el.attributes = options.attr ?? {};
    this.children.push(el);
    return el;
  }
  createDiv(options?: unknown): Element { return this.createEl('div', options); }
  createSpan(options?: unknown): Element { return this.createEl('span', options); }
  addClass() {} removeClass() {} focus() {}
  empty() { this.children = []; this.text = ''; }
  setText(text: string) { this.text = text; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(name: string, callback: (event?: any) => void) { this.events[name] = callback; }
  all(): Element[] { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelectorAll(selector: string): Element[] { return this.all().filter(el => selector.split(', ').includes(el.tag)); }
  find(label: string): Element {
    const el = this.all().find(child => child.attributes['aria-label'] === label || child.text === label);
    assert.ok(el, `Missing control: ${label}`);
    return el;
  }
  fill(value: string) { this.value = value; this.events.input?.(); }
  click() { if (!this.disabled) this.events.click?.(); }
}
class Button {
  buttonEl: Element;
  constructor(parent: Element) { this.buttonEl = parent.createEl('button'); }
  setButtonText(text: string) { this.buttonEl.text = text; return this; }
  setDisabled(value: boolean) { this.buttonEl.disabled = value; return this; }
  setCta() { return this; }
  onClick(callback: () => void) { this.buttonEl.events.click = callback; return this; }
}
class Modal {
  contentEl = new Element(); modalEl = new Element();
  constructor(readonly app: unknown) {}
  setTitle() {} onOpen() {} onClose() {}
  open() { this.onOpen(); } close() { this.onClose(); }
}
class MenuItem {
  title = ''; disabled = false; action = () => {};
  setTitle(value: string) { this.title = value; return this; }
  setIcon() { return this; }
  setDisabled(value: boolean) { this.disabled = value; return this; }
  onClick(callback: () => void) { this.action = callback; return this; }
}
class Menu {
  items: MenuItem[] = [];
  addItem(callback: (item: MenuItem) => void) { const item = new MenuItem(); callback(item); this.items.push(item); }
}
class File { extension = 'png'; stat = { size: 2 }; constructor(readonly path: string) {} }
const bundle = build({ entryPoints: ['src/main.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'], logLevel: 'silent' });

async function host(selection = '') {
  const requests: any[] = [];
  const imageReads: (() => void)[] = [];
  class FileReader {
    result = ''; onload?: () => void;
    readAsDataURL() { imageReads.push(() => { this.result = 'data:image/png;base64,AA=='; this.onload?.(); }); }
  }
  const events: Record<string, (...args: any[]) => void> = {};
  const editor = {
    value: `prefix${selection}`, from: 6, to: 6 + selection.length,
    getValue() { return this.value; }, getSelection() { return this.value.slice(this.from, this.to); },
    getCursor(which: string) { return { line: 0, ch: which === 'to' ? this.to : this.from }; },
    getRange(from: { ch: number }, to: { ch: number }) { return this.value.slice(from.ch, to.ch); },
    getLine() { return this.value; },
    replaceRange(text: string, from: { ch: number }, to: { ch: number }) { this.value = this.value.slice(0, from.ch) + text + this.value.slice(to.ch); }
  };
  const view = { file: { path: 'note.md' }, editor };
  const app = {
    workspace: { getActiveViewOfType: () => view, on: (name: string, callback: (...args: any[]) => void) => { events[name] = callback; } },
    metadataCache: { getFirstLinkpathDest: (path: string) => path === 'one.png' ? new File(path) : null },
    vault: { readBinary: async () => new Uint8Array([0, 0]).buffer },
    secretStorage: { getSecret: (name: string) => name.includes('image') ? 'vision-key' : 'text-key' }
  };
  class Plugin {
    app = app; commands: any[] = []; settings!: EasyPasteSettings;
    async loadData() { return null; } async saveData() {}
    addCommand(command: unknown) { this.commands.push(command); }
    addSettingTab() {} registerEvent() {}
  }
  const obsidian = {
    Plugin, Modal, ButtonComponent: Button, TFile: File, MarkdownView: class {}, PluginSettingTab: class {},
    Component: class { load() {} unload() {} }, Notice: class {},
    MarkdownRenderer: { render: async () => {} },
    arrayBufferToBase64: (buffer: ArrayBuffer) => Buffer.from(buffer).toString('base64'),
    requestUrl: async (request: any) => {
      requests.push(request);
      return { status: 200, json: { choices: [{ message: { content: 'converted' } }] } };
    }
  };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', 'FileReader', (await bundle).outputFiles[0].text)((id: string) => {
    assert.equal(id, 'obsidian'); return obsidian;
  }, module, module.exports, FileReader);
  const plugin = new module.exports.default();
  await plugin.onload();
  plugin.settings.textApi = { baseUrl: 'https://text.example/v1', model: 'text-model', secretName: 'text' };
  plugin.settings.imageApi = { baseUrl: 'https://vision.example/v1', model: 'vision-model', secretName: 'image' };
  const command = plugin.commands.find((c: any) => c.id === 'convert-selection');
  return { plugin, editor, view, events, requests, command, finishImageReads: async () => {
    imageReads.splice(0).forEach(read => read());
    await new Promise(resolve => setImmediate(resolve));
  }, open: () => {
    command.editorCheckCallback(false, editor, view);
    return plugin.modal as Modal & { generate(): Promise<void> };
  } };
}

test('one smart command and menu entry serve text, image and empty selections', async () => {
  const h = await host();
  assert.deepEqual(h.plugin.commands.map((c: any) => c.name), ['离线清洗', '智能转换']);
  assert.equal(h.command.editorCheckCallback(true, h.editor, h.view), true);
  const menu = new Menu();
  h.events['editor-menu'](menu, h.editor, h.view);
  assert.deepEqual(menu.items.map(item => [item.title, item.disabled]), [['EasyPaste：离线清洗', true], ['EasyPaste：智能转换', false]]);
  h.plugin.settings.shortcuts = false;
  assert.equal(h.command.editorCheckCallback(true, h.editor, h.view), false);
  menu.items[1].action();
  assert.ok(h.plugin.modal);
  h.plugin.modal.close();
});

test('empty selection accepts text in the same window, sends on demand and inserts on confirmation', async () => {
  const h = await host();
  const modal = h.open();
  assert.equal(h.requests.length, 0);
  modal.contentEl.find('待转换文本').fill('pasted source');
  await modal.generate();
  assert.equal(h.requests[0].url, 'https://text.example/v1/chat/completions');
  assert.equal(JSON.parse(h.requests[0].body).messages[1].content, 'pasted source');
  assert.equal(h.editor.value, 'prefix');
  modal.contentEl.find('确认应用').click();
  assert.equal(h.editor.value, 'prefixconverted');
});

test('mixed selected text and a local image use the independent vision endpoint, key and model', async () => {
  const h = await host('caption ![[one.png]]');
  const modal = h.open();
  assert.equal(h.requests.length, 0);
  await modal.generate();
  const request = h.requests[0];
  assert.equal(request.url, 'https://vision.example/v1/chat/completions');
  assert.equal(request.headers.Authorization, 'Bearer vision-key');
  const body = JSON.parse(request.body);
  assert.equal(body.model, 'vision-model');
  assert.match(body.messages[1].content[0].text, /caption/);
  assert.equal(body.messages[1].content[1].image_url.url, 'data:image/png;base64,AAA=');
  modal.contentEl.find('确认应用').click();
  assert.equal(h.editor.value, 'prefixconverted');
});

test('file-menu image action opens the same smart window', async () => {
  const h = await host();
  const menu = new Menu();
  h.events['file-menu'](menu, new File('one.png'));
  assert.equal(menu.items[0].title, 'EasyPaste：智能转换');
  menu.items[0].action();
  const modal = h.plugin.modal;
  assert.equal(modal.contentEl.find('待转换文本').value, '![[one.png]]');
  await modal.generate();
  assert.equal(h.requests[0].url, 'https://vision.example/v1/chat/completions');
  modal.close();
});

test('adding and removing images in the same window changes API routing and invalidates stale results', async () => {
  const h = await host('caption');
  const modal = h.open();
  const picker = modal.contentEl.find('添加图片');
  picker.files = [{ name: 'a.png', type: 'image/png', size: 1 }, { name: 'b.png', type: 'image/png', size: 1 }];
  picker.events.change();
  assert.equal(modal.contentEl.find('发送并转换').disabled, true);
  await modal.generate();
  assert.equal(h.requests.length, 0);
  await h.finishImageReads();
  await modal.generate();
  assert.equal(h.requests[0].url, 'https://vision.example/v1/chat/completions');
  assert.equal(JSON.parse(h.requests[0].body).messages[1].content.length, 3);
  modal.contentEl.find('移除图片 1').click();
  assert.equal(modal.contentEl.find('确认应用').disabled, true);
  modal.contentEl.find('移除图片 1').click();
  await modal.generate();
  assert.equal(h.requests[1].url, 'https://text.example/v1/chat/completions');
  modal.close();
});

test('pasted image works without a text selection and closing during image reading sends nothing', async () => {
  const h = await host();
  const modal = h.open();
  let prevented = false;
  modal.contentEl.events.paste({ clipboardData: { files: [{ name: 'pasted.png', type: 'image/png', size: 1 }] }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  await h.finishImageReads();
  await modal.generate();
  assert.equal(h.requests[0].url, 'https://vision.example/v1/chat/completions');
  modal.close();
  const next = h.open();
  next.contentEl.events.paste({ clipboardData: { files: [{ name: 'pasted.png', type: 'image/png', size: 1 }] }, preventDefault() {} });
  next.close();
  await h.finishImageReads();
  assert.equal(h.requests.length, 1);
  assert.equal(next.contentEl.children.length, 0);
});
