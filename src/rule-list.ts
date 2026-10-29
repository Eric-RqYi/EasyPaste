import { Setting, setIcon } from 'obsidian';
import { regexError, type CleanupRule, type RuleOptions } from './settings';

const labels = {
  words: ['英文断词与粘连词', '使用内置词典修复断词与粘连词。'],
  lists: ['列表与缩进', '规范列表符号、层级与续行缩进。'],
  joinWrappedLines: ['连接普通段落硬换行', '连接相邻的非空文本段落。']
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
      const card = root.createDiv({ cls: 'easypaste-rule' });
      const head = card.createDiv({ cls: 'easypaste-rule-head' });
      const name = rule.kind === 'builtin' ? labels[rule.id][0] : rule.name || '自定义规则';
      const handle = head.createEl('button', { cls: 'easypaste-drag-handle', attr: {
        type: 'button', draggable: 'true', 'aria-label': `拖动排序：${name}；也可用上下方向键移动`
      } });
      setIcon(handle, 'menu');
      handle.addEventListener('keydown', event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const target = index + (event.key === 'ArrowUp' ? -1 : 1);
        move(rule.id, target);
        root.querySelectorAll<HTMLButtonElement>('.easypaste-drag-handle')[Math.max(0, Math.min(pipeline.length - 1, target))]?.focus();
      });
      handle.addEventListener('dragstart', event => {
        dragged = rule.id;
        card.addClass('easypaste-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-easypaste-rule', rule.id);
        }
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
        }))
        .addExtraButton(b => b.setIcon('chevron-up').setTooltip('上移').setDisabled(index === 0).onClick(() => move(rule.id, index - 1)))
        .addExtraButton(b => b.setIcon('chevron-down').setTooltip('下移').setDisabled(index === pipeline.length - 1).onClick(() => move(rule.id, index + 1)));
      if (!editable || rule.kind !== 'regex') return;
      row.addButton(b => b.setButtonText('删除').onClick(() => { pipeline.splice(index, 1); render(); changed(); }));
      new Setting(card).setName('规则名称').addText(t => t.setValue(rule.name).onChange(value => { rule.name = value; changed(); }));
      const status = card.createEl('p');
      const validate = () => {
        const error = regexError(rule.pattern, rule.flags);
        status.setText(error ? `规则无效，执行时跳过：${error}` : '正则表达式有效');
        status.toggleClass('easypaste-rule-error', !!error);
      };
      new Setting(card).setName('匹配表达式').setDesc('JavaScript 正则语法，不要填写两侧的 /。')
        .addTextArea(t => t.setValue(rule.pattern).onChange(value => { rule.pattern = value; validate(); changed(); }));
      new Setting(card).setName('替换文本').setDesc('支持 $1、$2、$<名称> 捕获组；留空表示删除匹配内容。')
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
