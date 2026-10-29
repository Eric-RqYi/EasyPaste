import pairs from '../.generated/spelling.json';
import type { SpellingTarget } from './settings';

const tables: Partial<Record<SpellingTarget, ReadonlyMap<string, string>>> = {};
let lastProtected = '';
let protectedWords = new Set<string>();

/** Whole-word, case-preserving lookup only. No spellchecker, NLP or suffix guessing. */
export function convertSpelling(text: string, target: SpellingTarget, protectedVocabulary = ''): string {
  const table = tables[target] ??= new Map(pairs.map(([us, gb]) => target === 'us' ? [gb, us] : [us, gb]));
  if (lastProtected !== protectedVocabulary) {
    lastProtected = protectedVocabulary;
    protectedWords = new Set(protectedVocabulary.split(/[\s,;]+/).map(word => word.toLowerCase()).filter(Boolean));
  }
  return text.replace(/(?<![\p{L}\p{N}_])(?<!\p{L}['’])[A-Za-z]+(?![\p{L}\p{N}_])/gu, word => {
    // Mixed-case names and identifiers are not normal prose words.
    if (!/^(?:[a-z]+|[A-Z][a-z]+|[A-Z]+)$/.test(word)) return word;
    const lower = word.toLowerCase();
    if (protectedWords.has(lower)) return word;
    const replacement = table.get(lower);
    if (!replacement) return word;
    if (word === word.toUpperCase()) return replacement.toUpperCase();
    return /^[A-Z]/.test(word) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
  });
}
