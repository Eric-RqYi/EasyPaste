import { defaultT, type Translator } from './i18n';
import { calloutPrefix } from './context';
import { BUILTIN_RULE_ORDER, ruleName, regexError, replacementText, type RuleOptions } from './settings';
import { wordRepair } from './words';
import { convertSpelling } from './spelling';
import { markerOf, normalizeLists } from './lists';

export interface RuleResult { text: string; reasons: string[] }
function followsLineHyphen(text: string, offset: number): boolean {
  let at = offset - 1;
  while (at >= 0 && /[ \t]/.test(text[at])) at--;
  if (text[at] !== '\n') return false;
  at--;
  while (at >= 0 && /[ \t]/.test(text[at])) at--;
  return text[at] === '-' && /[A-Za-z]/.test(text[at - 1] ?? '');
}
/** Protect syntax whose spaces, hyphens and markers are meaningful. */
export function protectMarkdown(input: string): { text: string; restore: (text: string, continuationPrefix?: string) => string } {
  const saved: string[] = [];
  // Choose a sentinel absent from input; saved text is never processed by rules.
  let prefix = '\uE000EP';
  while (input.includes(prefix)) prefix += 'X';
  const keep = (text: string) => `${prefix}${saved.push(text) - 1}\uE001`;
  let text = input.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?=\r?\n|$)/, keep);
  text = text.replace(/(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2\3[ \t]*(?=\n|$)|$)/g,
    (_all, newline: string) => {
      return newline + keep(_all.slice(newline.length));
    });
  text = text.replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|(`+)[^\n]*?\1|(?<![\\$])\$(?!\$)[^\n$]+\$|!?\[[^\]\n]*\]\([^\n)]*\)|!?\[\[[^\]\n]+\]\]|https?:\/\/[^\s<>]+|<[^>\n]+>/g, keep);
  const token = new RegExp(`${prefix}(\\d+)\uE001`, 'g');
  return { text, restore: (value, continuationPrefix = '') => value.replace(token, (_m, n: string) => saved[Number(n)].replace(/\n/g, '\n' + continuationPrefix)) };
}

export interface RuleContext { beforeCursor: string; lineBeforeCursor?: string }

export function convertRules(input: string, options: RuleOptions, context?: RuleContext, t: Translator = defaultT): RuleResult {
  const newline = input.includes('\r\n') && !/(?<!\r)\n/.test(input) ? '\r\n' : '\n';
  const protectedText = protectMarkdown(input.replace(/\r\n/g, '\n'));
  let text = protectedText.text;
  const reasons = new Set<string>();
  let continuationPrefix = '';
  let firstLineSeparator = '';
  const update = (next: string, reason: string) => { if (next !== text) reasons.add(reason); text = next; };
  const pipeline = options.pipeline ?? BUILTIN_RULE_ORDER.map(id => ({ kind: 'builtin' as const, id }));
  for (const rule of pipeline) {
    if (rule.kind === 'regex') {
      if (!rule.enabled || regexError(rule.pattern, rule.flags, t)) continue;
      // Process only unprotected spans so broad expressions cannot destroy Markdown sentinels.
      const chunks = text.split(/(\uE000EPX*\d+\uE001)/g);
      update(chunks.map((chunk, index) => index % 2 ? chunk : chunk.replace(new RegExp(rule.pattern, rule.flags), replacementText(rule.replacement))).join(''), t('reason.regex', { name: ruleName(rule, t) }));
      continue;
    }
    if (!options[rule.id]) continue;
    if (rule.id === 'pasteIntoCallout') {
      const lineBeforeCursor = context?.lineBeforeCursor ?? context?.beforeCursor.split('\n').at(-1) ?? '';
      const linePrefix = calloutPrefix(lineBeforeCursor);
      if (linePrefix) {
        continuationPrefix = linePrefix + (linePrefix.endsWith('>') ? ' ' : '');
        firstLineSeparator = lineBeforeCursor === linePrefix && linePrefix.endsWith('>') ? ' ' : '';
      }
    }
    if (rule.id === 'words') {
      const repair = wordRepair(options.vocabulary);
      update(text.replace(/([A-Za-z])\u00AD(?:[ \t]*\n[ \t]*)?(?=[A-Za-z])/g, '$1'), t('reason.softHyphen'));
      update(text.replace(/(?<![\p{L}\p{N}_\-])(?<!\p{L}['’])([A-Za-z]+(?:-[A-Za-z]+)*)-[ \t]*\n[ \t]*([a-z][A-Za-z]*(?:-[A-Za-z]+)*)(?![\p{L}\p{N}_\-]|['’]\p{L})/gu,
        (whole, left: string, right: string) => repair.hyphen(left, right, true) ?? whole), t('reason.lineHyphen'));
      update(text.replace(/(?<![\p{L}\p{N}_\-])(?<!\p{L}['’])([A-Za-z]+)-([a-z][A-Za-z]*)(?![\p{L}\p{N}_\-]|['’]\p{L})/gu,
        (whole, left: string, right: string) => repair.hyphen(left, right, false) ?? whole), t('reason.hyphen'));
      const replacements = new Map<string, string>();
      for (const line of options.replacements.split('\n')) {
        const parts = line.split('=>').map(s => s.trim());
        if (parts.length === 2 && /^[a-zA-Z]+$/.test(parts[0]) && parts[1]) replacements.set(parts[0].toLowerCase(), parts[1]);
      }
      update(text.replace(/(?<![\p{L}\p{N}_\-])(?<!\p{L}['’])[A-Za-z]{3,64}(?![\p{L}\p{N}_\-]|['’]\p{L})/gu, (word, offset: number, source: string) => {
        const lower = word.toLowerCase();
        const explicit = replacements.get(lower);
        const replacement = explicit ?? (followsLineHyphen(source, offset) ? null : repair.split(word));
        if (!replacement) return word;
        if (word === word.toUpperCase()) return replacement.toUpperCase();
        if (/^[A-Z]/.test(word)) return replacement[0].toUpperCase() + replacement.slice(1);
        return replacement;
      }), t('reason.splitWords'));
    }
    if (rule.id === 'spelling') {
      update(convertSpelling(text, options.spellingTarget, options.spellingProtectedWords),
        options.spellingTarget === 'us' ? t('reason.spellingUS') : t('reason.spellingGB'));
    }
    if (rule.id === 'lists') {
      update(normalizeLists(text, options.indentSize), t('reason.lists'));
    }
    if (rule.id === 'joinWrappedLines') {
      update(text.replace(/([^\n]+)\n(?=\S)/g, (whole, previous: string, offset: number, source: string) => {
        const next = source.slice(offset + whole.length).split('\n')[0];
        if (/^\s|^\uE000|^[#>|]|^[-*+] |^\d+[.)] /.test(previous) || markerOf(previous) || markerOf(next) || /^[#>|\uE000]/.test(next)) return whole;
        return previous.trimEnd() + ' ';
      }), t('reason.joinLines'));
    }
  }
  let result = protectedText.restore(text);
  // Quote the final output, including new lines created by lists or custom rules.
  // Restoring protected spans first also keeps multiline code/math inside the callout.
  if (continuationPrefix && result.includes('\n')) {
    result = firstLineSeparator + result.replace(/\n/g, '\n' + continuationPrefix);
    reasons.add(t('reason.callout'));
  }
  result = result.replace(/\n/g, newline);
  return { text: result, reasons: result === input ? [] : [...reasons] };
}
