import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_SC } from "next/font/google";
import "@chongfuxi/styles/chongfuxi.css";

// Inter for Latin: one of the few UI faces with every pinyin vowel (ǎ ǐ ǒ ǔ ǖ
// ǘ ǚ ǜ), so a syllable never falls back mid-word. Noto Sans SC for Chinese,
// as a web font so every weight is real on the phone rather than a system
// face bolded by the browser. Both variable, so 550 and 650 are exact.
const latin = Inter({ subsets: ["latin", "latin-ext"], variable: "--cf-font-latin", display: "swap" });
// Served in unicode-range slices: only the characters on screen are fetched.
const han = Noto_Sans_SC({ preload: false, variable: "--cf-font-han", display: "swap" });
// The tab icons' characters in LXGW WenKai (霞鹜文楷), a modern regular script.
// Five characters, so only those are fetched: a few KB, not the whole face.
const TAB_GLYPHS = `https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@700&text=${encodeURIComponent("复卡查统入")}&display=block`;

export const metadata: Metadata = {
  title: "重复习 · Pleco-driven review",
  description:
    "Spaced repetition built from your Pleco decks: every word you add unlocks the sentences you can now read.",
  // Installable from the browser menu, so practice opens full screen like an app.
  manifest: "/chongfuxi/manifest.webmanifest",
  appleWebApp: { capable: true, title: "重复习", statusBarStyle: "default" },
  // 重复习 on a 3D stack of three flashcards, on the accent blue.
  icons: {
    icon: [
      { url: "/chongfuxi/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/chongfuxi/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/chongfuxi/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/chongfuxi/apple-touch-icon.png",
  },
};

// Phone first: draw under the system bars (the CSS pads by the safe-area
// insets) and colour them to match the ground in either theme.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1014" },
  ],
};

export default function ChongfuxiLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${latin.variable} ${han.variable}`} style={{ display: "contents" }}>
      <link rel="stylesheet" href={TAB_GLYPHS} precedence="default" />
      {children}
    </div>
  );
}
