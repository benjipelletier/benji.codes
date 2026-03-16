#!/usr/bin/env python3
"""
seed_db.py — Bulk import CC-CEDICT into Postgres.

Populates the dictionary + cluster layers (words, gloss_tokens, word_glosses,
synonym_clusters, cluster_members, synonym_edges).

Does NOT call Claude. Collocations, situations, and core_scene are filled
lazily at request time.

Usage:
  POSTGRES_URL="postgres://..." python scripts/seed_db.py --cedict data/cedict_ts.u8

Flags:
  --cedict PATH   Path to cedict_ts.u8 (required)
  --fresh         Truncate cluster tables before seeding (safe to re-run)
  --hsk PATH      Optional HSK word list to filter to (one word per line)
  --batch INT     Cluster batch size for progress commits (default 500)

Requires:
  pip install psycopg2-binary
"""

import argparse
import os
import re
import sys
from collections import defaultdict
from itertools import combinations

import psycopg2
import psycopg2.extras


# ─── Gloss normalization (mirrors lib/cedict.ts) ─────────────────────────────

STRIP_PREFIXES = [
    "to become ", "to make ", "to get ", "to be ", "to ",
    "an ", "a ", "the ",
]

STRIP_SUFFIXES = [
    " (of sth)", " (sb)", " (sth)", " (lit.)", " (fig.)", " (coll.)",
    " sth", " sb",
]

SKIP_PREFIXES = [
    "classifier ", "variant of ", "see ", "abbr. ", "surname ", "cl:",
    "old variant", "also written", "japanese variant",
]


def normalize_gloss(raw: str):
    g = raw.strip()
    for skip in SKIP_PREFIXES:
        if g.lower().startswith(skip):
            return None
    g = re.sub(r'\([^)]*\)', '', g).strip()
    if ';' in g:
        g = g[:g.index(';')].strip()
    for prefix in STRIP_PREFIXES:
        if g.lower().startswith(prefix):
            g = g[len(prefix):]
            break
    for suffix in STRIP_SUFFIXES:
        if g.lower().endswith(suffix):
            g = g[:-len(suffix)].strip()
            break
    g = re.sub(r'\s+', ' ', g).strip().lower()
    return g if len(g) >= 2 else None


# ─── CEDICT parser ────────────────────────────────────────────────────────────

def parse_cedict(path: str) -> list[dict]:
    words = []
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            m = re.match(r'^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+/(.+)/$', line)
            if not m:
                continue
            traditional, simplified, pinyin, glosses_raw = m.groups()
            raw_glosses = [g for g in glosses_raw.split('/') if g.strip()]
            tokens = list(dict.fromkeys(t for t in (normalize_gloss(g) for g in raw_glosses) if t))
            if not tokens:
                continue
            # Skip entries with no Chinese characters
            if not re.search(r'[\u4e00-\u9fff\u3400-\u4dbf]', simplified):
                continue
            words.append({
                'simplified': simplified,
                'traditional': traditional,
                'pinyin': pinyin,
                'raw_glosses': raw_glosses,
                'tokens': tokens,
            })
    print(f"Parsed {len(words)} CEDICT entries", file=sys.stderr)
    return words


# ─── HSK filter ───────────────────────────────────────────────────────────────

def load_hsk(path: str) -> set[str]:
    hsk = set()
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            parts = line.strip().split('\t')
            if parts[0]:
                hsk.add(parts[0])
    print(f"Loaded {len(hsk)} HSK words", file=sys.stderr)
    return hsk


# ─── Cluster builder ──────────────────────────────────────────────────────────

