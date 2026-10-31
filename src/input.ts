import { defaultT, UserFacingError, type Translator } from './i18n';
import type { ConversionMode } from './api';

export interface ConversionInput {
  text: string;
  images: string[];
}

/** Find image embeds anywhere in a selection, excluding Markdown code examples. */
export function imageReferences(source: string): string[] {
  const mask = (value: string) => value.replace(/[^\n]/g, ' ');
  const text = source
    .replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g, mask)
    .replace(/(`+)[^\n]*?\1/g, mask);
  const references: string[] = [];
  const embeds = /(?<!\\)!\[\[([^\]\n]+)\]\]|(?<!\\)!\[(?:\\.|[^\]\\])*\]\(\s*(?:<([^>\n]+)>|((?:\\.|[^\s()\\]|\((?:\\.|[^()\\])*\))+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^\)\n]*\)))?\s*\)/g;
  for (const match of text.matchAll(embeds)) {
    let path = match[1] ? match[1].split('|')[0].split('#')[0].trim() : match[2] ?? match[3];
    path = path.replace(/\\([\\()[\] ])/g, '$1');
    // Wiki embeds can also refer to notes and PDFs, which aren't image inputs.
    if (match[1] && !/\.(?:png|jpe?g|webp|gif|svg|bmp|avif|tiff?|heic)$/i.test(path)) continue;
    if (path && !references.includes(path)) references.push(path);
  }
  return references;
}

export function conversionMode(input: ConversionInput): ConversionMode {
  return input.images.length || imageReferences(input.text).length ? 'image' : 'text';
}

/** Resolve every selected embed before sending; a missing image must never silently use the text API. */
export async function resolveConversionInput(input: ConversionInput, readImage: (path: string) => Promise<string>, t: Translator = defaultT): Promise<ConversionInput> {
  if (input.text.length > 200000) throw new UserFacingError('input.tooLong', {}, t);
  if (!input.text.trim() && !input.images.length) throw new UserFacingError('input.empty', {}, t);
  const images: string[] = [];
  for (const path of imageReferences(input.text)) images.push(await readImage(path));
  images.push(...input.images);
  return { text: input.text, images };
}
