import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';
// Keeps one [data-anchor] element at the same viewport offset when content above or inside it changes
// height. The anchor is the element the user last touched while it is visible, otherwise the visible
// element nearest the top of the screen. With nothing in view there is no anchor, so off-screen content
// never pulls the page. Native scroll anchoring is disabled in CSS so the two cannot compete.
export function useScrollAnchor(root: RefObject<HTMLElement | null>, inset: () => number) {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let anchor: { id: string; top: number; scroll: number } | null = null;
    let touched: string | null = null;
    // WebKit scrolls the page to reveal the caret when text is inserted, even in the sticky text field. A scroll
    // in the frames after an edit is that reveal, not the user, so it does not move the anchor.
    let editing = 0;
    const edited = () => { cancelAnimationFrame(editing); editing = requestAnimationFrame(() => { editing = requestAnimationFrame(() => { editing = 0; }); }); };
    const find = (id: string) => element.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(id)}"]`);
    // Content in a sticky or fixed container does not move with the page, so it cannot anchor it.
    const pinned = (item: HTMLElement) => {
      for (let node: HTMLElement | null = item; node && node !== element; node = node.parentElement)
        if (/sticky|fixed/.test(getComputedStyle(node).position)) return true;
      return false;
    };
    const visible = (item: HTMLElement) => { const box = item.getBoundingClientRect(); return box.bottom > inset() && box.top < innerHeight && !pinned(item); };
    function record() {
      const last = touched ? find(touched) : null;
      const chosen = last && visible(last) ? last
        : [...element!.querySelectorAll<HTMLElement>('[data-anchor]')].filter(visible)
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      anchor = chosen ? { id: chosen.dataset.anchor!, top: chosen.getBoundingClientRect().top, scroll: scrollY } : null;
    }
    function restore() {
      const item = anchor && find(anchor.id);
      // Scroll events arrive a frame late. If the page scrolled since the anchor was recorded, the user (or
      // code) moved it on purpose: record the new position instead of undoing that scroll.
      if (!anchor || !item || (Math.abs(scrollY - anchor.scroll) >= 1 && !editing)) return record();
      const delta = item.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) < 1) return;
      window.scrollBy(0, delta); anchor.scroll = scrollY;
      // The page cannot scroll above its top, so there the anchor stays where it landed. Below a page that is
      // still short, the target is kept and reached as the page grows.
      if (delta < 0) anchor.top = item.getBoundingClientRect().top;
    }
    function touch(event: Event) {
      const card = (event.target as HTMLElement).closest<HTMLElement>('[data-anchor]');
      if (card && element!.contains(card)) { touched = card.dataset.anchor!; record(); }
    }
    // Mutations cover React commits before the next frame; resizes cover fonts, viewport and textarea changes.
    const observeAnchors = () => element.querySelectorAll('[data-anchor]').forEach(item => observer.observe(item));
    const mutations = new MutationObserver(() => { observeAnchors(); restore(); });
    mutations.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
    const observer = new ResizeObserver(restore);
    observer.observe(element);
    observeAnchors();
    record();
    // The scroll event for a restore arrives a frame late, after content may have moved again, so it restores
    // rather than records; restore() records when the page really was scrolled.
    addEventListener('scroll', restore, { passive: true });
    addEventListener('resize', record);
    element.addEventListener('pointerdown', touch);
    element.addEventListener('focusin', touch);
    element.addEventListener('input', edited);
    return () => {
      cancelAnimationFrame(editing); element.removeEventListener('input', edited);
      observer.disconnect(); mutations.disconnect();
      removeEventListener('scroll', restore); removeEventListener('resize', record);
      element.removeEventListener('pointerdown', touch); element.removeEventListener('focusin', touch);
    };
  }, [root, inset]);
}
