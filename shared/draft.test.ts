import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COLORS, DEFAULT_LAYOUT, FONT } from './recipe.ts';
import { DEFAULT_ANIMATION } from './animation.ts';
import { DRAFT_KEY, recoverDraft, saveDraft, historyReducer } from './draft.ts';
import type { Recipe } from './recipe.ts';
const recipe: Recipe = { schemaVersion: 4, id: '00000000-0000-4000-8000-000000000001', input: 'RECOVER\n ME', familyId: FONT.familyId, variantId: FONT.variantId, fontSha256: FONT.sha256, rendererVersion: FONT.rendererVersion, colors: { ...DEFAULT_COLORS, foreground: '#00FF66' }, layout: { spacing: 'full', width: 40, align: 'center', blocks: true }, animation: { ...DEFAULT_ANIMATION, effect: 'reveal', direction: 'left' } };
function storage(initial: string | null = null) {
  let value = initial;
  return { getItem: (key: string) => key === DRAFT_KEY ? value : null,
    setItem: (key: string, next: string) => { assert.equal(key, DRAFT_KEY); value = next; } };
}
test('a versioned draft roundtrips exact multiline input and font provenance', () => {
  const store = storage(); saveDraft(store, recipe);
  assert.deepEqual(recoverDraft(store).recipe, recipe);
  saveDraft(store, { ...recipe, input: 'x'.repeat(2001) });
  assert.equal(recoverDraft(store).recipe?.input.length, 2001);
});
test('legacy envelope and version-1 recipe migrate without rewriting storage during recovery', () => {
  const { colors: _colors, layout: _layout, animation: _animation, ...rest } = recipe; void _colors; void _layout; void _animation;
  const legacy = JSON.stringify({ schemaVersion: 1, recipe: { ...rest, schemaVersion: 1 } }); const store = storage(legacy);
  assert.deepEqual(recoverDraft(store).recipe, { ...recipe, colors: DEFAULT_COLORS, layout: DEFAULT_LAYOUT, animation: DEFAULT_ANIMATION });
  assert.equal(store.getItem(DRAFT_KEY), legacy);
});
test('corrupt, future and invalid-font drafts are retained rather than silently replaced', () => {
  for (const original of ['{bad', JSON.stringify({ schemaVersion: 99, recipe }), JSON.stringify({ schemaVersion: 2, recipe: { ...recipe, fontSha256: 'drift' } })]) {
    const store = storage(original); const result = recoverDraft(store);
    assert.equal(result.writable, false); assert(result.warning); assert.equal(result.recipe, undefined);
    assert.equal(store.getItem(DRAFT_KEY), original);
  }
});
test('storage security/quota failures are reported without changing active recipe', () => {
  const store = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Quota'); } };
  assert.equal(recoverDraft(store).writable, false);
  assert.throws(() => saveDraft(store, recipe), /Quota/);
  assert.equal(recipe.input, 'RECOVER\n ME');
});
test('undo/redo restores complete recipes and a new edit invalidates redo', () => {
  const start = { past: [], present: recipe, future: [] };
  const edited = historyReducer(start, { type: 'edit', recipe: { ...recipe, input: 'NEW' } });
  const undone = historyReducer(edited, { type: 'undo' });
  assert.deepEqual(undone.present, recipe);
  assert.equal(historyReducer(undone, { type: 'redo' }).present.input, 'NEW');
  const branched = historyReducer(undone, { type: 'edit', recipe: { ...recipe, input: 'OTHER' } });
  assert.equal(branched.future.length, 0);
  assert.equal(historyReducer(start, { type: 'edit', recipe }).past.length, 0);
});
