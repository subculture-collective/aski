import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';
// Keeps one [data-anchor] element at the same viewport offset when content above or inside it changes
// height. The anchor is the element the user last touched while it is visible, otherwise the first
// element below the sticky inset. Native scroll anchoring is disabled in CSS so the two cannot compete.
export function useScrollAnchor(root: RefObject<HTMLElement | null>, inset: () => number) {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let anchor: { id: string; top: number } | null = null;
    let touched: string | null = null;
    const find = (id: string) => element.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(id)}"]`);
    const visible = (item: HTMLElement) => { const box = item.getBoundingClientRect(); return box.bottom > inset() && box.top < innerHeight; };
    function record() {
      const last = touched ? find(touched) : null;
      const chosen = last && visible(last) ? last
        : [...element!.querySelectorAll<HTMLElement>('[data-anchor]')].find(item => item.getBoundingClientRect().bottom > inset());
      anchor = chosen ? { id: chosen.dataset.anchor!, top: chosen.getBoundingClientRect().top } : null;
    }
    function restore() {
      const item = anchor && find(anchor.id);
      if (!anchor || !item) return record();
      const delta = item.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) >= 1) window.scrollBy(0, delta);
    }
    function touch(event: Event) {
      const card = (event.target as HTMLElement).closest<HTMLElement>('[data-anchor]');
      if (card && element!.contains(card)) { touched = card.dataset.anchor!; record(); }
    }
    // Mutations cover React commits before the next frame; resizes cover fonts, viewport and textarea changes.
    const mutations = new MutationObserver(restore);
    mutations.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
    const observer = new ResizeObserver(restore);
    observer.observe(element);
    element.querySelectorAll('[data-anchor]').forEach(item => observer.observe(item));
    record();
    addEventListener('scroll', record, { passive: true });
    addEventListener('resize', record);
    element.addEventListener('pointerdown', touch);
    element.addEventListener('focusin', touch);
    return () => {
      observer.disconnect(); mutations.disconnect();
      removeEventListener('scroll', record); removeEventListener('resize', record);
      element.removeEventListener('pointerdown', touch); element.removeEventListener('focusin', touch);
    };
  }, [root, inset]);
}
