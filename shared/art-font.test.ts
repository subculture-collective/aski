import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ART_FONT, FONT_STACK } from './image.ts';
// Every character a bundled FIGlet font can draw is either in aski Art Mono or on its recorded fallback list,
// so adding a font that needs new glyphs fails here until scripts/art-font.py is rerun.
test('aski Art Mono covers what the FIGlet fonts draw, apart from its recorded fallbacks', () => {
  const covered = new Set(ART_FONT.covered);
  const fallback = new Set(ART_FONT.uncoveredCodePoints);
  const missing: string[] = [];
  for (const file of readdirSync('public/fonts').filter(name => name.endsWith('.flf'))) {
    const lines = readFileSync(`public/fonts/${file}`, 'utf8').split('\n');
    const header = lines[0].split(/\s+/); const hardblank = header[0].at(-1); const comments = Number(header[5]);
    for (const line of lines.slice(1 + comments)) {
      const body = line.trimEnd(); if (!body) continue;
      const end = body.at(-1)!; let core = body; while (core.endsWith(end)) core = core.slice(0, -1);
      for (const character of core) if (character !== hardblank && !/\s/.test(character) && !covered.has(character)
        && !fallback.has('U+' + character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'))) missing.push(`${file}: ${character}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});
test('the committed font file matches its manifest and leads the export font stack', () => {
  assert.equal(createHash('sha256').update(readFileSync('public' + ART_FONT.path)).digest('hex'), ART_FONT.sha256);
  assert.equal(createHash('sha256').update(readFileSync('public' + ART_FONT.licensePath)).digest('hex'), ART_FONT.licenseSha256);
  assert(FONT_STACK.startsWith(`'${ART_FONT.family}',`));
  assert(!/juliamono/i.test(ART_FONT.family));
});
