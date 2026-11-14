import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { decompressFrames, parseGIF } from 'gifuct-js';
// Export qualification measurements for #64. Run with `make qualify-export`; ordinary test runs skip it.
// Each project writes docs/research/export-qualification/<project>.json; docs/export-qualification.md
// summarises them. Viewport
// projects run on this machine's engines, so they measure layout and engine behaviour, not phone hardware.
test.skip(process.env.ASKI_QUALIFY !== '1', 'Run make qualify-export to record measurements.');
test.describe.configure({ timeout: 600_000 });
import { closeDownload, openCustomize, openDownload } from './ui.ts';
const panel = (page: Page) => page.getByRole('region', { name: 'Animation' });
const gif = (page: Page) => page.getByRole('group', { name: 'GIF export' });
const quantile = (values: number[], q: number) => { const sorted = [...values].sort((a, b) => a - b); return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]); };
async function download(page: Page, click: () => Promise<unknown>) {
  const [file] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: file.suggestedFilename(), bytes: readFileSync((await file.path())!) };
}
function decodeGif(bytes: Buffer) {
  const parsed = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const frames = decompressFrames(parsed, true);
  return { frames: frames.length, totalMs: frames.reduce((sum, frame) => sum + frame.delay, 0), loops: parsed.frames.some(frame => 'application' in frame && frame.application.id === 'NETSCAPE2.0'),
    disposal: [...new Set(frames.map(frame => frame.disposalType))], width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}
async function animate(page: Page, text: string, effect: string, seconds: string, hold: string, fps: string) {
  await closeDownload(page);
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill(text);
  await openCustomize(page, 'Animation');
  await panel(page).getByRole('radio', { name: effect }).check();
  await panel(page).getByLabel('Duration (seconds)').fill(seconds); await panel(page).getByLabel('Duration (seconds)').press('Enter');
  await panel(page).getByLabel('End hold (seconds)').fill(hold); await panel(page).getByLabel('End hold (seconds)').press('Enter');
  await panel(page).getByLabel('Frame rate').selectOption(fps);
}
// Encodes the current settings and returns the wall time from Create GIF to the finished result.
async function encode(page: Page) {
  await expect(gif(page).getByRole('button', { name: 'Create GIF' }), (await page.getByTestId('gif-size').textContent())!).toBeEnabled({ timeout: 5_000 });
  const started = Date.now();
  await gif(page).getByRole('button', { name: 'Create GIF' }).click();
  await expect(page.getByTestId('gif-result')).toBeVisible({ timeout: 540_000 });
  return Date.now() - started;
}
test('measure typing, export fidelity, GIF encoding and cancellation', async ({ page, browserName }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  const result: Record<string, unknown> = { project: testInfo.project.name, browser: browserName, version: page.context().browser()?.version(),
    viewport: page.viewportSize(), host: { cpu: cpus()[0]?.model, cores: cpus().length, memoryGiB: Math.round(totalmem() / 2 ** 30) } };
  // Typing: time from each input event to the next change of the rendered output, for 40 keystrokes into a
  // ten-line text in two styles.
  for (const style of ['ansi-compact.regular', 'figlet/linguaholic-shadow-3d']) {
    await page.getByLabel('Style', { exact: true }).selectOption(style);
    await input.fill(Array.from({ length: 9 }, (_, i) => `LINE ${i} OF THE TEXT`).join('\n') + '\n');
    await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
    await page.evaluate(() => {
      const w = window as unknown as { latencies: number[]; pending: number[] };
      w.latencies = []; w.pending = [];
      document.getElementById('input')!.addEventListener('input', () => w.pending.push(performance.now()));
      new MutationObserver(() => { const now = performance.now(); while (w.pending.length) w.latencies.push(now - w.pending.shift()!); })
        .observe(document.querySelector('[data-testid=output]')!, { childList: true, subtree: true, characterData: true });
    });
    await input.press('End'); await input.pressSequentially('THE QUICK BROWN FOX JUMPS OVER THE LAZY', { delay: 60 });
    await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
    const latencies = await page.evaluate(() => (window as unknown as { latencies: number[] }).latencies);
    result[`typing:${style}`] = { keystrokes: latencies.length, p50Ms: quantile(latencies, 0.5), p95Ms: quantile(latencies, 0.95), maxMs: Math.round(Math.max(...latencies)) };
    await page.reload(); await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  }
  // Fidelity: every format downloaded from one seamless block design with spaces and two lines.
  await page.getByLabel('Style', { exact: true }).selectOption('ansi-compact.regular');
  await input.fill('  A B\nCD  ');
  await openCustomize(page, 'Layout');
  await page.getByLabel(/^Seamless blocks/).check();
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  const shown = (await page.getByTestId('output').textContent())!;
  await openDownload(page);
  const text = await download(page, () => page.getByRole('button', { name: 'Download text' }).click());
  const ansi = await download(page, () => page.getByRole('button', { name: 'Download ANSI' }).click());
  const visible = ansi.bytes.toString('utf8').replace(/\x1b\[[\d;]*m/g, '');
  const exports = page.getByRole('group', { name: 'Image export' });
  const png = await download(page, () => exports.getByRole('button', { name: 'Download PNG' }).click());
  const svg = await download(page, () => exports.getByRole('button', { name: 'Download SVG' }).click());
  const pngSize = { width: png.bytes.readUInt32BE(16), height: png.bytes.readUInt32BE(20) };
  const svgText = svg.bytes.toString('utf8');
  const svgSize = /<svg [^>]*width="(\d+)" height="(\d+)"/.exec(svgText)!.slice(1).map(Number);
  result.fidelity = {
    text: { file: text.name, matchesScreen: text.bytes.toString('utf8') === shown, leadingSpacesKept: text.bytes.toString('utf8').startsWith(shown.slice(0, 2)) },
    ansi: { file: ansi.name, truecolor: /\x1b\[38;2;\d+;\d+;\d+m/.test(ansi.bytes.toString('utf8')), visibleTextMatches: visible.replace(/\r?\n$/, '') === shown.replace(/\r?\n$/, '') },
    png: { file: png.name, ...pngSize }, svg: { file: svg.name, width: svgSize[0], height: svgSize[1], matchesPng: svgSize[0] === pngSize.width && svgSize[1] === pngSize.height,
      noScriptsOrExternalReferences: !/<script|href=|url\(|<foreignObject|<!/i.test(svgText) },
  };
  // GIF: a typical export and the largest export the budgets allow, solid and transparent.
  const gifs: Record<string, unknown> = {};
  await animate(page, 'HELLO', 'Reveal', '2', '1', '12');
  gifs.typical = { settings: (await page.getByTestId('gif-size').textContent())!, encodeMs: await encode(page), ...decodeGif((await download(page, () => gif(page).getByRole('link', { name: 'Download GIF' }).click())).bytes) };
  await gif(page).getByLabel('Transparent background').check();
  gifs.typicalTransparent = { encodeMs: await encode(page), ...decodeGif((await download(page, () => gif(page).getByRole('link', { name: 'Download GIF' }).click())).bytes) };
  await gif(page).getByLabel('Transparent background').uncheck();
  // 540 frames of this glitch at scale 2 (1040 × 208) is about 117 million pixel-frames, just under the
  // 120 million budget.
  await animate(page, 'ASKI STUDIO', 'Glitch', '17', '1', '30');
  await gif(page).getByLabel('GIF scale').selectOption('2');
  const largest = (await page.getByTestId('gif-size').textContent())!;
  gifs.atBudget = { settings: largest, encodeMs: await encode(page), result: (await page.getByTestId('gif-result').textContent())!.split(',').slice(0, 2).join(',') };
  // The budget refusal names the setting to lower.
  await animate(page, 'ASKI STUDIO', 'Glitch', '19', '1', '30');
  gifs.overBudgetMessage = (await page.getByTestId('gif-size').textContent())!;
  await expect(gif(page).getByRole('button', { name: 'Create GIF' })).toBeDisabled();
  await animate(page, 'ASKI STUDIO', 'Glitch', '17', '1', '30');
  // Cancellation: stop the largest job midway, inside the page so the job cannot finish between seeing
  // progress and pressing Cancel, and time how quickly the page is idle and a small job then completes.
  await gif(page).getByRole('button', { name: 'Create GIF' }).click();
  const idleMs = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const button = (name: string) => [...document.querySelectorAll('.gif-export button')].find(item => item.textContent === name) as HTMLButtonElement | undefined;
    const tick = () => {
      const done = Number(/Frame (\d+) of/.exec(document.querySelector('[data-testid=gif-progress]')?.textContent || '')?.[1] || 0);
      if (done < 20) { if (document.querySelector('[data-testid=gif-result]')) reject(new Error('Finished before cancel')); else requestAnimationFrame(tick); return; }
      const cancelled = performance.now(); button('Cancel')!.click();
      const idle = () => button('Create GIF') ? resolve(Math.round(performance.now() - cancelled)) : requestAnimationFrame(idle);
      idle();
    };
    tick();
  }));
  await animate(page, 'HI', 'Reveal', '1', '0', '10');
  gifs.cancellation = { idleAfterCancelMs: idleMs, nextSmallJobMs: await encode(page) };
  result.gif = gifs;
  mkdirSync('docs/research/export-qualification', { recursive: true });
  writeFileSync(`docs/research/export-qualification/${testInfo.project.name}.json`, JSON.stringify({ recordedAt: new Date().toISOString(), ...result }, null, 2) + '\n');
});
