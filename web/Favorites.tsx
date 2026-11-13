import { getFamily, getVariant } from '../shared/catalog.ts';
import type { ReactNode } from 'react';
import type { FavoritePayload, LibraryRecord } from '../shared/library.ts';
interface FavoritesProps {
  favorites: LibraryRecord<FavoritePayload>[]; warning: string; activeVariantId: string; account: boolean;
  onApply: (favorite: FavoritePayload) => void; onRemove: (record: LibraryRecord<FavoritePayload>) => void;
  picker: (record: LibraryRecord<FavoritePayload>) => ReactNode;
}
// Favorites are style references only: applying one changes the style and keeps the current text.
export function Favorites({ favorites, warning, activeVariantId, account, onApply, onRemove, picker }: FavoritesProps) {
  return <section className="favorites" data-anchor="favorites" aria-labelledby="favorites-title">
    <h2 id="favorites-title">Favorites</h2>
    <p className="hint">{account ? 'Saved to your account.' : 'Saved in this browser only. No account needed; clearing site data removes them.'}</p>
    {warning && <p className="warning" data-testid="library-warning">{warning}</p>}
    {favorites.length ? <ul className="favorite-list">
      {favorites.map(record => {
        const name = record.payload.variantId ? getVariant(record.payload.variantId).name : getFamily(record.payload.familyId).name;
        return <li key={record.id}>
          <button aria-pressed={record.payload.variantId === activeVariantId} onClick={() => onApply(record.payload)}>{name}</button>
          <button className="remove" aria-label={`Remove ${name} from favorites`} onClick={() => onRemove(record)}>×</button>
          {picker(record)}
        </li>;
      })}
    </ul> : <p className="hint">Star a style in the gallery to keep it here.</p>}
  </section>;
}
