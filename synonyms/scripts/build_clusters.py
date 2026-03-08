#!/usr/bin/env python3
"""
build_clusters.py — Parse CC-CEDICT → synonym clusters JSON

Usage:
  python scripts/build_clusters.py \
    --cedict data/cedict_ts.u8 \
    --hsk data/hsk_words.txt \   # optional
    --output data/clusters.json

CC-CEDICT format: TRADITIONAL SIMPLIFIED [pin1 yin1] /gloss1/gloss2/.../

Output JSON shape:
{
  "clusters": [...],
  "words": { simplified: { simplified, traditional, pinyin, glosses, all_tokens } },
  "enrichment_prompts": [ { cluster_label, prompt } ]
}
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from itertools import combinations


# ─── Gloss normalization ────────────────────────────────────────────────────

STRIP_PREFIXES = [
    "to become ", "to make ", "to get ", "to be ", "to ",
    "an ", "a ", "the ",
]

STRIP_SUFFIXES = [
    " (of sth)", " (sb)", " (sth)", " (lit.)", " (fig.)", " (coll.)",
    " sth", " sb",
]

SKIP_PREFIXES = [
    "classifier ", "variant of ", "see ", "abbr. ", "surname ", "CL:",
    "old variant", "also written", "Japanese variant",
]


def normalize_gloss(raw: str) -> str | None:
    """Normalize one gloss string to a token, or return None to skip."""
    g = raw.strip()

    # Skip entirely if starts with a skip prefix
    for skip in SKIP_PREFIXES:
        if g.lower().startswith(skip.lower()):
            return None

    # Remove parentheticals like (math.) or (fig.)
    g = re.sub(r'\([^)]*\)', '', g).strip()

    # Remove text after semicolon (secondary meaning)
    if ';' in g:
        g = g[:g.index(';')].strip()

    # Strip leading prefixes (longest first to avoid partial matches)
    for prefix in STRIP_PREFIXES:
        if g.lower().startswith(prefix.lower()):
            g = g[len(prefix):]
            break

    # Strip trailing suffixes
    for suffix in STRIP_SUFFIXES:
        if g.lower().endswith(suffix.lower()):
            g = g[:-len(suffix)].strip()
            break

    # Clean up extra whitespace
    g = re.sub(r'\s+', ' ', g).strip()

    # Minimum length check
    if len(g) < 2:
        return None

    return g.lower()


# ─── CC-CEDICT parser ────────────────────────────────────────────────────────

def parse_cedict(path: str) -> list[dict]:
    """Parse CC-CEDICT file, return list of word entries."""
    words = []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue

                # Format: TRAD SIMP [pin1 yin1] /gloss1/gloss2/.../
                m = re.match(
                    r'^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+/(.+)/$',
                    line
                )
                if not m:
                    continue

                traditional, simplified, pinyin_raw, glosses_raw = m.groups()
                raw_glosses = [g for g in glosses_raw.split('/') if g.strip()]

                # Normalize each gloss to a token
                tokens = []
                for g in raw_glosses:
                    t = normalize_gloss(g)
                    if t:
                        tokens.append(t)

                if not tokens:
                    continue

                words.append({
                    'simplified': simplified,
                    'traditional': traditional,
                    'pinyin': pinyin_raw,
                    'glosses': raw_glosses,
                    'all_tokens': list(dict.fromkeys(tokens)),  # deduplicated, order preserved
                })

    except FileNotFoundError:
        print(f"ERROR: CC-CEDICT file not found at {path}", file=sys.stderr)
        sys.exit(1)

    print(f"Parsed {len(words)} entries from CC-CEDICT", file=sys.stderr)
    return words


# ─── HSK filter ─────────────────────────────────────────────────────────────

def load_hsk(path: str) -> set[str]:
    """Load HSK word list. One word per line, optionally tab-separated with level."""
    hsk_words = set()
    try:
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                # Tab-separated: word\tlevel or just word
                parts = line.split('\t')
                hsk_words.add(parts[0].strip())
    except FileNotFoundError:
        print(f"WARNING: HSK file not found at {path}, skipping filter", file=sys.stderr)
        return set()
    print(f"Loaded {len(hsk_words)} HSK words", file=sys.stderr)
    return hsk_words


# ─── Cluster builder ─────────────────────────────────────────────────────────

def build_clusters(words: list[dict], hsk_words: set[str] | None = None) -> list[dict]:
    """
    Build synonym clusters from word list.

    Algorithm:
    1. Inverted index: normalized_token → [word entries]
    2. Any token with 2–12 members = a cluster
    3. For each cluster, compute edges (one per shared gloss token per word pair)
    """
    # Filter to HSK words if provided
    if hsk_words:
        words = [w for w in words if w['simplified'] in hsk_words]
        print(f"After HSK filter: {len(words)} entries", file=sys.stderr)

    # Deduplicate: keep first entry per (simplified, pinyin) pair
    seen = set()
    deduped = []
    for w in words:
        key = (w['simplified'], w['pinyin'])
        if key not in seen:
            seen.add(key)
            deduped.append(w)
    words = deduped

    # Build inverted index: token → list of word indices
    token_to_words: dict[str, list[int]] = defaultdict(list)
    for i, w in enumerate(words):
        for token in w['all_tokens']:
            token_to_words[token].append(i)

    # Build clusters for tokens with 2–12 members
    clusters = []
    seen_member_sets: set[frozenset[int]] = set()

    for token, indices in sorted(token_to_words.items()):
        unique_indices = list(dict.fromkeys(indices))  # preserve order, deduplicate
        if len(unique_indices) < 2 or len(unique_indices) > 12:
            continue

        member_set = frozenset(unique_indices)
        if member_set in seen_member_sets:
            continue
        seen_member_sets.add(member_set)

        members = [words[i] for i in unique_indices]

        # Compute edges: for each pair, one edge per shared gloss token
        edges = []
        for idx1, idx2 in combinations(range(len(members)), 2):
            w1, w2 = members[idx1], members[idx2]
            shared_tokens = set(w1['all_tokens']) & set(w2['all_tokens'])
            for shared_token in sorted(shared_tokens):
                edges.append({
                    'word1': w1['simplified'],
                    'word2': w2['simplified'],
                    'gloss': shared_token,
                })

        if not edges:
            continue

        clusters.append({
            'label': token,
            'size': len(members),
            'members': members,
            'edges': edges,
        })

    print(f"Built {len(clusters)} synonym clusters", file=sys.stderr)
    return clusters


# ─── Enrichment prompt builder ───────────────────────────────────────────────

def build_enrichment_prompt(cluster: dict) -> str:
    """Build the LLM enrichment prompt for a cluster."""
    member_lines = []
    for m in cluster['members']:
        tokens_str = ', '.join(m['all_tokens'][:5])
        member_lines.append(
            f"  - {m['simplified']} ({m['traditional']}) [{m['pinyin']}]: "
            f"{'; '.join(m['glosses'][:3])} | tokens: {tokens_str}"
        )

    edge_pairs = defaultdict(list)
    for e in cluster['edges']:
        key = (e['word1'], e['word2'])
        edge_pairs[key].append(e['gloss'])

    edge_lines = [
        f"  - {w1}↔{w2}: shared glosses: {', '.join(glosses)}"
        for (w1, w2), glosses in edge_pairs.items()
    ]

    members_str = '/'.join(m['simplified'] for m in cluster['members'])

    return f"""You are a Chinese linguistics expert. Analyze this synonym cluster and return ONLY valid JSON.

