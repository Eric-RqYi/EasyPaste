import { mkdir, copyFile, cp, rm } from 'node:fs/promises';
const dir = 'dist/easy-paste';
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css', 'README.md', 'LICENSE']) await copyFile(name, `${dir}/${name}`);
await cp('node_modules/diff/LICENSE', `${dir}/LICENSE-diff`);
console.log(`Installable plugin: ${dir}`);
