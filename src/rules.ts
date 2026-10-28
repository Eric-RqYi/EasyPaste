import type { RuleOptions } from './settings';

export interface RuleResult { text: string; reasons: string[] }
interface Marker { indent: number; signature: string; marker: string; body: string; original: string }
const width = (s: string) => s.replace(/\t/g, '    ').length;
function markerOf(line: string): Marker | null {
  const bullet = /^(\s*)([•·●○◦▪▫‣⁃∙–—−*-]|\+)(?:[ \t]+)(\S.*)$/.exec(line)
    ?? /^(\s*)([•·●○◦▪▫‣⁃∙])([^\s].*)$/.exec(line);
  if (bullet && !/^([-*_])(?:\s*\1){2,}\s*$/.test(line.trim())) {
    return { indent: width(bullet[1]), signature: bullet[2], marker: '-', body: bullet[3], original: bullet[2] };
  }
  const ordered = /^(\s*)(?:(\d{1,6})([.)、．])|([A-Za-z])([.)])|([ivxlcdmIVXLCDM]{2,8})([.)]))(?:[ \t]+|(?<=[、．]))(\S.*)$/.exec(line);
  if (!ordered) return null;
  const [, space, number, delim, alpha, alphaDelim, roman, romanDelim, body] = ordered;
  const romanValue = (s: string) => {
    const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
    return [...s.toLowerCase()].reduce((sum, c, i, all) => sum + (values[c] < (values[all[i + 1]] ?? 0) ? -values[c] : values[c]), 0);
  };
  const isRoman = Boolean(roman) || Boolean(alpha && /[ivx]/i.test(alpha));
  const value = number ? Number(number) : isRoman ? romanValue(roman ?? alpha) : alpha.toLowerCase().charCodeAt(0) - 96;
  return {
    indent: width(space), signature: number ? `number${delim}` : isRoman ? `roman${romanDelim ?? alphaDelim}` : `alpha${alphaDelim}`,
    marker: `${value}.`, body, original: line.slice(space.length, line.length - body.length).trim()
  };
}

/** Protect syntax whose spaces, hyphens and markers are meaningful. */
export function protectMarkdown(input: string): { text: string; restore: (text: string) => string } {
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
  return { text, restore: value => value.replace(token, (_m, n: string) => saved[Number(n)]) };
}

export function convertRules(input: string, options: RuleOptions): RuleResult {
  const newline = input.includes('\r\n') && !/(?<!\r)\n/.test(input) ? '\r\n' : '\n';
  const protectedText = protectMarkdown(input.replace(/\r\n/g, '\n'));
  let text = protectedText.text;
  const reasons = new Set<string>();
  const update = (next: string, reason: string) => { if (next !== text) reasons.add(reason); text = next; };
  if (options.words) {
    const vocab = new Set(options.vocabulary.split(/[\s,;]+/).map(w => w.toLowerCase()).filter(Boolean));
    update(text.replace(/([A-Za-z])\u00AD(?:[ \t]*\n[ \t]*)?(?=[A-Za-z])/g, '$1'), '还原软连字符断词');
    update(text.replace(/([A-Za-z]+)-[ \t]*\n[ \t]*([a-z][A-Za-z]*)/g, (whole, left: string, right: string) =>
      vocab.has((left + right).toLowerCase()) ? left + right : whole), '合并词表确认的跨行断词');
    update(text.replace(/\b([A-Za-z]+)-([a-z][A-Za-z]*)\b/g, (whole, left: string, right: string) =>
      vocab.has((left + right).toLowerCase()) && !(vocab.has(left.toLowerCase()) && vocab.has(right.toLowerCase())) ? left + right : whole), '还原词表确认的连字符断词');
    const replacements = new Map<string, string>();
    for (const line of options.replacements.split('\n')) {
      const parts = line.split('=>').map(s => s.trim());
      if (parts.length === 2 && /^[a-zA-Z]+$/.test(parts[0]) && parts[1]) replacements.set(parts[0].toLowerCase(), parts[1]);
    }
    update(text.replace(/\b[A-Za-z]{4,64}\b/g, word => {
      const lower = word.toLowerCase();
      const explicit = replacements.get(lower);
      let replacement = explicit;
      if (!replacement && !vocab.has(lower) && !/^[A-Z]+$/.test(word)) {
        const candidates: string[] = [];
        for (let i = 3; i <= lower.length - 3; i++) {
          if (vocab.has(lower.slice(0, i)) && vocab.has(lower.slice(i))) candidates.push(`${word.slice(0, i)} ${word.slice(i)}`);
        }
        if (candidates.length === 1) replacement = candidates[0];
      }
      if (!replacement) return word;
      if (word === word.toUpperCase()) return replacement.toUpperCase();
      if (/^[A-Z]/.test(word)) return replacement[0].toUpperCase() + replacement.slice(1);
      return replacement;
    }), '拆分粘连单词');
  }
  if (options.lists) {
    const lines = text.split('\n');
    const stack: { indent: number; signature: string; outputIndent: number }[] = [];
    let continuation = 0;
    let afterBlank = false;
    const output = lines.map(line => {
      if (!line.trim()) { afterBlank = true; return line; }
      // Protected blocks and structural Markdown end a list continuation.
      if (/^\s*(?:\uE000|#{1,6} |>|\|)/.test(line) || /^\s*(?:[-*_]\s*){3,}$/.test(line)) {
        stack.length = 0; continuation = 0; return line;
      }
      const item = markerOf(line);
      if (item) {
        if (afterBlank && item.indent === 0) stack.length = 0;
        afterBlank = false;
        while (stack.length && item.indent < stack[stack.length - 1].indent) stack.pop();
        const same = stack.findIndex(s => s.indent === item.indent && s.signature === item.signature);
        if (same >= 0) stack.length = same + 1;
        else {
          const last = stack[stack.length - 1];
          // Same indentation but a different symbol denotes a nested list.
          stack.push({ indent: item.indent, signature: item.signature,
            outputIndent: last ? last.outputIndent + options.indentSize : item.indent });
        }
        const indent = stack[stack.length - 1].outputIndent;
        continuation = indent + item.marker.length + 1;
        return `${' '.repeat(indent)}${item.marker} ${item.body}`;
      }
      if (afterBlank) { stack.length = 0; continuation = 0; afterBlank = false; }
      // Do not rewrite indented code outside a list.
      return continuation ? ' '.repeat(continuation) + line.trimStart() : line;
    }).join('\n');
    update(output, '规范列表符号、层级与续行缩进');
  }
  if (options.joinWrappedLines) {
    update(text.replace(/([^\n]+)\n(?=\S)/g, (whole, previous: string, offset: number, source: string) => {
      const next = source.slice(offset + whole.length).split('\n')[0];
      if (/^\s|^\uE000|^[#>|]|^[-*+] |^\d+[.)] /.test(previous) || markerOf(previous) || markerOf(next) || /^[#>|\uE000]/.test(next)) return whole;
      return previous.trimEnd() + ' ';
    }), '连接段落中的硬换行');
  }
  const result = protectedText.restore(text).replace(/\n/g, newline);
  return { text: result, reasons: result === input ? [] : [...reasons] };
}
