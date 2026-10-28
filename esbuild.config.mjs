import * as esbuild from 'esbuild';
const config = {
  entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian'],
  format: 'cjs', target: 'es2022', platform: 'browser', outfile: 'main.js',
  sourcemap: process.argv.includes('--watch') ? 'inline' : false,
  banner: { js: '/* EasyPaste | MIT License | bundled dependencies retain their licenses */' }
};
if (process.argv.includes('--watch')) {
  const context = await esbuild.context(config);
  await context.watch();
} else await esbuild.build(config);
