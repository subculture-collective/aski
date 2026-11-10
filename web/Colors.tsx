import { useEffect, useRef, useState } from 'react';
import { DEFAULT_COLORS, parseColor } from '../shared/recipe.ts';
import type { Colors as ColorMap, Slot } from '../shared/recipe.ts';
import type { LibraryRecord, PalettePayload } from '../shared/library.ts';
export const SWATCHES = ['#211B30', '#FFFFFF', '#F1ECFF', '#C4B1FF', '#6330B5', '#D4FF60', '#000000', '#00FF66', '#FF4D6D', '#FFB000', '#3A86FF', '#7A7A7A'];
export const PRESETS: { name: string; colors: ColorMap }[] = [
  { name: 'Lilac', colors: DEFAULT_COLORS },
  { name: 'Terminal', colors: { foreground: '#00FF66', background: '#000000', shadow: '#007A33', highlight: '#B3FFD1' } },
  { name: 'Night', colors: { foreground: '#F1ECFF', background: '#211B30', shadow: '#6330B5', highlight: '#D4FF60' } },
  { name: 'Paper', colors: { foreground: '#000000', background: '#FFF8E7', shadow: '#7A7A7A', highlight: '#FFB000' } },
];
// The native picker fires input events while dragging; only its final change becomes an undo step.
function PickColor({ value, label, onPick }: { value: string; label: string; onPick: (value: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const latest = useRef(onPick);
  useEffect(() => { latest.current = onPick; });
  useEffect(() => {
    const element = ref.current!;
    const listener = () => latest.current(element.value);
    element.addEventListener('change', listener);
    return () => element.removeEventListener('change', listener);
  }, []);
  return <input ref={ref} type="color" aria-label={label} defaultValue={value.toLowerCase()} />;
}
const LABELS: Record<Slot, string> = { foreground: 'Foreground', background: 'Background', shadow: 'Shadow', highlight: 'Highlight' };
interface ColorsProps {
  slots: Slot[]; colors: ColorMap; palettes: LibraryRecord<PalettePayload>[];
  onChange: (colors: ColorMap) => void; onSavePalette: (name: string) => void; onDeletePalette: (record: LibraryRecord<PalettePayload>) => void;
}
// Slot controls show only the slots the selected font supports. Every change is one recipe edit.
export function Colors({ slots, colors, palettes, onChange, onSavePalette, onDeletePalette }: ColorsProps) {
  const [chosen, setChosen] = useState<Slot>('foreground');
  const slot = slots.includes(chosen) ? chosen : 'foreground';
  const [custom, setCustom] = useState('');
  const [message, setMessage] = useState('');
  const [paletteName, setPaletteName] = useState('');
  const assign = (value: string) => { onChange({ ...colors, [slot]: value }); setMessage(''); };
  return <section className="colors" aria-labelledby="colors-title">
    <h2 id="colors-title">Colors</h2>
    <fieldset className="slots"><legend>Slot</legend>
      {slots.map(item => <label key={item}>
        <input type="radio" name="color-slot" value={item} checked={item === slot} onChange={() => { setChosen(item); setMessage(''); }} />
        <span className="chip" style={{ background: colors[item] }} aria-hidden="true" />{LABELS[item]} <code>{colors[item]}</code>
      </label>)}
    </fieldset>
    <div className="swatches" role="group" aria-label={`Swatches for ${LABELS[slot]}`}>
      {SWATCHES.map(swatch => <button key={swatch} aria-label={swatch} aria-pressed={colors[slot] === swatch} style={{ background: swatch }} onClick={() => assign(swatch)} />)}
    </div>
    <form className="custom-color" onSubmit={event => {
      event.preventDefault();
      try { assign(parseColor(custom)); setCustom(''); } catch (error) { setMessage((error as Error).message); }
    }}>
      <label htmlFor="custom-color">Custom {LABELS[slot].toLowerCase()} color</label>
      <div><input id="custom-color" value={custom} placeholder="#RRGGBB" spellCheck={false} autoCapitalize="off" onChange={event => setCustom(event.target.value)} />
        <PickColor key={`${slot}${colors[slot]}`} value={colors[slot]} label={`Pick ${LABELS[slot].toLowerCase()} color`} onPick={value => assign(parseColor(value))} />
        <button type="submit">Apply</button></div>
    </form>
    {message && <p className="item-note" role="alert">{message}</p>}
    <div className="presets" role="group" aria-label="Palette presets">
      {PRESETS.map(preset => <button key={preset.name} onClick={() => onChange({ ...preset.colors })}>{preset.name}</button>)}
      <button onClick={() => onChange({ ...DEFAULT_COLORS })}>Reset colors</button>
    </div>
    <form className="save-palette" onSubmit={event => { event.preventDefault(); onSavePalette(paletteName.trim() || `Palette ${palettes.length + 1}`); setPaletteName(''); }}>
      <label htmlFor="palette-name">Palette name</label>
      <div><input id="palette-name" value={paletteName} maxLength={120} onChange={event => setPaletteName(event.target.value)} /><button type="submit">Save palette</button></div>
    </form>
    {palettes.length > 0 && <ul className="favorite-list" aria-label="Saved palettes">
      {palettes.map(record => <li key={record.id}>
        <button onClick={() => onChange({ ...record.payload.slots })}>
          <span className="palette-strip" aria-hidden="true">{slots.map(item => <span key={item} style={{ background: record.payload.slots[item] }} />)}</span>{record.payload.name}
        </button>
        <button className="remove" aria-label={`Delete palette ${record.payload.name}`} onClick={() => onDeletePalette(record)}>×</button>
      </li>)}
    </ul>}
  </section>;
}
