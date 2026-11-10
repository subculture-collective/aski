import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname,resolve,sep } from 'node:path';
const root=new URL('../',import.meta.url);
const selection=JSON.parse(await readFile(new URL('brand/selection.json',root)));
const target=new URL('brand/handoff.json',root);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceIndex=process.argv.indexOf('--source');
const source=sourceIndex<0?null:process.argv[sourceIndex+1];
const writing=process.argv.includes('--write');
let previous=null;try{previous=JSON.parse(await readFile(target));}catch(error){if(error.code!=='ENOENT')throw error;}
if(writing) assert(source,'--source STUDIO_REPOSITORY is required for an import');
let manifest;
if(source){
  const bytes=execFileSync('git',['show',`${selection.commit}:${selection.pack}/asset-manifest.json`],{cwd:source});
  assert.equal(hash(bytes),selection.manifestSha256,'Studio manifest drift');manifest=JSON.parse(bytes);
}
const files=[];
for(const row of selection.files){
  const dest=new URL(row.destination,root);
  assert(resolve(dest.pathname).startsWith(resolve(root.pathname)+sep),'Unsafe destination');
  let bytes;
  if(source){
    bytes=await readFile(resolve(source,selection.pack,row.source));
    assert.equal(hash(bytes),manifest.assets.find(item=>item.path===row.source)?.sha256,`Source drift: ${row.source}`);
  } else bytes=await readFile(dest);
  const expected={...row,sha256:hash(bytes),bytes:bytes.length};
  if(writing){
    try{const current=await readFile(dest);const old=previous?.files.find(item=>item.destination===row.destination);assert.equal(hash(current),old?.sha256,`Destination changed: ${row.destination}`);}catch(error){if(error.code!=='ENOENT')throw error;}
    await mkdir(dirname(dest.pathname),{recursive:true});await writeFile(dest,bytes);
  } else assert.equal(hash(await readFile(dest)),previous?.files.find(item=>item.destination===row.destination)?.sha256,`Imported asset drift: ${row.destination}`);
  files.push(expected);
}
const record={...selection,files};
if(writing)await writeFile(target,JSON.stringify(record,null,2)+'\n');
else assert.deepEqual(previous,record,'Handoff metadata drift');
console.log(`${files.length} selected Studio assets verified; private source pack excluded.`);
