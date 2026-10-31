import { Setting } from 'obsidian';
import { defaultT, type Translator } from './i18n';
import { ruleName, regexError, type CleanupRule, type RuleOptions } from './settings';

const descriptions = {
  words: 'rule.wordsDesc', spelling: 'rule.spellingDesc', lists: 'rule.listsDesc',
  joinWrappedLines: 'rule.joinWrappedLinesDesc', pasteIntoCallout: 'rule.pasteIntoCalloutDesc'
} as const;

/** The preview and settings share ordering, toggles and accessible drag handles. */
export function renderRuleList(root: HTMLElement, options: RuleOptions, changed: () => void, editable = false, t: Translator = defaultT): void {
  const pipeline = options.pipeline!;
  let dragged: string | undefined;
  const move = (id: string, target: number) => {
    const from = pipeline.findIndex(rule => rule.id === id);
    if (from < 0 || target < 0 || target >= pipeline.length || from === target) return;
    const [rule] = pipeline.splice(from, 1);
    pipeline.splice(target, 0, rule);
    render();
    changed();
  };
  const render = () => {
    root.empty();
    pipeline.forEach((rule, index) => {
      const card = root.createDiv({ cls: 'easypaste-rule easypaste-rule-edge' });
      const head = card.createDiv({ cls: 'easypaste-rule-head' });
      const name = ruleName(rule, t);
      const handle: HTMLElement = card.createEl('div', {
        cls: 'easypaste-drag-handle easypaste-drag-edge', attr: {
        role: 'button', tabindex: '0', draggable: 'true', 'aria-label': t('rule.dragLabel', { name })
      } });
      handle.addEventListener('keydown', event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const target = index + (event.key === 'ArrowUp' ? -1 : 1);
        move(rule.id, target);
        root.querySelectorAll<HTMLElement>('.easypaste-drag-handle')[Math.max(0, Math.min(pipeline.length - 1, target))]?.focus();
      });
      handle.addEventListener('dragstart', event => {
        dragged = rule.id;
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-easypaste-rule', rule.id);
          const rect = card.getBoundingClientRect();
          event.dataTransfer.setDragImage(card, event.clientX - rect.left, event.clientY - rect.top);
        }
        card.addClass('easypaste-dragging');
      });
      const clearDrop = () => card.removeClass('easypaste-drop-before', 'easypaste-drop-after');
      handle.addEventListener('dragend', () => {
        dragged = undefined;
        root.querySelectorAll<HTMLElement>('.easypaste-rule').forEach(el => el.removeClass('easypaste-dragging', 'easypaste-drop-before', 'easypaste-drop-after'));
      });
      card.addEventListener('dragover', event => {
        if (!dragged || dragged === rule.id) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        const rect = card.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        card.toggleClass('easypaste-drop-after', after);
        card.toggleClass('easypaste-drop-before', !after);
      });
      card.addEventListener('dragleave', clearDrop);
      card.addEventListener('drop', event => {
        if (!dragged) return;
        event.preventDefault();
        const from = pipeline.findIndex(item => item.id === dragged);
        const rect = card.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        const target = index + (after ? 1 : 0) - (from < index + (after ? 1 : 0) ? 1 : 0);
        clearDrop();
        move(dragged, target);
        dragged = undefined;
      });
      const row = new Setting(head).setName(t(rule.kind === 'builtin' ? 'rule.builtinRow' : 'rule.customRow', { index: index + 1, name }))
        .setDesc(rule.kind === 'builtin' ? t(descriptions[rule.id]) : t('rule.customDesc'))
        .addToggle(t => t.setValue(rule.kind === 'builtin' ? options[rule.id] : rule.enabled).onChange(value => {
          if (rule.kind === 'builtin') options[rule.id] = value;
          else rule.enabled = value;
          changed();
        }));
      if (rule.kind === 'builtin' && rule.id === 'spelling') {
        row.addDropdown(d => {
          d.selectEl.setAttribute('aria-label', t('rule.spellingTarget'));
          d.addOptions({ gb: t('rule.gb'), us: t('rule.us') }).setValue(options.spellingTarget).onChange(value => {
            options.spellingTarget = value === 'us' ? 'us' : 'gb';
            changed();
          });
        });
        if (editable) new Setting(card).setName(t('rule.protectedWords')).setDesc(t('rule.protectedWordsDesc'))
          .addTextArea(input => {
            input.inputEl.setAttribute('aria-label', t('rule.protectedWordsLabel'));
            input.setValue(options.spellingProtectedWords).onChange(value => { options.spellingProtectedWords = value; changed(); });
          });
      }
      if (!editable || rule.kind !== 'regex') return;
      row.addButton(b => b.setButtonText(t('common.delete')).onClick(() => { pipeline.splice(index, 1); render(); changed(); }));
      new Setting(card).setName(t('rule.name')).addText(input => input.setValue(ruleName(rule, t)).onChange(value => { rule.name = value; changed(); }));
      new Setting(card).setName(t('rule.pattern')).setDesc(t('rule.patternDesc'))
        .addTextArea(t => t.setValue(rule.pattern).onChange(value => { rule.pattern = value; validate(); changed(); }));
      const status = card.createEl('p', { cls: 'easypaste-regex-status', attr: { role: 'status', 'aria-live': 'polite' } });
      const validate = () => {
        const error = regexError(rule.pattern, rule.flags, t);
        status.setText(error ? t('rule.invalid', { error }) : t('rule.valid'));
        status.toggleClass('easypaste-rule-error', !!error);
      };
      new Setting(card).setName(t('rule.replacement')).setDesc(t('rule.replacementDesc'))
        .addTextArea(t => t.setValue(rule.replacement).onChange(value => { rule.replacement = value; changed(); }));
      new Setting(card).setName(t('rule.flags')).setDesc(t('rule.flagsDesc'))
        .addText(t => t.setValue(rule.flags).onChange(value => { rule.flags = value; validate(); changed(); }));
      validate();
    });
    if (editable) new Setting(root).setName(t('rule.addTitle')).addButton(b => b.setButtonText(t('rule.add')).onClick(() => {
      const rule: CleanupRule = { kind: 'regex', id: crypto.randomUUID(), name: '', enabled: false, pattern: '', replacement: '', flags: 'g' };
      pipeline.push(rule); render(); changed();
    }));
  };
  render();
}
