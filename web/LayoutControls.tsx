import { useState } from 'react';
import { ALIGNMENTS, MAX_WIDTH, MIN_WIDTH, parseWidth } from '../shared/recipe.ts';
import type { Layout, Spacing } from '../shared/recipe.ts';
const SPACING_LABELS: Record<Spacing, string> = { default: 'Font default', full: 'Full width', fitted: 'Fitted', smush: 'Smushed' };
const ALIGN_LABELS = { left: 'Left', center: 'Center', right: 'Right' };
interface LayoutProps { layout: Layout; fontName: string; fontDefault: string; canSmush: boolean; onChange: (layout: Layout) => void }
// Spacing modes come from the font header; widths and alignment apply to every font.
export function LayoutControls({ layout, fontName, fontDefault, canSmush, onChange }: LayoutProps) {
  const [width, setWidth] = useState('');
  const [message, setMessage] = useState('');
  return <section className="layout" data-anchor="layout" aria-labelledby="layout-title">
    <h2 id="layout-title">Layout</h2>
    <fieldset className="slots"><legend>Letter spacing</legend>
      {(Object.keys(SPACING_LABELS) as Spacing[]).map(spacing => {
        const unavailable = spacing === 'smush' && !canSmush;
        return <label key={spacing} aria-disabled={unavailable || undefined}>
          <input type="radio" name="spacing" value={spacing} checked={layout.spacing === spacing} disabled={unavailable}
            onChange={() => onChange({ ...layout, spacing })} />
          {SPACING_LABELS[spacing]}{spacing === 'default' ? ` (${fontDefault === 'smush' ? 'smushed' : fontDefault})` : ''}
        </label>;
      })}
    </fieldset>
    {!canSmush && <p className="hint" id="smush-note">{fontName} defines no smushing rules, so Smushed is unavailable.</p>}
    <form className="custom-color" onSubmit={event => {
      event.preventDefault();
      try { onChange({ ...layout, width: parseWidth(width) }); setMessage(''); setWidth(''); } catch (error) { setMessage((error as Error).message); }
    }}>
      <label htmlFor="max-width">Maximum width</label>
      <div>
        <input id="max-width" inputMode="numeric" value={width} placeholder={layout.width ? `${layout.width} columns` : 'No limit'} onChange={event => setWidth(event.target.value)} />
        <button type="submit">Set width</button>
        <button type="button" disabled={layout.width === null} onClick={() => { onChange({ ...layout, width: null }); setMessage(''); setWidth(''); }}>No limit</button>
      </div>
    </form>
    <p className="hint">{layout.width ? `Lines wrap between words at ${layout.width} columns.` : `Set ${MIN_WIDTH}–${MAX_WIDTH} columns to wrap long lines between words.`}</p>
    {message && <p className="item-note" role="alert">{message}</p>}
    <fieldset className="slots"><legend>Alignment</legend>
      {ALIGNMENTS.map(align => <label key={align}>
        <input type="radio" name="align" value={align} checked={layout.align === align} onChange={() => onChange({ ...layout, align })} />{ALIGN_LABELS[align]}
      </label>)}
    </fieldset>
  </section>;
}
