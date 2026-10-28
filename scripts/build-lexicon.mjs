import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Read data at build time only: the shipped plugin needs neither Node fs nor network access.
const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const readDictionary = async name => {
  const base = new URL('./', pathToFileURL(require.resolve(name)));
  return Promise.all(['index.aff', 'index.dic'].map(file => readFile(new URL(file, base), 'utf8')));
};
const [[aff, us], [gbAff, gb], frequency] = await Promise.all([
  readDictionary('dictionary-en'), readDictionary('dictionary-en-gb'),
  readFile(new URL('data/frequency-en.txt', root), 'utf8')
]);
if (aff !== gbAff) throw new Error('English affix rules differ; dictionaries must not be merged.');
const hash = createHash('sha256').update(frequency).digest('hex');
if (hash !== '5eb7d9ca29ba3aee23d11b8b3d3aa048d7e94538b468eeffd9e07f76de7d5125') {
  throw new Error('English frequency data checksum mismatch. See data/README.md before updating.');
}
const entries = [...new Set([...us.split(/\r?\n/).slice(1), ...gb.split(/\r?\n/).slice(1)].filter(Boolean))];
const frequencies = Object.create(null);
for (const line of frequency.split(/\r?\n/)) {
  const match = /^([a-z]{1,64}) (\d+)$/.exec(line);
  if (match) frequencies[match[1]] = Number(match[2]);
}
const output = JSON.stringify({ aff, dic: `${entries.length}\n${entries.join('\n')}\n`, frequencies });
await mkdir(new URL('.generated/', root), { recursive: true });
const target = new URL('.generated/english.json', root);
// Avoid rewriting the generated module on every watch/build invocation.
if (await readFile(target, 'utf8').catch(() => '') !== output) await writeFile(target, output);
