import { useState } from 'react';
import { families, getVariant } from '../../shared/catalog.ts';
import type { FontFamily, FontVariant } from '../../shared/catalog.ts';
import { colorize } from '../../shared/color.ts';
import { DEFAULT_COLORS } from '../../shared/recipe.ts';
import type { Colors } from '../../shared/recipe.ts';
import { usePreviews } from '../usePreviews.ts';
import type { Preview } from '../usePreviews.ts';
import { LOOK_LABELS } from '../Gallery.tsx';

export const DEFAULT_SAMPLE = 'hello';
const MASTHEAD_TEXT = 'aski';
const MASTHEAD_FAMILY = families.find(family => family.name === 'Classy') ?? families[0];
const MASTHEAD_COLORS: Colors = { ...DEFAULT_COLORS, foreground: '#D4FF60', shadow: '#C4B1FF' };
const looksOf = (family: FontFamily) => [...new Set(family.variants.flatMap(variant => variant.looks))];
const LOOKS = Object.keys(LOOK_LABELS).filter(look => families.some(family => looksOf(family).includes(look)));

// Rendered rows above and below the lettering are blank in many FIGlet fonts; drop them for display and copying.
function trimRows(text: string) {
  const rows = text.split('\n').map(row => row.trimEnd());
  while (rows.length && !rows[0]) rows.shift();
  while (rows.length && !rows.at(-1)) rows.pop();
  return rows.join('\n');
}

function Art({ preview, font, label, colors = DEFAULT_COLORS }: { preview?: Preview; font: FontVariant; label: string; colors?: Colors }) {
  if (!preview?.result) return <pre className="art pending">{preview?.error || 'Drawing…'}</pre>;
  const text = trimRows(preview.result.text);
  return <pre className="art" role="img" aria-label={label} tabIndex={0}>
    {colorize(text, font).map((run, index) => run.slot ? <span key={index} style={{ color: colors[run.slot] }}>{run.text}</span> : run.text)}
  </pre>;
}

export function MastheadArt() {
  const font = getVariant(MASTHEAD_FAMILY.defaultVariantId);
  const { previews } = usePreviews(MASTHEAD_TEXT, [font.variantId]);
  return <Art preview={previews[font.variantId]} font={font} colors={MASTHEAD_COLORS} label={`“${MASTHEAD_TEXT}” in ${font.name} lettering`} />;
}

export function Specimens() {
  const [sample, setSample] = useState('');
  const [look, setLook] = useState('');
  const [status, setStatus] = useState('');
  const text = sample.trim() ? sample : DEFAULT_SAMPLE;
  const { previews } = usePreviews(text, families.map(family => family.defaultVariantId));
  const shown = families.filter(family => !look || looksOf(family).includes(look));
  async function copy(family: FontFamily) {
    const result = previews[family.defaultVariantId]?.result;
    if (!result) return;
    try { await navigator.clipboard.writeText(trimRows(result.text)); setStatus(`Copied ${family.name}.`); }
    catch { setStatus('Copying is blocked here. Select the lettering and copy it by hand.'); }
  }
  function choose(next: string) {
    setLook(next);
    const count = families.filter(family => !next || looksOf(family).includes(next)).length;
    setStatus(next ? `Showing ${count} of ${families.length} families with ${LOOK_LABELS[next].toLowerCase()}.` : `Showing all ${families.length} families.`);
  }
  return <>
    <div className="tools">
      <h2 id="book-heading">The families</h2>
      <fieldset className="filter"><legend>Look</legend>
        <button type="button" className="btn" aria-pressed={!look} onClick={() => choose('')}>All</button>
        {LOOKS.map(item => <button key={item} type="button" className="btn" aria-pressed={look === item} onClick={() => choose(item)}>{LOOK_LABELS[item]}</button>)}
      </fieldset>
      <div className="sample"><label htmlFor="sample">Sample text</label>
        <input id="sample" type="text" maxLength={60} value={sample} placeholder={DEFAULT_SAMPLE} autoComplete="off" spellCheck={false} onChange={event => setSample(event.target.value)} />
      </div>
    </div>
    <p className="status" role="status">{status}</p>
    {shown.map(family => {
      const font = getVariant(family.defaultVariantId);
      const preview = previews[font.variantId];
      const missing = preview?.result?.unsupported ?? [];
      const id = 'family-' + family.familyId.replace(/\W+/g, '-');
      return <article className="row" key={family.familyId} aria-labelledby={id}>
        <div className="meta">
          <h3 id={id}>{family.name}</h3>
          <dl>
            <dt>Look</dt><dd>{looksOf(family).map(item => LOOK_LABELS[item]).join(', ') || 'Not recorded'}</dd>
            <dt>Height</dt><dd>{font.height} {font.height === 1 ? 'row' : 'rows'}</dd>
            <dt>Variants</dt><dd>{family.variants.length > 1 ? family.variants.map(variant => variant.name).join(', ') : '1'}</dd>
            <dt>Characters</dt><dd>{font.coverage.length}</dd>
            <dt>License</dt><dd>{font.license}</dd>
          </dl>
          <button type="button" className="btn" disabled={!preview?.result} onClick={() => copy(family)}>Copy text</button>
        </div>
        <div className="specimen">
          <Art preview={preview} font={font} label={`“${text.trim()}” in ${family.name} lettering`} />
          {missing.length > 0 && <p className="miss">{family.name} has no {missing.map(character => character === ' ' ? 'space' : character).join(' ')}.</p>}
        </div>
      </article>;
    })}
  </>;
}