def build_clusters(words, hsk):
    if hsk:
        words = [w for w in words if w['simplified'] in hsk]
        print(f"After HSK filter: {len(words)} entries", file=sys.stderr)

    # Deduplicate by (simplified, pinyin)
    seen: set[tuple] = set()
    deduped = []
    for w in words:
        key = (w['simplified'], w['pinyin'])
        if key not in seen:
            seen.add(key)
            deduped.append(w)
    words = deduped
    print(f"After dedup: {len(words)} unique (simplified, pinyin) entries", file=sys.stderr)

    # Inverted index: token → [word indices]
    token_to_idx: dict[str, list[int]] = defaultdict(list)
    for i, w in enumerate(words):
        for token in w['tokens']:
            token_to_idx[token].append(i)

    # Build clusters
    clusters = []
    seen_sets: set[frozenset] = set()
    for token, indices in sorted(token_to_idx.items()):
        unique = list(dict.fromkeys(indices))
        if not (2 <= len(unique) <= 12):
            continue
        fs = frozenset(unique)
        if fs in seen_sets:
            continue
        seen_sets.add(fs)

        members = [words[i] for i in unique]
        edges = []
        for i, j in combinations(range(len(members)), 2):
            shared = set(members[i]['tokens']) & set(members[j]['tokens'])
            for t in sorted(shared):
                edges.append((members[i]['simplified'], members[j]['simplified'], t))

        if edges:
            clusters.append({'label': token, 'members': members, 'edges': edges})

    print(f"Built {len(clusters)} synonym clusters", file=sys.stderr)
    return words, clusters


# ─── DB seed ─────────────────────────────────────────────────────────────────

