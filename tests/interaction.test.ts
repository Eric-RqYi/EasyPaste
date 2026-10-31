import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createTranslator, type Locale } from '../src/i18n';
import { loadSettings, type EasyPasteSettings } from '../src/settings';

// A small Obsidian host double runs the actual bundled command and modal code.
class Element {
  static focused?: Element;
  parent?: Element;
  children: Element[] = [];
  attributes: Record<string, string> = {};
  events: Record<string, (event?: any) => void> = {};
  text = ''; value = ''; hidden = false; className = '';
  private isDisabled = false;
  get disabled() { return this.isDisabled; }
  set disabled(value: boolean) {
    this.isDisabled = value;
    if (value && Element.focused === this) Element.focused = undefined;
  }
  scrollTop = 0; scrollLeft = 0;
  ownerDocument = {
    createElement: (tag: string) => new Element(tag),
    get activeElement() { return Element.focused ?? null; }
  };
  get childNodes() { return this.children; }
  get firstElementChild() { return this.children[0]; }
  files: { name: string; type: string; size: number }[] = [];
  get options() { return this.children.filter(child => child.tag === 'option'); }
  constructor(readonly tag = 'div') {}
  createEl(tag: string, options: any = {}): Element {
    const el = new Element(tag);
    el.className = typeof options === 'string' ? options : options.cls ?? '';
    el.text = options.text ?? '';
    el.attributes = options.attr ?? {};
    el.parent = this;
    this.children.push(el);
    return el;
  }
  createDiv(options?: unknown): Element { return this.createEl('div', options); }
  createSpan(options?: unknown): Element { return this.createEl('span', options); }
  addClass(...names: string[]) { this.className += ' ' + names.join(' '); }
  removeClass(...names: string[]) { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); }
  toggleClass(name: string, value: boolean) { if (value) this.addClass(name); else this.removeClass(name); }
  focus() { Element.focused = this; } scrollIntoView() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 100 }; }
  contains(el: Element): boolean { return this === el || this.all().includes(el); }
  closest(_selector: string): Element | null {
    let element: Element | undefined = this;
    while (element) {
      if (['input', 'textarea', 'select', 'button', 'a'].includes(element.tag)
        || ['button', 'textbox'].includes(element.attributes.role)
        || (element.attributes.contenteditable !== undefined && element.attributes.contenteditable !== 'false')) return element;
      element = element.parent;
    }
    return null;
  }
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
    const el = this.all().find(child => child.attributes['aria-label'] === label)
      ?? this.all().find(child => child.text === label);
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
  setDesc(text: string) { this.settingEl.setAttribute('data-description', text); return this; } setHeading() { return this; }
  addToggle(callback: (toggle: any) => void) {
    const input = this.settingEl.createEl('input');
    const toggle = { setValue(value: boolean) { input.value = String(value); return this; }, onChange(fn: (value: boolean) => void) { input.events.change = event => fn(event); return this; } };
    callback(toggle); return this;
  }
  addButton(callback: (button: Button) => void) { callback(new Button(this.settingEl)); return this; }
  addExtraButton(callback: (button: Button) => void) { callback(new Button(this.settingEl)); return this; }
  addText(callback: (text: any) => void) { return this.addTextArea(callback); }
  addDropdown(callback: (dropdown: any) => void) {
    const select = this.settingEl.createEl('select');
    const dropdown = { selectEl: select, addOptions(options: Record<string, string>) { for (const [value, text] of Object.entries(options)) { const option = select.createEl('option', { text }); option.value = value; } return this; }, setValue(value: string) { select.value = value; return this; }, onChange(fn: (value: string) => void) { select.events.input = () => fn(select.value); return this; } };
    callback(dropdown); return this;
  }
  addTextArea(callback: (text: any) => void) {
    const input = this.settingEl.createEl('textarea');
    const text = { inputEl: input, setPlaceholder() { return this; }, addOptions() { return this; }, setValue(value: string) { input.value = value; return this; }, onChange(fn: (value: string) => void) { input.events.input = () => fn(input.value); return this; } };
    callback(text); return this;
  }
}
class Modal {
  private keys: { modifiers: string[]; key: string; callback: (event: any) => any }[] = [];
  scope = {
    register: (modifiers: string[], key: string, callback: (event: any) => any) => {
      const handler = { modifiers, key, callback };
      this.keys.push(handler);
      return handler;
    },
    enter: (event: any): any => {
      const modifiers = ['shift', 'ctrl', 'meta', 'alt'].filter(key => event[`${key}Key`]);
      const handler = this.keys.find(handler => handler.key === event.key
        && handler.modifiers.length === modifiers.length
        && handler.modifiers.every(key => modifiers.includes(key.toLowerCase())));
      return handler?.callback(event);
    }
  };
  contentEl = new Element(); modalEl = new Element();
  constructor(readonly app: unknown) {}
  title = '';
  setTitle(value: string) { this.title = value; } onOpen() {} onClose() {}
  open() {
    this.onOpen();
    // Obsidian focuses the first eligible control AFTER onOpen returns.
    this.contentEl.all().find(el => !el.disabled && (['button', 'input', 'select', 'textarea'].includes(el.tag)
      || el.attributes.tabindex !== undefined))?.focus();
  }
  close() { this.onClose(); }
  keydown(extra: Record<string, unknown> = {}) {
    let stopped = false;
    const event = { key: 'Enter', target: Element.focused, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; }, ...extra };
    // The host scope runs at window capture, ahead of listeners on the preview.
    if (this.scope.enter(event) === false) { event.preventDefault(); event.stopPropagation(); }
    for (let el = event.target; el && !stopped; el = el.parent) el.events.keydown?.(event);
    if (!event.defaultPrevented && event.key === 'Enter') {
      if (event.target?.tag === 'button') event.target.click();
      if (event.target?.tag === 'textarea') event.target.fill(event.target.value + '\n');
    }
    return event;
  }
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

