// The voicing trainer's records, as the device keeps them (IndexedDB) and the
// API sends them. Field names follow the database columns.

import type { Quality } from './theory';

export type Mode = 'play' | 'spell' | 'name';
export const MODES: Mode[] = ['play', 'spell', 'name'];
export const MODE_LABEL: Record<Mode, string> = { play: 'Play', spell: 'Spell', name: 'Name' };

export type ContextType = 'isolated' | 'progression' | 'tune';

export interface Voicing {
  id: string;
  chord_label: string;
  root: number;
  quality: Quality;
  /** Spelled, bottom to top, with octave: ["F3", "Ab3", "C4", "Eb4"]. */
  notes: string[];
  top_note: string;
  family: string;
  tags: string[];
  /** MIDI number of the lowest note this voicing's bottom may sit on, or null. */
  lowest_register: number | null;
  notes_text: string | null;
  sort_order: number;
  updated_at: string;
}

export interface ContextStep {
  symbol: string;
  root: number;
  quality: Quality;
  /** A voicing pinned to this step; null picks one by voice leading. */
  voicing_id: string | null;
}

export interface Context {
  id: string;
  type: 'progression' | 'tune';
  name: string;
  key: number;
  tune_id: string | null;
  steps: ContextStep[];
  sort_order: number;
}

export interface Attempt {
  id: string;
  voicing_id: string;
  mode: Mode;
  context_type: ContextType;
  context_id: string | null;
  run_id: string | null;
  correct: boolean;
  /** Right but over its target time. */
  slow: boolean;
  response_ms: number;
  created_at: string;
  /** Device only: sent to the server yet. */
  synced: boolean;
  /** Device only: answered while not signed in as the owner, never sent. */
  local_only?: boolean;
}

export interface SrsState {
  voicing_id: string;
  mode: Mode;
  ease: number;
  /** Days. 0 while learning. */
  interval_days: number;
  due_at: string;
  /** Per-card target; null takes the mode's default. */
  target_ms: number | null;
  learned: boolean;
  reps: number;
  lapses: number;
  created_at: string;
  updated_at: string;
  /** Device only: changed here and not yet sent. */
  dirty?: boolean;
}

export interface Run {
  id: string;
  /** Same set, same key: runs to compare. */
  set_key: string;
  set_label: string;
  mode: Mode;
  context_type: ContextType;
  started_at: string;
  finished_at: string;
  cards: number;
  correct: number;
  avg_ms: number;
  slow: number;
  synced: boolean;
  local_only?: boolean;
}

export interface Tune {
  id: string;
  title: string;
  composer: string | null;
  home_key: number;
  is_minor: boolean;
  /** Chart symbols in order, a repeated chord in the next bar written once. */
  chords: string[];
}

export interface Settings {
  /** Default target per mode, ms. */
  target_ms: Record<Mode, number>;
  new_per_day: number;
  review_modes: Mode[];
  /** Spell mode: Ab and G# are different answers. */
  strict_spelling: boolean;
  /** Play mode's keyboard: as many keys as fit, or keys a real piano's width (lib/scale.ts). */
  keyboard_size: 'fit' | 'real';
  /** CSS pixels per real inch, once checked against a ruler; null guesses from the device. */
  px_per_inch: number | null;
  /** Real size, scaled: 1 is a piano's own keys; less fits more of them on the screen. */
  key_scale: number;
}

export const DEFAULT_SETTINGS: Settings = {
  target_ms: { play: 2000, spell: 2000, name: 2000 },
  new_per_day: 15,
  review_modes: ['play', 'spell', 'name'],
  strict_spelling: false,
  keyboard_size: 'fit',
  px_per_inch: null,
  key_scale: 1,
};

export const srsKey = (voicingId: string, mode: Mode) => `${voicingId}|${mode}`;
