import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const selection = JSON.parse(await readFile(new URL('brand/handoff.json',root)));
const fonts = JSON.parse(await readFile(new URL('shared/catalog-data.json',root)));
const artFont = JSON.parse(await readFile(new URL('shared/art-font.json',root)));
const allowed = new Set(['index.html','about/index.html','site.webmanifest','font-notice.txt','figlet-license.txt',
  ...selection.files.filter(row=>row.destination.startsWith('public/')).map(row=>row.destination.slice(7)),
  ...fonts.flatMap(font=>[font.path.slice(1),font.noticePath.slice(1)]),artFont.path.slice(1),artFont.licensePath.slice(1)]);
async function walk(path='') {
  for(const item of await readdir(new URL('dist/'+path,root),{withFileTypes:true})) {
    const file=path+item.name;
    if(item.isDirectory()) await walk(file+'/');
    else assert(allowed.has(file) || /^assets\/[\w.-]+\.(js|css)$/.test(file),`Unexpected public build file: ${file}`);
  }
}
await walk();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const row of selection.files.filter(row=>row.destination.startsWith('public/'))) assert.equal(hash(await readFile(new URL('dist/'+row.destination.slice(7),root))),row.sha256);
for(const font of fonts) assert.equal(hash(await readFile(new URL('dist'+font.path,root))),font.sha256);
assert.equal(hash(await readFile(new URL('dist'+artFont.path,root))),artFont.sha256);
assert.equal(hash(await readFile(new URL('dist'+artFont.licensePath,root))),artFont.licenseSha256);
console.log('Public build contains only selected static assets and application bundles; copied hashes match.');
