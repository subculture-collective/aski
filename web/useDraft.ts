import { useEffect, useReducer, useState } from 'react';
import { recoverDraft, saveDraft, historyReducer } from '../shared/draft.ts';
import { DEFAULT_COLORS, DEFAULT_LAYOUT, FONT } from '../shared/recipe.ts';
import { DEFAULT_ANIMATION } from '../shared/animation.ts';
import type { Recipe } from '../shared/recipe.ts';
export function useDraft() {
  const [initial] = useState(() => {
    const fallback: Recipe = { schemaVersion: 4, id: crypto.randomUUID(), input: 'ASKI', familyId: FONT.familyId, variantId: FONT.variantId, fontSha256: FONT.sha256, rendererVersion: FONT.rendererVersion, colors: { ...DEFAULT_COLORS }, layout: { ...DEFAULT_LAYOUT }, animation: { ...DEFAULT_ANIMATION } };
    try { return { fallback, ...recoverDraft(localStorage) }; }
    catch { return { fallback, recipe: undefined, writable: false, warning: 'Browser storage is unavailable. Keep a copy of your text.' }; }
  });
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: initial.recipe || initial.fallback, future: [] });
  const [saving, setSaving] = useState(initial.writable);
  const [warning, setWarning] = useState(initial.warning);
  const recipe = history.present;
  useEffect(() => {
    if (!saving) return;
    try { saveDraft(localStorage, recipe); }
    catch { setSaving(false); setWarning('Could not save in this browser. Your current text is still here.'); }
  }, [recipe, saving]);
  function saveCurrent() {
    try { saveDraft(localStorage, recipe); setWarning(''); setSaving(true); }
    catch { setSaving(false); setWarning('Could not save in this browser. Your current text is still here.'); }
  }
  function setRecipe(update: (previous: Recipe) => Recipe) { dispatch({ type: 'edit', recipe: update(recipe) }); }
  return { recipe, setRecipe, undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }),
    canUndo: !!history.past.length, canRedo: !!history.future.length, warning, saveCurrent };
}
