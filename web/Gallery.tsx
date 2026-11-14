import { useRef, useState } from 'react';
import { families, getVariant } from '../shared/catalog.ts';
import type { FontFamily } from '../shared/catalog.ts';
import { PREVIEW_LIMIT, usePreviews } from './usePreviews.ts';
import { Icon } from './Icon.tsx';
import type { CSSProperties } from 'react';
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
// The rows from the first to the last that contain more than spaces.
function inkedRows(text: string) {
  const rows = text.replace(/\n$/, '').split('\n');
  const first = rows.findIndex(row => row.trim());
  let last = rows.length - 1;
  while (last > first && !rows[last].trim()) last--;
  return first < 0 ? [] : rows.slice(first, last + 1);
}
export function Gallery({ input, activeFamilyId, variantFor, expanded, onVariant, onUse, onToggle, isFavorite, onFavorite, pins, onPin, onUseVariant }: GalleryProps) {
  const selected = families.map(variantFor);
  // Pinned variants render through the same preview queue, after the cards' own variants.
  const { previews, text, truncated } = usePreviews(input, [...new Set([...selected, ...pins])]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  // Filters other than the search field, shown on the toggle so a closed panel never hides an active filter.
  const activeFilters = filters.looks.length + (filters.supportsText ? 1 : 0) + (filters.maxColumns ? 1 : 0) + (filters.maxRows ? 1 : 0);
  return <section className="gallery" aria-labelledby="gallery-title">
    <div className="gallery-heading"><h2 id="gallery-title">Styles</h2>
      <div className="filters" role="search" aria-label="Find styles">
        <label htmlFor="style-search" className="visually-hidden">Search styles</label>
        <span className="search-icon" aria-hidden="true"><Icon name="search" /></span>
        <input id="style-search" ref={search} type="search" value={filters.query} placeholder="Search styles" onChange={event => set({ query: event.target.value })} />
        <button className="secondary" aria-expanded={filtersOpen} aria-controls="filter-options" onClick={() => setFiltersOpen(value => !value)}>Filters{activeFilters ? ` (${activeFilters})` : ''}<Icon name="chevron" /></button>
      </div>
      {/* The count replaces the hint once a search or filter narrows the list. */}
      <span data-testid="filter-count" aria-live="polite">{filtered ? `Showing ${shown.length} of ${families.length} families` : ''}</span>
    </div>
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
    <div id="filter-options" className="filter-options" role="group" aria-label="Filters" hidden={!filtersOpen}>
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
      <p className="hint">Sizes are columns × rows for your text{truncated ? ` (first ${PREVIEW_LIMIT} characters)` : ''}. Looks come from the characters each font draws.</p>
    </div>
    {truncated && <p className="gallery-note">Previews show the first {PREVIEW_LIMIT} characters. The selected style renders all of your text.</p>}
    <div className="family-grid">
      {shown.map(({ family, index, uncategorized }) => {
        const id = slug(family.familyId);
        const variant = getVariant(selected[index]);
        const preview = previews[variant.variantId];
        const inked = inkedRows(preview?.result?.text || '');
        const active = family.familyId === activeFamilyId;
        const open = expanded.has(family.familyId);
        // The name button covers the whole card, so a click anywhere selects the style. The star, the variant
        // menu and the "more" menu sit above it.
        const favorite = isFavorite(family.familyId, variant.variantId);
        return <article key={family.familyId} className="family-card" data-anchor={family.familyId} data-active={active || undefined} data-favorite={favorite || undefined} aria-labelledby={`family-${id}`}>
          <div className="family-heading">
            <h3 id={`family-${id}`} title={family.name}><button className="card-select" aria-pressed={active} aria-label={`Use ${family.name}`} onClick={() => onUse(family)}>{family.name}</button></h3>
            <button className="favorite" aria-pressed={isFavorite(family.familyId, variant.variantId)} aria-label={`Favorite ${variant.name}`}
              onClick={() => onFavorite(family.familyId, variant.variantId)}><Icon name="star" filled={isFavorite(family.familyId, variant.variantId)} /></button>
            <details className="menu card-menu">
              <summary aria-label={`More for ${family.name}`}><Icon name="more" /></summary>
              <div className="exports">
                {family.variants.length > 1 && <label className="field">Variant
                  <select className="variant-select" aria-label={`${family.name} variant`} value={variant.variantId} onChange={event => onVariant(family, event.target.value)}>
                    {family.variants.map(item => <option key={item.variantId} value={item.variantId}>{item.name}</option>)}
                  </select></label>}
                <button aria-pressed={pins.includes(variant.variantId)} aria-label={`Pin ${variant.name}`} onClick={() => onPin(variant.variantId)}><Icon name="pin" />{pins.includes(variant.variantId) ? 'Unpin from compare' : 'Pin to compare'}</button>
                <button aria-expanded={open} aria-controls={`details-${id}`} onClick={() => onToggle(family)}>Details</button>
              </div>
            </details>
          </div>
          {/* Each preview is scaled to fit its box from its own columns and the rows that hold ink: blank
              rows above and below the lettering are left out of the preview, not out of the copied text. */}
          <pre className="preview" data-testid={`preview-${id}`} aria-label={`${variant.name} preview`} aria-busy={preview?.input !== text} data-blocks={variant.blocks || undefined}
            style={{ '--cols': preview?.result?.columns || 1, '--rows': inked.length || 1, '--base': inked.length <= 1 ? '34px' : inked.length <= 2 ? '26px' : '16px' } as CSSProperties}>
            {preview?.error ? 'Preview unavailable.' : inked.join('\n')}
          </pre>
          <p className="card-meta" data-testid={`meta-${id}`} hidden={!open && !activeFilters}>
            {preview?.input !== text ? 'Measuring…' : preview.result ? `${preview.result.columns} × ${preview.result.rows}` : 'Size unavailable'}
            {' · '}{variant.looks.length ? variant.looks.map(look => LOOK_LABELS[look]).join(', ') : 'Look not recorded'}{uncategorized ? ' (shown because its look is unknown)' : ''}
          </p>
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
