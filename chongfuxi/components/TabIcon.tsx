// The tab bar's icons: a drawing for what the tab is, with one character of
// its Chinese name set over it. The character carries a halo in the colour
// behind it (--cf-tab-halo), so it reads where it crosses a line.

export type TabIconKind = "review" | "cards" | "lookup" | "stats" | "settings";

const GLYPH: Record<TabIconKind, { zh: string; x: number; y: number; size: number }> = {
  review: { zh: "复", x: 16, y: 16.5, size: 16.5 },
  cards: { zh: "卡", x: 14.5, y: 18.5, size: 16 },
  lookup: { zh: "查", x: 13.5, y: 13.5, size: 13.5 },
  stats: { zh: "统", x: 11, y: 11.5, size: 16.5 },
  settings: { zh: "设", x: 16, y: 16, size: 12.5 },
};

function Drawing({ kind }: { kind: TabIconKind }) {
  switch (kind) {
    // Going round again: a ring that ends in an arrowhead.
    case "review":
      return (
        <>
          <path d="M23.7 6.8A12 12 0 1 1 11.9 4.7" />
          <path d="M8.5 2.6 13.8 4 10.6 8.6" />
        </>
      );
    // A card in front of another.
    case "cards":
      return (
        <>
          <rect x="10" y="3" width="16" height="21" rx="3" transform="rotate(10 18 13.5)" className="cf-ti-back" />
          <rect x="6" y="8" width="17" height="21" rx="3" className="cf-ti-face" />
        </>
      );
    // A lens with its handle, the character inside it.
    case "lookup":
      return (
        <>
          <circle cx="13.5" cy="13.5" r="10" className="cf-ti-face" />
          <path d="M21 21l6.5 6.5" />
        </>
      );
    // Bars rising to the right, on a baseline.
    case "stats":
      return (
        <>
          <rect x="5" y="19" width="5.5" height="8.5" rx="1.5" className="cf-ti-fill" />
          <rect x="13.25" y="13" width="5.5" height="14.5" rx="1.5" className="cf-ti-fill" />
          <rect x="21.5" y="6.5" width="5.5" height="21" rx="1.5" className="cf-ti-fill" />
          <path d="M3 28.5h26" />
        </>
      );
    // A cog, the character in its middle.
    case "settings":
      return (
        <path
          className="cf-ti-face"
          d="M25.9 13.5 L28.7 13.4 L28.7 18.6 L25.9 18.5 L24.8 21.2 L26.8 23.2 L23.2 26.8 L21.2 24.8 L18.5 25.9 L18.6 28.7 L13.4 28.7 L13.5 25.9 L10.8 24.8 L8.8 26.8 L5.2 23.2 L7.2 21.2 L6.1 18.5 L3.3 18.6 L3.3 13.4 L6.1 13.5 L7.2 10.8 L5.2 8.8 L8.8 5.2 L10.8 7.2 L13.5 6.1 L13.4 3.3 L18.6 3.3 L18.5 6.1 L21.2 7.2 L23.2 5.2 L26.8 8.8 L24.8 10.8Z"
          strokeLinejoin="round"
        />
      );
  }
}

export function TabIcon({ kind }: { kind: TabIconKind }) {
  const g = GLYPH[kind];
  return (
    <svg className="cf-ti" viewBox="0 0 32 32" aria-hidden="true">
      <g className="cf-ti-draw">
        <Drawing kind={kind} />
      </g>
      <text x={g.x} y={g.y} fontSize={g.size} className="cf-ti-zh">
        {g.zh}
      </text>
    </svg>
  );
}
