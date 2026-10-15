// A YouTube video's Chinese captions, for the text analyser.
//
// YouTube's caption links from its web player now need a token only a real
// browser can make, so the player is asked for as YouTube's phone apps ask
// for it (the Android client, then the iOS one), whose caption links can be
// read as they are. Hand-made Chinese captions are preferred to automatic
// ones, simplified to traditional. Each caption line is kept as a line of the
// text. YouTube may refuse a server it takes for a bot; then the owner is
// told to paste the captions instead. Client versions here go stale and need
// bumping now and then.

import { FetchError } from "./fetchtext";

const CLIENTS = [
  {
    client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34 },
    ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
  },
  {
    client: { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2" },
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  },
];

/** Simplified first; a track YouTube made itself (asr) after any made by hand. */
const LANGUAGES = ["zh-Hans", "zh-CN", "zh-SG", "zh", "zh-Hant", "zh-TW", "zh-HK"];

interface Track {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

/** The video's id, from any of the shapes a YouTube link takes; null when it isn't one. */
export function videoId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtu.be") return url.pathname.slice(1, 12) || null;
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  const v = url.searchParams.get("v");
  if (v) return v.slice(0, 11);
  const path = url.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
  return path?.[2] ?? null;
}

function pick(tracks: Track[]): Track | null {
  const zh = tracks.filter((t) => t.languageCode.startsWith("zh"));
  const rank = (t: Track) => (t.kind === "asr" ? 100 : 0) + (LANGUAGES.indexOf(t.languageCode) + 1 || 50);
  return zh.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** The captions as lines, a repeated line (automatic captions roll) kept once. */
function linesOf(json: { events?: Array<{ segs?: Array<{ utf8?: string }> }> }): string[] {
  const out: string[] = [];
  for (const e of json.events ?? []) {
    const line = (e.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (line && line !== out[out.length - 1]) out.push(line);
  }
  return out;
}

export async function fetchCaptions(id: string): Promise<{ title: string | null; text: string; url: string; automatic: boolean }> {
  let refused = false;
  for (const { client, ua } of CLIENTS) {
    let player: {
      playabilityStatus?: { status?: string };
      videoDetails?: { title?: string };
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } };
    };
    try {
      const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json", "user-agent": ua },
        body: JSON.stringify({ videoId: id, context: { client: { ...client, hl: "zh-CN", gl: "US" } } }),
      });
      player = await res.json();
    } catch {
      continue;
    }
    if (player.playabilityStatus?.status !== "OK") {
      refused = true;
      continue;
    }
    const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const track = pick(tracks);
    if (!track) throw new FetchError(tracks.length ? "That video has captions, but none in Chinese." : "That video has no captions.");
    try {
      const res = await fetch(`${track.baseUrl.replace(/&fmt=[^&]*/, "")}&fmt=json3`, {
        signal: AbortSignal.timeout(15_000),
        headers: { "user-agent": ua },
      });
      const lines = linesOf(await res.json());
      if (lines.length) {
        return {
          title: player.videoDetails?.title ?? null,
          text: lines.join("\n"),
          url: `https://www.youtube.com/watch?v=${id}`,
          automatic: track.kind === "asr",
        };
      }
    } catch {
      // Empty or refused: the next client may do better.
    }
  }
  throw new FetchError(
    refused
      ? "YouTube wouldn't share that video's captions with the server. Paste them instead: on YouTube, … › Show transcript."
      : "Couldn't read that video's captions. Paste them instead: on YouTube, … › Show transcript.",
  );
}
