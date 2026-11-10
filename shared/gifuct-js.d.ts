// Minimal types for gifuct-js@2.1.2, used only by tests to decode exported GIFs.
declare module 'gifuct-js' {
  export interface ParsedFrame { delay: number; disposalType: number; transparentIndex?: number; dims: { width: number; height: number; top: number; left: number }; patch: Uint8ClampedArray }
  export interface ParsedGif { frames: ({ application: { id: string } } | object)[] }
  export function parseGIF(buffer: ArrayBuffer): ParsedGif;
  export function decompressFrames(gif: ParsedGif, buildImagePatches: boolean): ParsedFrame[];
}
