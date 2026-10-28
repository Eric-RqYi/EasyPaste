interface Marker {
  indent: number;
  signature: string;
  marker: string;
  body: string;
  path?: number[];
}
interface Candidate extends Marker {
  start: number;
  end: number;
  anchored: boolean;
  context: string;
  operandPair: boolean;
  // A bare 1.2 needs an observed parent, otherwise it could be a decimal.
  barePath: boolean;
}
const width = (s: string) => s.replace(/\t/g, '    ').length;
const structural = (line: string) => /^\s*(?:#{1,6} |>|\|)/.test(line)
  || /^\s*\uE000EPX*\d+\uE001\s*$/.test(line)
  || /^\s*(?:[-*_]\s*){3,}$/.test(line);
const romanValue = (s: string) => {
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  return [...s.toLowerCase()].reduce((sum, c, i, all) => sum + (values[c] < (values[all[i + 1]] ?? 0) ? -values[c] : values[c]), 0);
};

/** Scan markers only; deciding whether an inline occurrence is a list is separate. */
function candidatesOf(line: string): Candidate[] {
  const candidates: Candidate[] = [];
  const tokens = /\uE000EPX*\d+\uE001|\d{1,6}(?:[.．]\d{1,6})+(?:[.)、．])?|\d{1,6}[.)、．]|[ivxlcdmIVXLCDM]{2,8}[.)]|[A-Za-z][.)]|[•·●○◦▪▫‣⁃∙–—−*+\-]/g;
  for (const match of line.matchAll(tokens)) {
    const raw = match[0];
    const start = match.index;
    if (raw.startsWith('\uE000')) continue;
    const before = line.slice(0, start);
    const after = line.slice(start + raw.length);
    const anchored = /^[ \t]*$/.test(before);
    const left = before.trimEnd().slice(-1);
    const right = after.trimStart()[0] ?? '';
    const gap = /^[ \t]*/.exec(after)![0];
    if (!right || before.endsWith('\\')) continue;
    const ordered = /^[\dA-Za-z]/.test(raw);
    let signature = raw;
    let marker = '-';
    let path: number[] | undefined;
    let barePath = false;
    if (ordered) {
      // Avoid matching the tail of a word, decimal, version, date or section reference.
      if (!anchored && !/[ \t]$/.test(before)) continue;
      const numeric = /^\d/.test(raw);
      const delimiter = /[.)、．]$/.test(raw) ? raw.slice(-1) : '.';
      if (!gap && (!numeric || !/[、．]$/.test(raw))) continue;
      if (numeric) {
        path = raw.replace(/[.)、．]$/, '').split(/[.．]/).map(Number);
        barePath = path.length > 1 && /\d$/.test(raw);
        signature = `number${barePath ? '.' : delimiter}`;
      } else {
        const label = raw.slice(0, -1);
        const roman = label.length > 1 || /^[ivx]$/i.test(label);
        path = [roman ? romanValue(label) : label.toLowerCase().charCodeAt(0) - 96];
        signature = `${roman ? 'roman' : 'alpha'}${delimiter}`;
      }
      marker = `${path[path.length - 1]}.`;
    } else {
      // Copied slides often join the preceding item directly to a dash (e.g. ":– At" or "states- attention").
      // Keep its following gap; repetition/context checks below still decide whether it is a list.
      if (/[–—−*+\-]/.test(raw) && !gap) continue;
      // Emphasis/operators and the mathematical minus still require a preceding token boundary.
      if (/[−*+]/.test(raw) && !anchored && !/[ \t]$/.test(before)) continue;
      if (!anchored && /[·∙]/.test(raw) && /[A-Za-z0-9]/.test(left) && /[A-Za-z0-9]/.test(right) && !gap && !/[ \t]$/.test(before)) continue;
      // Ranges and arithmetic are not lists, even inside an otherwise confirmed list.
      if (!anchored && /[–—−+\-·∙]/.test(raw) && /\d/.test(left) && /\d/.test(right)) continue;
    }
    candidates.push({ start, end: start + raw.length + gap.length,
      indent: width(/^[ \t]*/.exec(line)![0]), signature, marker, path, anchored,
      context: `${left}\u0000${right}`, barePath, body: '',
      operandPair: /[–—−+\-]/.test(raw)
        && /^[A-Za-z]$/.test(before.trimEnd().split(/\s+/).at(-1) ?? '')
        && /^[A-Za-z](?=[ \t–—\-]|$)/.test(after.trimStart()) });
  }
  return candidates;
}

export function markerOf(line: string): Marker | null {
  if (structural(line)) return null;
  const item = candidatesOf(line).find(item => item.anchored && !item.barePath);
  return item ? { ...item, body: line.slice(item.end) } : null;
}

