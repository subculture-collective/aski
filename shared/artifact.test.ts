import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkArtifact } from './artifact.ts';
import { toSvg } from './image.ts';
import { colorize } from './color.ts';
import { DEFAULT_COLORS } from './recipe.ts';
import { getVariant } from './catalog.ts';
import { createGif } from './gif.ts';
const svg = (text: string) => new TextEncoder().encode(text);
const head = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">';
test('aski SVG exports in both text and block modes pass the upload check', () => {
  const font = getVariant('ansi-compact.regular');
  for (const blocks of [false, true]) {
    const runs = colorize('█▀ A&<\n▄ "x"', font);
    const out = toSvg(runs, DEFAULT_COLORS, { columns: 5, rows: 2 }, { scale: 2, padding: 4, transparent: false, blocks });
    const [, width, height] = /width="(\d+)" height="(\d+)"/.exec(out)!.map(Number);
    assert.doesNotThrow(() => checkArtifact(svg(out), 'image/svg+xml', width, height));
  }
});
test('active, external and unknown SVG content is refused', () => {
  const cases = [
    `${head}<script>alert(1)</script></svg>`, `${head}<rect onload="x" width="1" height="1"/></svg>`,
    `${head}<foreignObject></foreignObject></svg>`, `<!DOCTYPE svg [<!ENTITY a "b">]>${head}</svg>`,
    `${head}<rect fill="url(https://e.test/x)" width="1" height="1"/></svg>`, `${head}<image href="https://e.test/x.png"/></svg>`,
    `${head}<!-- c --></svg>`, `<?xml-stylesheet href="x"?>${head}</svg>`, `${head}&custom;</svg>`, `${head}<g></svg>`,
    `${head}</svg><svg></svg>`, `${head}<rect width="1" width="2"/></svg>`, `${head}<rect x='1'/></svg>`,
    head.replace('width="10"', 'width="11"') + '</svg>', head.replace(/xmlns="[^"]+"/, 'xmlns="http://e.test"') + '</svg>',
  ];
  for (const text of cases) assert.throws(() => checkArtifact(svg(text), 'image/svg+xml', 10, 10), Error, text);
  assert.throws(() => checkArtifact(new Uint8Array([0xff, 0xfe, 0x3c]), 'image/svg+xml', 10, 10), /UTF-8/);
});
test('PNG and GIF signatures and sizes must match the declared type and size', () => {
  const png = new Uint8Array(33); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(png.buffer).setUint32(16, 300); new DataView(png.buffer).setUint32(20, 40);
  assert.doesNotThrow(() => checkArtifact(png, 'image/png', 300, 40));
  assert.throws(() => checkArtifact(png, 'image/png', 300, 41), /size/);
  assert.throws(() => checkArtifact(png, 'image/gif', 300, 40), /not a GIF/);
  const encoder = createGif({ width: 2, height: 2, transparent: false, loop: true }); encoder.add(new Uint8Array(16).fill(255), 10);
  const gif = encoder.finish().bytes;
  assert.doesNotThrow(() => checkArtifact(gif, 'image/gif', 2, 2));
  assert.throws(() => checkArtifact(gif, 'image/png', 2, 2), /not a PNG/);
  assert.throws(() => checkArtifact(gif, 'text/html', 2, 2), /not supported/);
  assert.throws(() => checkArtifact(new Uint8Array(0), 'image/gif', 2, 2), /empty/);
  assert.throws(() => checkArtifact(gif, 'image/gif', 0, 2), /size/);
});
