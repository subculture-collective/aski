import { useState } from 'react';
import { DEFAULT_IMAGE, IMAGE_LIMITS, imageSize } from '../shared/image.ts';
import type { ImageOptions } from '../shared/image.ts';
// PNG and SVG settings. Exports never change the draft; failures are reported here.
export function ImageExport({ columns, rows, blocks, disabled, onExport }: {
  columns: number; rows: number; blocks: boolean; disabled: boolean; onExport: (format: 'png' | 'svg', options: ImageOptions) => Promise<void>;
}) {
  const [options, setOptions] = useState<ImageOptions>(DEFAULT_IMAGE);
  const [message, setMessage] = useState('');
  const settings = { ...options, blocks };
  let size = '', limit = '';
  try { const { width, height } = imageSize(columns, rows, settings); size = `${width} × ${height} pixels`; } catch (error) { limit = (error as Error).message; }
  const run = (format: 'png' | 'svg') => { setMessage(''); onExport(format, settings).catch(error => setMessage(`Could not export: ${(error as Error).message} Your design is unchanged.`)); };
  return <div className="image-export" role="group" aria-label="Image export">
    <div className="timing">
      <div className="field"><label htmlFor="image-scale">Scale</label>
        <select id="image-scale" value={options.scale} onChange={event => setOptions({ ...options, scale: Number(event.target.value) })}>
          {Array.from({ length: IMAGE_LIMITS.scale[1] }, (_, index) => index + 1).map(scale => <option key={scale} value={scale}>{scale}× ({8 * scale} × {16 * scale} px cells)</option>)}
        </select></div>
      <div className="field"><label htmlFor="image-padding">Padding (pixels)</label>
        <input id="image-padding" type="number" inputMode="numeric" min={0} max={IMAGE_LIMITS.padding[1]} value={options.padding}
          onChange={event => setOptions({ ...options, padding: Math.max(0, Math.min(IMAGE_LIMITS.padding[1], Math.round(Number(event.target.value) || 0))) })} /></div>
    </div>
    <label className="toggle"><input type="checkbox" checked={options.transparent} onChange={event => setOptions({ ...options, transparent: event.target.checked })} />Transparent background</label>
    <p className="hint" data-testid="image-size">{limit || `${size}. ${blocks ? 'Blocks are drawn as solid shapes.' : 'Characters use your device’s monospace font in PNG; SVG uses the viewer’s.'}`}</p>
    <div className="item-actions">
      <button onClick={() => run('png')} disabled={disabled || !!limit}>Download PNG</button>
      <button onClick={() => run('svg')} disabled={disabled || !!limit}>Download SVG</button>
    </div>
    {message && <p className="item-note" role="alert">{message}</p>}
  </div>;
}
