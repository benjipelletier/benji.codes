import 'server-only';
// Voice edits: someone with edit rights talks ("on bar 4, change the D7 to
// C6") and the chart changes as they speak. The phone's speech recognition
// turns their voice into text in the browser; this reads the text so far
// against the chart and hands back edits in the language AI agents use
// (lib/script.ts), which the page previews as they speak and saves when
// they say keep it (voice/apply). Nothing is saved before then.
//
// The model is Claude Haiku (IFAKEPRO_VOICE_MODEL, default claude-haiku-5-5,
// the model 重复习's lookups run on) at low effort: it's called every second
// or so while someone talks, so it has to be quick and cheap. The key is
// IFAKEPRO_ANTHROPIC_API_KEY, else the site's ANTHROPIC_API_KEY, else 重复习's.

import Anthropic from '@anthropic-ai/sdk';
import { HttpError } from '@ifakepro/lib/session';
import { BAR_TEXT, CHART_LEGEND, OPS } from '@ifakepro/lib/brief';
import { type Doc, applyOps, changes, chartText } from '@ifakepro/lib/script';
import type { VoiceResult } from '@ifakepro/lib/types';

export const VOICE_MODEL = process.env.IFAKEPRO_VOICE_MODEL || 'claude-haiku-5-5';
/** What a voice edit is called in the history and the edit log, on its pill. */
export const VOICE_AGENT = 'Voice';
/** Longest a transcript may be: a few sentences. */
export const MAX_TRANSCRIPT = 600;

const SYSTEM = `You turn what a musician says out loud into edits of a lead sheet (a chord chart) in iFake Pro. They are looking at the chart and talking: "on bar 4, change the D7 to C6", "make bars 9 to 12 a two five one in F", "put a rest on beat 3 of bar 7", "add a repeat around the bridge". You get the chart and the transcript of what they've said so far, and answer with the bars they're talking about and the edits.

The transcript comes from speech recognition, live, so:
- It may stop mid-sentence. Make the edits that are already clear; leave out one that isn't finished yet ("change the D7 to" has no target yet) and set unfinished. Never guess the end of a sentence.
- Words come out as heard: numbers as words or homophones ("bar for", "bar to", "bar ate" mean 4, 2, 8), note names as letters or sounds ("see" C, "be" B, "a" A, "E flat", "B flat", "F sharp"). Chords are spoken: "C six" C6, "D seven" D7, "B flat major seven" Bbmaj7, "D minor seven" Dm7, "F sharp half diminished" F#m7b5, "G seven flat nine" G7b9, "C over E" C/E, "two five one in F" Gm7 C7 Fmaj7.
- They correct themselves ("no wait, C seven", "scratch that", "actually bar 5"): the transcript is everything said, so answer with what they mean by the end. A later instruction replaces an earlier one about the same bars.
- It's all one request: answer with every edit it asks for, not just the latest.

How the chart reads:
${CHART_LEGEND}

${BAR_TEXT}

The edits are ops, each one a JSON object written as a string in the ops list:
${OPS}

Every bar number means the chart as shown, even after an insert in the same answer. Use the smallest op that does what they said: changing one chord in a bar is a put at that chord's beat, or chords on that bar with the rest of it as it was; don't rewrite bars they didn't mention. If they name a chord that isn't in the bar ("change the D7" in a bar with no D7), go by the bar they named and change what's there, unless the chord they named is in a nearby bar they might mean, in which case change nothing and say so in summary.

Answer with:
- heard: what they said, tidied into one plain sentence of instructions ("Bar 4: change D7 to C6.").
- focus: the bar numbers the latest words are about, even before an edit is clear ("on bar 4…" gives [4]); [] when none.
- ops: the edits, each as a JSON string; [] when nothing is clear yet.
- summary: one short line per change, by bar, before → after ("Bar 4: D7 → C6", "Bars 9–12: Gm7 | C7 | Fmaj7 | Fmaj7", "Key: C → Eb"); or a line saying what's unclear.
- unfinished: true when the last instruction is still being said.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['heard', 'focus', 'ops', 'summary', 'unfinished'],
  properties: {
    heard: { type: 'string' },
    focus: { type: 'array', items: { type: 'integer' } },
    ops: { type: 'array', items: { type: 'string' } },
    summary: { type: 'array', items: { type: 'string' } },
    unfinished: { type: 'boolean' },
  },
} as const;

export type VoiceReading = VoiceResult;

function client(): Anthropic {
  const apiKey = process.env.IFAKEPRO_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.CHONGFUXI_ANTHROPIC_API_KEY;
  if (!apiKey) throw new HttpError(503, 'Voice edits need an Anthropic API key on the server (IFAKEPRO_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY)');
  return new Anthropic({ apiKey });
}

type Raw = { heard: string; focus: number[]; ops: Record<string, unknown>[]; summary: string[]; unfinished: boolean; badJson: string[] };

async function ask(doc: Doc, transcript: string, refused?: { ops: Record<string, unknown>[]; errors: string[] }): Promise<Raw> {
  const content: Anthropic.TextBlockParam[] = [
    // The chart is the same for every call while someone talks about it: cached.
    { type: 'text', text: `<chart>\n${chartText(doc)}\n</chart>`, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `They've said: "${transcript}"` },
  ];
  if (refused)
    content.push({
      type: 'text',
      text: `Your ops ${JSON.stringify(refused.ops)} were refused:\n${refused.errors.join('\n')}\nAnswer again with ops that do what they said.`,
    });
  let message: Anthropic.Message;
  try {
    message = await client().messages.create({
      model: VOICE_MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Too many voice edits at once; wait a moment');
    if (e instanceof Anthropic.APIError) {
      console.error('[ifakepro] voice model', e.status, e.message);
      throw new HttpError(502, 'The voice model didn’t answer; try again');
    }
    throw e;
  }
  if (message.stop_reason === 'refusal') throw new HttpError(422, 'The voice model declined that');
  const text = message.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('');
  let given: Record<string, unknown>;
  try {
    given = JSON.parse(text);
  } catch {
    throw new HttpError(502, message.stop_reason === 'max_tokens' ? 'That was too much to change at once; say less' : 'The voice model’s answer came back malformed');
  }
  console.log('[ifakepro] voice', JSON.stringify({ usage: message.usage }));
  const ops: Record<string, unknown>[] = [];
  const badJson: string[] = [];
  for (const o of Array.isArray(given.ops) ? given.ops : []) {
    try {
      const op = JSON.parse(String(o));
      if (op && typeof op === 'object' && !Array.isArray(op)) ops.push(op);
      else badJson.push(String(o));
    } catch {
      badJson.push(String(o));
    }
  }
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 200)).slice(0, 40) : []);
  return {
    heard: typeof given.heard === 'string' ? given.heard.slice(0, 600) : '',
    focus: Array.isArray(given.focus) ? given.focus.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= doc.chart.bars.length).slice(0, 64) : [],
    ops,
    summary: strs(given.summary),
    unfinished: given.unfinished === true,
    badJson,
  };
}

