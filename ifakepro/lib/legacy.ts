// The cell grid iReal Pro itself uses, and the shape charts were stored in
// before bars became timelines (chart v1). iReal lays a chart out 16 cells to
// a row; a bar owns a run of cells (four, usually) and each cell holds one
// chord or nothing. Only the iReal reader and writer (ireal.ts) and the
// conversion to and from timed events (convert.ts) work in cells now.

/** The barline a bar opens with. Unset: none drawn (start of chart, or after a ] } Z). */
export type OpenBar = '|' | '[' | '{';
/** The barline a bar closes with when it's more than a plain |. */
export type CloseBar = ']' | '}' | 'Z';
/** x: repeat last bar · r: repeat last two bars · p: slash · n: N.C. */
export type CellSym = 'x' | 'r' | 'p' | 'n';

export interface Cell {
  /** A chord in iReal spelling: C-7, Bb^7, F#h7, Eb7b9/G, W/C. */
  ch?: string;
  sym?: CellSym;
  /** An alternate chord, written small above. */
  alt?: string;
  small?: boolean;
  /** A text annotation, e.g. "D.C. al Coda". iReal may prefix *NN (its height). */
  text?: string;
  fermata?: boolean;
  segno?: boolean;
  coda?: boolean;
  /** iReal's U: where playback ends. Kept so export loses nothing. */
  end?: boolean;
}

/** What a bar carries besides its music: barlines, rehearsal marks, layout. Shared by both models. */
export interface BarFrame {
  id: string;
  open?: OpenBar;
  close?: CloseBar;
  /** Rehearsal mark: A B C D, i (intro), V (verse). */
  section?: string;
  /** Time signature change, "4/4", "3/4", "12/8". */
  time?: string;
  /** Ending number (N1, N2, N3). */
  ending?: number;
  /** Empty cells before the bar, from iReal's layout (e.g. a 2nd ending indented under the 1st). */
  spacer?: number;
  /** Extra vertical space before the bar's row (iReal's Y). */
  vspace?: number;
  /** Start a new row here. Set in the editor; iReal itself has no such mark. */
  br?: boolean;
}

export interface CellBar extends BarFrame {
  cells: Cell[];
}

export interface CellChart {
  v: 1;
  bars: CellBar[];
}

export function isBlankCell(c: Cell): boolean {
  return !c.ch && !c.sym;
}
