import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit, devices } from 'playwright';
import { parseGIF, decompressFrames } from 'gifuct-js';

const root = fileURLToPath(new URL('./', import.meta.url));
const outputDir = process.env.PROBE_OUTPUT || join(root, 'artifacts');
await mkdir(outputDir, { recursive: true });
const server = createServer(async (req, res) => {
  const file = ({ '/worker.js': 'worker.js', '/storage.js': 'storage.js' })[req.url] || 'index.html';
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
  res.end(await readFile(join(root, 'dist', file)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const cases = [
  ['chromium-desktop', chromium, { viewport: { width: 1280, height: 800 } }],
  ['firefox-desktop', firefox, { viewport: { width: 1280, height: 800 } }],
  ['webkit-desktop', webkit, { viewport: { width: 1280, height: 800 } }],
  ['chromium-phone-emulated', chromium, devices['Pixel 7']],
  ['webkit-phone-emulated', webkit, devices['iPhone 13']],
  ['webkit-tablet-emulated', webkit, devices['iPad Mini']],
];
const reports = [];
try {
  for (const [name, engine, contextOptions] of cases) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ ...contextOptions, acceptDownloads: true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url);
      const capabilities = await page.evaluate(() => ({ worker: !!window.Worker, offscreen: !!window.OffscreenCanvas,
        blob: !!window.Blob, indexedDB: !!window.indexedDB, userAgent: navigator.userAgent,
        viewport: { width: innerWidth, height: innerHeight } }));
      assert(capabilities.worker && capabilities.offscreen && capabilities.blob && capabilities.indexedDB, name);
      await page.evaluate(() => {
        window.ticks = [];
        window.tickTimer = setInterval(() => window.ticks.push(performance.now()), 8);
      });
      const artifacts = [];
      for (const [transparent, once] of [[false, false], [true, true]]) {
        await page.locator('#draft').fill('ASKI');
        await page.evaluate(opts => window.start(opts), { transparent, once });
        await page.waitForFunction(() => window.progress >= 1);
        await page.locator('#draft').fill('Draft changed while encoding');
        await page.waitForFunction(() => document.querySelector('#status').textContent === 'done');
        const data = await page.evaluate(() => ({ ...window.result, bytes: Array.from(window.result.bytes),
          draft: document.querySelector('#draft').value, ticks: window.ticks.length,
          heap: performance.memory ? { used: performance.memory.usedJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null }));
        assert.equal(data.draft, 'Draft changed while encoding');
        assert(data.ticks > 0, 'main-thread timer did not run');
        const bytes = Uint8Array.from(data.bytes);
        const gif = parseGIF(bytes.buffer);
        const frames = decompressFrames(gif, true);
        assert.equal(gif.lsd.width, 320); assert.equal(gif.lsd.height, 128);
        assert.equal(frames.length, 40);
        assert.equal(frames.reduce((sum, frame) => sum + frame.delay, 0), 2200);
        assert(frames.every(frame => frame.disposalType === (transparent ? 2 : 1)));
        const hasRepeat = new TextDecoder().decode(bytes).includes('NETSCAPE2.0');
        assert.equal(hasRepeat, !once);
        assert.equal(frames[0].patch[3], transparent ? 0 : 255);
        assert(frames.at(-1).patch.some((value, i) => i % 4 === 3 && value === 255));
        const downloadEvent = page.waitForEvent('download');
        await page.locator('#download').click();
        const download = await downloadEvent;
        const file = `${name}-${transparent ? 'transparent-once' : 'opaque-loop'}.gif`;
        await download.saveAs(join(outputDir, file));
        const downloaded = await readFile(join(outputDir, file));
        assert.deepEqual(new Uint8Array(downloaded), bytes, 'download bytes differ');
        await page.waitForFunction(() => document.querySelector('#preview').complete && document.querySelector('#preview').naturalWidth === 320);
        artifacts.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
          ms: Math.round(data.ms), frames: frames.length, durationMs: 2200, transparent, once,
          activePixelBufferBytes: data.activePixelBufferBytes, mainThreadTimerTicks: data.ticks,
          mainThreadHeap: data.heap, previewDecoded: true, downloadMatches: true });
      }
      const saved = artifacts[0];
      const savedBytes = [...await readFile(join(outputDir, saved.file))];
      const blobStorage = await page.evaluate(bytes => window.storageProbe.blobSupport(bytes), savedBytes);
      await page.evaluate(bytes => window.storageProbe.save(bytes), savedBytes);
      assert(await page.evaluate(() => window.storageProbe.rollback()));
      await page.reload();
      const restored = await page.evaluate(() => window.storageProbe.load());
      assert.deepEqual(restored, savedBytes, 'IndexedDB blob differs after reload');
      await page.evaluate(() => window.start({ frames: 200 }));
      await page.waitForFunction(() => window.progress >= 1);
      await page.locator('#cancel').click();
      assert.equal(await page.locator('#status').textContent(), 'cancelled');
      assert.equal(await page.evaluate(() => window.result), null);
      await page.locator('#draft').fill('ASKI');
      await page.locator('#start').click();
      await page.waitForFunction(() => document.querySelector('#status').textContent === 'done');
      await page.evaluate(() => window.start({ width: 999999 }));
      await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('error:Invalid width'));
      await page.evaluate(() => clearInterval(window.tickTimer));
      assert.deepEqual(errors, []);
      reports.push({ name, engineVersion: browser.version(), physicalDevice: false, capabilities, artifacts,
        cancellationAndRestart: true, invalidAllocationRejected: true, byteArrayReloadRoundTrip: true,
        blobStorage, transactionRollback: true, pageErrors: errors });
      console.log(`${name}: encoding, alpha, timing, loop, download, edit, cancellation, restart passed`);
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
const report = { schemaVersion: 1, observedAt: new Date().toISOString(), host: process.platform + '/' + process.arch,
  limitations: ['All cases are automated desktop-hosted browser engines, not physical phone/tablet or branded Safari/Chrome qualification.',
    'Pixel-buffer count excludes canvas backing stores, quantizer/encoder allocations, browser/native memory, and transient copies. Chromium heap numbers cover the main realm, not whole-worker or device peak memory.',
    'The 320x128/40-frame sample proves feasibility only; it does not establish production export budgets or complete font coverage.'], reports };
await writeFile(join(outputDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
