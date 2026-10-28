export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  textModel: string;
  visionModel: string;
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
  providers: Provider[];
  textProvider: string;
  visionProvider: string;
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
  providers: [
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', textModel: '', visionModel: '', secretName: 'easypaste-openai' },
    { id: 'nebius', name: 'Nebius', baseUrl: 'https://api.tokenfactory.nebius.com/v1', textModel: '', visionModel: '', secretName: 'easypaste-nebius' },
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', textModel: '', visionModel: '', secretName: 'easypaste-deepseek' }
  ],
  textProvider: 'openai', visionProvider: 'openai', timeoutSeconds: 90, extraInstructions: ''
};
export function loadSettings(value: Partial<EasyPasteSettings> | null): EasyPasteSettings {
  const defaults = structuredClone(DEFAULT_SETTINGS);
  const result = { ...defaults, ...value, rules: { ...defaults.rules, ...value?.rules } };
  if (!Array.isArray(result.providers) || !result.providers.length) result.providers = defaults.providers;
  result.rules.indentSize = result.rules.indentSize === 2 ? 2 : 4;
  result.timeoutSeconds = Math.min(300, Math.max(10, Number(result.timeoutSeconds) || 90));
  result.maxAutoChars = Math.min(100000, Math.max(1000, Number(result.maxAutoChars) || 30000));
  return result;
}
