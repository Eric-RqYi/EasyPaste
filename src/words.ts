import nspell from 'nspell';
import english from '../.generated/english.json';

const CACHE_LIMIT = 8192;
const MIN_FREQUENCY = 100_000;
const MIN_SCORE_GAP = Math.log10(20);
const SHORT_WORDS = new Set('a i am an as at be by do go he if in is it me my no of on or so to up us we'.split(' '));
// Both spellings can be meaningful (e.g. re-creation / recreation).
const AMBIGUOUS_PREFIX = /^(?:re|co|non|pre|post|anti|self|ex)$/i;
const frequencies: Readonly<Record<string, number>> = english.frequencies;
let dictionary: ReturnType<typeof nspell> | undefined;
const knownCache = new Map<string, boolean>();

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}
function builtinKnown(word: string): boolean {
  const cached = knownCache.get(word);
  if (cached !== undefined) return cached;
  dictionary ??= nspell(english.aff, english.dic);
  return remember(knownCache, word, dictionary.correct(word));
}

export interface WordRepair {
  hyphen(left: string, right: string, acrossLine: boolean): string | null;
  split(word: string): string | null;
}
let previousVocabulary: string | undefined;
let previousRepair: WordRepair;

/** A bounded cache per active vocabulary; user additions never mutate the shared dictionary. */
export function wordRepair(vocabulary: string): WordRepair {
  if (previousVocabulary === vocabulary) return previousRepair;
  const custom = new Set(vocabulary.split(/[\s,;]+/).map(word => word.toLowerCase()).filter(Boolean));
  const known = (word: string) => custom.has(word.toLowerCase()) || builtinKnown(word);
  const knownParts = (word: string) => word.split('-').every(part => known(part));
  const splitCache = new Map<string, string | null>();
  const pieceFrequency = (word: string): number => {
    if (word.length <= 2 && !SHORT_WORDS.has(word) && !custom.has(word)) return 0;
    if (!known(word === 'i' ? 'I' : word)) return 0;
    const count = frequencies[word] ?? 0;
    // Custom technical terms need not appear in a general-purpose corpus.
    return custom.has(word) ? Math.max(count, MIN_FREQUENCY) : count >= MIN_FREQUENCY ? count : 0;
  };
  const repair: WordRepair = {
    hyphen(left, right, acrossLine) {
      if (left.length + right.length > 64) return null;
      const joined = left + right;
      const hyphenated = `${left}-${right}`;
      const mergedKnown = known(joined) || (joined.includes('-') && knownParts(joined));
      const bothKnown = knownParts(left) && knownParts(right);
      if (known(hyphenated)) return acrossLine ? hyphenated : null;
      if (mergedKnown && !bothKnown && !(AMBIGUOUS_PREFIX.test(left) && known(right))) return joined;
      // Only remove the line break when keeping the hyphen has no competing joined word.
      if (acrossLine && !mergedKnown && bothKnown) return hyphenated;
      return null;
    },
    split(word) {
      if (splitCache.has(word)) return splitCache.get(word)!;
      let result: string | null = null;
      // Leave acronyms, mixed-case identifiers and valid complete words intact.
      if (/^(?:[a-z]{3,64}|[A-Z][a-z]{2,63})$/.test(word) && !known(word)) {
        const lower = word.toLowerCase();
        const candidates: { at: number; score: number }[] = [];
        for (let at = 1; at < lower.length; at++) {
          const left = pieceFrequency(lower.slice(0, at));
          if (!left) continue;
          const right = pieceFrequency(lower.slice(at));
          if (right) candidates.push({ at, score: Math.log10(left) + Math.log10(right) });
        }
        candidates.sort((a, b) => b.score - a.score);
        const [best, next] = candidates;
        if (best && (!next || best.score - next.score >= MIN_SCORE_GAP)) {
          result = `${word.slice(0, best.at)} ${word.slice(best.at)}`;
        }
      }
      return remember(splitCache, word, result);
    }
  };
  previousVocabulary = vocabulary;
  previousRepair = repair;
  return repair;
}
