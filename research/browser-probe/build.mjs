import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
const font = await readFile(new URL('./node_modules/figlet/fonts/ANSI Compact.flf', import.meta.url), 'utf8');
await build({ entryPoints: [new URL('./worker.mjs', import.meta.url).pathname], bundle: true,
  platform: 'browser', format: 'iife', outfile: new URL('./dist/worker.js', import.meta.url).pathname,
  define: { FONT_DATA: JSON.stringify(font) } });
await writeFile(new URL('./dist/index.html', import.meta.url), await readFile(new URL('./index.html', import.meta.url)));
await build({ entryPoints: [new URL('./storage.mjs', import.meta.url).pathname], bundle: true,
  platform: 'browser', format: 'iife', outfile: new URL('./dist/storage.js', import.meta.url).pathname });
