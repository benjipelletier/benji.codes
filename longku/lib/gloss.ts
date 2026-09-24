// CEDICT definitions, trimmed for display. Pure, so client components can use
// it on corpus entries they've fetched.

/**
 * A CEDICT definition cut to its first `senses` senses, without the idiom tag.
 * Two is often worth it: CEDICT tends to lead with the literal reading
 * ("lit. …") and put the sense people actually use second.
 */
export function gloss(e: string, senses = 1): string {
  const s = e
    .replace(/\s*\(idiom\)\s*/g, " ")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, senses)
    .join("; ");
  const max = senses > 1 ? 160 : 90;
  return s.length > max ? `${s.slice(0, max - 3)}…` : s;
}
