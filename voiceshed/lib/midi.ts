'use client';

// A USB MIDI keyboard for Play mode (the owner: "support an external keyboard …
// a Lekato 88 … USB type-C to USB type-C. I want to be able to review my cards
// by playing the keyboard"). Web MIDI: Chrome on Android and desktop (Safari
// has none). One shared connection for the app; components subscribe to its
// notes. Any class-compliant keyboard works the same way.

import { useEffect, useRef, useSyncExternalStore } from 'react';

export type MidiStatus = 'unsupported' | 'off' | 'asking' | 'on' | 'denied';
export interface MidiState {
  status: MidiStatus;
  /** The keyboards plugged in now, by name. */
  inputs: string[];
}
export type MidiNote = { kind: 'on'; note: number; velocity: number } | { kind: 'off'; note: number } | { kind: 'pedal'; down: boolean };

/** Kept on the device: the owner turned the keyboard on here, so reconnect on open. */
const KEY = 'vs-midi';

const supported = () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
let state: MidiState = { status: 'off', inputs: [] };
let access: MIDIAccess | null = null;
const watchers = new Set<() => void>();
const listeners = new Set<(n: MidiNote) => void>();

function set(next: Partial<MidiState>) {
  state = { ...state, ...next };
  watchers.forEach(w => w());
}

function onMessage(e: MIDIMessageEvent) {
  const d = e.data;
  if (!d || d.length < 2) return;
  const kind = d[0] & 0xf0;
  let n: MidiNote | null = null;
  // A note-on at velocity 0 is a note-off (running status keyboards send it).
  if (kind === 0x90 && d[2] > 0) n = { kind: 'on', note: d[1], velocity: d[2] };
  else if (kind === 0x80 || kind === 0x90) n = { kind: 'off', note: d[1] };
  else if (kind === 0xb0 && d[1] === 64) n = { kind: 'pedal', down: d[2] >= 64 };
  if (n) listeners.forEach(l => l(n!));
}

/** Listen to every keyboard plugged in, now and as they come and go. */
function wire(a: MIDIAccess) {
  const names: string[] = [];
  a.inputs.forEach(input => {
    input.onmidimessage = onMessage;
    if (input.state === 'connected') names.push(input.name || 'MIDI keyboard');
  });
  set({ status: 'on', inputs: names });
}

/** Ask for MIDI (Chrome asks the person the first time). `quiet`: only if already allowed, no prompt. */
export async function connectMidi(quiet = false): Promise<void> {
  if (!supported()) return set({ status: 'unsupported' });
  if (access) return wire(access);
  if (quiet) {
    // Don't prompt on page load: only reconnect when the browser already said yes.
    try {
      const p = await navigator.permissions.query({ name: 'midi' as PermissionName });
      if (p.state !== 'granted') return;
    } catch {
      return;
    }
  }
  set({ status: 'asking' });
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
    access.onstatechange = () => access && wire(access);
    wire(access);
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
  } catch {
    set({ status: 'denied' });
  }
}

export function disconnectMidi() {
  if (access) {
    access.inputs.forEach(i => (i.onmidimessage = null));
    access.onstatechange = null;
  }
  access = null;
  set({ status: supported() ? 'off' : 'unsupported', inputs: [] });
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

/** Whether the owner turned the keyboard on here before. */
export function midiWanted(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

const subscribe = (w: () => void) => {
  watchers.add(w);
  return () => watchers.delete(w);
};
const SERVER: MidiState = { status: 'off', inputs: [] };

/** The keyboard's state; reconnects quietly when it was on here before. */
export function useMidi(): MidiState {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER);
  useEffect(() => {
    if (!supported()) set({ status: 'unsupported' });
    else if (state.status === 'off' && midiWanted()) void connectMidi(true);
  }, []);
  return s;
}

/** Every note, note-off and pedal from any keyboard, while mounted. */
export function useMidiNotes(handler: (n: MidiNote) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const l = (n: MidiNote) => ref.current(n);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}
