import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { loadSettings, type EasyPasteSettings } from '../src/settings';

// A small Obsidian host double runs the actual bundled command and modal code.
class Element {
  children: Element[] = [];
  attributes: Record<string, string> = {};
  events: Record<string, (event?: any) => void> = {};
  text = ''; value = ''; hidden = false; disabled = false; className = '';
  scrollTop = 0; scrollLeft = 0;
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  get childNodes() { return this.children; }
  get firstElementChild() { return this.children[0]; }
  files: { name: string; type: string; size: number }[] = [];
  constructor(readonly tag = 'div') {}
  createEl(tag: string, options: any = {}): Element {
    const el = new Element(tag);
    el.className = typeof options === 'string' ? options : options.cls ?? '';
    el.text = options.text ?? '';
    el.attributes = options.attr ?? {};
    this.children.push(el);
    return el;
  }
  createDiv(options?: unknown): Element { return this.createEl('div', options); }
  createSpan(options?: unknown): Element { return this.createEl('span', options); }
  addClass(...names: string[]) { this.className += ' ' + names.join(' '); }
  removeClass(...names: string[]) { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); }
  toggleClass(name: string, value: boolean) { if (value) this.addClass(name); else this.removeClass(name); }
  focus() {} scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, height: 100 }; }
  contains(el: Element): boolean { return this.all().includes(el); }
  replaceChildren(...children: Element[]) { this.children = children; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  empty() { this.children = []; this.text = ''; }
  setText(text: string) { this.text = text; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(name: string, callback: (event?: any) => void) { this.events[name] = callback; }
  all(): Element[] { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelectorAll(selector: string): Element[] {
    return this.all().filter(el => selector.startsWith('.') ? el.className.split(' ').includes(selector.slice(1)) : selector.split(', ').includes(el.tag));
  }
  querySelector(selector: string): Element | undefined { return this.all().find(el => selector.startsWith('#') ? (el as any).id === selector.slice(1) : el.className.split(' ').includes(selector.slice(1))); }
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
  setIcon() { return this; }
  setTooltip(text: string) { this.buttonEl.setAttribute('aria-label', text); return this; }
  onClick(callback: () => void) { this.buttonEl.events.click = callback; return this; }
}
class Setting {
  settingEl: Element;
  constructor(parent: Element) { this.settingEl = parent.createDiv('setting-item'); }
  setName(text: string) { this.settingEl.createSpan({ text }); return this; }
  setDesc() { return this; } setHeading() { return this; }
  addToggle(callback: (toggle: any) => void) {
    const input = this.settingEl.createEl('input');
    const toggle = { setValue(value: boolean) { input.value = String(value); return this; }, onChange(fn: (value: boolean) => void) { input.events.change = event => fn(event); return this; } };
    callback(toggle); return this;
  }
  addButton(callback: (button: Button) => void) { callback(new Button(this.settingEl)); return this; }
  addExtraButton(callback: (button: Button) => void) { callback(new Button(this.settingEl)); return this; }
  addText(callback: (text: any) => void) { return this.addTextArea(callback); }
  addDropdown(callback: (text: any) => void) { return this.addTextArea(callback); }
  addTextArea(callback: (text: any) => void) {
    const input = this.settingEl.createEl('textarea');
    const text = { inputEl: input, setPlaceholder() { return this; }, addOptions() { return this; }, setValue(value: string) { input.value = value; return this; }, onChange(fn: (value: string) => void) { input.events.input = () => fn(input.value); return this; } };
    callback(text); return this;
  }
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
  let savedSettings: EasyPasteSettings | undefined;
  const rendered: { text: string; element: Element; finish: () => void }[] = [];
  let delayRenders = false;
  const settingNavigation: string[] = [];
  let responseContent = 'converted';
  const htmlInputs: string[] = [];
  let clipboardMarkdown = '';
  let htmlFails = false;
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
    setting: { open: () => settingNavigation.push('open'), openTabById: (id: string) => settingNavigation.push(id) },
    workspace: { getActiveViewOfType: () => view, on: (name: string, callback: (...args: any[]) => void) => { events[name] = callback; } },
    metadataCache: { getFirstLinkpathDest: (path: string) => path === 'one.png' ? new File(path) : null },
    vault: { readBinary: async () => new Uint8Array([0, 0]).buffer },
    secretStorage: { getSecret: (name: string) => name.includes('image') ? 'vision-key' : 'text-key' }
  };
  class Plugin {
    app = app; commands: any[] = []; settings!: EasyPasteSettings; manifest = { id: 'easy-paste' };
    async loadData() { return null; } async saveData(value: EasyPasteSettings) { savedSettings = structuredClone(value); }
    addCommand(command: unknown) { this.commands.push(command); }
    addSettingTab() {} registerEvent() {}
  }
  const obsidian = {
    htmlToMarkdown(html: string) { htmlInputs.push(html); if (htmlFails) throw new Error('Invalid HTML'); return clipboardMarkdown; },
    Plugin, Modal, Setting, setIcon() {}, ButtonComponent: Button, TFile: File, MarkdownView: class {}, PluginSettingTab: class { containerEl = new Element(); constructor(readonly app: unknown) {} },
    Component: class { load() {} unload() {} addChild() {} removeChild() {} }, Notice: class {},
    MarkdownRenderer: { render: (_app: unknown, text: string, element: Element) => new Promise<void>(resolve => {
      const finish = () => { element.createSpan({ text }); resolve(); };
      rendered.push({ text, element, finish });
      if (!delayRenders) finish();
    }) },
    arrayBufferToBase64: (buffer: ArrayBuffer) => Buffer.from(buffer).toString('base64'),
    requestUrl: async (request: any) => {
      requests.push(request);
      return { status: 200, json: { choices: [{ message: { content: responseContent } }] } };
    }
  };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', 'FileReader', (await bundle).outputFiles[0].text)((id: string) => {
    assert.equal(id, 'obsidian'); return obsidian;
  }, module, module.exports, FileReader);
  const plugin = new module.exports.default();
  await plugin.onload();
  plugin.settings.textApi = { ...plugin.settings.textApi, baseUrl: 'https://text.example/v1', model: 'text-model', secretName: 'text' };
  plugin.settings.imageApi = { ...plugin.settings.imageApi, baseUrl: 'https://vision.example/v1', model: 'vision-model', secretName: 'image' };
  const command = plugin.commands.find((c: any) => c.id === 'convert-selection');
  return { plugin, editor, view, events, requests, command, rendered, settingNavigation, htmlInputs, getSavedSettings: () => savedSettings, setClipboardMarkdown: (text: string) => { clipboardMarkdown = text; }, failHtml: () => { htmlFails = true; }, setResponse: (text: string) => { responseContent = text; }, delayRenders: () => { delayRenders = true; }, finishImageReads: async () => {
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

test('diff and preview share a soft-wrapped editor, preserve edits across switches and apply the latest value', async () => {
  const h = await host('ofthe');
  h.plugin.commands.find((command: any) => command.id === 'clean-selection').editorCheckCallback(false, h.editor, h.view);
  const modal = h.plugin.modal as Modal;
  const editor = modal.contentEl.find('编辑转换结果');
  assert.equal(editor.attributes.wrap, 'soft');
  assert.equal(editor.value, 'of the');
  assert.equal(modal.contentEl.all().filter(el => ['差异', '预览'].includes(el.text)).length, 2);
  assert.ok(!modal.contentEl.all().some(el => ['改动对比', '编辑结果', '排版预览'].includes(el.text)));
  editor.fill('**first edit**');
  modal.contentEl.find('预览').click();
  assert.equal(modal.contentEl.find('编辑转换结果'), editor);
  assert.equal(h.rendered.at(-1)?.text, '**first edit**');
  editor.fill('**second edit**\n$E=mc^2$');
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(h.rendered.at(-1)?.text, '**second edit**\n$E=mc^2$');
  modal.contentEl.find('差异').click();
  assert.equal(editor.value, '**second edit**\n$E=mc^2$');
  const original = modal.contentEl.querySelector('.easypaste-original-text')!;
  assert.equal(original.textContent, 'ofthe');
  assert.ok(original.all().some(el => el.tag === 'del'));
  const overlay = modal.contentEl.querySelector('.easypaste-editor-highlights')!;
  assert.equal(overlay.textContent, editor.value + '\u200b');
  assert.ok(overlay.all().some(el => el.className === 'easypaste-added'));
  editor.scrollTop = 70;
  editor.events.scroll();
  assert.equal(overlay.scrollTop, 70);
  modal.contentEl.find('确认应用').click();
  assert.equal(h.editor.value, 'prefix**second edit**\n$E=mc^2$');
});

test('preview rule panel only toggles/reorders rules and regenerates from the original input immediately', async () => {
  const h = await host('ofthe');
  h.plugin.commands.find((command: any) => command.id === 'clean-selection').editorCheckCallback(false, h.editor, h.view);
  const modal = h.plugin.modal as Modal;
  const panel = modal.modalEl.find('快速配置规则');
  assert.ok(modal.modalEl.children.includes(panel));
  assert.ok(!modal.contentEl.all().includes(panel));
  assert.ok(!panel.all().some(el => ['上移', '下移'].includes(el.attributes['aria-label'] ?? el.text)));
  assert.equal(panel.hidden, true);
  modal.contentEl.find('配置规则').click();
  assert.equal(panel.hidden, false);
  assert.equal(modal.contentEl.find('配置规则').attributes['aria-expanded'], 'true');
  assert.ok(!panel.all().some(el => ['新增规则', '删除', '匹配表达式', '规则名称'].includes(el.text)));
  const editor = modal.contentEl.find('编辑转换结果');
  editor.fill('manual edit');
  panel.querySelectorAll('input')[h.plugin.settings.rules.pipeline.findIndex((rule: any) => rule.id === 'words')].events.change(false);
  assert.equal(h.plugin.settings.rules.words, false);
  assert.equal(editor.value, 'ofthe');
  panel.querySelectorAll('input')[h.plugin.settings.rules.pipeline.findIndex((rule: any) => rule.id === 'words')].events.change(true);
  assert.equal(editor.value, 'of the');
  assert.equal(h.requests.length, 0);
  modal.modalEl.find('打开规则设置').click();
  assert.deepEqual(h.settingNavigation, ['open', 'easy-paste']);
  modal.close();
  h.plugin.settings.rules.words = false;
  await h.plugin.saveSettings();
  assert.equal(editor.value, 'of the');
});

test('dragging rule handles changes the effective execution order and keyboard moves also work', async () => {
  const h = await host('AAA');
  const rules = h.plugin.settings.rules;
  rules.pipeline!.unshift(
    { kind: 'regex', id: 'a', name: 'A to B', enabled: true, pattern: 'AAA', replacement: 'BBB', flags: 'g' },
    { kind: 'regex', id: 'b', name: 'B to C', enabled: true, pattern: 'BBB', replacement: 'CCC', flags: 'g' }
  );
  h.plugin.commands.find((command: any) => command.id === 'clean-selection').editorCheckCallback(false, h.editor, h.view);
  const modal = h.plugin.modal as Modal;
  assert.equal(modal.contentEl.find('编辑转换结果').value, 'CCC');
  let panel = modal.modalEl.find('快速配置规则');
  const cards = panel.querySelectorAll('.easypaste-rule');
  const handles = panel.querySelectorAll('.easypaste-drag-handle');
  handles[1].events.dragstart({ dataTransfer: { setData() {} } });
  cards[0].events.drop({ clientY: 10, preventDefault() {} });
  assert.deepEqual(rules.pipeline!.slice(0, 2).map((rule: any) => rule.id), ['b', 'a']);
  assert.equal(modal.contentEl.find('编辑转换结果').value, 'BBB');
  panel = modal.modalEl.find('快速配置规则');
  panel.querySelectorAll('.easypaste-drag-handle')[0].events.keydown({ key: 'ArrowDown', preventDefault() {} });
  assert.deepEqual(rules.pipeline!.slice(0, 2).map((rule: any) => rule.id), ['a', 'b']);
  assert.equal(modal.contentEl.find('编辑转换结果').value, 'CCC');
  modal.close();
});

test('LLM conversion from the rules preview sends original pasted input only on demand and keeps the same modal', async () => {
  const h = await host('ofthe');
  h.plugin.commands.find((command: any) => command.id === 'clean-selection').editorCheckCallback(false, h.editor, h.view);
  const modal = h.plugin.modal as Modal & { generate(): Promise<void> };
  assert.equal(h.requests.length, 0);
  modal.contentEl.find('编辑转换结果').fill('manual edit');
  modal.contentEl.find('智能转换临时要求').fill('Keep original language');
  assert.ok(modal.contentEl.find('使用 LLM 智能转换'));
  const request = modal.generate();
  assert.equal(modal.contentEl.find('确认应用').disabled, true);
  assert.equal(modal.contentEl.find('编辑转换结果').disabled, true);
  await request;
  assert.equal(h.plugin.modal, modal);
  assert.equal(JSON.parse(h.requests[0].body).messages[1].content, 'ofthe');
  assert.equal(JSON.parse(h.requests[0].body).messages[0].content, h.plugin.settings.textApi.prompt + '\n\nKeep original language');
  assert.equal(h.requests[0].url, 'https://text.example/v1/chat/completions');
  assert.equal(modal.contentEl.find('编辑转换结果').value, 'converted');
  assert.equal(modal.contentEl.find('编辑转换结果').disabled, false);
  modal.contentEl.find('确认应用').click();
  assert.equal(h.editor.value, 'prefixconverted');
});

test('manual offline preview opens even without changes so rules and LLM remain reachable', async () => {
  const h = await host('ordinary text');
  h.plugin.commands.find((command: any) => command.id === 'clean-selection').editorCheckCallback(false, h.editor, h.view);
  assert.equal(h.plugin.modal.contentEl.find('编辑转换结果').value, 'ordinary text');
  assert.ok(h.plugin.modal.contentEl.find('配置规则'));
  assert.ok(h.plugin.modal.contentEl.find('使用 LLM 智能转换'));
  h.plugin.modal.close();
});

test('automatic rule and LLM results use the captured insertion indentation, not the later cursor', async () => {
  const h = await host();
  h.editor.value = '    ';
  h.editor.from = h.editor.to = 4;
  let prevented = false;
  h.events['editor-paste']({ defaultPrevented: false, clipboardData: {
    files: [], items: [], getData: () => '• first\n• second'
  }, preventDefault: () => { prevented = true; } }, h.editor, h.view);
  assert.equal(prevented, true);
  const modal = h.plugin.modal as Modal;
  assert.equal(modal.contentEl.find('编辑转换结果').value, '- first\n    - second');
  h.editor.from = h.editor.to = 0;
  const panel = modal.modalEl.find('快速配置规则');
  panel.querySelectorAll('input')[h.plugin.settings.rules.pipeline.findIndex((rule: any) => rule.id === 'lists')].events.change(false);
  assert.equal(modal.contentEl.find('编辑转换结果').value, '• first\n    • second');
  h.setResponse('- LLM first\n- LLM second');
  await (modal as any).generate();
  assert.equal(modal.contentEl.find('编辑转换结果').value, '- LLM first\n    - LLM second');
  modal.close();
});

test('late Markdown renders never replace a newer edit or update a closed preview', async () => {
  const h = await host('ofthe');
  h.delayRenders();
  h.plugin.commands.find((command: any) => command.id === 'clean-selection').editorCheckCallback(false, h.editor, h.view);
  const modal = h.plugin.modal as Modal;
  modal.contentEl.find('预览').click();
  modal.contentEl.find('编辑转换结果').fill('new result');
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(h.rendered.length, 2);
  h.rendered[1].finish();
  await new Promise(resolve => setImmediate(resolve));
  const rendered = modal.contentEl.querySelector('.easypaste-rendered')!;
  assert.equal(rendered.textContent, 'new result');
  h.rendered[0].finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rendered.textContent, 'new result');
  modal.contentEl.find('预览').click();
  modal.close();
  h.rendered[2].finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(modal.contentEl.children.length, 0);
});

test('failed LLM conversion preserves the editable rule result and enables confirmation again', async () => {
  const h = await host('ofthe');
  h.plugin.settings.textApi.model = '';
  h.plugin.commands.find((command: any) => command.id === 'clean-selection').editorCheckCallback(false, h.editor, h.view);
  const modal = h.plugin.modal;
  await modal.generate();
  assert.equal(h.requests.length, 0);
  assert.equal(modal.contentEl.find('编辑转换结果').value, 'of the');
  assert.equal(modal.contentEl.find('确认应用').disabled, false);
  modal.contentEl.find('确认应用').click();
  assert.equal(h.editor.value, 'prefixof the');
});

test('full settings retain regex creation/editing/deletion while builtin rules only expose ordering and toggles', async () => {
  const h = await host('AAA');
  const tab = h.plugin.settingTab;
  tab.display();
  const initialCards = tab.containerEl.querySelectorAll('.easypaste-rule');
  assert.equal(initialCards.length, 6);
  assert.ok(initialCards.filter((_card: Element, index: number) => h.plugin.settings.rules.pipeline[index].kind === 'builtin').every((card: Element) => card.querySelectorAll('textarea').length === 0));
  assert.equal(initialCards.filter((card: Element) => card.querySelectorAll('textarea').length > 0).length, 2);
  tab.containerEl.find('新增规则').click();
  const rule = h.plugin.settings.rules.pipeline!.at(-1);
  assert.equal(rule.kind, 'regex');
  assert.equal(rule.enabled, false);
  let cards = tab.containerEl.querySelectorAll('.easypaste-rule');
  const card = cards.at(-1)!;
  const fields = card.querySelectorAll('textarea');
  fields[0].fill('New name');
  fields[1].fill('AAA');
  fields[2].fill('BBB');
  fields[3].fill('g');
  card.querySelectorAll('input')[0].events.change(true);
  assert.deepEqual([rule.name, rule.pattern, rule.replacement, rule.flags, rule.enabled], ['New name', 'AAA', 'BBB', 'g', true]);
  h.plugin.commands.find((command: any) => command.id === 'clean-selection').editorCheckCallback(false, h.editor, h.view);
  const modal = h.plugin.modal;
  assert.equal(modal.contentEl.find('编辑转换结果').value, 'BBB');
  fields[2].fill('CCC');
  assert.equal(modal.contentEl.find('编辑转换结果').value, 'CCC');
  card.find('删除').click();
  cards = tab.containerEl.querySelectorAll('.easypaste-rule');
  assert.equal(cards.length, 6);
  assert.equal(modal.contentEl.find('编辑转换结果').value, 'AAA');
  modal.close();
});

test('automatic paste triggers on custom-only changes and applies the preview after confirmation', async () => {
  const h = await host();
  const rules = h.plugin.settings.rules;
  rules.words = rules.lists = rules.joinWrappedLines = false;
  rules.pipeline = [{ kind: 'regex', id: 'custom-auto', name: '自定义清洗', enabled: true, pattern: 'AAA', replacement: 'BBB', flags: 'g' }];
  let prevented = false;
  h.events['editor-paste']({ defaultPrevented: false, clipboardData: {
    files: [], items: [], getData: () => 'AAA'
  }, preventDefault: () => { prevented = true; } }, h.editor, h.view);
  assert.equal(prevented, true);
  const modal = h.plugin.modal as Modal;
  assert.equal(modal.contentEl.find('编辑转换结果').value, 'BBB');
  assert.equal(h.editor.value, 'prefix');
  assert.equal(h.requests.length, 0);
  modal.contentEl.find('确认应用').click();
  assert.equal(h.editor.value, 'prefixBBB');
});

test('automatic paste ignores disabled, invalid, unmatched and unchanged custom rules', async () => {
  const h = await host();
  const rules = h.plugin.settings.rules;
  rules.words = rules.lists = rules.joinWrappedLines = false;
  const rule = { kind: 'regex' as const, id: 'custom-auto', name: '自定义清洗', enabled: true, pattern: 'AAA', replacement: 'BBB', flags: 'g' };
  rules.pipeline = [rule];
  for (const config of [
    { enabled: false, pattern: 'AAA', replacement: 'BBB' },
    { enabled: true, pattern: '[', replacement: 'BBB' },
    { enabled: true, pattern: 'ZZZ', replacement: 'BBB' },
    { enabled: true, pattern: 'AAA', replacement: 'AAA' }
  ]) {
    Object.assign(rule, config);
    let prevented = false;
    h.events['editor-paste']({ defaultPrevented: false, clipboardData: {
      files: [], items: [], getData: () => 'AAA'
    }, preventDefault: () => { prevented = true; } }, h.editor, h.view);
    assert.equal(prevented, false);
    assert.equal(h.plugin.modal, undefined);
  }
});

test('Slides rich paste cleans the converted Markdown even when plain text has no matching markers', async () => {
  const h = await host();
  h.plugin.settings.rules.words = h.plugin.settings.rules.lists = h.plugin.settings.rules.joinWrappedLines = false;
  const markdown = '**\n\n\n- ...\n\t\n- ...\n\n\n**';
  h.setClipboardMarkdown(markdown);
  const html = '<b><ul><li>...</li><li>...</li></ul></b>';
  let prevented = false;
  h.events['editor-paste']({ defaultPrevented: false, clipboardData: {
    files: [], items: [{ type: 'text/plain' }, { type: 'text/html' }],
    getData: (type: string) => type === 'text/html' ? html : '...\n...'
  }, preventDefault: () => { prevented = true; } }, h.editor, h.view);
  assert.equal(prevented, true);
  assert.deepEqual(h.htmlInputs, [html]);
  const modal = h.plugin.modal as Modal;
  assert.equal(modal.contentEl.find('编辑转换结果').value, '- ...\n- ...');
  assert.equal(h.editor.value, 'prefix');
  assert.equal(h.requests.length, 0);
  modal.contentEl.find('确认应用').click();
  assert.equal(h.editor.value, 'prefix- ...\n- ...');
});

test('the reported Slides Markdown also triggers automatic cleanup as plain text', async () => {
  const h = await host();
  const text = '**\n\n\n- ...\n\t\n- ...\n\n\n**';
  let prevented = false;
  h.events['editor-paste']({ defaultPrevented: false, clipboardData: {
    files: [], items: [], getData: (type: string) => type === 'text/plain' ? text : ''
  }, preventDefault: () => { prevented = true; } }, h.editor, h.view);
  assert.equal(prevented, true);
  assert.equal(h.plugin.modal.contentEl.find('编辑转换结果').value, '- ...\n- ...');
  h.plugin.modal.close();
});

test('rich paste keeps native behavior when unchanged, media-containing, or conversion fails', async () => {
  for (const scenario of ['unchanged', 'media', 'failed', 'disabled'] as const) {
    const h = await host();
    h.setClipboardMarkdown(scenario === 'disabled' ? '**\n- First\n**' : '- First');
    if (scenario === 'failed') h.failHtml();
    if (scenario === 'disabled') h.plugin.settings.autoPaste = false;
    let prevented = false;
    h.events['editor-paste']({ defaultPrevented: false, clipboardData: {
      files: [], items: [], getData: (type: string) => type === 'text/html' ? (scenario === 'media' ? '<p><img src="slide.png"></p>' : '<ul><li>First</li></ul>') : 'First'
    }, preventDefault: () => { prevented = true; } }, h.editor, h.view);
    assert.equal(prevented, false, scenario);
    assert.equal(h.plugin.modal, undefined, scenario);
  }
});

test('each API section exposes a collapsed prompt editor and saves its own prompt', async () => {
  const h = await host();
  const tab = h.plugin.settingTab;
  tab.display();
  assert.ok(!tab.containerEl.all().some((el: Element) => el.text === '补充格式要求'));
  const sections = tab.containerEl.querySelectorAll('.easypaste-api-section');
  for (const [index, field] of ['textApi', 'imageApi'].entries()) {
    const section = sections[index];
    const panel = section.querySelector('.easypaste-prompt-editor')!;
    assert.equal(panel.hidden, true);
    const button = section.find('编辑 Prompt');
    button.click();
    assert.equal(panel.hidden, false);
    assert.equal(button.attributes['aria-expanded'], 'true');
    const editor = panel.querySelectorAll('textarea')[0];
    assert.equal(editor.value, h.plugin.settings[field].prompt);
    editor.fill(`Custom ${field} prompt`);
    assert.equal(h.plugin.settings[field].prompt, `Custom ${field} prompt`);
    button.click();
    assert.equal(panel.hidden, true);
  }
  await h.plugin.saveSettings();
  assert.equal(h.getSavedSettings()!.textApi.prompt, 'Custom textApi prompt');
  assert.equal(h.getSavedSettings()!.imageApi.prompt, 'Custom imageApi prompt');
});

test('an already open composer reads the current text or image base prompt when sending', async () => {
  for (const [selection, field] of [['plain text', 'textApi'], ['caption ![[one.png]]', 'imageApi']]) {
    const h = await host(selection);
    const modal = h.open();
    h.plugin.settingTab.display();
    const title = field === 'textApi' ? '智能转换' : '图片转换';
    h.plugin.settingTab.containerEl.find(`${title}基础 Prompt`).fill('Updated after opening');
    await modal.generate();
    assert.equal(JSON.parse(h.requests[0].body).messages[0].content, 'Updated after opening');
    modal.close();
  }
});

test('temporary requirements save across reopen and reload, append to system prompt and clear in one click', async () => {
  const h = await host('source');
  let modal = h.open();
  modal.contentEl.find('智能转换临时要求').fill('Only fix formatting.\nKeep English.');
  assert.equal(h.requests.length, 0);
  await h.plugin.saveSettings();
  assert.equal(h.getSavedSettings()!.temporaryInstructions, 'Only fix formatting.\nKeep English.');
  modal.close();
  h.plugin.settings = loadSettings(h.getSavedSettings()!);
  modal = h.open();
  const input = modal.contentEl.find('智能转换临时要求');
  assert.equal(input.value, 'Only fix formatting.\nKeep English.');
  const pending = modal.generate();
  assert.equal(input.disabled, true);
  assert.equal(modal.contentEl.find('清空临时要求').disabled, true);
  await pending;
  assert.equal(JSON.parse(h.requests[0].body).messages[0].content,
    h.plugin.settings.textApi.prompt + '\n\nOnly fix formatting.\nKeep English.');
  modal.contentEl.find('清空临时要求').click();
  assert.equal(input.value, '');
  await h.plugin.saveSettings();
  assert.equal(h.getSavedSettings()!.temporaryInstructions, '');
  await modal.generate();
  assert.equal(JSON.parse(h.requests[1].body).messages[0].content, h.plugin.settings.textApi.prompt);
  modal.close();
  modal = h.open();
  assert.equal(modal.contentEl.find('智能转换临时要求').value, '');
  modal.close();
});


test('paste into callout opens a preview on unchanged prose, toggles live, and keeps captured quote prefix', async () => {
  const h = await host();
  h.editor.value = '> ';
  h.editor.from = h.editor.to = 2;
  let prevented = false;
  h.events['editor-paste']({ defaultPrevented: false, clipboardData: {
    files: [], items: [], getData: (type: string) => type === 'text/plain' ? 'First\n\nSecond' : ''
  }, preventDefault: () => { prevented = true; } }, h.editor, h.view);
  assert.equal(prevented, true);
  const modal = h.plugin.modal as Modal;
  const result = modal.contentEl.find('编辑转换结果');
  assert.equal(result.value, 'First\n> \n> Second');
  assert.equal(h.editor.value, '> ');
  const panel = modal.modalEl.find('快速配置规则');
  const index = h.plugin.settings.rules.pipeline.findIndex((rule: any) => rule.id === 'pasteIntoCallout');
  h.editor.from = h.editor.to = 0;
  panel.querySelectorAll('input')[index].events.change(false);
  assert.equal(result.value, 'First\n\nSecond');
  panel.querySelectorAll('input')[index].events.change(true);
  assert.equal(result.value, 'First\n> \n> Second');
  modal.contentEl.find('确认应用').click();
  assert.equal(h.editor.value, '> First\n> \n> Second');
});

test('offline Enter applies edited output; Shift+Enter, IME and repeat never apply', async () => {
  const h = await host('ofthe');
  h.plugin.commands.find((command: any) => command.id === 'clean-selection').editorCheckCallback(false, h.editor, h.view);
  const modal = h.plugin.modal as Modal;
  const apply = modal.contentEl.find('确认应用');
  assert.ok(apply.className.includes('easypaste-enter-action'));
  modal.contentEl.find('编辑转换结果').fill('edited output');
  const preview = modal.contentEl.find('转换预览');
  const enter = (extra = {}) => preview.events.keydown({ key: 'Enter', target: preview, preventDefault() {}, stopPropagation() {}, ...extra });
  for (const extra of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }, { ctrlKey: true }]) enter(extra);
  assert.equal(h.editor.value, 'prefixofthe');
  enter();
  assert.equal(h.editor.value, 'prefixedited output');
});

