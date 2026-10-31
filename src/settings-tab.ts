import { LOCALES, isLocaleReady, normalizeLocale, errorText } from './i18n';
import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type EasyPaste from './main';
import type { ApiSettings } from './settings';
import { renderRuleList } from './rule-list';
import { completionUrl } from './api';

export class EasyPasteSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: EasyPaste) { super(app, plugin); }
  display(): void {
    const { containerEl: root } = this;
    const s = this.plugin.settings;
    root.empty();
    root.createEl('h2', { text: this.plugin.t('common.pluginName') });
    const save = () => this.plugin.saveSettings().catch(() => { new Notice(this.plugin.t('settings.saveFailed')); });
    const languageKeys = { 'zh-CN': 'language.zhCN', en: 'language.en', ko: 'language.ko' } as const;
    new Setting(root).setName(this.plugin.t('language.name'))
      .addDropdown(dropdown => {
        const options = Object.fromEntries(LOCALES.map(locale => {
          const name = this.plugin.t(languageKeys[locale]);
          return [locale, isLocaleReady(locale) ? name : this.plugin.t('language.pending', { name })];
        }));
        dropdown.addOptions(options).setValue(s.language);
        for (const option of Array.from(dropdown.selectEl.options)) option.disabled = !isLocaleReady(normalizeLocale(option.value));
        dropdown.onChange(async value => {
          const locale = normalizeLocale(value);
          if (!isLocaleReady(locale)) { dropdown.setValue(s.language); return; }
          s.language = locale;
          try { await this.plugin.saveSettings(); this.display(); }
          catch { new Notice(this.plugin.t('language.saveFailed')); }
        });
      });
    new Setting(root).setName(this.plugin.t('settings.autoPaste')).setDesc(this.plugin.t('settings.autoPasteDesc'))
      .addToggle(t => t.setValue(s.autoPaste).onChange(async v => { s.autoPaste = v; await save(); }));
    new Setting(root).setName(this.plugin.t('settings.shortcuts')).setDesc(this.plugin.t('settings.shortcutsDesc'))
      .addToggle(t => t.setValue(s.shortcuts).onChange(async v => { s.shortcuts = v; await save(); }));
    new Setting(root).setName(this.plugin.t('settings.maxChars')).setDesc(this.plugin.t('settings.maxCharsDesc'))
      .addText(t => t.setValue(String(s.maxAutoChars)).onChange(async v => { const n = Number(v); if (Number.isFinite(n) && n >= 1000 && n <= 100000) { s.maxAutoChars = n; await save(); } }));
    const rulesHeading = new Setting(root).setName(this.plugin.t('settings.rules')).setHeading();
    rulesHeading.settingEl.id = 'easypaste-rule-settings';
    this.ruleSection(root.createDiv('easypaste-rules'));
    new Setting(root).setName(this.plugin.t('settings.indent')).addDropdown(d => d.addOptions({ '2': this.plugin.t('settings.indent2'), '4': this.plugin.t('settings.indent4') })
      .setValue(String(s.rules.indentSize)).onChange(async v => { s.rules.indentSize = Number(v); await save(); }));
    new Setting(root).setName(this.plugin.t('settings.replacements')).setDesc(this.plugin.t('settings.replacementsDesc'))
      .addTextArea(t => t.setValue(s.rules.replacements).onChange(async v => { s.rules.replacements = v; await save(); }).inputEl.rows = 7);
    new Setting(root).setName(this.plugin.t('settings.vocabulary')).setDesc(this.plugin.t('settings.vocabularyDesc'))
      .addTextArea(t => t.setValue(s.rules.vocabulary).onChange(async v => { s.rules.vocabulary = v; await save(); }).inputEl.rows = 8);
    this.apiSection(root.createDiv('easypaste-api-section'), this.plugin.t('api.textSection'), s.textApi, false);
    this.apiSection(root.createDiv('easypaste-api-section'), this.plugin.t('api.imageSection'), s.imageApi, true);
    new Setting(root).setName(this.plugin.t('settings.general')).setHeading();
    new Setting(root).setName(this.plugin.t('settings.timeout')).setDesc(this.plugin.t('settings.timeoutDesc'))
      .addText(t => t.setValue(String(s.timeoutSeconds)).onChange(async v => { const n = Number(v); if (n >= 10 && n <= 300) { s.timeoutSeconds = n; await save(); } }));
  }
  focusRules(): void {
    this.containerEl.querySelector('#easypaste-rule-settings')?.scrollIntoView({ block: 'start' });
  }
  private ruleSection(root: HTMLElement): void {
    root.createEl('p', { text: this.plugin.t('settings.rulesDesc') });
    renderRuleList(root.createDiv(), this.plugin.settings.rules, () => {
      void this.plugin.saveSettings().catch(() => new Notice(this.plugin.t('settings.rulesSaveFailed')));
    }, true, this.plugin.t);
  }
  private apiSection(root: HTMLElement, title: string, api: ApiSettings, image: boolean): void {
    const save = () => this.plugin.saveSettings().catch(() => { new Notice(this.plugin.t('settings.saveFailed')); });
    new Setting(root).setName(title).setHeading();
    new Setting(root).setName(this.plugin.t('settings.baseUrl')).setDesc(this.plugin.t('settings.baseUrlDesc'))
      .addText(t => t.setPlaceholder(this.plugin.t('settings.baseUrlPlaceholder')).setValue(api.baseUrl).onChange(async v => { api.baseUrl = v.trim(); await save(); }));
    const keySetting = new Setting(root).setName(this.plugin.t('settings.apiKey'));
    const updateKeyStatus = () => keySetting.setDesc(this.app.secretStorage.getSecret(api.secretName)
      ? this.plugin.t('settings.keySaved') : this.plugin.t('settings.keyMissing'));
    updateKeyStatus();
    keySetting.addText(t => {
      t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off';
      t.setPlaceholder(this.plugin.t('settings.keyPlaceholder')).onChange(v => {
        if (v.trim()) { this.app.secretStorage.setSecret(api.secretName, v.trim()); updateKeyStatus(); }
      });
    }).addButton(b => b.setButtonText(this.plugin.t('common.clear')).onClick(() => { this.app.secretStorage.setSecret(api.secretName, ''); this.display(); }));
    new Setting(root).setName(this.plugin.t('settings.model')).setDesc(image ? this.plugin.t('settings.imageModelDesc') : this.plugin.t('settings.textModelDesc'))
      .addText(t => t.setPlaceholder(this.plugin.t('settings.modelPlaceholder')).setValue(api.model).onChange(async v => { api.model = v.trim(); await save(); }));
    const promptSetting = new Setting(root).setName(this.plugin.t('settings.prompt')).setDesc(this.plugin.t('settings.promptDesc'));
    const promptPanel = root.createDiv('easypaste-prompt-editor');
    promptPanel.hidden = true;
    const promptInput = promptPanel.createEl('textarea', { attr: {
      'aria-label': this.plugin.t('settings.promptLabel', { section: title }), rows: '12', spellcheck: 'false'
    } });
    promptInput.value = api.prompt;
    promptInput.addEventListener('input', () => {
      api.prompt = promptInput.value;
      void this.plugin.saveSettings().catch(() => new Notice(this.plugin.t('settings.promptSaveFailed')));
    });
    promptSetting.addButton(b => {
      b.setButtonText(this.plugin.t('settings.editPrompt'));
      b.buttonEl.setAttribute('aria-expanded', 'false');
      b.onClick(() => {
        promptPanel.hidden = !promptPanel.hidden;
        b.setButtonText(promptPanel.hidden ? this.plugin.t('settings.editPrompt') : this.plugin.t('settings.collapsePrompt'));
        b.buttonEl.setAttribute('aria-expanded', String(!promptPanel.hidden));
        if (!promptPanel.hidden) promptInput.focus();
      });
    });
    new Setting(root).setName(this.plugin.t('settings.checkUrl')).setDesc(this.plugin.t('settings.checkUrlDesc'))
      .addButton(b => b.setButtonText(this.plugin.t('settings.check')).onClick(() => {
        try { new Notice(this.plugin.t('settings.requestUrl', { url: completionUrl(api.baseUrl, this.plugin.t) })); }
        catch (e) { new Notice(errorText(e, this.plugin.t, 'api.invalidUrl')); }
      }));
  }
}
