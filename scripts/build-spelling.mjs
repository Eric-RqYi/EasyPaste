import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = (await readFile(new URL('data/spelling-variants.json', root), 'utf8')).replace(/\r\n/g, '\n');
if (createHash('sha256').update(source).digest('hex') !== '06116ad631171f0c7a06d050c0720fb7a3015a253aa8ed53cac9867ba435f6f1') {
  throw new Error('Spelling snapshot checksum mismatch. See data/README.md before updating.');
}
const snapshot = JSON.parse(source);
const blocked = new Set('prize prizes prized prizing prise prises prised prising size sizes sized sizing'.split(' '));
const usWords = new Set();
const gbWords = new Set();
const pairs = [];
for (const [us, gb] of snapshot.pairs) {
  if (!/^[a-z]{3,64}$/.test(us) || !/^[a-z]{3,64}$/.test(gb) || us === gb) throw new Error('Invalid spelling pair');
  // This regex validates an explicit ESDB pair; it is never used to guess a spelling at runtime.
  const pattern = us.replace(/or|iz/g, part => part === 'or' ? 'ou?r' : 'i[zs]');
  if (!new RegExp(`^${pattern}$`).test(gb) || blocked.has(us) || blocked.has(gb)) continue;
  if (usWords.has(us) || gbWords.has(gb) || usWords.has(gb) || gbWords.has(us)) throw new Error('Ambiguous spelling pair');
  usWords.add(us); gbWords.add(gb); pairs.push([us, gb]);
}
const target = new URL('.generated/spelling.json', root);
const output = JSON.stringify(pairs);
await mkdir(new URL('.generated/', root), { recursive: true });
if (await readFile(target, 'utf8').catch(() => '') !== output) await writeFile(target, output);
