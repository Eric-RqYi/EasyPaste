/** Conservative context check for automatic paste only. Manual cleanup remains available. */
export function isProtectedContext(beforeCursor: string): boolean {
  const lines = beforeCursor.split('\n');
  let fence: { char: string; length: number } | undefined;
  let math = false;
  let yaml = lines[0]?.trim() === '---';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (yaml) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) yaml = false;
      continue;
    }
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (match) {
      if (!fence) fence = { char: match[1][0], length: match[1].length };
      else if (match[1][0] === fence.char && match[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    if (/^\s*\$\$\s*$/.test(line)) math = !math;
  }
  const last = lines[lines.length - 1] ?? '';
  const backticks = last.match(/(?<!\\)`+/g) ?? [];
  const dollars = last.match(/(?<!\\)\$/g) ?? [];
  const latex = beforeCursor.lastIndexOf('\\[') > beforeCursor.lastIndexOf('\\]') || last.lastIndexOf('\\(') > last.lastIndexOf('\\)');
  return yaml || Boolean(fence) || math || backticks.length % 2 === 1 || dollars.length % 2 === 1 || latex;
}