async function host(selection = '', commandPrefix = '', initialSettings: EasyPasteSettings | null = null) {
  const requests: any[] = [];
  const notices: string[] = [];
  const secrets = new Map<string, string>();
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
    secretStorage: {
      getSecret: (name: string) => secrets.get(name) ?? (name.includes('image') ? 'vision-key' : 'text-key'),
      setSecret: (name: string, key: string) => { secrets.set(name, key); }
    }
  };
  class Plugin {
    app = app; commands: any[] = []; settings!: EasyPasteSettings; manifest = { id: 'easy-paste' };
    async loadData() { return initialSettings; } async saveData(value: EasyPasteSettings) { savedSettings = structuredClone(value); }
    addCommand(command: any) { command.name = commandPrefix + command.name; this.commands.push(command); return command; }
    addSettingTab() {} registerEvent() {}
  }
  const obsidian = {
    htmlToMarkdown(html: string) { htmlInputs.push(html); if (htmlFails) throw new Error('Invalid HTML'); return clipboardMarkdown; },
    Plugin, Modal, Setting, setIcon() {}, ButtonComponent: Button, TFile: File, MarkdownView: class {}, PluginSettingTab: class { containerEl = new Element(); constructor(readonly app: unknown) {} },
    Component: class { load() {} unload() {} addChild() {} removeChild() {} }, Notice: class { constructor(message: string) { notices.push(message); } },
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
  return { plugin, editor, view, events, requests, notices, command, rendered, settingNavigation, htmlInputs, getSavedSettings: () => savedSettings, setClipboardMarkdown: (text: string) => { clipboardMarkdown = text; }, failHtml: () => { htmlFails = true; }, setResponse: (text: string) => { responseContent = text; }, delayRenders: () => { delayRenders = true; }, finishImageReads: async () => {
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
  assert.equal(modal.contentEl.querySelector('.easypaste-status')!.text, '当前规则没有改变原文。');
  panel.querySelectorAll('input')[h.plugin.settings.rules.pipeline.findIndex((rule: any) => rule.id === 'words')].events.change(true);
  assert.equal(editor.value, 'of the');
  assert.equal(modal.contentEl.querySelector('.easypaste-status')!.text, '');
  assert.match(modal.contentEl.querySelector('.easypaste-tags')!.textContent, /拆分粘连单词/);
  assert.equal(h.requests.length, 0);
  modal.modalEl.find('打开规则设置').click();
  assert.deepEqual(h.settingNavigation, ['open', 'easy-paste']);
  modal.close();
  h.plugin.settings.rules.words = false;
  await h.plugin.saveSettings();
  assert.equal(editor.value, 'of the');
});

test('spelling target switches live, persists and respects protected words from full settings', async () => {
  const h = await host('color organize');
  h.plugin.commands.find((command: any) => command.id === 'clean-selection').editorCheckCallback(false, h.editor, h.view);
  const modal = h.plugin.modal as Modal;
  let panel = modal.modalEl.find('快速配置规则');
  const index = h.plugin.settings.rules.pipeline.findIndex((rule: any) => rule.id === 'spelling');
  assert.equal(modal.contentEl.find('编辑转换结果').value, 'color organize');
  panel.querySelectorAll('input')[index].events.change(true);
  assert.equal(modal.contentEl.find('编辑转换结果').value, 'colour organise');
  panel = modal.modalEl.find('快速配置规则');
  panel.find('转换至：').fill('us');
  assert.equal(modal.contentEl.find('编辑转换结果').value, 'color organize');
  panel = modal.modalEl.find('快速配置规则');
  panel.find('转换至：').fill('gb');
  const tab = h.plugin.settingTab; tab.display();
  tab.containerEl.find('拼写保护词').fill('color');
  assert.equal(modal.contentEl.find('编辑转换结果').value, 'color organise');
  await h.plugin.saveSettings();
  assert.equal(h.getSavedSettings()?.rules.spelling, true);
  assert.equal(h.getSavedSettings()?.rules.spellingTarget, 'gb');
  assert.equal(h.getSavedSettings()?.rules.spellingProtectedWords, 'color');
  assert.equal(h.requests.length, 0);
  modal.close();
});

test('spelling-only changes trigger automatic paste preview and apply only after confirmation', async () => {
  const h = await host();
  h.plugin.settings.rules.words = h.plugin.settings.rules.lists = false;
  h.plugin.settings.rules.spelling = true;
  h.plugin.settings.rules.spellingTarget = 'us';
  let prevented = false;
  h.events['editor-paste']({ defaultPrevented: false, clipboardData: {
    files: [], items: [], getData: () => 'colour organise practice'
  }, preventDefault: () => { prevented = true; } }, h.editor, h.view);
  assert.equal(prevented, true);
  assert.equal(h.editor.value, 'prefix');
  const modal = h.plugin.modal as Modal;
  assert.equal(modal.contentEl.find('编辑转换结果').value, 'color organize practice');
  assert.equal(h.requests.length, 0);
  modal.contentEl.find('确认应用').click();
  assert.equal(h.editor.value, 'prefixcolor organize practice');
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
  handles[1].events.dragstart({ clientX: 10, clientY: 20, dataTransfer: { setData() {}, setDragImage() {} } });
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

test('full settings retain regex editing and only expose the spelling builtin parameters', async () => {
  const h = await host('AAA');
  const tab = h.plugin.settingTab;
  tab.display();
  const initialCards = tab.containerEl.querySelectorAll('.easypaste-rule');
  assert.equal(initialCards.length, 7);
  assert.ok(initialCards.filter((_card: Element, index: number) => h.plugin.settings.rules.pipeline[index].kind === 'builtin' && h.plugin.settings.rules.pipeline[index].id !== 'spelling').every((card: Element) => card.querySelectorAll('textarea').length === 0));
  assert.equal(initialCards.filter((card: Element) => card.querySelectorAll('textarea').length > 0).length, 3);
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
  assert.equal(cards.length, 7);
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
    h.plugin.settingTab.containerEl.find(`${title}Prompt`).fill('Updated after opening');
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

test('offline preview keeps initial focus after the host opens it and Enter applies once', async () => {
  const h = await host('ofthe');
  h.plugin.commands.find((command: any) => command.id === 'clean-selection').editorCheckCallback(false, h.editor, h.view);
  const modal = h.plugin.modal as Modal;
  assert.ok(Element.focused === modal.contentEl.find('转换预览'), 'Expected preview focus');
  assert.equal(modal.keydown().defaultPrevented, true);
  assert.equal(h.editor.value, 'prefixof the');
});

test('smart selection starts in preview and scope Enter sends then applies without another click', async () => {
  const h = await host('source');
  const modal = h.open();
  const preview = modal.contentEl.find('转换预览');
  assert.ok(Element.focused === preview, 'Expected preview focus');
  modal.keydown();
  modal.keydown({ repeat: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests.length, 1);
  assert.equal(h.editor.value, 'prefixsource');
  assert.ok(Element.focused === preview, 'Expected preview focus');
  modal.keydown();
  assert.equal(h.editor.value, 'prefixconverted');
});

test('clicking send moves focus to preview before the host disables the button', async () => {
  const h = await host('source');
  const modal = h.open();
  const send = modal.contentEl.find('发送并转换');
  send.focus();
  send.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests.length, 1);
  assert.ok(Element.focused === modal.contentEl.find('转换预览'), 'Expected preview focus');
  modal.keydown();
  assert.equal(h.editor.value, 'prefixconverted');
});

test('host key dispatch preserves input newlines and ignores modified, composing and repeated Enter', async () => {
  const h = await host();
  const modal = h.open();
  assert.ok(Element.focused === modal.contentEl.find('待转换文本'), 'Expected source input focus');
  for (const label of ['待转换文本', '智能转换临时要求', '编辑转换结果']) {
    const input = modal.contentEl.find(label);
    input.focus();
    input.fill('text');
    assert.equal(modal.keydown().defaultPrevented, false);
    assert.equal(input.value, 'text\n');
  }
  const preview = modal.contentEl.find('转换预览');
  preview.focus();
  for (const extra of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
    { isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true }]) modal.keydown(extra);
  assert.equal(h.requests.length, 0);
  assert.equal(h.editor.value, 'prefix');
  modal.close();
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


test('settings use a full-height edge handle, drag the entire card, and validate below the expression', async () => {
  const h = await host('AAA');
  const tab = h.plugin.settingTab;
  tab.display();
  const cards = tab.containerEl.querySelectorAll('.easypaste-rule');
  const edge = cards[1].querySelector('.easypaste-drag-edge')!;
  assert.ok(edge);
  assert.equal(edge.tag, 'div');
  assert.equal(edge.attributes.draggable, 'true');
  assert.equal(edge.attributes.tabindex, '0');
  assert.ok(cards[1].children.includes(edge));
  assert.equal(cards[1].querySelector('.easypaste-rule-head')!.querySelector('.easypaste-drag-handle'), undefined);
  let ghost: unknown[] = [];
  edge.events.dragstart({ clientX: 12, clientY: 30, dataTransfer: {
    setData() {}, setDragImage(...args: unknown[]) { ghost = args; }
  } });
  assert.deepEqual(ghost, [cards[1], 12, 30]);
  const id = h.plugin.settings.rules.pipeline[1].id;
  cards[0].events.drop({ clientY: 10, preventDefault() {} });
  assert.equal(h.plugin.settings.rules.pipeline[0].id, id);
  tab.containerEl.find('新增规则').click();
  const regex = tab.containerEl.querySelectorAll('.easypaste-rule').at(-1)!;
  const status = regex.querySelector('.easypaste-regex-status')!;
  const patternIndex = regex.children.findIndex((el: Element) => el.textContent.includes('匹配表达式'));
  assert.equal(regex.children[patternIndex + 1], status);
  assert.ok(regex.children[patternIndex + 2].textContent.includes('替换文本'));
  const pattern = regex.querySelectorAll('textarea')[1];
  pattern.fill('[');
  assert.ok(status.text.startsWith('规则无效'));
  assert.ok(status.className.includes('easypaste-rule-error'));
  pattern.fill('valid');
  assert.equal(status.text, '正则表达式有效');
  assert.ok(!status.className.includes('easypaste-rule-error'));
});


test('preview side cards use edge handles and omit API disclosure and title subtitle', async () => {
  const h = await host('ofthe');
  h.plugin.commands.find((command: any) => command.id === 'clean-selection').editorCheckCallback(false, h.editor, h.view);
  const modal = h.plugin.modal as Modal;
  const panel = modal.modalEl.find('快速配置规则');
  for (const card of panel.querySelectorAll('.easypaste-rule')) {
    const edge = card.querySelector('.easypaste-drag-edge');
    assert.ok(edge && card.children.includes(edge));
    assert.equal(card.querySelector('.easypaste-rule-head')!.querySelector('.easypaste-drag-handle'), undefined);
  }
  assert.equal(modal.contentEl.querySelector('.easypaste-disclosure'), undefined);
  assert.ok(!modal.contentEl.textContent.includes('本地规则转换'));
  modal.close();
});

test('clicking readonly preview focuses it and modal-scope Enter applies exactly once', async () => {
  const h = await host('ofthe');
  h.plugin.commands.find((command: any) => command.id === 'clean-selection').editorCheckCallback(false, h.editor, h.view);
  const modal = h.plugin.modal as Modal;
  const preview = modal.contentEl.find('转换预览');
  const original = modal.contentEl.querySelector('.easypaste-original-text')!;
  const target = original.children[0] ?? original;
  modal.contentEl.find('编辑转换结果').focus();
  preview.events.click({ target });
  assert.ok(Element.focused === preview, 'Expected preview focus');
  const event = { key: 'Enter', target, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  assert.equal(modal.scope.enter(event), false);
  preview.events.keydown(event);
  assert.equal(h.editor.value, 'prefixof the');
});

test('switching preview tabs restores preview focus and rendered descendants support Enter', async () => {
  const h = await host('source');
  const modal = h.open();
  await modal.generate();
  const preview = modal.contentEl.find('转换预览');
  modal.contentEl.find('预览').click();
  assert.ok(Element.focused === preview, 'Expected preview focus');
  const rendered = modal.contentEl.querySelector('.easypaste-rendered')!;
  const text = rendered.createSpan({ text: 'rendered result' });
  modal.scope.enter({ key: 'Enter', target: text, preventDefault() {}, stopPropagation() {} });
  assert.equal(h.editor.value, 'prefixconverted');
});

test('automatic callout paste reads the actual line in a multiline note, including existing body text', async () => {
  for (const line of ['> ', '> already written: ', '> > ']) {
    const h = await host();
    const original = 'Intro\n\n> [!note] Title\n' + line;
    h.editor.value = original;
    const position = { line: 3, ch: line.length };
    const offset = (pos: { line: number; ch: number }) => original.split('\n').slice(0, pos.line).reduce((n, value) => n + value.length + 1, 0) + pos.ch;
    h.editor.getCursor = () => ({ ...position });
    h.editor.getLine = (index = 0) => original.split('\n')[index];
    h.editor.getRange = (from: any, to: any) => original.slice(offset(from), offset(to));
    h.editor.replaceRange = (text: string, from: any, to: any) => { h.editor.value = original.slice(0, offset(from)) + text + original.slice(offset(to)); };
    let prevented = false;
    h.events['editor-paste']({ defaultPrevented: false, clipboardData: {
      files: [], items: [], getData: (type: string) => type === 'text/plain' ? 'First\n\nSecond' : ''
    }, preventDefault: () => { prevented = true; } }, h.editor, h.view);
    assert.equal(prevented, true, line);
    const continuation = line.startsWith('> >') ? '> > ' : '> ';
    assert.equal(h.plugin.modal.contentEl.find('编辑转换结果').value, 'First\n' + continuation + '\n' + continuation + 'Second');
    h.plugin.modal.contentEl.find('确认应用').click();
    assert.equal(h.editor.value, original + 'First\n' + continuation + '\n' + continuation + 'Second');
  }
});

test('callout paste uses the event editor even when the active view exposes a different editor object', async () => {
  const h = await host();
  const eventEditor = h.editor;
  eventEditor.value = '> ';
  eventEditor.from = eventEditor.to = 2;
  h.view.editor = { ...eventEditor, value: 'main editor' };
  const info = { file: h.view.file, editor: eventEditor };
  let prevented = false;
  h.events['editor-paste']({ defaultPrevented: false, clipboardData: {
    files: [], items: [], getData: (type: string) => type === 'text/plain' ? 'First\nSecond' : ''
  }, preventDefault: () => { prevented = true; } }, eventEditor, info);
  assert.equal(prevented, true);
  h.plugin.modal.contentEl.find('确认应用').click();
  assert.equal(eventEditor.value, '> First\n> Second');
  assert.equal(h.view.editor.value, 'main editor');
});

test('disabled callout rule and already handled paste do not intercept quote pastes', async () => {
  for (const handled of [false, true]) {
    const h = await host();
    h.editor.value = '> ';
    h.editor.from = h.editor.to = 2;
    h.plugin.settings.rules.pasteIntoCallout = handled;
    let prevented = false;
    h.events['editor-paste']({ defaultPrevented: handled, clipboardData: {
      files: [], items: [], getData: (type: string) => type === 'text/plain' ? 'First\nSecond' : ''
    }, preventDefault: () => { prevented = true; } }, h.editor, h.view);
    assert.equal(prevented, false);
    assert.equal(h.plugin.modal, undefined);
  }
});

test('single-line slide paste into a callout quotes the split list immediately and when rules are toggled', async () => {
  const h = await host();
  h.editor.value = '> ';
  h.editor.from = h.editor.to = 2;
  // It must also work when the saved rule order puts callout handling before lists.
  const rules = h.plugin.settings.rules;
  rules.pipeline = [{ kind: 'builtin', id: 'pasteIntoCallout' }, ...rules.pipeline!.filter((rule: any) => rule.id !== 'pasteIntoCallout')];
  const source = 'One way to view the forward pass:– Input representation of each token ispropagated through the residual stream– Modules like MHA and FFN make small,additive edits.';
  const expected = 'One way to view the forward pass:\n> - Input representation of each token is propagated through the residual stream– Modules like MHA and FFN make small,additive edits.';
  let prevented = false;
  h.events['editor-paste']({ defaultPrevented: false, clipboardData: {
    files: [], items: [], getData: (type: string) => type === 'text/plain' ? source : ''
  }, preventDefault: () => { prevented = true; } }, h.editor, h.view);
  assert.equal(prevented, true);
  const modal = h.plugin.modal as Modal;
  const result = modal.contentEl.find('编辑转换结果');
  assert.equal(result.value, expected);
  const panel = modal.modalEl.find('快速配置规则');
  panel.querySelectorAll('input')[0].events.change(false);
  assert.equal(result.value, expected.replace(/\n> /g, '\n'));
  panel.querySelectorAll('input')[0].events.change(true);
  assert.equal(result.value, expected);
  assert.equal(h.editor.value, '> ');
  modal.contentEl.find('确认应用').click();
  assert.equal(h.editor.value, '> ' + expected);
});

async function selectLanguage(h: Awaited<ReturnType<typeof host>>, locale: Locale): Promise<void> {
  h.plugin.settingTab.display();
  const root = h.plugin.settingTab.containerEl as Element;
  const row = root.find(h.plugin.t('language.name')).parent!;
  const select = row.children.find(child => child.tag === 'select')!;
  select.fill(locale);
  await new Promise(resolve => setImmediate(resolve));
}

test('all three languages are selectable, persist, and load with translated commands after restart', async () => {
  const h = await host();
  h.plugin.settingTab.display();
  const root = h.plugin.settingTab.containerEl as Element;
  const row = root.find('插件语言').parent!;
  assert.equal(row.attributes['data-description'], undefined);
  const select = row.children.find(child => child.tag === 'select')!;
  assert.deepEqual(select.options.map(option => [option.value, option.text, option.disabled]), [
    ['zh-CN', '简体中文', false], ['en', '英语', false], ['ko', '韩语', false]
  ]);
  for (const locale of ['en', 'ko', 'zh-CN'] as const) {
    await selectLanguage(h, locale);
    assert.equal(h.plugin.settings.language, locale);
    assert.equal(h.getSavedSettings()?.language, locale);
    const restarted = await host('', '', h.getSavedSettings()!);
    assert.equal(restarted.plugin.settings.language, locale);
    assert.equal(restarted.plugin.commands[0].name, createTranslator(locale)('command.clean'));
  }
});

test('real language changes translate new UI and errors while preserving open preview edits and user content', async () => {
  const h = await host('source content');
  const first = h.open();
  await first.generate();
  first.contentEl.find('编辑转换结果').fill('my manual edit');
  h.plugin.settings.temporaryInstructions = '用户自定义要求';
  const prompt = h.plugin.settings.textApi.prompt;
  await selectLanguage(h, 'en');
  assert.equal(first.contentEl.find('编辑转换结果').value, 'my manual edit');
  assert.equal(first.title, 'EasyPaste：智能转换');
  first.close();
  for (const locale of ['en', 'ko', 'zh-CN'] as const) {
    await selectLanguage(h, locale);
    const t = createTranslator(locale);
    assert.equal(h.plugin.commands[0].name, t('command.clean'));
    assert.equal(h.plugin.settings.textApi.prompt, prompt);
    assert.equal(h.plugin.settings.temporaryInstructions, '用户自定义要求');
    const menu = new Menu();
    h.events['editor-menu'](menu, h.editor, h.view);
    assert.equal(menu.items[0].title, t('common.menuTitle', { name: t('command.clean') }));
    const settingsRoot = h.plugin.settingTab.containerEl as Element;
    settingsRoot.find(t('language.name'));
    settingsRoot.find(t('rule.pattern'));
    const description = settingsRoot.find(t('settings.maxChars')).parent!.attributes['data-description'];
    assert.equal(description, t('settings.maxCharsDesc'));
    const next = h.open();
    assert.equal(next.title, t('preview.smartTitle'));
    const source = next.contentEl.find(t('preview.sourceLabel'));
    assert.equal(source.value, 'source content');
    assert.equal(source.attributes.placeholder, t('preview.sourcePlaceholder'));
    assert.equal(next.contentEl.find(t('preview.instructions')).value, '用户自定义要求');
    next.contentEl.find(t('preview.editorLabel'));
    source.fill('');
    await next.generate();
    assert.equal(next.contentEl.querySelector('.easypaste-status')!.text, t('input.empty'));
    source.fill('source content');
    await next.generate();
    assert.equal(next.contentEl.querySelector('.easypaste-status')!.text, t('preview.converted'));
    // The snapshot still blocks an edited note and displays the translated error.
    h.editor.value += '!';
    next.contentEl.find(t('preview.apply')).click();
    assert.equal(next.contentEl.querySelector('.easypaste-status')!.text, t('preview.targetChanged'));
    h.editor.value = 'prefixsource content';
    next.contentEl.find(t('preview.apply')).click();
    assert.equal(h.notices.at(-1), t('preview.applied'));
    h.editor.value = 'prefixsource content';
  }
});


test('refreshing command language preserves host prefixes and registered command ids', async () => {
  const h = await host('', 'EasyPaste: ');
  const originalT = h.plugin.t;
  Object.defineProperty(h.plugin, 't', { get: () => (key: string) => `⟦${key}⟧${originalT(key)}` });
  await h.plugin.saveSettings();
  assert.equal(h.plugin.commands[0].name, 'EasyPaste: ⟦command.clean⟧离线清洗');
  assert.equal(h.plugin.commands[0].id, 'clean-selection');
  await h.plugin.saveSettings();
  assert.equal(h.plugin.commands[0].name, 'EasyPaste: ⟦command.clean⟧离线清洗');
});
