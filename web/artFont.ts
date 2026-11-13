import { ART_FONT } from '../shared/image.ts';
let loading: Promise<void> | null = null;
// Canvas text uses only faces that have finished loading, so image and GIF exports wait for aski Art Mono
// first. Pages load it through art-font.css; a worker has no stylesheet and adds the face itself. If it
// cannot load, drawing continues with the system monospace fonts later in FONT_STACK.
export function loadArtFont(): Promise<void> {
  loading ??= (async () => {
    if (typeof document !== 'undefined') { await document.fonts.load(`16px "${ART_FONT.family}"`); return; }
    const fonts = (self as unknown as { fonts?: FontFaceSet }).fonts;
    if (!fonts || typeof FontFace === 'undefined') return;
    const face = new FontFace(ART_FONT.family, `url(${new URL(ART_FONT.path, self.location.origin).href})`);
    fonts.add(face);
    await face.load();
  })().catch(() => undefined);
  return loading;
}
