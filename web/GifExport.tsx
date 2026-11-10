import { useEffect, useRef, useState } from 'react';
import { frameCount, cycleMs } from '../shared/animation.ts';
import type { Animation, FrameModel } from '../shared/animation.ts';
import { validateGif } from '../shared/gif.ts';
import { imageSize } from '../shared/image.ts';
import type { ImageOptions } from '../shared/image.ts';
import type { Colors } from '../shared/recipe.ts';
import type { GifJob, GifReply } from './gif.worker.ts';
type State = { kind: 'idle' } | { kind: 'encoding'; done: number; total: number } | { kind: 'done'; url: string; bytes: number; frames: number } | { kind: 'error'; message: string };
const kilobytes = (bytes: number) => bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`;
// Encodes in a dedicated worker with progress and cancellation. The draft is never touched.
export function GifExport({ model, animation, colors, variantId, blocks, fileName }: {
  model: FrameModel | null; animation: Animation; colors: Colors; variantId: string; blocks: boolean; fileName: string;
}) {
  const [scale, setScale] = useState(1);
  const [transparent, setTransparent] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const worker = useRef<Worker | null>(null);
  const jobs = useRef(0);
  const options: ImageOptions = { scale, padding: 8, transparent, blocks };
  const frames = frameCount(animation);
  let size = '', limit = '';
  try {
    const { width, height } = imageSize(model?.columns || 0, model?.rows || 0, options);
    size = `${width} × ${height} pixels, ${frames} frames, ${(cycleMs(animation) / 1000).toFixed(1)} s, ${animation.loop ? 'looping' : 'plays once'}`;
    limit = validateGif(width, height, frames);
  } catch (error) { limit = (error as Error).message; }
  const stop = () => { worker.current?.terminate(); worker.current = null; };
  useEffect(() => () => { stop(); }, []);
  // A finished GIF belongs to the settings it was made from; any change clears it.
  useEffect(() => {
    setState(previous => { if (previous.kind === 'done') URL.revokeObjectURL(previous.url); return previous.kind === 'encoding' ? previous : { kind: 'idle' }; });
  }, [model, animation, colors, scale, transparent, blocks]);
  function start() {
    if (!model || limit) return;
    stop();
    const current = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });
    worker.current = current;
    const jobId = ++jobs.current;
    setState({ kind: 'encoding', done: 0, total: frames });
    current.onmessage = (event: MessageEvent<GifReply>) => {
      if (event.data.jobId !== jobId) return;
      const reply = event.data;
      if (reply.type === 'progress') setState({ kind: 'encoding', done: reply.done, total: reply.total });
      else if (reply.type === 'done') { stop(); setState({ kind: 'done', url: URL.createObjectURL(new Blob([reply.bytes as BlobPart], { type: 'image/gif' })), bytes: reply.bytes.length, frames: reply.frames }); }
      else { stop(); setState({ kind: 'error', message: `${reply.message} Your design is unchanged.` }); }
    };
    current.onerror = () => { stop(); setState({ kind: 'error', message: 'The GIF encoder stopped. Your design is unchanged; try again.' }); };
    const job: GifJob = { jobId, model: { text: model.text, columns: model.columns, rows: model.rows, typewriter: model.typewriter }, animation, colors, variantId, options };
    current.postMessage(job);
  }
  return <div className="gif-export" role="group" aria-label="GIF export">
    <h3>GIF</h3>
    <div className="timing">
      <div className="field"><label htmlFor="gif-scale">GIF scale</label>
        <select id="gif-scale" value={scale} onChange={event => setScale(Number(event.target.value))}>
          {[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}×</option>)}
        </select></div>
    </div>
    <label className="toggle"><input type="checkbox" checked={transparent} onChange={event => setTransparent(event.target.checked)} />Transparent background</label>
    <p className="hint" data-testid="gif-size">{limit || size}</p>
    {state.kind === 'encoding'
      ? <div className="item-actions">
        <button onClick={() => { stop(); setState({ kind: 'idle' }); }}>Cancel</button>
        <progress max={state.total} value={state.done} aria-label="GIF progress" />
        <span className="hint" data-testid="gif-progress">Frame {state.done} of {state.total}</span>
      </div>
      : <button onClick={start} disabled={!model || !!limit}>Create GIF</button>}
    {state.kind === 'error' && <p className="item-note" role="alert">{state.message}</p>}
    {state.kind === 'done' && <div className="gif-result">
      <img src={state.url} alt="Encoded GIF sample" />
      <p className="hint" data-testid="gif-result">{kilobytes(state.bytes)}, {state.frames} stored {state.frames === 1 ? 'frame' : 'frames'} (identical neighbours merged). GIF keeps up to 256 colors per frame and on/off transparency, so soft edges may look harder than the preview.</p>
      <a className="button" href={state.url} download={fileName}>Download GIF</a>
    </div>}
  </div>;
}
