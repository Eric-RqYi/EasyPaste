import { Setting, setIcon } from 'obsidian';
import { regexError, type CleanupRule, type RuleOptions } from './settings';

const labels = {
  words: ['英文断词与粘连词', '使用内置词典修复断词与粘连词。'],
  spelling: ['英美拼写转换', '转换常见英美拼写'],
  lists: ['列表与缩进', '规范列表符号、层级与续行缩进。'],
  joinWrappedLines: ['连接普通段落硬换行', '连接相邻的非空文本段落。'],
  pasteIntoCallout: ['粘贴到标注内容', '在行首 > 后粘贴时，让后续行与空行继承引用前缀，保持在同一个标注框内。']
};

/** The preview and settings share ordering, toggles and accessible drag handles. */
export function renderRuleList(root: HTMLElement, options: RuleOptions, changed: () => void, editable = false): void {
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
      const card = root.createDiv({ cls: editable ? 'easypaste-rule easypaste-rule-editable' : 'easypaste-rule' });
      const head = card.createDiv({ cls: 'easypaste-rule-head' });
      const name = rule.kind === 'builtin' ? labels[rule.id][0] : rule.name || '自定义规则';
      const handle: HTMLElement = (editable ? card : head).createEl(editable ? 'div' : 'button', {
        cls: editable ? 'easypaste-drag-handle easypaste-drag-edge' : 'easypaste-drag-handle', attr: {
        role: 'button', tabindex: '0', draggable: 'true', 'aria-label': `拖动排序：${name}；也可用上下方向键移动`
      } });
      if (!editable) setIcon(handle, 'menu');
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
      const row = new Setting(head).setName(`${index + 1}. ${name}${rule.kind === 'builtin' ? '（内置）' : ''}`)
        .setDesc(rule.kind === 'builtin' ? labels[rule.id][1] : '自定义正则替换')
        .addToggle(t => t.setValue(rule.kind === 'builtin' ? options[rule.id] : rule.enabled).onChange(value => {
          if (rule.kind === 'builtin') options[rule.id] = value;
          else rule.enabled = value;
          changed();
        }));
      if (rule.kind === 'builtin' && rule.id === 'spelling') {
        row.addDropdown(d => {
          d.selectEl.setAttribute('aria-label', '转换至：');
          d.addOptions({ gb: '英式', us: '美式' }).setValue(options.spellingTarget).onChange(value => {
            options.spellingTarget = value === 'us' ? 'us' : 'gb';
            changed();
          });
        });
        if (editable) new Setting(card).setName('白名单').setDesc('可选，空格或换行分隔，忽略大小写。')
          .addTextArea(t => {
            t.inputEl.setAttribute('aria-label', '拼写保护词');
            t.setValue(options.spellingProtectedWords).onChange(value => { options.spellingProtectedWords = value; changed(); });
          });
      }
      if (!editable || rule.kind !== 'regex') return;
      row.addButton(b => b.setButtonText('删除').onClick(() => { pipeline.splice(index, 1); render(); changed(); }));
      new Setting(card).setName('规则名称').addText(t => t.setValue(rule.name).onChange(value => { rule.name = value; changed(); }));
      new Setting(card).setName('匹配表达式').setDesc('JavaScript 正则语法，不要填写两侧的 /。')
        .addTextArea(t => t.setValue(rule.pattern).onChange(value => { rule.pattern = value; validate(); changed(); }));
      const status = card.createEl('p', { cls: 'easypaste-regex-status', attr: { role: 'status', 'aria-live': 'polite' } });
      const validate = () => {
        const error = regexError(rule.pattern, rule.flags);
        status.setText(error ? `规则无效，执行时跳过：${error}` : '正则表达式有效');
        status.toggleClass('easypaste-rule-error', !!error);
      };
      new Setting(card).setName('替换文本').setDesc('支持 $1、$2、$<名称> 捕获组；\\n 换行、\\t 制表符、\\\\ 字面反斜杠；留空表示删除匹配内容。')
        .addTextArea(t => t.setValue(rule.replacement).onChange(value => { rule.replacement = value; changed(); }));
      new Setting(card).setName('匹配标志').setDesc('例如 g 全部替换、i 忽略大小写、m 多行、s 跨行。留空仅替换首处。')
        .addText(t => t.setValue(rule.flags).onChange(value => { rule.flags = value; validate(); changed(); }));
      validate();
    });
    if (editable) new Setting(root).setName('新增正则规则').addButton(b => b.setButtonText('新增规则').onClick(() => {
      const rule: CleanupRule = { kind: 'regex', id: crypto.randomUUID(), name: '自定义规则', enabled: false, pattern: '', replacement: '', flags: 'g' };
      pipeline.push(rule); render(); changed();
    }));
  };
  render();
}
