import { readFile, writeFile } from 'node:fs/promises';

const packageUrl = new URL('./package.json', import.meta.url);
const manifestUrl = new URL('./manifest.json', import.meta.url);
const versionsUrl = new URL('./versions.json', import.meta.url);

const { version } = JSON.parse(await readFile(packageUrl, 'utf8'));
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
const versions = JSON.parse(await readFile(versionsUrl, 'utf8'));

manifest.version = version;
versions[version] = manifest.minAppVersion;

await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(versionsUrl, `${JSON.stringify(versions, null, 2)}\n`);