def seed(conn, words: list[dict], clusters: list[dict], batch_size: int):
    cur = conn.cursor()

    # ── 1. Upsert words ──────────────────────────────────────────────────────
    print("Inserting words...", file=sys.stderr)
    psycopg2.extras.execute_values(
        cur,
        """
        INSERT INTO words (simplified, traditional, pinyin, raw_glosses)
        VALUES %s
        ON CONFLICT (simplified, pinyin) DO UPDATE SET
            traditional = EXCLUDED.traditional,
            raw_glosses = EXCLUDED.raw_glosses
        """,
        [(w['simplified'], w['traditional'], w['pinyin'], w['raw_glosses']) for w in words],
        template="(%s, %s, %s, %s::text[])",
        page_size=2000,
    )
    conn.commit()

    cur.execute("SELECT id, simplified, pinyin FROM words")
    # Map (simplified, pinyin) → id
    word_id_map: dict[tuple, int] = {(r[1], r[2]): r[0] for r in cur.fetchall()}
    # Map simplified → id (first occurrence, for edge lookups)
    simp_id_map: dict[str, int] = {}
    for (simp, _pin), wid in word_id_map.items():
        if simp not in simp_id_map:
            simp_id_map[simp] = wid
    print(f"  {len(word_id_map)} words in DB", file=sys.stderr)

    # ── 2. Upsert gloss tokens ───────────────────────────────────────────────
    print("Inserting gloss tokens...", file=sys.stderr)
    all_tokens: set[str] = set()
    for w in words:
        all_tokens.update(w['tokens'])
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO gloss_tokens (token) VALUES %s ON CONFLICT (token) DO NOTHING",
        [(t,) for t in all_tokens],
        page_size=2000,
    )
    conn.commit()

    cur.execute("SELECT id, token FROM gloss_tokens")
    token_id_map: dict[str, int] = {r[1]: r[0] for r in cur.fetchall()}
    print(f"  {len(token_id_map)} gloss tokens in DB", file=sys.stderr)

    # ── 3. Insert word_glosses ───────────────────────────────────────────────
    print("Inserting word_glosses...", file=sys.stderr)
    wg_rows = []
    for w in words:
        wid = word_id_map.get((w['simplified'], w['pinyin']))
        if not wid:
            continue
        for token in w['tokens']:
            tid = token_id_map.get(token)
            if tid:
                wg_rows.append((wid, tid))
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO word_glosses (word_id, gloss_id) VALUES %s ON CONFLICT DO NOTHING",
        wg_rows,
        page_size=5000,
    )
    conn.commit()
    print(f"  {len(wg_rows)} word_gloss edges", file=sys.stderr)

    # ── 4. Insert clusters + members + edges (batched) ───────────────────────
    print(f"Inserting {len(clusters)} synonym clusters (batch={batch_size})...", file=sys.stderr)

    cluster_rows_buf: list[tuple] = []
    member_rows_buf: list[tuple] = []
    edge_rows_buf: list[tuple] = []

    def flush_cluster_batch():
        if not cluster_rows_buf:
            return
        # Cluster inserts (not bulk — need RETURNING id)
        # Already inserted individually in loop below; this just commits
        conn.commit()
        cluster_rows_buf.clear()

        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO cluster_members (cluster_id, word_id) VALUES %s ON CONFLICT DO NOTHING",
            member_rows_buf,
            page_size=2000,
        )
        member_rows_buf.clear()

        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO synonym_edges (cluster_id, word1_id, word2_id, gloss_id)
            VALUES %s
            ON CONFLICT DO NOTHING
            """,
            edge_rows_buf,
            page_size=2000,
        )
        edge_rows_buf.clear()
        conn.commit()

    for i, cluster in enumerate(clusters):
        if i > 0 and i % batch_size == 0:
            flush_cluster_batch()
            print(f"  {i}/{len(clusters)} clusters committed", file=sys.stderr)

        cur.execute(
            """
            INSERT INTO synonym_clusters (label, word_count) VALUES (%s, %s)
            ON CONFLICT (label) DO UPDATE SET word_count = EXCLUDED.word_count
            RETURNING id
            """,
            (cluster['label'], len(cluster['members'])),
        )
        cluster_id: int = cur.fetchone()[0]
        cluster_rows_buf.append((cluster_id,))

        # Build simplified → word_id for this cluster's members
        member_ids: dict[str, int] = {}
        for m in cluster['members']:
            wid = word_id_map.get((m['simplified'], m['pinyin'])) or simp_id_map.get(m['simplified'])
            if wid:
                member_ids[m['simplified']] = wid
                member_rows_buf.append((cluster_id, wid))

        for word1, word2, token in cluster['edges']:
            w1_id = member_ids.get(word1)
            w2_id = member_ids.get(word2)
            tid = token_id_map.get(token)
            if not (w1_id and w2_id and tid):
                continue
            lo, hi = (w1_id, w2_id) if w1_id < w2_id else (w2_id, w1_id)
            edge_rows_buf.append((cluster_id, lo, hi, tid))

    flush_cluster_batch()
    print(f"  {len(clusters)}/{len(clusters)} clusters committed", file=sys.stderr)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Seed Postgres from CC-CEDICT')
    parser.add_argument('--cedict', required=True, help='Path to cedict_ts.u8')
    parser.add_argument('--hsk', help='Optional HSK word list')
    parser.add_argument('--fresh', action='store_true', help='Truncate cluster tables first')
    parser.add_argument('--batch', type=int, default=500, help='Cluster commit batch size')
    args = parser.parse_args()

    postgres_url = os.environ.get('POSTGRES_URL')
    if not postgres_url:
        # Try loading from .env.local in cwd or project root
        for env_path in ['.env.local', os.path.join(os.path.dirname(__file__), '..', '.env.local')]:
            env_path = os.path.normpath(env_path)
            if os.path.exists(env_path):
                with open(env_path) as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith('#') or '=' not in line:
                            continue
                        key, _, val = line.partition('=')
                        val = val.strip().strip('"').strip("'")
                        os.environ.setdefault(key.strip(), val)
                postgres_url = os.environ.get('POSTGRES_URL')
                if postgres_url:
                    print(f"Loaded POSTGRES_URL from {env_path}", file=sys.stderr)
                    break
    if not postgres_url:
        print("ERROR: POSTGRES_URL not found in env or .env.local", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(postgres_url)
    cur = conn.cursor()

    if args.fresh:
        print("--fresh: truncating cluster tables (cascade)...", file=sys.stderr)
        cur.execute("TRUNCATE synonym_clusters CASCADE")
        conn.commit()
        print("  Done (words/gloss_tokens/word_glosses preserved)", file=sys.stderr)

    all_words = parse_cedict(args.cedict)
    hsk = load_hsk(args.hsk) if args.hsk else None
    words, clusters = build_clusters(all_words, hsk)
    seed(conn, words, clusters, args.batch)

    cur.execute("SELECT COUNT(*) FROM words")
    w_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM synonym_clusters")
    c_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM synonym_edges")
    e_count = cur.fetchone()[0]

    print(f"\nDB totals: {w_count} words | {c_count} clusters | {e_count} edges", file=sys.stderr)
    conn.close()
    print("Seed complete.", file=sys.stderr)


if __name__ == '__main__':
    main()
