import { neon } from '@neondatabase/serverless';
import type { ContentMap, ContentMetadata, LineAnnotation, ContentRow } from './types';

let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

// ─── Schema Setup ────────────────────────────────────────────────────────────

let tablesEnsured = false;

export async function ensureTables() {
  if (tablesEnsured) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS contents (
      content_hash TEXT PRIMARY KEY,
      source_text TEXT NOT NULL,
      content_map JSONB NOT NULL,
      title TEXT,
      artist TEXT,
      content_type TEXT NOT NULL DEFAULT 'other',
      language_variant TEXT NOT NULL DEFAULT 'simplified',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS line_annotations (
      content_hash TEXT NOT NULL REFERENCES contents(content_hash),
      line_index INT NOT NULL,
      annotation JSONB NOT NULL,
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (content_hash, line_index)
    )
  `;
  tablesEnsured = true;
}

// ─── Content Map ─────────────────────────────────────────────────────────────

export async function getContent(contentHash: string): Promise<ContentRow | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM contents WHERE content_hash = ${contentHash}
  ` as Record<string, unknown>[];
  return (rows[0] as unknown as ContentRow) ?? null;
}

export async function storeContent(
  contentHash: string,
  sourceText: string,
  contentMap: ContentMap,
  metadata: ContentMetadata,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO contents (content_hash, source_text, content_map, title, artist, content_type, language_variant)
    VALUES (
      ${contentHash},
      ${sourceText},
      ${JSON.stringify(contentMap)},
      ${metadata.title},
      ${metadata.artist},
      ${metadata.contentType},
      ${metadata.languageVariant}
    )
    ON CONFLICT (content_hash) DO NOTHING
  `;
}

// ─── Line Annotations ────────────────────────────────────────────────────────

export async function getLineAnnotation(
  contentHash: string,
  lineIndex: number,
): Promise<LineAnnotation | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT annotation FROM line_annotations
    WHERE content_hash = ${contentHash} AND line_index = ${lineIndex}
  ` as Record<string, unknown>[];
  const row = rows[0] as unknown as { annotation: LineAnnotation } | undefined;
  return row?.annotation ?? null;
}

export async function storeLineAnnotation(
  contentHash: string,
  lineIndex: number,
  annotation: LineAnnotation,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO line_annotations (content_hash, line_index, annotation)
    VALUES (${contentHash}, ${lineIndex}, ${JSON.stringify(annotation)})
    ON CONFLICT (content_hash, line_index) DO UPDATE SET
      annotation = ${JSON.stringify(annotation)},
      version = line_annotations.version + 1
  `;
}
