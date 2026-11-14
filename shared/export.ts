import type { ColorRun } from './color.ts';
import type { Colors } from './recipe.ts';
// Plain text exports are the rendered text exactly: same spaces, same line breaks, UTF-8 without a BOM.
// A Markdown code block uses a fence longer than any backtick run in the text so it cannot close early.
export function toCodeBlock(text: string) {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), match => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}text\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}\n`;
}
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g; // eslint-disable-line no-control-regex
const rgb = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)).join(';');
// 24-bit SGR colors per line. Each line starts with the background and ends with a reset, so colors never
// leak past the artwork or into the next line. Control characters cannot reach the terminal.
export function toAnsi(runs: ColorRun[], colors: Colors) {
  const background = `\u001b[48;2;${rgb(colors.background)}m`;
  const lines: string[] = [''];
  let current: string | null = null;
  for (const run of runs) {
    const parts = run.text.replace(CONTROL, '�').split('\n');
    parts.forEach((part, index) => {
      if (index > 0) { lines.push(''); current = null; }
      if (!part) return;
      if (!lines.at(-1)) lines[lines.length - 1] = background;
      if (run.slot && run.slot !== current) { lines[lines.length - 1] += `\u001b[38;2;${rgb(colors[run.slot])}m`; current = run.slot; }
      lines[lines.length - 1] += part;
    });
  }
  return lines.map(line => line ? line + '\u001b[0m' : line).join('\n');
}
// Removes the SGR sequences this exporter writes; used to prove the visible text is unchanged.
export const stripAnsi = (text: string) => text.replace(/\u001b\[[\d;]*m/g, ''); // eslint-disable-line no-control-regex
export function exportName(name: string, extension: string) {
  const base = name.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).toLowerCase() || 'design';
  return `aski-${base}.${extension}`;
}
