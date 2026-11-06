import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Instrument_Serif, Noto_Music } from 'next/font/google';
import '@voicebox/styles/voicebox.css';

// Self-hosted through next/font, so they're /_next/static files the service
// worker keeps: the app looks the same with no connection. Noto Music is the
// fallback for ♭ ♯ ♮, which the other faces don't have.
const serif = Instrument_Serif({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], variable: '--vb-serif', display: 'swap' });
const sans = Geist({ subsets: ['latin'], variable: '--vb-sans', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--vb-mono', display: 'swap' });
const music = Noto_Music({ weight: '400', subsets: ['music'], variable: '--vb-music', display: 'swap', preload: false });

export const metadata: Metadata = {
  title: 'Voicebox · jazz piano voicings, faster',
  description: 'Flashcards and timed drills for jazz piano voicings: play, spell and name them against the clock. Works offline.',
  // Installable, so it opens full screen and offline like an app.
  manifest: '/voicebox/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Voicebox', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/voicebox/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/voicebox/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/voicebox/apple-touch-icon.png',
  },
};

// Phone first: draw under the system bars (the CSS pads by the safe-area
// insets) and colour them to match the ground in either theme.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f1e8d6' },
    { media: '(prefers-color-scheme: dark)', color: '#16120e' },
  ],
};

export default function VoiceboxLayout({ children }: { children: React.ReactNode }) {
  return <div className={`vbx ${serif.variable} ${sans.variable} ${mono.variable} ${music.variable}`}>{children}</div>;
}
