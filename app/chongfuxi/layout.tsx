import type { Metadata, Viewport } from "next";
import "@chongfuxi/styles/chongfuxi.css";

export const metadata: Metadata = {
  title: "重复习 · Pleco-driven review",
  description:
    "Spaced repetition built from your Pleco decks: every word you add unlocks the sentences you can now read.",
  // Installable from the browser menu, so practice opens full screen like an app.
  manifest: "/chongfuxi/manifest.webmanifest",
  appleWebApp: { capable: true, title: "重复习", statusBarStyle: "default" },
  icons: { icon: "/chongfuxi/icon-192.png", apple: "/chongfuxi/apple-touch-icon.png" },
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
  return <>{children}</>;
}
