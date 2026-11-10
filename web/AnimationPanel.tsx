import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { DIRECTIONS, LIMITS, cycleSlots, frameCount, frameDataAt, frameIndex, frameTime, parseAnimation } from '../shared/animation.ts';
import type { Animation, FrameModel } from '../shared/animation.ts';
import type { Colors, Slot } from '../shared/recipe.ts';
import { GifExport } from './GifExport.tsx';
import type { FontVariant } from '../shared/catalog.ts';
const EFFECT_LABELS = { none: 'None', typewriter: 'Typewriter', reveal: 'Reveal', 'palette-cycle': 'Palette cycle', shimmer: 'Shimmer', glitch: 'Glitch' } as const;
const DIRECTION_LABELS = { down: 'Top to bottom', up: 'Bottom to top', right: 'Left to right', left: 'Right to left' } as const;
interface AnimationProps { animation: Animation; model: FrameModel | null; font: FontVariant; colors: Colors; blocks: boolean; fileName: string; onInspect: (index: number) => void; onSaveGif: (gif: { bytes: Uint8Array; width: number; height: number }) => Promise<string>; onChange: (animation: Animation) => void }
const RATES = [6, 8, 10, 12, 15, 20, 24, 30];
// Seconds in the controls, whole milliseconds in the recipe.
function SecondsField({ id, label, value, range, onCommit }: { id: string; label: string; value: number; range: readonly [number, number]; onCommit: (ms: number) => string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const commit = () => {
    if (draft === null) return;
    const ms = Math.round(Number(draft) * 1000);
    const error = draft.trim() && Number.isFinite(ms) ? onCommit(ms) : `${label} must be a number of seconds.`;
    setMessage(error); if (!error) setDraft(null);
  };
  return <div className="field">
    <label htmlFor={id}>{label} (seconds)</label>
    <input id={id} type="number" inputMode="decimal" step="0.5" min={range[0] / 1000} max={range[1] / 1000} value={draft ?? String(value / 1000)}
      onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
    {message && <p className="item-note" role="alert">{message}</p>}
  </div>;
}
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// Previews the selected design with the shared frame function. Reduced motion starts paused.
export function AnimationPanel({ animation, model, font, colors, blocks, fileName, onInspect, onSaveGif, onChange }: AnimationProps) {
  const [playing, setPlaying] = useState(() => !reducedMotion());
  const [index, setIndex] = useState(0);
  const count = frameCount(animation);
  const active = animation.effect !== 'none' && !!model;
  const last = count - 1;
  useEffect(() => {
    if (!playing || !active) return;
    let frame = 0;
    // Play-once restarts from the beginning when started at its last frame.
    const started = performance.now() - frameTime(animation, !animation.loop && index >= last ? 0 : index);
    const tick = (now: number) => {
      const next = frameIndex(animation, now - started);
      setIndex(next);
      if (!animation.loop && next >= last) { setPlaying(false); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Restart timing only when playback or timing settings change, not on every frame.
  }, [playing, active, animation]);
  const current = Math.min(index, last);
  useEffect(() => { onInspect(current); }, [current, onInspect]);
  // Validates a timing change through the recipe rules; returns a message instead of applying bad values.
  const update = (change: Partial<Animation>) => {
    try { onChange(parseAnimation({ ...animation, ...change })); return ''; } catch (error) { return (error as Error).message; }
  };
  const frame = useMemo(() => active ? frameDataAt(model!, animation, frameTime(animation, current), colors, font) : null, [active, model, animation, current, colors, font]);
  const style = Object.fromEntries(Object.entries(frame?.colors || colors).map(([slot, color]) => [`--slot-${slot}`, color])) as CSSProperties;
  const ownSlots = font.slots.filter(slot => slot !== 'background');
  return <section className="animation" data-anchor="animation" aria-labelledby="animation-title">
    <h2 id="animation-title">Animation</h2>
    <fieldset className="slots"><legend>Effect</legend>
      {(Object.keys(EFFECT_LABELS) as Animation['effect'][]).map(effect => <label key={effect}>
        <input type="radio" name="effect" value={effect} checked={animation.effect === effect} onChange={() => { setIndex(0); onChange({ ...animation, effect }); }} />{EFFECT_LABELS[effect]}
      </label>)}
    </fieldset>
    {(animation.effect === 'reveal' || animation.effect === 'shimmer') && <fieldset className="slots"><legend>Direction</legend>
      {DIRECTIONS.map(direction => <label key={direction}>
        <input type="radio" name="direction" value={direction} checked={animation.direction === direction} onChange={() => { setIndex(0); onChange({ ...animation, direction }); }} />{DIRECTION_LABELS[direction]}
      </label>)}
    </fieldset>}
    {(animation.effect === 'shimmer' || animation.effect === 'glitch') && <div className="field">
      <label htmlFor="intensity">Intensity</label>
      <input id="intensity" className="scrubber" type="range" min={LIMITS.intensity[0]} max={LIMITS.intensity[1]} value={animation.intensity}
        onChange={event => update({ intensity: Number(event.target.value) })} />
    </div>}
    {animation.effect === 'glitch' && <div className="item-actions">
      <button onClick={() => update({ seed: (animation.seed * 48271 + 1) % LIMITS.seed[1] })}>New glitch pattern</button>
      <span className="hint">Pattern {animation.seed}. The same pattern always produces the same frames.</span>
    </div>}
    {animation.effect === 'palette-cycle' && <p className="hint" data-testid="cycle-note">{ownSlots.length > 1
      ? `Rotates the ${ownSlots.join(' and ')} colors.`
      : `${font.name} has one color slot, so the foreground moves through your ${cycleSlots(font.slots as Slot[]).join(', ')} colors.`} The background stays fixed.</p>}
    {animation.effect !== 'none' && <>
      <pre className="art animation-preview" data-testid="animation-preview" aria-label="Animation preview" style={style}>
        {(frame?.runs || []).map((run, key) => run.slot && run.slot !== 'foreground' ? <span key={key} className={`slot-${run.slot}`}>{run.text}</span> : run.text)}
      </pre>
      <div className="item-actions">
        <button aria-pressed={playing} onClick={() => setPlaying(value => !value)} disabled={!model}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => { setIndex(0); setPlaying(true); }} disabled={!model}>Restart</button>
        <span className="hint frame-label" data-testid="frame-label">Frame {current + 1} of {count}</span>
      </div>
      <label htmlFor="scrubber">Frame</label>
      <input id="scrubber" className="scrubber" type="range" min={1} max={count} step={1} value={current + 1} disabled={!model}
        aria-valuetext={`Frame ${current + 1} of ${count}, ${(frameTime(animation, current) / 1000).toFixed(2)} seconds`}
        onChange={event => { setPlaying(false); setIndex(Number(event.target.value) - 1); }} />
      <div className="timing">
        <SecondsField id="duration" label="Duration" value={animation.durationMs} range={LIMITS.durationMs} onCommit={durationMs => update({ durationMs })} />
        <SecondsField id="hold" label="End hold" value={animation.holdMs} range={LIMITS.holdMs} onCommit={holdMs => update({ holdMs })} />
        <div className="field"><label htmlFor="fps">Frame rate</label>
          <select id="fps" value={animation.fps} onChange={event => update({ fps: Number(event.target.value) })}>
            {RATES.map(rate => <option key={rate} value={rate}>{rate} fps</option>)}
          </select></div>
      </div>
      <fieldset className="slots"><legend>Playback</legend>
        <label><input type="radio" name="loop" checked={animation.loop} onChange={() => update({ loop: true })} />Loop</label>
        <label><input type="radio" name="loop" checked={!animation.loop} onChange={() => update({ loop: false })} />Play once</label>
      </fieldset>
      {!model && <p className="hint">The preview starts when the artwork has rendered.</p>}
      <GifExport model={model} animation={animation} colors={colors} variantId={font.variantId} blocks={blocks} fileName={fileName} onSave={onSaveGif} />
    </>}
  </section>;
}
