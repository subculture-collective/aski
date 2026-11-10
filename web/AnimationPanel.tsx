import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { DIRECTIONS, frameAt, frameCount, frameIndex, frameTime } from '../shared/animation.ts';
import type { Animation, FrameModel } from '../shared/animation.ts';
import { colorize } from '../shared/color.ts';
import type { FontVariant } from '../shared/catalog.ts';
const EFFECT_LABELS = { none: 'None', typewriter: 'Typewriter', reveal: 'Reveal' } as const;
const DIRECTION_LABELS = { down: 'Top to bottom', up: 'Bottom to top', right: 'Left to right', left: 'Right to left' } as const;
interface AnimationProps { animation: Animation; model: FrameModel | null; font: FontVariant; style: CSSProperties; onChange: (animation: Animation) => void }
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// Previews the selected design with the shared frame function. Reduced motion starts paused.
export function AnimationPanel({ animation, model, font, style, onChange }: AnimationProps) {
  const [playing, setPlaying] = useState(() => !reducedMotion());
  const [index, setIndex] = useState(0);
  const count = frameCount(animation);
  const active = animation.effect !== 'none' && !!model;
  useEffect(() => {
    if (!playing || !active) return;
    let frame = 0;
    const started = performance.now() - frameTime(animation, index);
    const tick = (now: number) => { setIndex(frameIndex(animation, now - started)); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Restart timing only when playback or timing settings change, not on every frame.
  }, [playing, active, animation]);
  const current = Math.min(index, count - 1);
  const text = useMemo(() => active ? frameAt(model!, animation, frameTime(animation, current)) : '', [active, model, animation, current]);
  const runs = useMemo(() => colorize(text, font), [text, font]);
  return <section className="animation" aria-labelledby="animation-title">
    <h2 id="animation-title">Animation</h2>
    <fieldset className="slots"><legend>Effect</legend>
      {(Object.keys(EFFECT_LABELS) as Animation['effect'][]).map(effect => <label key={effect}>
        <input type="radio" name="effect" value={effect} checked={animation.effect === effect} onChange={() => { setIndex(0); onChange({ ...animation, effect }); }} />{EFFECT_LABELS[effect]}
      </label>)}
    </fieldset>
    {animation.effect === 'reveal' && <fieldset className="slots"><legend>Direction</legend>
      {DIRECTIONS.map(direction => <label key={direction}>
        <input type="radio" name="direction" value={direction} checked={animation.direction === direction} onChange={() => { setIndex(0); onChange({ ...animation, direction }); }} />{DIRECTION_LABELS[direction]}
      </label>)}
    </fieldset>}
    {animation.effect !== 'none' && <>
      <pre className="art animation-preview" data-testid="animation-preview" aria-label="Animation preview" style={style}>
        {runs.map((run, key) => run.slot && run.slot !== 'foreground' ? <span key={key} className={`slot-${run.slot}`}>{run.text}</span> : run.text)}
      </pre>
      <div className="item-actions">
        <button aria-pressed={playing} onClick={() => setPlaying(value => !value)} disabled={!model}>{playing ? 'Pause' : 'Play'}</button>
        <span className="hint" data-testid="frame-label">Frame {current + 1} of {count}</span>
      </div>
      {!model && <p className="hint">The preview starts when the artwork has rendered.</p>}
    </>}
  </section>;
}
