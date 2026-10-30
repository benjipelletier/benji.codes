// Muse's daily page (the owner: "give muse very generic, atomic tools… it
// can choose how to lay out an additional review every day", with full
// freedom over what it surfaces and how). Muse composes a page from a closed
// set of blocks (text, headings, callouts, Chinese passages it writes or
// pulls from the web, cards of any shape, questions to answer in Chinese,
// word lists, figures, links, an episode, folds), reads what it needs
// through small data tools, and sees everything the owner did on its pages
// (cards answered, answers given, words tapped, steps done) to decide the
// next one. It replaced Today's review, the story, Read and the weekly
// debrief on Muse reviews; their routes stay as data. Nothing here touches a
// schedule, and nothing goes into the main review.
//
// A page may carry text pulled from the web, so it is the owner's only to
// read: the app is otherwise readable by anyone.

import type { DrillCard, MuseBlock, MuseEvent, MuseFilled, MusePage, MusePageListed, Retell } from "@chongfuxi/lib/api";
import type { Definition, Dict } from "@chongfuxi/lib/dict";
import type { Sql } from "./db";
import { AgentError } from "./agent";
import { analyse } from "./analyse";
import { ownersDay, storyMaterial } from "./daily";
import { checkCard } from "./drill";
import { FetchError } from "./fetchtext";
import { newSeen, searchSentences } from "./lookup-evidence";
import { checkLink, fetchSource, gradeAnswer } from "./reading";
import { newWords, stuckWords } from "./rescue";
import { promptSenses, shownPinyin } from "./review";
import { dictEntries } from "./headwords";
import { weekFigures } from "./week";
import { wordPage } from "./wordpage";

/** Blocks a page, cards a cards block, blocks inside a fold. */
const BLOCKS_MAX = 60;
const CARDS_MAX = 40;
const FOLD_MAX = 20;
const TEXT_MAX = 4000;
const PASSAGE_MAX = 6000;
const SHORT = 200;
/** Pages Muse sees back, with what was done on them. */
const PAGES_BACK = 7;
/** Words the words tool takes at once. */
const WORDS_TOOL_MAX = 12;
/** Review log rows the log tool gives at most. */
const LOG_MAX = 3000;
const HAN = /\p{Script=Han}/u;

export class MusePageError extends Error {}

