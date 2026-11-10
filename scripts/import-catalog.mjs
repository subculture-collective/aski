import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import figlet from 'figlet';
import { supportsBlocks } from '../shared/cells.ts';
const root = new URL('../', import.meta.url);
const require = createRequire(import.meta.url);
const packageRoot = dirname(dirname(require.resolve('figlet')));
const audit = JSON.parse(await readFile(new URL('research/font-audit/catalog-audit.json', root)));
const rights = JSON.parse(await readFile(new URL('catalog/rights-decisions.json', root)));
const mappings = JSON.parse(await readFile(new URL('catalog/color-mappings.json', root))).fonts;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const approved = new Set(rights.approved);
const check = process.argv.includes('--check');
async function emit(path, bytes) {
  const dest = new URL(path, root);
  if (check) assert.equal(hash(await readFile(dest)), hash(bytes), `Catalog drift: ${path}`);
  else { await mkdir(dirname(dest.pathname), { recursive: true }); await writeFile(dest, bytes); }
}
// Each look names a Unicode range the letters are drawn with; a font can have several.
const LOOKS = { block: /[\u2580-\u2590\u2594-\u259f]/u, shaded: /[\u2591-\u2593]/u, line: /[\u2500-\u257f]/u, braille: /[\u2800-\u28ff]/u,
  letter: /[A-Za-z]/, enclosed: /[\u2460-\u24ff]/u, wide: /[\uff01-\uff5e]/u, symbol: /[^\sA-Za-z\u2460-\u24ff\u2500-\u259f\u2800-\u28ff\uff01-\uff5e]/u };
const looksOf = text => Object.keys(LOOKS).filter(look => LOOKS[look].test(text));
const fonts = [], candidates = [];
for (const candidate of audit.fonts) {
  const source = await readFile(join(packageRoot, 'fonts', candidate.file));
  assert.equal(hash(source), candidate.sha256, candidate.name);
  const lines = source.toString().replace(/\r\n?/g, '\n').split('\n');
  const notice = lines.slice(1, Number(lines[0].split(/\s+/)[5]) + 1).join('\n');
  assert.equal(hash(notice), candidate.headerSha256);
  const name = candidate.name;
  const group = Object.entries(rights.families).find(([, variants]) => variants.includes(name));
  const familyId = name === 'ANSI Compact' ? 'ansi-compact' : `figlet/${slug(group?.[0] || name)}`;
  const variantId = name === 'ANSI Compact' ? 'ansi-compact.regular' : `figlet/${slug(name)}`;
  const cleared = approved.has(name);
  const entry = { name, familyId, variantId, sha256: candidate.sha256, source: candidate.source,
    headerSha256: candidate.headerSha256, rights: cleared ? 'approved' : 'needs-review',
    license: cleared ? candidate.notice : null, tags: null, colorMapping: null, coverage: null };
  candidates.push(entry);
  if (!cleared) continue;
  assert.equal(candidate.redistribution, 'explicit-permission');
  assert(candidate.notice === 'MIT' ? /MIT License/i.test(notice) : /redistribute it and.or modify it[\s\S]*Do What The Fuck You Want To Public License, Version 2/.test(notice), name);
  const options = figlet.parseFont(variantId, source.toString());
  const glyphs = figlet.figFonts[variantId];
  const coverage = Object.keys(glyphs).filter(key => /^\d+$/.test(key)).map(Number).filter(cp =>
    cp === 32 || glyphs[cp].some(line => line.split(options.hardBlank).join(' ').trim().length > 0));
  const path = `fonts/${slug(name)}.flf`;
  // Reviewed slot mappings must name characters the font actually draws.
  const colorMapping = mappings[name] || null;
  const drawn = new Set(Object.values(glyphs).filter(Array.isArray).flatMap(lines => [...lines.join('')]));
  for (const characters of Object.values(colorMapping || {})) for (const character of characters) assert(drawn.has(character), `${name} never draws ${character}`);
  // Horizontal layout capability comes from the font header: its own default and whether it defines smushing rules.
  const rules = options.fittingRules;
  const spacing = { default: ['full', 'fitted', 'smush', 'smush'][rules.hLayout], smush: [1, 2, 3, 4, 5, 6].some(rule => rules[`hRule${rule}`]) };
  fonts.push({ ...entry, colorMapping, coverage, path: '/' + path, noticePath: `/fonts/${slug(name)}-notice.txt`, height: options.height, format: 'figlet',
    slots: ['foreground', 'background', ...Object.keys(colorMapping || {})], spacing,
    // Seamless blocks only when every drawn character is a known block shape (hard blanks render as spaces).
    blocks: supportsBlocks([...drawn].filter(character => character !== options.hardBlank)),
    // Broad looks from the characters the font draws for A–Z; tags stay null until reviewed.
    looks: looksOf(Array.from({ length: 26 }, (_, index) => glyphs[65 + index] || []).flat().join('').split(options.hardBlank).join(' ')) });
  await emit('public/' + path, source);
  await emit(`public/fonts/${slug(name)}-notice.txt`, notice + '\n');
}
assert.equal(fonts.length, approved.size);
for (const name of Object.keys(mappings)) assert(fonts.some(font => font.name === name), `Color mapping for unapproved font: ${name}`);
const expected = new Set(fonts.flatMap(x => [x.path.split('/').pop(), x.noticePath.split('/').pop()]));
if (check) for (const file of await readdir(new URL('public/fonts/', root))) assert(expected.has(file), `Unapproved packaged font: ${file}`);
await emit('shared/catalog-data.json', JSON.stringify(fonts, null, 2) + '\n');
await emit('catalog/candidates.json', JSON.stringify(candidates, null, 2) + '\n');
console.log(`${candidates.length} candidates; ${fonts.length} approved font binaries and notices verified.`);
