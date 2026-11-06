import type { Metadata } from 'next';
import '@jazz/styles/voicings.css';

export const metadata: Metadata = {
  title: 'jazz · voicings',
  description: 'Flashcards and timed drills for jazz piano voicings: play, spell and name them faster.',
  // Installable, so it opens full screen and offline like an app.
  manifest: '/jazz-voicings/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Voicings', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/jazz-voicings/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/jazz-voicings/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/jazz-voicings/apple-touch-icon.png',
  },
};

export default function VoicingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
