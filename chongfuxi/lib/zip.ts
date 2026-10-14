// The text files in a .zip, read in the browser: the central directory for
// where each file is, and DecompressionStream for the deflated ones. Enough
// for a folder of lessons zipped on a phone or a computer; not a general
// archive reader (no encryption, no zip64).

export interface ZipText {
  name: string;
  text: string;
}

const u16 = (v: DataView, at: number) => v.getUint16(at, true);
const u32 = (v: DataView, at: number) => v.getUint32(at, true);

async function inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Every file in the zip whose name ends in .txt (or .md, .srt), decoded as UTF-8, in name order. */
export async function readZipTexts(bytes: ArrayBuffer, wanted = /\.(txt|md|srt|vtt)$/i): Promise<ZipText[]> {
  const v = new DataView(bytes);
  // The end-of-central-directory record: within the last 64 KB, signature 0x06054b50.
  let end = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 65557); i--) {
    if (u32(v, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("That isn't a zip file.");
  const count = u16(v, end + 10);
  let at = u32(v, end + 16);
  const decoder = new TextDecoder("utf-8");
  const out: ZipText[] = [];
  for (let n = 0; n < count; n++) {
    if (u32(v, at) !== 0x02014b50) throw new Error("The zip's directory is damaged.");
    const method = u16(v, at + 10);
    const size = u32(v, at + 20);
    const nameLength = u16(v, at + 28);
    const extraLength = u16(v, at + 30);
    const commentLength = u16(v, at + 32);
    const local = u32(v, at + 42);
    const name = decoder.decode(new Uint8Array(bytes, at + 46, nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    // Folders, macOS's resource forks, and anything not text.
    if (name.endsWith("/") || name.startsWith("__MACOSX/") || !wanted.test(name)) continue;
    const start = local + 30 + u16(v, local + 26) + u16(v, local + 28);
    const raw = new Uint8Array(bytes, start, size);
    const data = method === 0 ? raw : method === 8 ? await inflate(raw) : null;
    if (!data) throw new Error(`${name} is packed in a way this can't read.`);
    out.push({ name: name.split("/").pop() ?? name, text: decoder.decode(data) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
