import * as fs from 'fs';
import * as path from 'path';
import type { CedictEntry } from './types';

// ─── Gloss normalization (mirrors Python script logic) ───────────────────────

const STRIP_PREFIXES = [
  'to become ', 'to make ', 'to get ', 'to be ', 'to ',
  'an ', 'a ', 'the ',
];

const STRIP_SUFFIXES = [
  ' (of sth)', ' (sb)', ' (sth)', ' (lit.)', ' (fig.)', ' (coll.)',
  ' sth', ' sb',
];

const SKIP_PREFIXES = [
  'classifier ', 'variant of ', 'see ', 'abbr. ', 'surname ', 'cl:',
  'old variant', 'also written', 'japanese variant',
];

export function normalizeGloss(raw: string): string | null {
  let g = raw.trim();

  // Skip if starts with a skip prefix
  for (const skip of SKIP_PREFIXES) {
    if (g.toLowerCase().startsWith(skip)) return null;
  }

  // Remove parentheticals
  g = g.replace(/\([^)]*\)/g, '').trim();

  // Remove text after semicolon
  const semiIdx = g.indexOf(';');
  if (semiIdx !== -1) g = g.slice(0, semiIdx).trim();

  // Strip leading prefixes (longest first)
  for (const prefix of STRIP_PREFIXES) {
    if (g.toLowerCase().startsWith(prefix.toLowerCase())) {
      g = g.slice(prefix.length);
      break;
    }
  }

  // Strip trailing suffixes
  for (const suffix of STRIP_SUFFIXES) {
    if (g.toLowerCase().endsWith(suffix.toLowerCase())) {
      g = g.slice(0, -suffix.length).trim();
      break;
    }
  }

  // Clean whitespace
  g = g.replace(/\s+/g, ' ').trim().toLowerCase();

  // Minimum length
  if (g.length < 2) return null;

  return g;
}

// ─── Singleton CEDICT index ──────────────────────────────────────────────────

interface CedictIndex {
  // simplified → list of entries (may have multiple pronunciations)
  bySimplified: Map<string, CedictEntry[]>;
  // normalized_token → list of simplified chars
  byToken: Map<string, string[]>;
}

let _index: CedictIndex | null = null;

function parseLine(line: string): CedictEntry | null {
  line = line.trim();
  if (!line || line.startsWith('#')) return null;

  // TRADITIONAL SIMPLIFIED [pin1 yin1] /gloss1/gloss2/.../
  const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/);
  if (!m) return null;

  const [, traditional, simplified, pinyin, glossesRaw] = m;
  const raw_glosses = glossesRaw.split('/').filter((g) => g.trim());

  // Normalize each gloss
  const normalizedSet = new Set<string>();
  for (const g of raw_glosses) {
    const t = normalizeGloss(g);
    if (t) normalizedSet.add(t);
  }

  if (normalizedSet.size === 0) return null;

  return {
    simplified,
    traditional,
    pinyin,
    raw_glosses,
    normalized_tokens: Array.from(normalizedSet),
  };
}

export function loadCEDICT(): CedictIndex {
  if (_index) return _index;

  const cedictPath = path.join(process.cwd(), 'data', 'cedict_ts.u8');

  if (!fs.existsSync(cedictPath)) {
    console.error(`CC-CEDICT not found at ${cedictPath}. Download from https://www.mdbg.net/chinese/dictionary?page=cedict`);
    // Return empty index — on-the-fly building will be unavailable
    _index = { bySimplified: new Map(), byToken: new Map() };
    return _index;
  }

  const content = fs.readFileSync(cedictPath, 'utf-8');
  const lines = content.split('\n');

  const bySimplified = new Map<string, CedictEntry[]>();
  const byToken = new Map<string, string[]>();

  for (const line of lines) {
    const entry = parseLine(line);
    if (!entry) continue;

    // Index by simplified
    if (!bySimplified.has(entry.simplified)) {
      bySimplified.set(entry.simplified, []);
    }
    bySimplified.get(entry.simplified)!.push(entry);

    // Index by token
    for (const token of entry.normalized_tokens) {
      if (!byToken.has(token)) {
        byToken.set(token, []);
      }
      const existing = byToken.get(token)!;
      if (!existing.includes(entry.simplified)) {
        existing.push(entry.simplified);
      }
    }
  }

  _index = { bySimplified, byToken };
  console.error(`CEDICT loaded: ${bySimplified.size} simplified chars, ${byToken.size} normalized tokens`);
  return _index;
}

// ─── Synonym lookup ──────────────────────────────────────────────────────────

export interface SynonymCluster {
  label: string;
  members: CedictEntry[];
  edges: Array<{ word1: string; word2: string; gloss: string }>;
}

export function findSynonyms(simplified: string): SynonymCluster[] {
  const index = loadCEDICT();

  const entries = index.bySimplified.get(simplified);
  if (!entries || entries.length === 0) return [];

  // Collect all tokens from all pronunciations of this word
  const targetTokens = new Set<string>();
  for (const entry of entries) {
    entry.normalized_tokens.forEach((t) => targetTokens.add(t));
  }

  // For each shared token, find the cluster
  const clusters: SynonymCluster[] = [];
  const seenClusterKeys = new Set<string>();

  for (const token of targetTokens) {
    const siblingsSimplified = index.byToken.get(token) || [];

    // Filter to 2–12 members
    if (siblingsSimplified.length < 2 || siblingsSimplified.length > 12) continue;

    const clusterKey = siblingsSimplified.slice().sort().join('|');
    if (seenClusterKeys.has(clusterKey)) continue;
    seenClusterKeys.add(clusterKey);

    // Resolve entries for each member (use first entry if multiple pronunciations)
    const members: CedictEntry[] = [];
    for (const simp of siblingsSimplified) {
      const sibEntries = index.bySimplified.get(simp);
      if (sibEntries && sibEntries.length > 0) {
        members.push(sibEntries[0]);
      }
    }

    if (members.length < 2) continue;

    // Compute edges: one per shared gloss per pair
    const edges: Array<{ word1: string; word2: string; gloss: string }> = [];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const tokens1 = new Set(members[i].normalized_tokens);
        const tokens2 = new Set(members[j].normalized_tokens);
        for (const t of tokens1) {
          if (tokens2.has(t)) {
            edges.push({
              word1: members[i].simplified,
              word2: members[j].simplified,
              gloss: t,
            });
          }
        }
      }
    }

    if (edges.length === 0) continue;

    clusters.push({ label: token, members, edges });
  }

  return clusters;
}