Cluster label: "{cluster['label']}"
Words: {members_str}

Members:
{chr(10).join(member_lines)}

Edges (shared glosses):
{chr(10).join(edge_lines)}

Return JSON with this exact shape:
{{
  "words": {{
    "<simplified>": {{
      "core_scene": "1 sentence describing the specific perceptual/physical scene this word evokes — what makes it DIFFERENT from its siblings",
      "collocations": [
        {{
          "phrase": "<Chinese phrase>",
          "pinyin": "<pinyin>",
          "gloss": "<English gloss>",
          "weight": <0.0-1.0, higher = stronger association>,
          "pattern": "<compound|verb-object|complement|modifier|idiom>",
          "shared_with": ["<simplified chars of other cluster members that also commonly use this collocation>"]
        }}
      ]
    }}
  }},
  "situations": [
    {{
      "scenario": "<English situation description, 1-2 sentences>",
      "answer": "<simplified char of the correct word>",
      "why": "<explanation of why this word fits and others don't>",
      "example_zh": "<example sentence in Chinese using the correct word>",
      "difficulty": <1=obvious, 2=requires thought, 3=tricky>
    }}
  ]
}}

Rules:
- 5-8 collocations per word
- 2-3 situations total (not per word), covering different words as answers
- core_scene must highlight the DISTINGUISHING feature vs siblings
- situations should be concrete, sensory, real-world scenarios"""


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Build synonym clusters from CC-CEDICT')
    parser.add_argument('--cedict', required=True, help='Path to cedict_ts.u8')
    parser.add_argument('--hsk', help='Path to HSK word list (optional)')
    parser.add_argument('--output', required=True, help='Output JSON path')
    parser.add_argument('--min-size', type=int, default=2, help='Min cluster size (default 2)')
    parser.add_argument('--max-size', type=int, default=12, help='Max cluster size (default 12)')
    args = parser.parse_args()

    # Parse CC-CEDICT
    all_words = parse_cedict(args.cedict)

    # Load HSK filter
    hsk_words = None
    if args.hsk:
        hsk_words = load_hsk(args.hsk)

    # Build clusters
    clusters = build_clusters(all_words, hsk_words)

    # Filter by size args
    clusters = [c for c in clusters if args.min_size <= c['size'] <= args.max_size]

    # Build words index
    words_index: dict[str, dict] = {}
    for cluster in clusters:
        for m in cluster['members']:
            words_index[m['simplified']] = m

    # Build enrichment prompts
    enrichment_prompts = [
        {
            'cluster_label': c['label'],
            'members': [m['simplified'] for m in c['members']],
            'prompt': build_enrichment_prompt(c),
        }
        for c in clusters
    ]

    # Serialize clusters (strip bulky member data from cluster list, keep in words_index)
    output_clusters = []
    for c in clusters:
        output_clusters.append({
            'label': c['label'],
            'size': c['size'],
            'members': c['members'],
            'edges': c['edges'],
        })

    output = {
        'clusters': output_clusters,
        'words': words_index,
        'enrichment_prompts': enrichment_prompts,
        'stats': {
            'total_cedict_entries': len(all_words),
            'total_clusters': len(clusters),
            'total_unique_words': len(words_index),
        },
    }

    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Written to {args.output}", file=sys.stderr)
    print(f"Stats: {output['stats']}", file=sys.stderr)


if __name__ == '__main__':
    main()
