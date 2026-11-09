import figlet from 'figlet';
import { GIFEncoder, applyPalette } from 'gifenc';
import { delayAt, validateJob, visibleColumns } from './contract.mjs';

figlet.parseFont('ANSI Compact', FONT_DATA);
const palette = [[24, 21, 34], [212, 255, 96], [255, 110, 82]];

// This bounded probe uses explicit block geometry; it is not a complete glyph renderer.
function draw(ctx, glyph, x, y, color) {
  ctx.fillStyle = color;
  if (glyph === '█') ctx.fillRect(x, y, 8, 12);
  else if (glyph === '▀') ctx.fillRect(x, y, 8, 6);
  else if (glyph === '▄') ctx.fillRect(x, y + 6, 8, 6);
  else if (glyph !== ' ') ctx.fillText(glyph, x, y + 10);
}

self.onmessage = async ({ data }) => {
  try {
    validateJob(data);
    const { width, height, frames, transparent, once } = data;
    const started = performance.now();
    const output = figlet.textSync(data.text, { font: 'ANSI Compact' });
    const rows = output.split('\n');
    const columns = Math.max(...rows.map(x => [...x].length));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.font = '12px monospace';
    const gif = GIFEncoder();
    for (let frame = 0; frame < frames; frame++) {
      ctx.fillStyle = '#181522';
      ctx.fillRect(0, 0, width, height);
      const visible = visibleColumns(frame, frames, columns);
      rows.forEach((row, y) => [...row].slice(0, visible).forEach((glyph, x) => {
        draw(ctx, glyph, 8 + x * 8, 8 + y * 12, x === visible - 1 ? '#ff6e52' : '#d4ff60');
      }));
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const indexed = applyPalette(rgba, palette);
      gif.writeFrame(indexed, width, height, { palette, transparent, transparentIndex: 0,
        delay: delayAt(frame, frames, 20, 200), repeat: once ? -1 : 0, dispose: transparent ? 2 : 1 });
      self.postMessage({ type: 'progress', frame: frame + 1 });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    gif.finish();
    const bytes = gif.bytes();
    self.postMessage({ type: 'done', bytes, render: output, ms: performance.now() - started,
      activePixelBufferBytes: width * height * 5, encodedBytes: bytes.length }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error.message) });
  }
};
