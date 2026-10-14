// Sending a Pleco file to the server, and what describes one.
//
// A request body has to fit under Vercel's 4.5 MB limit, so a file travels
// gzipped and in chunks: it is announced, the chunks follow one request each,
// and it counts as stored once the last is in. The server then turns it into
// rows (POST …/ingest); this module only gets it there.

export type ImportFormat = "pqb" | "xml" | "anki";
export type ImportEncoding = "gzip" | "identity";

export interface ImportDescriptor {
  id: string;
  at: number;
  fileName: string;
  sha256: string | null;
  format: ImportFormat;
  encoding: ImportEncoding;
  /** Size before compression. */
  bytes: number;
  chunks: number;
}

export interface StoredImport extends ImportDescriptor {
  /** Every chunk has arrived. */
  complete: boolean;
  /** When it was turned into rows, if it has been. */
  ingested: number | null;
}

export const CHUNK_BYTES = 3 * 1024 * 1024;
export const MAX_CHUNKS = 64;

const API = "/api/chongfuxi";

async function answer<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The server answered ${res.status}.`);
  }
  return res.json() as Promise<T>;
}

/** gzip where the browser can; a .pqb shrinks to well under half. */
export async function compress(bytes: ArrayBuffer): Promise<{ encoding: ImportEncoding; data: ArrayBuffer }> {
  if (typeof CompressionStream === "undefined") return { encoding: "identity", data: bytes };
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return { encoding: "gzip", data: await new Response(stream).arrayBuffer() };
}

export async function sha256(bytes: ArrayBuffer): Promise<string | null> {
  // crypto.subtle is withheld over plain http (a phone on the LAN hitting a dev server).
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fresh id. crypto.randomUUID is secure-context only too, hence the fallback. */
export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** What a file starts with says what it is; phones rename downloads freely. */
export function formatOfHead(head: Uint8Array): "pqb" | "xml" | null {
  const magic = "SQLite format 3\u0000";
  if (head.length >= magic.length && [...magic].every((c, i) => head[i] === c.charCodeAt(0))) return "pqb";
  return /<plecoflash\b/.test(new TextDecoder().decode(head.subarray(0, 2000))) ? "xml" : null;
}

/** Store a file on the server. Resolves with its id once every chunk is in. */
export async function uploadFile(file: File, progress: (sent: number, total: number) => void): Promise<string> {
  const raw = await file.arrayBuffer();
  const format = formatOfHead(new Uint8Array(raw, 0, Math.min(raw.byteLength, 2000)));
  if (!format) throw new Error("This doesn't look like a Pleco flashcard backup (.pqb) or card export (.xml).");
  const [hash, packed] = await Promise.all([sha256(raw), compress(raw)]);
  const chunks = Math.max(1, Math.ceil(packed.data.byteLength / CHUNK_BYTES));
  const descriptor: ImportDescriptor = {
    id: newId(),
    at: Date.now(),
    fileName: file.name,
    sha256: hash,
    format,
    encoding: packed.encoding,
    bytes: raw.byteLength,
    chunks,
  };
  await answer(
    await fetch(`${API}/imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(descriptor),
    }),
  );
  for (let i = 0; i < chunks; i++) {
    await answer(
      await fetch(`${API}/imports/${encodeURIComponent(descriptor.id)}/${i}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: packed.data.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES),
      }),
    );
    progress(i + 1, chunks);
  }
  return descriptor.id;
}
