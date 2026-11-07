// Real piano size on a screen. A piano's white key is 23.5 mm wide (an
// octave, seven white keys, is 16.5 cm). A CSS pixel isn't a fixed size —
// browsers keep 96 per CSS inch whatever the screen — so how many CSS pixels
// make a real inch is guessed from the device, and the owner can check it
// once against a ruler (Review → Settings) and keep the corrected figure.

export const WHITE_KEY_MM = 23.5;
export const OCTAVE_MM = WHITE_KEY_MM * 7;

/**
 * CSS pixels per physical inch, as best the device tells. Every current
 * iPad but the mini is 264 ppi at 2× (132 CSS px an inch); the mini is
 * 326 ppi at 2× (163), told apart by its 744-wide screen. Anything else
 * starts at 132 and wants a ruler check.
 */
export function guessPxPerInch(): number {
  if (typeof window === 'undefined') return 132;
  const ua = navigator.userAgent;
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (iPad) {
    const short = Math.min(screen.width, screen.height);
    return short === 744 ? 163 : 132;
  }
  if (/iPhone/.test(ua)) return window.devicePixelRatio >= 3 ? 153 : 163;
  return 132;
}

/** A real white key's width in CSS pixels (times `scale`), from a calibrated figure if there is one. */
export function whiteKeyPx(pxPerInch: number | null, scale = 1): number {
  return ((pxPerInch ?? guessPxPerInch()) / 25.4) * WHITE_KEY_MM * scale;
}

/** White keys each voicing type spans, fewest to most (the shapes in lib/theory.ts). */
export const FAMILY_SPAN: [string, number, number][] = [
  ['right-hand rootless', 6, 8],
  ['m7b5 closed', 8, 9],
  ['drop-2 two-hand', 10, 12],
  ['m7b5 spread', 10, 12],
];