test('smart Enter sends once then highlights apply; changing source restores send', async () => {
  const h = await host();
  const modal = h.open();
  const send = modal.contentEl.find('发送并转换');
  const apply = modal.contentEl.find('确认应用');
  const preview = modal.contentEl.find('转换预览');
  const enter = () => preview.events.keydown({ key: 'Enter', target: preview, preventDefault() {}, stopPropagation() {} });
  assert.ok(!send.className.includes('easypaste-enter-action'));
  modal.contentEl.find('待转换文本').fill('source');
  assert.ok(send.className.includes('easypaste-enter-action'));
  enter();
  enter();
  assert.ok(!send.className.includes('easypaste-enter-action'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.requests.length, 1);
  assert.ok(apply.className.includes('easypaste-enter-action'));
  assert.equal(apply.attributes['aria-keyshortcuts'], 'Enter');
  modal.contentEl.find('待转换文本').fill('new source');
  assert.ok(send.className.includes('easypaste-enter-action'));
  assert.ok(!apply.className.includes('easypaste-enter-action'));
  enter();
  await new Promise(resolve => setTimeout(resolve, 0));
  enter();
  assert.equal(h.editor.value, 'prefixconverted');
  assert.equal(h.requests.length, 2);
});

test('Enter only belongs to the preview region; inputs and other controls keep native behavior', async () => {
  const h = await host('ofthe');
  const modal = h.open();
  const preview = modal.contentEl.find('转换预览');
  assert.equal(preview.attributes.tabindex, '0');
  assert.equal(modal.modalEl.events.keydown, undefined);
  const targets = ['待转换文本', '智能转换临时要求', '编辑转换结果', '取消', '发送并转换']
    .map(label => modal.contentEl.find(label));
  let prevented = false;
  let stopped = false;
  for (const target of targets) {
    preview.events.keydown({ key: 'Enter', target,
      preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  }
  assert.equal(prevented, false);
  assert.equal(stopped, false);
  assert.equal(h.requests.length, 0);
  assert.equal(h.editor.value, 'prefixofthe');
  modal.close();
});
