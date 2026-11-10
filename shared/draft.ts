import { parseRecipe } from './recipe.ts';
import type { RecipeV1 } from './recipe.ts';
export const DRAFT_KEY = 'aski:draft';
type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>;
export interface Recovery { recipe?: RecipeV1; writable: boolean; warning: string }
function parseEditableRecipe(value: unknown): RecipeV1 {
  if (!value || typeof value !== 'object' || !('input' in value) || typeof value.input !== 'string' || value.input.length > 100_000) throw new Error('Invalid draft text');
  // Keep temporarily over-limit editor text; rendering still applies MAX_INPUT.
  return { ...parseRecipe({ ...value, input: '' }), input: value.input };
}
export function recoverDraft(storage: Pick<DraftStorage, 'getItem'>): Recovery {
  try {
    const raw = storage.getItem(DRAFT_KEY);
    if (raw === null) return { writable: true, warning: '' };
    const value = JSON.parse(raw);
    if (!value || (value.schemaVersion !== 1 && value.schemaVersion !== 2)) throw new Error('Unsupported draft');
    return { recipe: parseEditableRecipe(value.recipe), writable: true, warning: '' };
  } catch {
    return { writable: false, warning: 'Could not recover the saved draft. It has been kept. Save this draft to replace it.' };
  }
}
export function saveDraft(storage: Pick<DraftStorage, 'setItem'>, recipe: RecipeV1) {
  storage.setItem(DRAFT_KEY, JSON.stringify({ schemaVersion: 2, recipe: parseEditableRecipe(recipe), updatedAt: new Date().toISOString() }));
}
export interface DraftHistory { past: RecipeV1[]; present: RecipeV1; future: RecipeV1[] }
export type HistoryAction = { type: 'edit'; recipe: RecipeV1 } | { type: 'undo' | 'redo' };
export function historyReducer(state: DraftHistory, action: HistoryAction): DraftHistory {
  if (action.type === 'undo') {
    if (!state.past.length) return state;
    return { past: state.past.slice(0, -1), present: state.past.at(-1)!, future: [state.present, ...state.future] };
  }
  if (action.type === 'redo') {
    if (!state.future.length) return state;
    return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
  }
  if ('recipe' in action && JSON.stringify(state.present) !== JSON.stringify(action.recipe)) {
    return { past: [...state.past, state.present].slice(-100), present: action.recipe, future: [] };
  }
  return state;
}
