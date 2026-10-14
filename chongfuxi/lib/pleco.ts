// Reading a Pleco flashcard backup (.pqb).
//
// A backup is a plain SQLite database ("Pleco SQL Flashcard Database", format
// 8 at the time of writing). The format is undocumented, so this reads only the
// columns it needs and keeps them as Pleco stored them — "@" between characters
// and all — leaving interpretation to the corpus. The snapshot is the record of
// what the backup said; anything derived from it can be recomputed later.
//
// Works on any object with sql.js's `exec`, so the same code runs in the
// browser (sql.js on WASM) and in Node scripts.

export interface PlecoCard {
  id: number;
  /** Characters joined by "@", as Pleco stores them. */
  hw: string;
  /** Traditional form, when the card has one. */
  alt: string | null;
  /** Numbered pinyin: "@" between syllables, a space before each new word. */
  pron: string;
  /** Only present on cards with their own definition (custom cards). */
  defn: string | null;
  /** Linked to an entry in one of Pleco's dictionaries. */
  dict: boolean;
  /** Categories the card is filed under (Pleco files cards under leaves). */
  cats: number[];
  /** Unix seconds. */
  created: number;
  modified: number;
}

export interface PlecoCategory {
  id: number;
  name: string;
  parent: number;
}

export interface PlecoScore {
  card: number;
  score: number;
  difficulty: number | null;
  /** One digit per review, oldest first: 6 for right, 2 for wrong. */
  history: string;
  correct: number;
  incorrect: number;
  reviewed: number;
  /** Unix seconds; null if never reviewed. */
  first: number | null;
  last: number | null;
}

/** What Pleco knew about one card's reviews: where its schedule here starts from. */
export type PlecoSeed = Omit<PlecoScore, "card">;

export interface PlecoScorefile {
  id: number;
  name: string;
  scores: PlecoScore[];
}

export interface PlecoSnapshot {
  format: { name: string; version: string; platform: string; created: number | null };
  cards: PlecoCard[];
  categories: PlecoCategory[];
  scorefiles: PlecoScorefile[];
}

/** The slice of sql.js's Database this module uses. */
export interface SqlLike {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
}

export class NotAPlecoBackupError extends Error {
  constructor(detail: string) {
    super(`This doesn't look like a Pleco flashcard backup (${detail}).`);
    this.name = "NotAPlecoBackupError";
  }
}

function rows(db: SqlLike, sql: string): unknown[][] {
  return db.exec(sql)[0]?.values ?? [];
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export function readPleco(db: SqlLike): PlecoSnapshot {
  const tables = new Set(rows(db, "select name from sqlite_master where type = 'table'").map((r) => str(r[0])));
  for (const t of ["pleco_flash_cards", "pleco_flash_categories", "pleco_flash_categoryassigns"]) {
    if (!tables.has(t)) throw new NotAPlecoBackupError(`no ${t} table`);
  }

  const props = new Map<string, string>();
  if (tables.has("pleco_flash_properties")) {
    for (const [k, v] of rows(db, "select propid, propvalue from pleco_flash_properties")) props.set(str(k), str(v));
  }

  const catsByCard = new Map<number, number[]>();
  for (const [card, cat] of rows(db, "select card, cat from pleco_flash_categoryassigns")) {
    const c = num(card);
    const list = catsByCard.get(c);
    if (list) list.push(num(cat));
    else catsByCard.set(c, [num(cat)]);
  }

  const cards: PlecoCard[] = rows(
    db,
    "select id, hw, althw, pron, defn, dictid, created, modified from pleco_flash_cards order by id",
  ).map(([id, hw, alt, pron, defn, dictid, created, modified]) => ({
    id: num(id),
    hw: str(hw),
    alt: strOrNull(alt),
    pron: str(pron),
    defn: strOrNull(defn),
    // Custom cards carry -1; cards linked to a dictionary carry its id.
    dict: num(dictid) > 0,
    cats: catsByCard.get(num(id)) ?? [],
    created: num(created),
    modified: num(modified),
  }));

  const categories: PlecoCategory[] = rows(db, "select id, name, parent from pleco_flash_categories order by id").map(
    ([id, name, parent]) => ({ id: num(id), name: str(name), parent: num(parent) }),
  );

  const scorefiles: PlecoScorefile[] = [];
  if (tables.has("pleco_flash_scorefiles")) {
    for (const [id, name] of rows(db, "select id, name from pleco_flash_scorefiles order by id")) {
      const table = `pleco_flash_scores_${num(id)}`;
      if (!tables.has(table)) continue;
      const scores = rows(
        db,
        `select card, score, difficulty, history, correct, incorrect, reviewed, firstreviewedtime, lastreviewedtime from ${table}`,
      ).map(([card, score, difficulty, history, correct, incorrect, reviewed, first, last]) => ({
        card: num(card),
        score: num(score),
        difficulty: numOrNull(difficulty),
        history: str(history),
        correct: num(correct),
        incorrect: num(incorrect),
        reviewed: num(reviewed),
        first: numOrNull(first) || null,
        last: numOrNull(last) || null,
      }));
      scorefiles.push({ id: num(id), name: str(name), scores });
    }
  }

  return {
    format: {
      name: props.get("FormatString") ?? "",
      version: props.get("FormatVersion") ?? "",
      platform: props.get("FilePlatform") ?? "",
      created: props.has("FileCreated") ? Number(props.get("FileCreated")) : null,
    },
    cards,
    categories,
    scorefiles,
  };
}
