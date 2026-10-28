import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type EasyPaste from './main';
import type { Provider } from './settings';
import { completionUrl } from './api';

export class EasyPasteSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: EasyPaste) { super(app, plugin); }
  display(): void {
    const { containerEl: root } = this;
    const s = this.plugin.settings;
    root.empty();
    root.createEl('h2', { text: 'EasyPaste' });
    root.createEl('p', { text: '自动粘贴只使用本地规则。LLM 与 OCR 必须手动点击发送，所有结果均需确认后应用。' });
    const save = () => this.plugin.saveSettings();
    new Setting(root).setName('自动粘贴预览').setDesc('仅在检测到并修复了列表、断词或词表中的粘连词时弹出；代码与公式上下文不触发。')
      .addToggle(t => t.setValue(s.autoPaste).onChange(async v => { s.autoPaste = v; await save(); }));
    new Setting(root).setName('启用快捷键命令').setDesc('开启后可在 Obsidian「快捷键」中绑定 EasyPaste 的三个命令。关闭后命令不可用，右键菜单仍可使用。默认不占用系统快捷键。')
      .addToggle(t => t.setValue(s.shortcuts).onChange(async v => { s.shortcuts = v; await save(); }));
    new Setting(root).setName('自动处理字符上限').setDesc('超出时保持 Obsidian 原生粘贴，可选中文本手动清洗。')
      .addText(t => t.setValue(String(s.maxAutoChars)).onChange(async v => { const n = Number(v); if (Number.isFinite(n) && n >= 1000 && n <= 100000) { s.maxAutoChars = n; await save(); } }));
    new Setting(root).setName('离线规则').setHeading();
    new Setting(root).setName('列表与缩进').setDesc('转换点号、破折号、数字/字母/罗马序号。相同缩进中不同符号推断为子列表，同一符号再次出现时回到原层级。')
      .addToggle(t => t.setValue(s.rules.lists).onChange(async v => { s.rules.lists = v; await save(); }));
    new Setting(root).setName('英文断词与粘连词').setDesc('按下面的词表与替换表修复，不进行无词典依据的猜测。')
      .addToggle(t => t.setValue(s.rules.words).onChange(async v => { s.rules.words = v; await save(); }));
    new Setting(root).setName('连接普通段落硬换行').setDesc('默认关闭。开启后将普通段落相邻非空行连为空格，诗歌、地址等内容请关闭。')
      .addToggle(t => t.setValue(s.rules.joinWrappedLines).onChange(async v => { s.rules.joinWrappedLines = v; await save(); }));
    new Setting(root).setName('子列表缩进').addDropdown(d => d.addOptions({ '2': '2 个空格', '4': '4 个空格（推荐）' })
      .setValue(String(s.rules.indentSize)).onChange(async v => { s.rules.indentSize = Number(v); await save(); }));
    new Setting(root).setName('精确替换表').setDesc('每行：粘连词 => 正确文本。忽略大小写，保留首字母大写。')
      .addTextArea(t => t.setValue(s.rules.replacements).onChange(async v => { s.rules.replacements = v; await save(); }).inputEl.rows = 7);
    new Setting(root).setName('英文词表').setDesc('每行一个词或空格分隔。已知词不拆分；未知词仅在有唯一的两词拆分时修复（每词至少 3 字母）。跨行连字符仅在合并后属于词表时删除。')
      .addTextArea(t => t.setValue(s.rules.vocabulary).onChange(async v => { s.rules.vocabulary = v; await save(); }).inputEl.rows = 8);
    new Setting(root).setName('API 供应商').setHeading();
    root.createEl('p', { text: '兼容 OpenAI Chat Completions。模型 ID 请从供应商控制台复制；图片识别必须选择支持 image_url 的视觉模型。API Key 使用 Obsidian SecretStorage 保存，其他配置存入插件 data.json。' });
    const providerSelect = (name: string, key: 'textProvider' | 'visionProvider') => {
      new Setting(root).setName(name).addDropdown(d => {
        s.providers.forEach(p => d.addOption(p.id, p.name));
        d.setValue(s[key]).onChange(async v => { s[key] = v; await save(); });
      });
    };
    providerSelect('文本转换供应商', 'textProvider');
    providerSelect('图片识别供应商', 'visionProvider');
    for (const provider of s.providers) this.provider(root, provider);
    new Setting(root).setName('添加自定义供应商').addButton(b => b.setButtonText('添加').onClick(async () => {
      const id = `custom-${Date.now()}`;
      s.providers.push({ id, name: '自定义供应商', baseUrl: '', textModel: '', visionModel: '', secretName: `easypaste-${id}` });
      await save(); this.display();
    }));
    new Setting(root).setName('等待超时（秒）').setDesc('10–300 秒。取消或超时会停止等待与应用结果；底层请求可能仍在供应商处执行并计费。')
      .addText(t => t.setValue(String(s.timeoutSeconds)).onChange(async v => { const n = Number(v); if (n >= 10 && n <= 300) { s.timeoutSeconds = n; await save(); } }));
    new Setting(root).setName('补充格式要求').setDesc('仅发送到手动 API 转换，不影响本地规则。')
      .addTextArea(t => t.setValue(s.extraInstructions).onChange(async v => { s.extraInstructions = v; await save(); }).inputEl.rows = 4);
  }
  private provider(root: HTMLElement, p: Provider): void {
    const save = () => this.plugin.saveSettings();
    new Setting(root).setName(p.name).setHeading();
    new Setting(root).setName('显示名称').addText(t => t.setValue(p.name).onChange(async v => { p.name = v; await save(); }));
    new Setting(root).setName('Base URL').setDesc('例如 https://api.tokenfactory.nebius.com/v1；也接受完整 /chat/completions 地址。')
      .addText(t => t.setValue(p.baseUrl).onChange(async v => { p.baseUrl = v.trim(); await save(); }));
    new Setting(root).setName('API Key').setDesc(this.app.secretStorage.getSecret(p.secretName) ? '已保存。留空保持原密钥；点击清除可删除。' : '尚未配置。留空保持原密钥。')
      .addText(t => {
        t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off';
        t.setPlaceholder('输入密钥以保存').onChange(v => { if (v.trim()) this.app.secretStorage.setSecret(p.secretName, v.trim()); });
      }).addButton(b => b.setButtonText('清除').onClick(() => { this.app.secretStorage.setSecret(p.secretName, ''); this.display(); }));
    new Setting(root).setName('文本模型 ID').addText(t => t.setValue(p.textModel).onChange(async v => { p.textModel = v.trim(); await save(); }));
    new Setting(root).setName('视觉模型 ID').addText(t => t.setValue(p.visionModel).onChange(async v => { p.visionModel = v.trim(); await save(); }));
    new Setting(root).setName('检查地址格式').setDesc('只检查本地配置，不发送网络请求。')
      .addButton(b => b.setButtonText('检查').onClick(() => {
        try { new Notice(`请求地址：${completionUrl(p.baseUrl)}`); }
        catch (e) { new Notice(e instanceof Error ? e.message : '地址无效'); }
      }));
    if (p.id.startsWith('custom-')) new Setting(root).setName('移除此供应商').addButton(b => b.setButtonText('移除').onClick(async () => {
      this.plugin.settings.providers = this.plugin.settings.providers.filter(item => item.id !== p.id);
      if (this.plugin.settings.textProvider === p.id) this.plugin.settings.textProvider = 'openai';
      if (this.plugin.settings.visionProvider === p.id) this.plugin.settings.visionProvider = 'openai';
      this.app.secretStorage.setSecret(p.secretName, '');
      await save(); this.display();
    }));
  }
}
