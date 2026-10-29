export interface ApiSettings {
  baseUrl: string;
  model: string;
  secretName: string;
}
export type BuiltinRuleId = 'words' | 'lists' | 'joinWrappedLines';
export type CleanupRule = { kind: 'builtin'; id: BuiltinRuleId } | {
  kind: 'regex'; id: string; name: string; enabled: boolean;
  pattern: string; replacement: string; flags: string;
};
export const BUILTIN_RULE_ORDER: BuiltinRuleId[] = ['words', 'lists', 'joinWrappedLines'];
export function regexError(pattern: string, flags: string): string | null {
  if (!pattern) return '请输入匹配表达式';
  try { new RegExp(pattern, flags); return null; }
  catch (error) { return error instanceof Error ? error.message : '正则表达式无效'; }
}
export interface RuleOptions {
  pipeline?: CleanupRule[];
  lists: boolean;
  words: boolean;
  joinWrappedLines: boolean;
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
  extraInstructions: string;
}
export const DEFAULT_SETTINGS: EasyPasteSettings = {
  autoPaste: true, shortcuts: true, maxAutoChars: 30000,
  rules: {
    lists: true, words: true, joinWrappedLines: false, indentSize: 4,
    pipeline: BUILTIN_RULE_ORDER.map(id => ({ kind: 'builtin', id })),
    replacements: 'ofthe => of the\ninthe => in the\ntothe => to the\nforthe => for the\nandthe => and the\nfromthe => from the',
    vocabulary: 'information\nprocessing\nlanguage\nlearning\nrepresentation\nunderstanding\ntransformation\nclassification\nrecognition\ncommunication\nimplementation\nconfiguration\nexperimental\nexperiment\nanalysis\nattention\nmechanism\nmodel\nmodels\nneural\nnetwork\nnetworks\nnatural\nspeech\ntext\nword\nwords\nembedding\nembeddings\nsemantic\nsyntax\nsyntactic\nphonological\nmorphological\ntokenization\nperformance\nevaluation\nprobability\ndistribution\ngeneralization\nregularization\noptimization'
  },
  textApi: { baseUrl: '', model: '', secretName: 'easypaste-text-api' },
  imageApi: { baseUrl: '', model: '', secretName: 'easypaste-image-api' },
  timeoutSeconds: 90, extraInstructions: ''
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
};
export function loadSettings(value: SavedSettings | null): EasyPasteSettings {
  const defaults = structuredClone(DEFAULT_SETTINGS);
  const { providers, textProvider, visionProvider, api, textApi, imageApi, ...saved } = value ?? {};
  const result = { ...defaults, ...saved, rules: { ...defaults.rules, ...value?.rules } };
  const migrateApi = (current: Partial<ApiSettings> | undefined, fallback: ApiSettings, modelKey: 'textModel' | 'visionModel', providerId: string | undefined): ApiSettings => {
    if (current) return { ...fallback, ...current };
    // The previous shared configuration initializes both sections; keys are separated below.
    if (api) return { ...fallback, ...api, secretName: api.secretName || 'easypaste-api' };
    const provider = Array.isArray(providers)
      ? providers.find(p => p.id === providerId) ?? providers.find(p => p[modelKey]?.trim()) ?? providers[0]
      : undefined;
    return provider ? {
      baseUrl: provider.baseUrl,
      model: provider[modelKey]?.trim() || '',
      secretName: provider.secretName || fallback.secretName
    } : { ...fallback };
  };
  result.textApi = migrateApi(textApi, defaults.textApi, 'textModel', textProvider);
  result.imageApi = migrateApi(imageApi, defaults.imageApi, 'visionModel', visionProvider);
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
  for (const id of BUILTIN_RULE_ORDER) if (!seen.has(id)) pipeline.push({ kind: 'builtin', id });
  result.rules.pipeline = pipeline;
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
