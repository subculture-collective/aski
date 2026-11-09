import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import figlet from 'figlet';
const require = createRequire(import.meta.url);
const root = dirname(dirname(require.resolve('figlet')));
assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version, '1.12.0');
const sha = value => createHash('sha256').update(value).digest('hex');
const notices = [
  ['MIT', /MIT License/i, 'explicit-permission'],
  ['WTFPL-2.0', /Do What The Fuck You Want To Public License, Version 2/i, 'explicit-permission'],
  ['custom-modification-notice', /Permission is hereby given to modify|Permission to modify granted/i, 'needs-review'],
];
const fonts = [];
for (const file of (await readdir(join(root, 'fonts'))).filter(x => x.endsWith('.flf')).sort()) {
  const bytes = await readFile(join(root, 'fonts', file));
  const lines = bytes.toString().replace(/\r\n?/g, '\n').split('\n');
  const fields = lines[0].split(/\s+/);
  const count = Number(fields[5]);
  assert(Number.isInteger(count) && count >= 0, file);
  const comment = lines.slice(1, count + 1).join('\n');
  const rule = notices.find(([, pattern]) => pattern.test(comment));
  fonts.push({ name: file.slice(0, -4), file, sha256: sha(bytes), headerSha256: sha(comment),
    height: Number(fields[1]), notice: rule?.[0] ?? 'not-declared-in-header',
    redistribution: rule?.[2] ?? 'needs-review',
    source: 'https://github.com/patorjk/figlet.js/blob/v1.12.0/fonts/' + encodeURIComponent(file) });
}
const samples = [];
for (const font of ['Standard', 'Graffiti', 'ANSI Compact', 'Isometric1', 'Isometric2', 'Isometric3', 'Isometric4', 'Linguaholic Shadow 3D']) {
  for (const text of ['ASKI\nA🙂', 'A A']) {
    const output = figlet.textSync(text, { font, horizontalLayout: 'default', verticalLayout: 'default' });
    samples.push({ font, input: text, outputSha256: sha(output), rows: output.split('\n').length,
      columns: Math.max(...output.split('\n').map(x => [...x].length)),
      unsupportedEmojiSameAsAbsent: text.includes('🙂') && output === figlet.textSync(text.replace('🙂', ''), { font }) });
  }
}
const report = { schemaVersion: 1, source: { package: 'figlet', version: '1.12.0',
  engineLicense: 'MIT', engineLicenseSha256: sha(await readFile(join(root, 'LICENSE.txt'))),
  npmIntegrity: 'sha512-Ith3WsUi0N/EqGt+0/F6XnWhT04sohhH2tT0Dq7GdUmWbMTIoCbg2Jq9qKggmTO62ST5kRCfB311EmIMbizGyA==' },
  counts: { fonts: fonts.length, explicitPermission: fonts.filter(x => x.redistribution === 'explicit-permission').length,
    needsReview: fonts.filter(x => x.redistribution === 'needs-review').length },
  policy: 'Header classification is evidence triage, not blanket rights clearance. Ship only entries with a reviewed rights record and retained notice. No font binaries are copied by this audit.',
  fonts, samples };
const target = new URL('./catalog-audit.json', import.meta.url);
const serialized = JSON.stringify(report, null, 2) + '\n';
const observed = JSON.parse(await readFile(new URL('../../docs/research/taag-observations.json', import.meta.url), 'utf8'));
for (const sample of observed.samples.filter(x => x.format === 'figlet')) {
  const output = figlet.textSync(sample.input, { font: sample.font });
  assert.equal(sha(output), sample.outputSha256, `TAAG output drift for ${sample.font}`);
}
if (process.argv.includes('--check')) assert.equal(await readFile(target, 'utf8'), serialized, 'Audit drift; regenerate and review the pinned package');
else await writeFile(target, serialized);
console.log(JSON.stringify(report.counts));
