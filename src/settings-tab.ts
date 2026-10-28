import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type EasyPaste from './main';
import type { ApiSettings } from './settings';
import { completionUrl } from './api';

export class EasyPasteSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: EasyPaste) { super(app, plugin); }
  display(): void {
    const { containerEl: root } = this;
    const s = this.plugin.settings;
    root.empty();
    root.createEl('h2', { text: 'EasyPaste' });
    const save = () => this.plugin.saveSettings();
    new Setting(root).setName('自动粘贴预览').setDesc('仅在检测到并修复了列表、断词或粘连词时弹出；代码与公式上下文不触发。')
      .addToggle(t => t.setValue(s.autoPaste).onChange(async v => { s.autoPaste = v; await save(); }));
    new Setting(root).setName('启用快捷键命令').setDesc('开启后可在 Obsidian「快捷键」中绑定「离线清洗」和「智能转换」。智能转换自动选择文本或视觉 API，无选区时可粘贴文本或添加图片。关闭后右键菜单仍可使用。默认不占用系统快捷键。')
      .addToggle(t => t.setValue(s.shortcuts).onChange(async v => { s.shortcuts = v; await save(); }));
    new Setting(root).setName('自动处理字符上限').setDesc('超出时保持 Obsidian 原生粘贴，可选中文本手动清洗。')
      .addText(t => t.setValue(String(s.maxAutoChars)).onChange(async v => { const n = Number(v); if (Number.isFinite(n) && n >= 1000 && n <= 100000) { s.maxAutoChars = n; await save(); } }));
    new Setting(root).setName('离线规则').setHeading();
    new Setting(root).setName('列表与缩进').setDesc('转换点号、破折号、数字/字母/罗马序号。相同缩进中不同符号推断为子列表，同一符号再次出现时回到原层级。')
      .addToggle(t => t.setValue(s.rules.lists).onChange(async v => { s.rules.lists = v; await save(); }));
    new Setting(root).setName('英文断词与粘连词').setDesc('使用内置英美拼写词典与词频离线修复，无需配置词表。歧义较大的内容保留原文，修改后先预览。')
      .addToggle(t => t.setValue(s.rules.words).onChange(async v => { s.rules.words = v; await save(); }));
    new Setting(root).setName('连接普通段落硬换行').setDesc('默认关闭。开启后将普通段落相邻非空行连为空格，诗歌、地址等内容请关闭。')
      .addToggle(t => t.setValue(s.rules.joinWrappedLines).onChange(async v => { s.rules.joinWrappedLines = v; await save(); }));
    new Setting(root).setName('子列表缩进').addDropdown(d => d.addOptions({ '2': '2 个空格', '4': '4 个空格（推荐）' })
      .setValue(String(s.rules.indentSize)).onChange(async v => { s.rules.indentSize = Number(v); await save(); }));
    new Setting(root).setName('精确替换表').setDesc('可选。每行：粘连词 => 正确文本。优先于自动拆分与完整词保护，忽略大小写，保留首字母大写。')
      .addTextArea(t => t.setValue(s.rules.replacements).onChange(async v => { s.rules.replacements = v; await save(); }).inputEl.rows = 7);
    new Setting(root).setName('额外英文词表').setDesc('可选，留空仍可自动处理。每行一个词或空格分隔，用于补充专业术语、品牌和姓名；完整词加入后不会自动拆分。已有词表继续生效。')
      .addTextArea(t => t.setValue(s.rules.vocabulary).onChange(async v => { s.rules.vocabulary = v; await save(); }).inputEl.rows = 8);
    this.apiSection(root.createDiv('easypaste-api-section'), '智能转换', s.textApi, false);
    this.apiSection(root.createDiv('easypaste-api-section'), '图片转换', s.imageApi, true);
    new Setting(root).setName('通用转换设置').setHeading();
    new Setting(root).setName('等待超时（秒）').setDesc('10–300 秒。取消或超时会停止等待与应用结果；底层请求可能仍在供应商处执行并计费。')
      .addText(t => t.setValue(String(s.timeoutSeconds)).onChange(async v => { const n = Number(v); if (n >= 10 && n <= 300) { s.timeoutSeconds = n; await save(); } }));
    new Setting(root).setName('补充格式要求').setDesc('仅发送到手动 API 转换，不影响本地规则。')
      .addTextArea(t => t.setValue(s.extraInstructions).onChange(async v => { s.extraInstructions = v; await save(); }).inputEl.rows = 4);
  }
  private apiSection(root: HTMLElement, title: string, api: ApiSettings, image: boolean): void {
    const save = () => this.plugin.saveSettings();
    new Setting(root).setName(title).setHeading();
    new Setting(root).setName('Base URL').setDesc('填写兼容 OpenAI Chat Completions 的服务地址；也接受完整 /chat/completions 地址。')
      .addText(t => t.setPlaceholder('https://api.example.com/v1').setValue(api.baseUrl).onChange(async v => { api.baseUrl = v.trim(); await save(); }));
    const keySetting = new Setting(root).setName('API Key');
    const updateKeyStatus = () => keySetting.setDesc(this.app.secretStorage.getSecret(api.secretName)
      ? '已保存。留空保持原密钥；点击清除可删除。' : '尚未配置。密钥使用 Obsidian SecretStorage 保存。');
    updateKeyStatus();
    keySetting.addText(t => {
      t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off';
      t.setPlaceholder('输入密钥以保存').onChange(v => {
        if (v.trim()) { this.app.secretStorage.setSecret(api.secretName, v.trim()); updateKeyStatus(); }
      });
    }).addButton(b => b.setButtonText('清除').onClick(() => { this.app.secretStorage.setSecret(api.secretName, ''); this.display(); }));
    new Setting(root).setName('Model Name').setDesc(image ? '填写视觉模型名称或 ID。智能转换输入含图片时使用此配置（包含同时输入的文本）。' : '填写文本模型名称或 ID。智能转换输入为纯文本时使用此配置。')
      .addText(t => t.setPlaceholder('模型名称或 ID').setValue(api.model).onChange(async v => { api.model = v.trim(); await save(); }));
    new Setting(root).setName('检查地址格式').setDesc('只检查本地配置，不发送网络请求。')
      .addButton(b => b.setButtonText('检查').onClick(() => {
        try { new Notice(`请求地址：${completionUrl(api.baseUrl)}`); }
        catch (e) { new Notice(e instanceof Error ? e.message : '地址无效'); }
      }));
  }
}
