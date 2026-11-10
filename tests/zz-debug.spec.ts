import { test } from '@playwright/test';
test('trace what moves the Pause button', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => { const original = window.scrollBy.bind(window); (window as any).__scrolls = []; window.scrollBy = ((x: number, y: number) => { (window as any).__scrolls.push([Math.round(performance.now()), y]); original(x, y); }) as typeof window.scrollBy; });
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Animation' });
  const input = page.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('TYPE');
  await panel.getByRole('radio', { name: 'Typewriter' }).check();
  await page.waitForTimeout(1500);
  await input.fill('TYPE\nMORE');
  await page.waitForTimeout(500);
  await panel.getByRole('radio', { name: 'Reveal' }).check();
  await panel.getByRole('radio', { name: 'Right to left' }).check();
  await panel.getByRole('button', { name: 'Pause' }).scrollIntoViewIfNeeded();
  const samples = await page.evaluate(() => new Promise<unknown[]>(resolve => {
    const out: unknown[] = []; const start = performance.now(); (window as any).__scrolls = [];
    const pause = [...document.querySelectorAll('button')].find(b => b.textContent === 'Pause')!;
    const pre = document.querySelector('[data-testid="animation-preview"]')!;
    const tick = () => {
      const b = pause.getBoundingClientRect(), p = pre.getBoundingClientRect();
      out.push({ t: Math.round(performance.now() - start), by: b.y, py: p.y, ph: p.height, sy: scrollY, dh: document.documentElement.scrollHeight, ih: innerHeight,
        frame: document.querySelector('[data-testid="frame-label"]')?.textContent });
      if (performance.now() - start < 2500) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  }));
  let last = '';
  for (const s of samples as Record<string, unknown>[]) { const key = JSON.stringify({ ...s, t: 0, frame: 0 }); if (key !== last) console.log('S', JSON.stringify(s)); last = key; }
  console.log('SCROLLS', JSON.stringify(await page.evaluate(() => (window as any).__scrolls.slice(0, 40))), (await page.evaluate(() => (window as any).__scrolls.length)));
  const anchors = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-anchor]')].slice(0, 12).map(a => [a.dataset.anchor, Math.round(a.getBoundingClientRect().top), Math.round(a.getBoundingClientRect().height)]));
  console.log('ANCHORS', JSON.stringify(anchors));
});
