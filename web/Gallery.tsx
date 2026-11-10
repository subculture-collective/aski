import { families, getVariant } from '../shared/catalog.ts';
import type { FontFamily } from '../shared/catalog.ts';
import { PREVIEW_LIMIT, usePreviews } from './usePreviews.ts';
const slug = (id: string) => id.replace(/[^a-z\d]+/gi, '-');
interface GalleryProps {
  input: string; activeFamilyId: string; variantFor: (family: FontFamily) => string;
  expanded: ReadonlySet<string>; onVariant: (family: FontFamily, variantId: string) => void;
  onUse: (family: FontFamily) => void; onToggle: (family: FontFamily) => void;
}
export function Gallery({ input, activeFamilyId, variantFor, expanded, onVariant, onUse, onToggle }: GalleryProps) {
  const selected = families.map(variantFor);
  const { previews, text, truncated } = usePreviews(input, selected);
  return <section className="gallery" aria-labelledby="gallery-title">
    <div className="gallery-heading"><h2 id="gallery-title">Styles</h2><span>{families.length} families · live previews</span></div>
    {truncated && <p className="gallery-note">Previews show the first {PREVIEW_LIMIT} characters. The selected style renders all of your text.</p>}
    <div className="family-grid">
      {families.map((family, index) => {
        const id = slug(family.familyId);
        const variant = getVariant(selected[index]);
        const preview = previews[variant.variantId];
        const active = family.familyId === activeFamilyId;
        const open = expanded.has(family.familyId);
        return <article key={family.familyId} className="family-card" data-anchor={family.familyId} data-active={active || undefined} aria-labelledby={`family-${id}`}>
          <div className="family-heading"><h3 id={`family-${id}`}>{family.name}</h3>{active && <span className="badge">In use</span>}</div>
          {family.variants.length > 1 && <fieldset className="variants"><legend>Variant</legend>
              {family.variants.map(item => <label key={item.variantId}>
                <input type="radio" name={`variant-${id}`} value={item.variantId} checked={item.variantId === variant.variantId} onChange={() => onVariant(family, item.variantId)} />
                <span>{item.name}</span>
              </label>)}
            </fieldset>}
          <pre className="preview" data-testid={`preview-${id}`} aria-label={`${variant.name} preview`} aria-busy={preview?.input !== text}>
            {preview?.error ? 'Preview unavailable.' : preview?.result?.text || ''}
          </pre>
          <div className="card-actions">
            <button aria-pressed={active} onClick={() => onUse(family)}>Use style</button>
            <button aria-expanded={open} aria-controls={`details-${id}`} onClick={() => onToggle(family)}>Details</button>
          </div>
          {open && <dl id={`details-${id}`} className="family-details">
            <dt>Variants</dt><dd>{family.variants.length}</dd>
            <dt>Line height</dt><dd>{variant.height} rows</dd>
            <dt>Characters</dt><dd>{variant.coverage.length} supported</dd>
            <dt>License</dt><dd><a href={variant.noticePath}>{variant.license} notice</a></dd>
          </dl>}
        </article>;
      })}
    </div>
  </section>;
}
