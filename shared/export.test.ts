import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getVariant } from './catalog.ts';
import { colorize } from './color.ts';
import { exportName, stripAnsi, toAnsi, toCodeBlock } from './export.ts';
import { loadFont, renderRecipe } from './render.ts';
import { DEFAULT_COLORS, FONT } from './recipe.ts';
const render = (variantId: string, input: string) => {
  const font = getVariant(variantId);
  loadFont(readFileSync(new URL('../public' + font.path, import.meta.url), 'utf8'), variantId);
  return renderRecipe({ schemaVersion: 1, id: '00000000-0000-4000-8000-000000000001', input, familyId: font.familyId, variantId, fontSha256: font.sha256, rendererVersion: FONT.rendererVersion }).text;
};
test('plain text bytes are the rendered text exactly', () => {
  const text = readFileSync(new URL('./fixtures/multiline.txt', import.meta.url), 'utf8');
  assert.equal(render(FONT.variantId, ' A\nB'), text);
  const bytes = new TextEncoder().encode(text);
  assert.notDeepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(new TextDecoder().decode(bytes), text);
  assert(text.startsWith(' ') && text.includes('\n'));
});
test('code blocks keep whitespace and use a fence the text cannot close', () => {
  assert.equal(toCodeBlock(' A\n B'), '```text\n A\n B\n```\n');
  const tricky = 'x ``` y ```` z';
  const block = toCodeBlock(tricky);
  assert(block.startsWith('`````text\n') && block.endsWith('\n`````\n'));
  assert.equal(block.slice('`````text\n'.length, -'\n`````\n'.length), tricky);
});
test('ANSI output keeps the visible text, resets every line and colors mapped slots', () => {
  const font = getVariant('figlet/linguaholic-shadow-3d');
  const text = render(font.variantId, 'AK\nB');
  const colors = { ...DEFAULT_COLORS, foreground: '#FF0000', shadow: '#00FF00', background: '#000000' };
  const ansi = toAnsi(colorize(text, font), colors);
  assert.equal(stripAnsi(ansi), text);
  const lines = ansi.split('\n');
  assert.equal(lines.length, text.split('\n').length);
  for (const line of lines.filter(Boolean)) {
    assert(line.startsWith('\u001b[48;2;0;0;0m'), 'background first');
    assert(line.endsWith('\u001b[0m'), 'reset last');
  }
  assert(ansi.includes('\u001b[38;2;255;0;0m█'));
  assert(ansi.includes('\u001b[38;2;0;255;0m'));
});
test('control characters never reach the terminal', () => {
  const ansi = toAnsi([{ slot: 'foreground', text: 'A\u001b[2J\u0007B\u009bC' }, { slot: null, text: '\n' }], DEFAULT_COLORS);
  const visible = stripAnsi(ansi);
  assert.equal(visible, 'A�[2J�B�C\n');
  assert(!/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(visible)); // eslint-disable-line no-control-regex
  // The only escape sequences left are the exporter's own SGR codes.
  assert.deepEqual(ansi.match(/\u001b\[[^m]*m/g), ['\u001b[48;2;255;255;255m', '\u001b[38;2;33;27;48m', '\u001b[0m']); // eslint-disable-line no-control-regex
  assert.equal(ansi.split('\u001b').length - 1, 3);
});
test('file names are safe', () => {
  assert.equal(exportName('Future Thin: HELLO/../x', 'txt'), 'aski-future-thin-hello-x.txt');
  assert.equal(exportName('🙂', 'ans'), 'aski-design.ans');
  // Accents are dropped from their letters instead of splitting the word.
  assert.equal(exportName('ANSI Compact Héllo ünï', 'txt'), 'aski-ansi-compact-hello-uni.txt');
});