function confirmedCandidates(candidates: Candidate[]): Set<Candidate> {
  const confirmed = new Set<Candidate>();
  const bulletGroups = new Map<string, Candidate[]>();
  const orderedGroups = new Map<string, Candidate[]>();
  const paths = new Set(candidates.filter(c => c.signature.startsWith('number') && !c.barePath).map(c => c.path!.join('.')));
  for (const item of candidates) {
    if (item.barePath && !paths.has(item.path!.slice(0, -1).join('.'))) continue;
    if (item.anchored) confirmed.add(item);
    const groups = item.path ? orderedGroups : bulletGroups;
    const key = item.signature + (item.path ? ':' + item.path.slice(0, -1).join('.') : '');
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  for (const group of bulletGroups.values()) {
    const anchored = group.some(item => item.anchored);
    // Compare the nearest non-space characters: copied list separators usually have spaces on both sides.
    const varied = group.length >= 2 && new Set(group.map(item => item.context)).size === group.length
      && !group.every(item => item.operandPair);
    if (anchored || varied) for (const item of group) confirmed.add(item);
  }
  for (const group of orderedGroups.values()) {
    // A pair of consecutive siblings confirms both markers, even with other list styles between them.
    for (let i = 1; i < group.length; i++) {
      if (group[i].path!.at(-1) === group[i - 1].path!.at(-1)! + 1) {
        confirmed.add(group[i - 1]);
        confirmed.add(group[i]);
      }
    }
  }
  // Consecutive children can confirm their otherwise solitary parent in a collapsed paragraph.
  const ancestors = new Set<string>();
  for (const item of confirmed) {
    if (item.signature.startsWith('number') && item.path) {
      for (let depth = 1; depth < item.path.length; depth++) ancestors.add(item.path.slice(0, depth).join('.'));
    }
  }
  for (const item of candidates) {
    if (item.signature.startsWith('number') && ancestors.has(item.path!.join('.'))) confirmed.add(item);
  }
  // An explicit numeric path also confirms a lone child of an already confirmed parent.
  const confirmedPaths = new Set([...confirmed].filter(c => c.signature.startsWith('number')).map(c => c.path!.join('.')));
  for (const item of [...candidates].sort((a, b) => (a.path?.length ?? 0) - (b.path?.length ?? 0))) {
    if (item.path && item.path.length > 1 && confirmedPaths.has(item.path.slice(0, -1).join('.'))) {
      confirmed.add(item);
      confirmedPaths.add(item.path.join('.'));
    }
  }
  return confirmed;
}

interface Placement { indent: number; signature: string; outputIndent: number; marker: string }

/** Remember each style after returning to a parent; inline items reuse the line-start evidence. */
function layout(indentSize: number, seeds: Candidate[] = []) {
  const levels = new Map<string, Placement>();
  const anchors = new Map<string, Placement>();
  const paths = new Map<string, Placement>();
  const stack: Placement[] = [];
  const place = (item: Candidate): Placement => {
    const key = `${item.indent}:${item.signature}`;
    const existing = levels.get(key) ?? (!item.anchored ? anchors.get(item.signature) : undefined);
    while (stack.length && item.indent < stack[stack.length - 1].indent) stack.pop();
    const last = stack.at(-1);
    const step = (parent: Placement) => Math.max(indentSize, parent.marker.length + 1);
    let outputIndent = existing?.outputIndent ?? (last ? last.outputIndent + step(last) : item.indent);
    if (!existing) {
      for (const level of levels.values()) {
        if (level.indent === item.indent) outputIndent = Math.max(outputIndent, level.outputIndent + step(level));
      }
    }
    if (item.path && item.path.length > 1) {
      // Full numeric paths express ancestry independently of the symbol-style stack.
      const parent = paths.get(item.path.slice(0, -1).join('.'));
      const root = levels.get(`${item.indent}:${item.signature}`);
      outputIndent = parent ? parent.outputIndent + step(parent)
        : (root?.outputIndent ?? item.indent) + (item.path.length - 1) * indentSize;
    }
    const placement = { indent: item.indent, signature: item.signature, outputIndent, marker: item.marker };
    if (!item.path || item.path.length === 1) levels.set(key, placement);
    if (item.anchored && !anchors.has(item.signature) && (!item.path || item.path.length === 1)) anchors.set(item.signature, placement);
    if (item.path && item.signature.startsWith('number')) paths.set(item.path.join('.'), placement);
    while (stack.length && stack[stack.length - 1].outputIndent >= outputIndent) stack.pop();
    stack.push(placement);
    return placement;
  };
  for (const seed of seeds) place(seed);
  stack.length = 0;
  paths.clear();
  return place;
}

function normalizeBlock(lines: string[], indentSize: number): string[] {
  const byLine = lines.map(candidatesOf);
  const confirmed = confirmedCandidates(byLine.flat());
  const place = layout(indentSize, byLine.flat().filter(item => item.anchored && confirmed.has(item)));
  const output: string[] = [];
  let continuation = 0;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const items = byLine[n].filter(item => confirmed.has(item));
    if (!items.length) {
      output.push(continuation ? ' '.repeat(continuation) + line.trimStart() : line);
      continue;
    }
    const prefix = line.slice(0, items[0].start).trimEnd();
    if (prefix) output.push(continuation ? ' '.repeat(continuation) + prefix.trimStart() : prefix);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const body = items[i + 1] ? line.slice(item.end, items[i + 1].start).trimEnd() : line.slice(item.end);
      const { outputIndent } = place(item);
      continuation = outputIndent + item.marker.length + 1;
      output.push(`${' '.repeat(outputIndent)}${item.marker} ${body}`);
    }
  }
  return output;
}

/** Blank lines and structural Markdown bound inference, so unrelated paragraphs do not share evidence. */
export function normalizeLists(text: string, indentSize: number): string {
  const output: string[] = [];
  let block: string[] = [];
  const flush = () => { output.push(...normalizeBlock(block, indentSize)); block = []; };
  for (const line of text.split('\n')) {
    if (!line.trim() || structural(line)) { flush(); output.push(line); }
    else block.push(line);
  }
  flush();
  return output.join('\n');
}