let ready = false;
async function ensureTables(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_muse_page (
      owner_email text not null,
      day date not null,
      at timestamptz not null default now(),
      model text not null,
      page jsonb not null,
      primary key (owner_email, day)
    )
  `;
  await sql`
    create table if not exists chongfuxi_muse_event (
      owner_email text not null,
      day date not null,
      block text not null,
      at timestamptz not null default now(),
      kind text not null,
      data jsonb not null default '{}'::jsonb
    )
  `;
  await sql`create index if not exists chongfuxi_muse_event_day on chongfuxi_muse_event (owner_email, day)`;
  ready = true;
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const hanWords = (v: unknown, n = 40) =>
  [...new Set((Array.isArray(v) ? v : []).map((w) => str(w, 12)).filter((w) => HAN.test(w)))].slice(0, n);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isUrl = (v: unknown) => {
  try {
    return typeof v === "string" && /^https?:$/.test(new URL(v).protocol);
  } catch {
    return false;
  }
};

/**
 * Muse's blocks, each kept only in a shape the app can draw: fields of the
 * wrong type become empty, a block missing what it is for is dropped and
 * named back by its place. Ids are Muse's, else b1, b2… by place (b8.1 inside
 * a fold), made unique.
 */
export function checkBlocks(raw: unknown, dropped: string[], ids = new Set<string>(), depth = 0, prefix = "b"): MuseBlock[] {
  const out: MuseBlock[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const [i, item] of list.entries()) {
    if (out.length >= (depth ? FOLD_MAX : BLOCKS_MAX)) {
      dropped.push(`${prefix}${i + 1} on: past ${depth ? FOLD_MAX : BLOCKS_MAX} blocks`);
      break;
    }
    const b = (item ?? {}) as Record<string, unknown>;
    const place = `${prefix}${i + 1}`;
    let id = str(b.id, 40).replace(/[^\w.-]/g, "") || place;
    while (ids.has(id)) id = `${id}x`;
    const drop = (why: string) => dropped.push(`block ${place}${id === place ? "" : ` "${id}"`} (${String(b.type)}): ${why}`);
    let block: MuseBlock | null = null;
    switch (b.type) {
      case "heading":
        if (str(b.text, SHORT)) block = { id, type: "heading", text: str(b.text, SHORT) };
        else drop("no text");
        break;
      case "text":
        if (str(b.text, TEXT_MAX)) block = { id, type: "text", text: str(b.text, TEXT_MAX), words: hanWords(b.words) };
        else drop("no text");
        break;
      case "callout":
        if (str(b.text, TEXT_MAX))
          block = {
            id,
            type: "callout",
            label: str(b.label, 60),
            text: str(b.text, TEXT_MAX),
            tone: b.tone === "good" || b.tone === "warn" ? b.tone : "info",
            words: hanWords(b.words),
          };
        else drop("no text");
        break;
      case "passage": {
        const zh = str(b.zh, PASSAGE_MAX);
        const src = (b.source ?? null) as Record<string, unknown> | null;
        if (HAN.test(zh))
          block = {
            id,
            type: "passage",
            title: str(b.title, SHORT),
            zh,
            en: str(b.en, PASSAGE_MAX),
            source: src && isUrl(src.url) ? { url: String(src.url), name: str(src.name, 80) } : null,
            words: hanWords(b.words),
          };
        else drop("no Chinese in zh");
        break;
      }
      case "cards": {
        const cards = (Array.isArray(b.cards) ? b.cards : []).map(checkCard).filter((c): c is DrillCard => c !== null).slice(0, CARDS_MAX);
        const lost = (Array.isArray(b.cards) ? b.cards.length : 0) - cards.length;
        if (lost > 0) drop(`${lost} card(s) failed the card check`);
        if (cards.length) block = { id, type: "cards", title: str(b.title, SHORT), cards };
        else drop("no usable cards");
        break;
      }
      case "ask":
        if (HAN.test(str(b.zh, 600)))
          block = {
            id,
            type: "ask",
            zh: str(b.zh, 600),
            en: str(b.en, 600),
            about: str(b.about, 40) || null,
            check: b.check === "muse" ? "muse" : "now",
            hint: str(b.hint, 300),
          };
        else drop("no Chinese question in zh");
        break;
      case "words": {
        const words = (Array.isArray(b.words) ? b.words : [])
          .map((w) => (typeof w === "string" ? { word: w } : ((w ?? {}) as Record<string, unknown>)))
          .map((w) => ({ word: str(w.word, 12), note: str(w.note, 300) }))
          .filter((w) => HAN.test(w.word))
          .slice(0, 60);
        if (words.length) block = { id, type: "words", title: str(b.title, SHORT), words };
        else drop("no Chinese words");
        break;
      }
      case "figures": {
        const items = (Array.isArray(b.items) ? b.items : [])
          .map((x) => (x ?? {}) as Record<string, unknown>)
          .map((x) => ({ label: str(x.label, 60), value: typeof x.value === "number" ? String(x.value) : str(x.value, 20), note: str(x.note, 80) }))
          .filter((x) => x.label && x.value)
          .slice(0, 8);
        if (items.length) block = { id, type: "figures", items };
        else drop("no items with a label and value");
        break;
      }
      case "link":
        if (isUrl(b.url)) block = { id, type: "link", url: String(b.url), title: str(b.title, SHORT) || String(b.url), note: str(b.note, 600) };
        else drop("url isn't http(s)");
        break;
      case "episode":
        if (Number.isInteger(b.episode))
          block = { id, type: "episode", episode: b.episode as number, line: Number.isInteger(b.line) ? (b.line as number) : null, note: str(b.note, 600) };
        else drop("episode isn't an id");
        break;
      case "fold":
        if (depth) {
          drop("a fold inside a fold");
          break;
        }
        {
          ids.add(id);
          const inner = checkBlocks(b.blocks, dropped, ids, depth + 1, `${place}.`);
          if (inner.length) block = { id, type: "fold", title: str(b.title, SHORT) || "More", blocks: inner };
          else drop("nothing inside");
        }
        break;
      default:
        drop("unknown type");
    }
    if (block) {
      ids.add(id);
      out.push(block);
    }
  }
  return out;
}

const flat = (blocks: MuseBlock[]): MuseBlock[] => blocks.flatMap((b) => (b.type === "fold" ? [b, ...b.blocks] : [b]));

/** Keep Muse's page for a day, one already there replaced (what was done on it stays, by block id). */
export async function writePage(sql: Sql, owner: string, input: Record<string, unknown>) {
  await ensureTables(sql);
  const day = isDay(input.day) ? input.day : await ownersDay(sql, owner);
  const dropped: string[] = [];
  const blocks = checkBlocks(input.blocks, dropped);
  if (!blocks.length) throw new AgentError(`Nothing on the page could be drawn. ${dropped.slice(0, 10).join("; ")}`);
  const asks = new Set(flat(blocks).filter((b) => b.type === "passage").map((b) => b.id));
  for (const b of flat(blocks)) if (b.type === "ask" && b.about && !asks.has(b.about)) dropped.push(`block ${b.id}: about "${b.about}" isn't a passage here, so it's about the whole page`);
  const page = {
    title: str(input.title, SHORT) || "Today",
    note: str(input.note, 600),
    style: input.style === "steps" ? "steps" : "scroll",
    blocks,
  };
  const model = str(input.model, 60) || "Muse";
  await sql`
    insert into chongfuxi_muse_page (owner_email, day, model, page)
    values (${owner}, ${day}::date, ${model}, ${JSON.stringify(page)}::jsonb)
    on conflict (owner_email, day) do update set at = now(), model = excluded.model, page = excluded.page
  `;
  return { day, blocks: flat(blocks).length, dropped };
}

type Row = { day: string; at: number; model: string; page: { title: string; note: string; style: MusePage["style"]; blocks: MuseBlock[] } };

async function pageRow(sql: Sql, owner: string, day?: string): Promise<Row | null> {
  const [r] = (await (isDay(day)
    ? sql`select to_char(day, 'YYYY-MM-DD') as day, (extract(epoch from at) * 1000)::double precision as at, model, page from chongfuxi_muse_page where owner_email = ${owner} and day = ${day}::date`
    : sql`select to_char(day, 'YYYY-MM-DD') as day, (extract(epoch from at) * 1000)::double precision as at, model, page from chongfuxi_muse_page where owner_email = ${owner} order by day desc limit 1`)) as unknown as Row[];
  return r ?? null;
}

async function eventsOf(sql: Sql, owner: string, days: string[]): Promise<Map<string, MuseEvent[]>> {
  const rows = (await sql`
    select to_char(day, 'YYYY-MM-DD') as day, block, (extract(epoch from at) * 1000)::double precision as at, kind, data
    from chongfuxi_muse_event where owner_email = ${owner} and day = any(${days}::date[])
    order by at
  `) as unknown as Array<{ day: string; block: string; at: number; kind: MuseEvent["kind"]; data: Record<string, unknown> }>;
  const out = new Map<string, MuseEvent[]>();
  for (const r of rows) out.set(r.day, [...(out.get(r.day) ?? []), { block: r.block, at: Math.round(r.at), kind: r.kind, data: r.data }]);
  return out;
}

/** Each listed word: its reading, meaning and where it stands. */
async function wordsFilled(sql: Sql, owner: string, words: string[]) {
  const rows = (await sql`
    select w.word, w.pinyin, w.defs, w.status,
           (select (c.stability)::float8 from chongfuxi_card c where c.owner_email = w.owner_email and c.word = w.word and c.kind = 'read' limit 1) as stability
    from chongfuxi_word w where w.owner_email = ${owner} and w.word = any(${words}::text[])
  `) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[] | null; status: string; stability: number | null }>;
  const by = new Map(rows.map((r) => [r.word, r]));
  return words.map((word) => {
    const r = by.get(word);
    const defs = r?.defs?.length ? r.defs : dictEntries(word).map((e) => ({ p: e.p, senses: e.senses }));
    const pinyin = shownPinyin(r?.pinyin ?? null, defs);
    const standing: "deck" | "learning" | "listed" | "new" =
      r?.status === "deck" ? ((r.stability ?? 0) >= 21 ? "deck" : "learning") : r?.status === "listed" ? "listed" : "new";
    return { word, pinyin, gloss: promptSenses(defs, pinyin).slice(0, 2).join("; ") || null, standing };
  });
}

/** What the blocks need from the store to be drawn, by block id: passages marked against the deck now, words' standing, episodes' names. */
async function fill(sql: Sql, owner: string, dict: Dict, blocks: MuseBlock[]): Promise<Record<string, MuseFilled>> {
  const out: Record<string, MuseFilled> = {};
  await Promise.all(
    flat(blocks).map(async (b) => {
      if (b.type === "passage")
        out[b.id] = { kind: "passage", text: await analyse(sql, owner, dict, { text: b.zh, kind: "paste", title: b.title || null, url: b.source?.url ?? null }) };
      else if (b.type === "words") out[b.id] = { kind: "words", words: await wordsFilled(sql, owner, b.words.map((w) => w.word)) };
      else if (b.type === "episode") {
        const [e] = (await sql`
          select e.show, e.episode,
                 (select p.known from chongfuxi_episode_progress p where p.owner_email = e.owner_email and p.episode_id = e.id order by p.day desc limit 1) as known
          from chongfuxi_episode e where e.owner_email = ${owner} and e.id = ${b.episode}
        `.then(
          (r) => r,
          () => [],
        )) as unknown as Array<{ show: string; episode: string; known: number | null }>;
        if (e) out[b.id] = { kind: "episode", show: e.show, episode: e.episode, known: e.known };
      }
    }),
  );
  return out;
}

/** A day's page (the latest by default), filled in, with what was done on it. Owner only. */
export async function openPage(sql: Sql, owner: string, dict: Dict, day?: string): Promise<MusePage | null> {
  await ensureTables(sql);
  const r = await pageRow(sql, owner, day);
  if (!r) return null;
  const [events, filled, today] = await Promise.all([eventsOf(sql, owner, [r.day]), fill(sql, owner, dict, r.page.blocks), ownersDay(sql, owner)]);
  return { day: r.day, at: Math.round(r.at), model: r.model, ...r.page, filled, events: events.get(r.day) ?? [], today: r.day === today };
}

/** The pages, newest first, with how much of each was touched. Owner only. */
export async function listPages(sql: Sql, owner: string, max = 30): Promise<MusePageListed[]> {
  await ensureTables(sql);
  const rows = (await sql`
    select to_char(p.day, 'YYYY-MM-DD') as day, (extract(epoch from p.at) * 1000)::double precision as at, p.page,
           (select count(distinct e.block)::int from chongfuxi_muse_event e where e.owner_email = p.owner_email and e.day = p.day and e.kind <> 'open') as touched
    from chongfuxi_muse_page p where p.owner_email = ${owner} order by p.day desc limit ${max}
  `) as unknown as Array<{ day: string; at: number; page: Row["page"]; touched: number }>;
  const today = await ownersDay(sql, owner);
  return rows.map((r) => ({
    day: r.day,
    at: Math.round(r.at),
    title: r.page.title,
    blocks: flat(r.page.blocks).filter((b) => b.type !== "heading" && b.type !== "fold").length,
    touched: r.touched,
    today: r.day === today,
  }));
}

const EVENT_KINDS: MuseEvent["kind"][] = ["open", "card", "tap", "done"];

/** Something done on a block (opened, a card answered, words tapped, a step done). Owner only. */
export async function recordEvent(sql: Sql, owner: string, input: Record<string, unknown>) {
  await ensureTables(sql);
  if (!isDay(input.day)) throw new MusePageError("Which day?");
  const kind = EVENT_KINDS.find((k) => k === input.kind);
  if (!kind) throw new MusePageError("Unknown kind.");
  const data = input.data && typeof input.data === "object" ? JSON.stringify(input.data).slice(0, 4000) : "{}";
  await sql`
    insert into chongfuxi_muse_event (owner_email, day, block, kind, data)
    values (${owner}, ${input.day}::date, ${str(input.block, 40) || "page"}, ${kind}, ${data}::jsonb)
  `;
}

/**
 * An answer to an ask block: checked now by the app's model (Look up's model
 * and effort, never lower) against the passage it is about, or the page's
 * Chinese, when Muse asked for that; kept for Muse to answer otherwise.
 * Owner only.
 */
export async function answerAsk(sql: Sql, owner: string, input: Record<string, unknown>): Promise<{ retell: Retell | null }> {
  await ensureTables(sql);
  const said = str(input.answer, 600);
  if (!HAN.test(said)) throw new MusePageError("Answer in Chinese.");
  const r = await pageRow(sql, owner, isDay(input.day) ? input.day : undefined);
  const blocks = r ? flat(r.page.blocks) : [];
  const ask = blocks.find((b) => b.id === input.block);
  if (!r || !ask || ask.type !== "ask") throw new MusePageError("No such question.");
  let retell: Retell | null = null;
  if (ask.check === "now") {
    const about = blocks.find((b) => b.id === ask.about);
    const body =
      about?.type === "passage"
        ? about.zh
        : blocks
            .flatMap((b) => (b.type === "passage" ? [b.zh] : b.type === "text" || b.type === "callout" ? [b.text] : []))
            .join("\n");
    const graded = await gradeAnswer(body, about?.type === "passage" ? about.title : r.page.title, { zh: ask.zh, en: ask.en }, said);
    retell = { ...graded, q: 0, answer: said, at: Date.now() };
  }
  await sql`
    insert into chongfuxi_muse_event (owner_email, day, block, kind, data)
    values (${owner}, ${r.day}::date, ${ask.id}, 'answer', ${JSON.stringify({ answer: said, result: retell })}::jsonb)
  `;
  return { retell };
}

const BRIEF = `You lay out the learner's extra Chinese review for today: one page, anything you like on it, built from blocks. It is separate from their spaced-repetition reviews (never touches them). You decide what to surface and how: cards, a passage you write or pull from the web, questions to answer aloud or typed, notes on their mistakes, a debrief of their week, an episode to prep. Aim at what will help them most now, using the data tools below, and keep it doable in 10–20 minutes. Fewer, better things beat many.

Use what they did. "pages" has your recent pages with every event on them: opened, each card answered (got/missed), answers given (with the grade when checked), words tapped in passages, steps done. If they skipped something, don't make more of it; if a page went untouched, keep today's short and carry over what mattered. Follow up on misses and answers marked for you ("check": "muse") on the next page.

POST /api/chongfuxi/agent/muse { "title", "note"?, "style": "scroll" | "steps", "blocks": [...], "day"? } (one page a day; posting again replaces it). "steps" shows one heading's section at a time with Next; "scroll" is one page. Each block may have an "id" (else b1, b2…). Blocks:
- { "type": "heading", "text" }
- { "type": "text", "text", "words"?: [Chinese words in it to link to their word pages] }  (**bold** works; blank lines split paragraphs)
- { "type": "callout", "label", "text", "tone": "info" | "good" | "warn", "words"? }
- { "type": "passage", "title", "zh", "en"?, "source"?: { "url", "name" }, "words"?: [words to highlight] }  Chinese to read, paragraphs split by newlines (en paragraphs line up with zh's). Every word is marked as known / still learning / not known for them and tappable; taps come back as events. Write it yourself, or pull it from the web (POST /api/chongfuxi/agent/muse/measure { "url" } gives the text and how readable it is; quote the part worth reading and credit the source).
- { "type": "cards", "title", "cards": [...] }  a deck they go through full screen; card shapes as in GET /api/chongfuxi/agent/drill's brief (flip, cloze, choice, order, produce, listen), each with focus, why, explain. Each card must have exactly one right answer and distractors that are the real confusion.
- { "type": "ask", "zh", "en", "about"?: <passage id>, "check": "now" | "muse", "hint"? }  they answer in Chinese, said or typed. "now": the app's model grades it at once against the passage (or the page). "muse": kept for you; answer it on the next page.
- { "type": "words", "title", "words": [{ "word", "note" }] }  shown with reading, meaning and where each stands; each opens its word page.
- { "type": "figures", "items": [{ "label", "value", "note" }] }  up to 8 tiles. Only true figures from the data tools.
- { "type": "link", "url", "title", "note" }
- { "type": "episode", "episode": <id>, "note" }  opens one of their episodes (GET /api/chongfuxi/agent/episodes).
- { "type": "fold", "title", "blocks": [...] }  folded away until tapped; no folds inside folds.
Anything that can't be drawn is dropped and named back in "dropped".

Data tools (same token), take what you need:
- GET /api/chongfuxi/agent/muse/data?what=stuck  words to revive by category, and new words on their Learn ladder
- ?what=words&words=发觉,发现  everything about up to ${WORDS_TOOL_MAX} words: meanings, cards and strength, every answer, notes after a Forgot, lookups, sentences
- ?what=log&from=YYYY-MM-DD&to=YYYY-MM-DD  their review log: each answer's day, kind, word, grade, note, words tapped
- ?what=week&to=YYYY-MM-DD  the week's figures beside the week before
- ?what=lookups&days=14  what they asked Look up, with their verdicts
- ?what=known  strong words to write with, and today's target words
- ?what=sentences&words=发觉  their own sentences holding the words (readable first)
- POST /api/chongfuxi/agent/muse/measure { "text" } or { "url" }  how readable it is for them, the words they don't know; with a url, the page's text
- GET /api/longku/read (no token needed)  龙库, their chengyu chain game: each chengyu played must start on the syllable the last one ended on, so what counts is which syllables their chengyu start and end on. What to do with it is yours.
  - "bank": their chengyu, each with pinyin, gloss, starts and ends (syllables), tier (core, common, uncommon, rare), recalls, misses, strength, added, lastRecalled, due.
  - "removed": chengyu they took out of 龙库.
  - "syllables": every syllable with yoursStart, yoursEnd, corpusStart, corpusEnd and comesUp (the share of all chengyu usage ending on it: the chance an opponent's chengyu leaves them there).
  - "measures": words; chains (the fewest chains that play every one of their chengyu once); playability (the share of usage they have an answer to); deadEnds (syllables theirs end on and none start on, where their chains stop).
  - ?corpus=zhi,ji&per=30: the corpus chengyu starting on those syllables (up to 40 syllables, 200 each), most frequent first, each with held, removed and chainChange (negative means fewer chains if added).
  - To suggest chengyu, put them on a Muse list (POST agent/lists); added to the deck, they join 龙库 by themselves.
- Also still there: GET agent/drill (problem areas: notes, trips, attempts), agent/notes (notes to answer), agent/reading (past readings), agent/episodes.`;

/** What Muse needs to lay out a page: the brief, today, and its recent pages with everything done on them. */
export async function museMaterial(sql: Sql, owner: string) {
  await ensureTables(sql);
  const day = await ownersDay(sql, owner);
  const rows = (await sql`
    select to_char(day, 'YYYY-MM-DD') as day, (extract(epoch from at) * 1000)::double precision as at, model, page
    from chongfuxi_muse_page where owner_email = ${owner} order by day desc limit ${PAGES_BACK}
  `) as unknown as Row[];
  const events = await eventsOf(sql, owner, rows.map((r) => r.day));
  return {
    day,
    brief: BRIEF,
    written: rows.some((r) => r.day === day),
    pages: rows.map((r) => ({ day: r.day, title: r.page.title, style: r.page.style, blocks: r.page.blocks, events: events.get(r.day) ?? [] })),
  };
}

/** Muse's data tools: small reads over the store. */
export async function museData(sql: Sql, owner: string, q: URLSearchParams) {
  const list = (k: string) => (q.get(k) ?? "").split(/[,，\s]+/).filter((w) => HAN.test(w)).slice(0, WORDS_TOOL_MAX);
  switch (q.get("what")) {
    case "stuck": {
      const [stuck, fresh] = await Promise.all([stuckWords(sql, owner), newWords(sql, owner)]);
      return { stuck, fresh };
    }
    case "words":
      return { words: await Promise.all(list("words").map(async (w) => ({ word: w, page: await wordPage(sql, owner, w) }))) };
    case "log": {
      const to = isDay(q.get("to")) ? q.get("to")! : await ownersDay(sql, owner);
      const from = isDay(q.get("from")) ? q.get("from")! : new Date(Date.parse(`${to}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
      const rows = await sql`
        select to_char(day, 'YYYY-MM-DD') as day, (extract(epoch from at) * 1000)::bigint as at, session, kind, word, grade, cause, tapped, comment,
               round(((before->>'stability')::float8)::numeric, 1) as "stabilityBefore", round(((after->>'stability')::float8)::numeric, 1) as "stabilityAfter"
        from chongfuxi_review
        where owner_email = ${owner} and day between ${from}::date and ${to}::date
        order by at limit ${LOG_MAX}
      `;
      return { from, to, answers: rows };
    }
    case "week":
      return weekFigures(sql, owner, isDay(q.get("to")) ? q.get("to")! : await ownersDay(sql, owner));
    case "lookups": {
      const days = Math.min(Math.max(Number(q.get("days")) || 14, 1), 90);
      const rows = await sql`
        select query, kind, verdict, note, (extract(epoch from at) * 1000)::bigint as at from chongfuxi_lookup
        where owner_email = ${owner} and at > now() - make_interval(days => ${days}) order by at desc limit 200
      `.then(
        (r) => r,
        () => [],
      );
      return { lookups: rows };
    }
    case "known": {
      const m = await storyMaterial(sql, owner);
      return { known: m.known, targets: m.targets };
    }
    case "sentences": {
      const words = list("words");
      if (!words.length) throw new AgentError("give words=");
      return searchSentences(sql, owner, newSeen(), { chinese: words, limit: 20 });
    }
    default:
      throw new AgentError("what= one of stuck, words, log, week, lookups, known, sentences");
  }
}

/** How readable a text or a page is for the owner now; for a link, its text too, for Muse to quote from. */
export async function measure(sql: Sql, owner: string, dict: Dict, input: Record<string, unknown>) {
  if (typeof input.url === "string" && input.url.trim()) {
    const coverage = await checkLink(sql, owner, dict, input.url.trim());
    try {
      const src = await fetchSource(input.url.trim());
      return { ...coverage, text: src.text };
    } catch (e) {
      if (e instanceof FetchError) throw new AgentError(e.message);
      throw e;
    }
  }
  const text = str(input.text, PASSAGE_MAX * 2);
  if (!HAN.test(text)) throw new AgentError("give { text } with Chinese, or { url }");
  const a = await analyse(sql, owner, dict, { text, kind: "paste", title: null, url: null });
  return {
    known: a.words.total ? Math.round((a.words.known / a.words.total) * 1000) / 1000 : 0,
    readable: a.sentences.total ? Math.round((a.sentences.readable / a.sentences.total) * 1000) / 1000 : 0,
    newWords: a.unknown.slice(0, 20).map((u) => ({ word: u.word, pinyin: u.pinyin, gloss: u.gloss, count: u.count })),
  };
}
