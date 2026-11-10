import { test } from '@playwright/test';
test('trace what moves the Pause button', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Animation' });
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('TYPE\nMORE');
  await panel.getByRole('radio', { name: 'Reveal' }).check();
  await panel.getByRole('radio', { name: 'Right to left' }).check();
  const samples = await page.evaluate(() => new Promise<unknown[]>(resolve => {
    const out: unknown[] = []; const start = performance.now();
    const pause = [...document.querySelectorAll('button')].find(b => b.textContent === 'Pause')!;
    const pre = document.querySelector('[data-testid="animation-preview"]')!;
    const tick = () => {
      const b = pause.getBoundingClientRect(), p = pre.getBoundingClientRect();
      const lines = (pre.textContent || '').split('\n');
      out.push({ t: Math.round(performance.now() - start), bx: b.x, by: b.y, bh: b.height, py: p.y, ph: p.height, pw: p.width, sy: scrollY, dh: document.documentElement.scrollHeight,
        rows: lines.length, chars: [...new Set([...(pre.textContent || '')])].join(''), frame: document.querySelector('[data-testid="frame-label"]')?.textContent });
      if (performance.now() - start < 2500) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  }));
  let last = '';
  for (const s of samples as Record<string, unknown>[]) { const key = JSON.stringify({ ...s, t: 0, frame: 0 }); if (key !== last) console.log(JSON.stringify(s)); last = key; }
});
