// The Chinese text of a web page, for the text analyser: fetched on the
// server, its charset honoured (many Chinese sites are still GBK), and cut
// down to the lines of the page's body that carry Chinese, so menus, footers
// and scripts fall away. Owner only: it fetches whatever it is given.

/** Longest page read, in bytes. */
const PAGE_MAX = 4_000_000;
const TIMEOUT_MS = 15_000;
/** A line needs this many Han characters to be kept: menu items and labels have fewer. */
const LINE_MIN_HAN = 4;

export class FetchError extends Error {}

/** A host that is this machine or a private network: not to be fetched. */
function isPrivate(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // An IPv6 address: loopback, unique local or link local.
  if (h.includes(":")) return h === "::1" || /^(fc|fd|fe80)/.test(h);
  const ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new FetchError("That isn't a link.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchError("Only http and https links can be read.");
  if (isPrivate(url.hostname)) throw new FetchError("That address can't be read from here.");
  return url;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ldquo: "“", rdquo: "”", hellip: "…", mdash: "—" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const han = (s: string) => (s.match(/[㐀-鿿]/g) ?? []).length;

/** The page's lines with Chinese in, from its article if it marks one, else its body. */
export function pageText(html: string): { title: string | null; text: string } {
  const title =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    null;
  let body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|iframe|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, "");
  const article = body.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ?? body.match(/<main\b[\s\S]*?<\/main>/i)?.[0];
  if (article && han(article) >= 200) body = article;
  const text = decodeEntities(
    body
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/blockquote)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => han(l) >= LINE_MIN_HAN)
    .join("\n");
  return { title: title ? decodeEntities(title).trim().slice(0, 200) : null, text };
}

/** Fetch a page and keep its Chinese text. */
export async function fetchPage(raw: string): Promise<{ title: string | null; text: string; url: string }> {
  const url = checkUrl(raw);
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.5",
        accept: "text/html,application/xhtml+xml",
      },
    });
  } catch {
    throw new FetchError("The page didn't answer.");
  }
  if (!res.ok) throw new FetchError(`The page answered ${res.status}.`);
  const bytes = new Uint8Array(await res.arrayBuffer()).slice(0, PAGE_MAX);
  // The charset: the header's, else the page's own meta, else UTF-8.
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
  const charset =
    res.headers.get("content-type")?.match(/charset=([\w-]+)/i)?.[1] ?? head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? "utf-8";
  let html: string;
  try {
    html = new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    html = new TextDecoder("utf-8").decode(bytes);
  }
  const page = pageText(html);
  if (han(page.text) < 10) throw new FetchError("No Chinese text found on that page.");
  return { ...page, url: url.toString() };
}