/**
 * Read a transcript against a song: the bars it's about and the edits, tried
 * on the chart. When `final` and the chart refuses them, the model gets one
 * more go with the reasons; a refusal while they're still talking is left
 * for the next call, which hears more.
 */
export async function readSpeech(doc: Doc, transcript: string, final: boolean): Promise<VoiceReading> {
  let raw = await ask(doc, transcript);
  const tryOps = (r: Raw) => {
    if (!r.ops.length) return { ok: true as const, preview: null, errors: r.badJson.map((b) => `couldn’t read the op ${b}`) };
    const res = applyOps(doc, r.ops);
    if ('errors' in res) return { ok: false as const, preview: null, errors: [...res.errors, ...r.badJson.map((b) => `couldn’t read the op ${b}`)] };
    return { ok: true as const, preview: res.doc, errors: r.badJson.map((b) => `couldn’t read the op ${b}`) };
  };
  let tried = tryOps(raw);
  if (final && (!tried.ok || raw.badJson.length)) {
    raw = await ask(doc, transcript, { ops: raw.ops, errors: tried.errors });
    tried = tryOps(raw);
  }
  return {
    heard: raw.heard,
    focus: raw.focus,
    ops: tried.ok ? raw.ops : [],
    summary: raw.summary,
    unfinished: raw.unfinished,
    errors: tried.errors,
    preview: tried.preview,
    changes: tried.preview ? changes(doc, tried.preview) : null,
  };
}

/** A few calls a second while someone talks is expected; this caps runaway loops, per person. */
const recent = new Map<string, number[]>();
export function voiceBudget(userId: string) {
  const now = Date.now();
  const calls = (recent.get(userId) ?? []).filter((t) => now - t < 10 * 60_000);
  if (calls.length >= 300) throw new HttpError(429, 'That’s a lot of voice edits; take a breather and try again in a few minutes');
  calls.push(now);
  recent.set(userId, calls);
}
