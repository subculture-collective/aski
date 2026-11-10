import { useRef, useState } from 'react';
import { families, getVariant } from '../shared/catalog.ts';
import type { FontFamily } from '../shared/catalog.ts';
import { PREVIEW_LIMIT, usePreviews } from './usePreviews.ts';
const slug = (id: string) => id.replace(/[^a-z\d]+/gi, '-');
export const LOOK_LABELS: Record<string, string> = { block: 'Blocks', shaded: 'Shaded', line: 'Lines', braille: 'Braille', letter: 'Letters', enclosed: 'Enclosed', wide: 'Wide', symbol: 'Symbols' };
interface Filters { query: string; looks: string[]; supportsText: boolean; maxColumns: string; maxRows: string }
const NO_FILTERS: Filters = { query: '', looks: [], supportsText: false, maxColumns: '', maxRows: '' };
interface GalleryProps {
  input: string; activeFamilyId: string; variantFor: (family: FontFamily) => string;
  expanded: ReadonlySet<string>; onVariant: (family: FontFamily, variantId: string) => void;
  onUse: (family: FontFamily) => void; onToggle: (family: FontFamily) => void;
  isFavorite: (familyId: string, variantId: string) => boolean; onFavorite: (familyId: string, variantId: string) => void;
  pins: string[]; onPin: (variantId: string) => void; onUseVariant: (variantId: string) => void;
}
export function Gallery({ input, activeFamilyId, variantFor, expanded, onVariant, onUse, onToggle, isFavorite, onFavorite, pins, onPin, onUseVariant }: GalleryProps) {
  const selected = families.map(variantFor);
  // Pinned variants render through the same preview queue, after the cards' own variants.
  const { previews, text, truncated } = usePreviews(input, [...new Set([...selected, ...pins])]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const set = (change: Partial<Filters>) => setFilters(previous => ({ ...previous, ...change }));
  const search = useRef<HTMLInputElement>(null);
  // Clearing removes the button that was pressed, so move focus to the search field.
  const clearFilters = () => { setFilters(NO_FILTERS); search.current?.focus(); };
  // Unpinning removes the pressed button; focus the next pin, or the search field when none remain.
  const unpin = (variantId: string) => {
    const rest = pins.filter(item => item !== variantId);
    onPin(variantId);
    requestAnimationFrame(() => {
      const next = rest[Math.min(pins.indexOf(variantId), rest.length - 1)];
      (next ? document.querySelector<HTMLElement>(`[data-testid="pinned-${slug(next)}"] button`) : search.current)?.focus();
    });
  };
  const characters = [...new Set(Array.from(input.replace(/\r\n?/g, '\n')).filter(character => character !== '\n'))];
  const limit = (value: string) => /^\d+$/.test(value.trim()) ? Number(value) : null;
  // Uncategorized families (no recorded look) stay visible, marked, when a look filter is on.
  const shown = families.map((family, index) => {
    const variant = getVariant(selected[index]);
    const query = filters.query.trim().toLowerCase();
    if (query && ![family.name, ...family.variants.map(item => item.name)].some(name => name.toLowerCase().includes(query))) return null;
    const uncategorized = !variant.looks.length;
    if (filters.looks.length && !uncategorized && !filters.looks.some(look => variant.looks.includes(look))) return null;
    if (filters.supportsText) { const coverage = new Set(variant.coverage); if (characters.some(character => !coverage.has(character.codePointAt(0)!))) return null; }
    const size = previews[variant.variantId]?.input === text ? previews[variant.variantId]?.result : undefined;
    const columns = limit(filters.maxColumns), rows = limit(filters.maxRows);
    if (size && ((columns !== null && size.columns > columns) || (rows !== null && size.rows > rows))) return null;
    return { family, index, uncategorized: uncategorized && filters.looks.length > 0 };
  }).filter(item => item !== null);
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  return <section className="gallery" aria-labelledby="gallery-title">
    <div className="gallery-heading"><h2 id="gallery-title">Styles</h2><span>{families.length} families · live previews</span></div>
    {pins.length > 0 && <section className="compare" aria-labelledby="compare-title">
      <h3 id="compare-title">Compare ({pins.length})</h3>
      <div className="compare-grid">
        {pins.map(variantId => {
          const variant = getVariant(variantId);
          const preview = previews[variantId];
          return <div key={variantId} className="compare-item" data-testid={`pinned-${slug(variantId)}`}>
            <strong>{variant.name}</strong>
            <pre className="preview" aria-label={`${variant.name} comparison`} aria-busy={preview?.input !== text}>{preview?.error ? 'Preview unavailable.' : preview?.result?.text || ''}</pre>
            <div className="card-actions">
              <button aria-label={`Use ${variant.name}`} onClick={() => onUseVariant(variantId)}>Use</button>
              <button aria-label={`Unpin ${variant.name}`} onClick={() => unpin(variantId)}>Unpin</button>
            </div>
          </div>;
        })}
      </div>
    </section>}
    <div className="filters" role="search" aria-label="Find styles">
      <div className="field"><label htmlFor="style-search">Search styles</label>
        <input id="style-search" ref={search} type="search" value={filters.query} placeholder="Family or variant name" onChange={event => set({ query: event.target.value })} /></div>
      <fieldset className="slots"><legend>Look</legend>
        {Object.entries(LOOK_LABELS).map(([look, label]) => <label key={look}>
          <input type="checkbox" checked={filters.looks.includes(look)} onChange={event => set({ looks: event.target.checked ? [...filters.looks, look] : filters.looks.filter(item => item !== look) })} />{label}
        </label>)}
      </fieldset>
      <div className="timing">
        <div className="field"><label htmlFor="max-columns">Max columns</label><input id="max-columns" inputMode="numeric" value={filters.maxColumns} placeholder="Any" onChange={event => set({ maxColumns: event.target.value })} /></div>
        <div className="field"><label htmlFor="max-rows">Max rows</label><input id="max-rows" inputMode="numeric" value={filters.maxRows} placeholder="Any" onChange={event => set({ maxRows: event.target.value })} /></div>
      </div>
      <label className="toggle"><input type="checkbox" checked={filters.supportsText} onChange={event => set({ supportsText: event.target.checked })} />Supports every character in my text</label>
      <p className="hint" data-testid="filter-count" aria-live="polite">Showing {shown.length} of {families.length} families. Sizes are columns × rows for your text{truncated ? ` (first ${PREVIEW_LIMIT} characters)` : ''}. Looks come from the characters each font draws; reviewed style tags are not recorded yet.</p>
    </div>
    {truncated && <p className="gallery-note">Previews show the first {PREVIEW_LIMIT} characters. The selected style renders all of your text.</p>}
    <div className="family-grid">
      {shown.map(({ family, index, uncategorized }) => {
        const id = slug(family.familyId);
        const variant = getVariant(selected[index]);
        const preview = previews[variant.variantId];
        const active = family.familyId === activeFamilyId;
        const open = expanded.has(family.familyId);
        return <article key={family.familyId} className="family-card" data-anchor={family.familyId} data-active={active || undefined} aria-labelledby={`family-${id}`}>
          <div className="family-heading"><h3 id={`family-${id}`}>{family.name}</h3>{active && <span className="badge">In use</span>}
            <button className="favorite" aria-pressed={isFavorite(family.familyId, variant.variantId)} aria-label={`Favorite ${variant.name}`}
              onClick={() => onFavorite(family.familyId, variant.variantId)}>{isFavorite(family.familyId, variant.variantId) ? '★' : '☆'}</button></div>
          {family.variants.length > 1 && <fieldset className="variants"><legend>Variant</legend>
              {family.variants.map(item => <label key={item.variantId}>
                <input type="radio" name={`variant-${id}`} value={item.variantId} checked={item.variantId === variant.variantId} onChange={() => onVariant(family, item.variantId)} />
                <span>{item.name}</span>
              </label>)}
            </fieldset>}
          <p className="card-meta" data-testid={`meta-${id}`}>
            {preview?.input !== text ? 'Measuring…' : preview.result ? `${preview.result.columns} × ${preview.result.rows}` : 'Size unavailable'}
            {' · '}{variant.looks.length ? variant.looks.map(look => LOOK_LABELS[look]).join(', ') : 'Look not recorded'}{uncategorized ? ' (shown because its look is unknown)' : ''}
          </p>
          <pre className="preview" data-testid={`preview-${id}`} aria-label={`${variant.name} preview`} aria-busy={preview?.input !== text}>
            {preview?.error ? 'Preview unavailable.' : preview?.result?.text || ''}
          </pre>
          <div className="card-actions">
            <button aria-pressed={active} onClick={() => onUse(family)}>Use style</button>
            <button aria-expanded={open} aria-controls={`details-${id}`} onClick={() => onToggle(family)}>Details</button>
            <button aria-pressed={pins.includes(variant.variantId)} aria-label={`Pin ${variant.name}`} onClick={() => onPin(variant.variantId)}>Pin</button>
          </div>
          {<dl id={`details-${id}`} className="family-details" hidden={!open}>
            <dt>Variants</dt><dd>{family.variants.length}</dd>
            <dt>Line height</dt><dd>{variant.height} rows</dd>
            <dt>Characters</dt><dd>{variant.coverage.length} supported</dd>
            <dt>License</dt><dd><a href={variant.noticePath}>{variant.license} notice</a></dd>
          </dl>}
        </article>;
      })}
    </div>
    {!shown.length && <div className="empty" data-testid="no-results"><p>No styles match these filters.</p><button onClick={clearFilters}>Clear filters</button></div>}
    {filtered && shown.length > 0 && <button className="clear-filters" onClick={clearFilters}>Clear filters</button>}
  </section>;
}
