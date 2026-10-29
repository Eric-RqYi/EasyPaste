import defaultPrompts from './default-prompts.json';

export interface ApiSettings {
  baseUrl: string;
  model: string;
  secretName: string;
  prompt: string;
}
export type SpellingTarget = 'us' | 'gb';
export type BuiltinRuleId = 'words' | 'spelling' | 'lists' | 'joinWrappedLines' | 'pasteIntoCallout';
export type CleanupRule = { kind: 'builtin'; id: BuiltinRuleId } | {
  kind: 'regex'; id: string; name: string; enabled: boolean;
  pattern: string; replacement: string; flags: string;
};
export const BUILTIN_RULE_ORDER: BuiltinRuleId[] = ['words', 'spelling', 'lists', 'joinWrappedLines', 'pasteIntoCallout'];
export const EXAMPLE_RULES: CleanupRule[] = [
  { kind: 'regex', id: 'example-slides-wrapper', name: '示例：移除 Google 幻灯片首尾星号', enabled: true,
    pattern: String.raw`^[ \t]*(?:\\?\*){2}[ \t]*\n(?:[ \t]*\n)*([\s\S]*?)\n(?:[ \t]*\n)*[ \t]*(?:\\?\*){2}[ \t]*(?=\n|$)`, replacement: '$1', flags: 'gm' },
  { kind: 'regex', id: 'example-list-blank-lines', name: '示例：移除无序列表项之间的空行', enabled: true,
    pattern: String.raw`(^[ \t]*[-+*][ \t]+[^\n]*)\n(?:[ \t]*\n)+(?=[ \t]*[-+*][ \t]+)`, replacement: String.raw`$1\n`, flags: 'gm' }
];
/** Replacement strings do not interpret escapes in JavaScript's String.replace. */
export function replacementText(value: string): string {
  return value.replace(/\\([nrt\\])/g, (_match, escape: string) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\' })[escape]!);
}
export function regexError(pattern: string, flags: string): string | null {
  if (!pattern) return '请输入匹配表达式';
  try { new RegExp(pattern, flags); return null; }
  catch (error) { return error instanceof Error ? error.message : '正则表达式无效'; }
}
export interface RuleOptions {
  pipeline?: CleanupRule[];
  examplesVersion?: number;
  lists: boolean;
  words: boolean;
  spelling: boolean;
  spellingTarget: SpellingTarget;
  spellingProtectedWords: string;
  joinWrappedLines: boolean;
  pasteIntoCallout: boolean;
  indentSize: number;
  replacements: string;
  vocabulary: string;
}
export interface EasyPasteSettings {
  autoPaste: boolean;
  shortcuts: boolean;
  maxAutoChars: number;
  rules: RuleOptions;
  textApi: ApiSettings;
  imageApi: ApiSettings;
  timeoutSeconds: number;
  temporaryInstructions: string;
}
export const DEFAULT_SETTINGS: EasyPasteSettings = {
  autoPaste: true, shortcuts: true, maxAutoChars: 30000,
  rules: {
    lists: true, words: true, spelling: false, spellingTarget: 'gb', spellingProtectedWords: '',
    joinWrappedLines: false, pasteIntoCallout: true, indentSize: 4,
    pipeline: [EXAMPLE_RULES[0], ...BUILTIN_RULE_ORDER.filter(id => id !== 'pasteIntoCallout').map(id => ({ kind: 'builtin' as const, id })), EXAMPLE_RULES[1], { kind: 'builtin', id: 'pasteIntoCallout' }],
    examplesVersion: 1,
    replacements: 'ofthe => of the\ninthe => in the\ntothe => to the\nforthe => for the\nandthe => and the\nfromthe => from the',
    vocabulary: 'information\nprocessing\nlanguage\nlearning\nrepresentation\nunderstanding\ntransformation\nclassification\nrecognition\ncommunication\nimplementation\nconfiguration\nexperimental\nexperiment\nanalysis\nattention\nmechanism\nmodel\nmodels\nneural\nnetwork\nnetworks\nnatural\nspeech\ntext\nword\nwords\nembedding\nembeddings\nsemantic\nsyntax\nsyntactic\nphonological\nmorphological\ntokenization\nperformance\nevaluation\nprobability\ndistribution\ngeneralization\nregularization\noptimization'
  },
  textApi: { baseUrl: '', model: '', secretName: 'easypaste-text-api', prompt: defaultPrompts.text },
  imageApi: { baseUrl: '', model: '', secretName: 'easypaste-image-api', prompt: defaultPrompts.image },
  timeoutSeconds: 90, temporaryInstructions: ''
};
interface LegacyProvider {
  id: string;
  baseUrl: string;
  textModel?: string;
  visionModel?: string;
  secretName: string;
}
type SavedSettings = Partial<Omit<EasyPasteSettings, 'textApi' | 'imageApi'>> & {
  textApi?: Partial<ApiSettings>;
  imageApi?: Partial<ApiSettings>;
  api?: Partial<ApiSettings>;
  providers?: LegacyProvider[];
  textProvider?: string;
  visionProvider?: string;
  extraInstructions?: string;
};
export function loadSettings(value: SavedSettings | null): EasyPasteSettings {
  const defaults = structuredClone(DEFAULT_SETTINGS);
  const { providers, textProvider, visionProvider, api, textApi, imageApi, extraInstructions, ...saved } = value ?? {};
  const result = { ...defaults, ...saved, rules: { ...defaults.rules, ...value?.rules } };
  const migrateApi = (current: Partial<ApiSettings> | undefined, fallback: ApiSettings, modelKey: 'textModel' | 'visionModel', providerId: string | undefined): ApiSettings => {
    if (current) return { ...fallback, ...current };
    // The previous shared configuration initializes both sections; keys are separated below.
    if (api) return { ...fallback, ...api, secretName: api.secretName || 'easypaste-api' };
    const provider = Array.isArray(providers)
      ? providers.find(p => p.id === providerId) ?? providers.find(p => p[modelKey]?.trim()) ?? providers[0]
      : undefined;
    return provider ? {
      ...fallback,
      baseUrl: provider.baseUrl,
      model: provider[modelKey]?.trim() || '',
      secretName: provider.secretName || fallback.secretName
    } : { ...fallback };
  };
  result.textApi = migrateApi(textApi, defaults.textApi, 'textModel', textProvider);
  result.imageApi = migrateApi(imageApi, defaults.imageApi, 'visionModel', visionProvider);
  result.temporaryInstructions = typeof saved.temporaryInstructions === 'string'
    ? saved.temporaryInstructions : typeof extraInstructions === 'string' ? extraInstructions : '';
  const seen = new Set<string>();
  const pipeline: CleanupRule[] = [];
  for (const rule of Array.isArray(result.rules.pipeline) ? result.rules.pipeline : []) {
    if (!rule || typeof rule.id !== 'string' || seen.has(rule.id)) continue;
    if (rule.kind === 'builtin' && BUILTIN_RULE_ORDER.includes(rule.id)) {
      pipeline.push({ kind: 'builtin', id: rule.id });
    } else if (rule.kind === 'regex' && !BUILTIN_RULE_ORDER.includes(rule.id as BuiltinRuleId)
      && typeof rule.pattern === 'string' && typeof rule.replacement === 'string' && typeof rule.flags === 'string') {
      pipeline.push({ ...rule, name: typeof rule.name === 'string' ? rule.name : '自定义规则', enabled: rule.enabled === true });
    } else continue;
    seen.add(rule.id);
  }
  for (const id of BUILTIN_RULE_ORDER) if (!seen.has(id)) {
    const afterWords = id === 'spelling' ? pipeline.findIndex(rule => rule.id === 'words') : -1;
    pipeline.splice(afterWords < 0 ? pipeline.length : afterWords + 1, 0, { kind: 'builtin', id });
  }
  if ((value?.rules?.examplesVersion ?? 0) < 1) {
    if (!seen.has(EXAMPLE_RULES[0].id)) pipeline.unshift(structuredClone(EXAMPLE_RULES[0]));
    if (!seen.has(EXAMPLE_RULES[1].id)) pipeline.push(structuredClone(EXAMPLE_RULES[1]));
  }
  result.rules.examplesVersion = 1;
  result.rules.pipeline = pipeline;
  result.rules.spelling = result.rules.spelling === true;
  result.rules.spellingTarget = result.rules.spellingTarget === 'us' ? 'us' : 'gb';
  result.rules.spellingProtectedWords = typeof result.rules.spellingProtectedWords === 'string' ? result.rules.spellingProtectedWords : '';
  result.rules.indentSize = result.rules.indentSize === 2 ? 2 : 4;
  result.timeoutSeconds = Math.min(300, Math.max(10, Number(result.timeoutSeconds) || 90));
  result.maxAutoChars = Math.min(100000, Math.max(1000, Number(result.maxAutoChars) || 30000));
  return result;
}

export function migrateApiSecrets(settings: EasyPasteSettings, storage: {
  getSecret(name: string): string | null;
  setSecret(name: string, key: string): void;
}): boolean {
  let changed = false;
  for (const field of ['textApi', 'imageApi'] as const) {
    const api = settings[field];
    const target = DEFAULT_SETTINGS[field].secretName;
    if (api.secretName === target) continue;
    // Copy within SecretStorage so editing or clearing one section cannot change the other.
    storage.setSecret(target, storage.getSecret(api.secretName) ?? '');
    api.secretName = target;
    changed = true;
  }
  return changed;
}
