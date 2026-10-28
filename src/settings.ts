export interface ApiSettings {
  baseUrl: string;
  model: string;
  secretName: string;
}
export interface RuleOptions {
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
