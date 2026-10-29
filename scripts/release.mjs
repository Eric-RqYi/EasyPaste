import { mkdir, copyFile, cp, rm } from 'node:fs/promises';
const dir = 'dist/easy-paste';
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css', 'README.md', 'LICENSE']) await copyFile(name, `${dir}/${name}`);
await cp('node_modules/diff/LICENSE', `${dir}/LICENSE-diff`);
for (const name of ['nspell', 'dictionary-en', 'dictionary-en-gb']) {
  await copyFile(`node_modules/${name}/license`, `${dir}/LICENSE-${name}`);
}
await copyFile('node_modules/is-buffer/LICENSE', `${dir}/LICENSE-is-buffer`);
await copyFile('data/LICENSE-frequency', `${dir}/LICENSE-frequency`);
await copyFile('data/LICENSE-spelling', `${dir}/LICENSE-spelling`);
console.log(`Installable plugin: ${dir}`);
