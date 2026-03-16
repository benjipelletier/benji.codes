import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/react';

export const metadata: Metadata = {
  title: '同义词星图 — Synonym Cluster Graph',
  description: 'Learn Chinese synonym distinctions through interactive word clusters, collocational gravity fields, and contextual challenges.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@900&family=JetBrains+Mono:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html, body { height: 100%; }
          body {
            background: #0a0806;
            color: #e8d5b0;
            font-family: 'JetBrains Mono', 'Courier New', monospace;
            font-weight: 300;
            -webkit-font-smoothing: antialiased;
          }
          .zh {
            font-family: 'Noto Serif SC', 'Songti SC', serif;
            font-weight: 900;
          }
          ::selection { background: rgba(217, 164, 65, 0.3); }
          /* View transition: smooth fade between cluster pages */
          ::view-transition-old(root) {
            animation: 220ms ease-out both vtFadeOut;
          }
          ::view-transition-new(root) {
            animation: 280ms ease-in both vtFadeIn;
          }
          @keyframes vtFadeOut {
            from { opacity: 1; transform: scale(1); }
            to   { opacity: 0; transform: scale(0.97); }
          }
          @keyframes vtFadeIn {
            from { opacity: 0; transform: scale(1.02); }
            to   { opacity: 1; transform: scale(1); }
          }
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-track { background: #0a0806; }
          ::-webkit-scrollbar-thumb { background: rgba(217, 164, 65, 0.3); border-radius: 3px; }
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes titleGlow {
            0%, 100% { text-shadow: 0 0 20px rgba(217,164,65,0.35); }
            50%       { text-shadow: 0 0 36px rgba(217,164,65,0.65), 0 0 8px rgba(217,164,65,0.3); }
          }
          .title-glow { animation: titleGlow 3.5s ease-in-out infinite; }
          @keyframes uiFadeDown {
            from { opacity: 0; transform: translateY(-8px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .ui-fade-down { animation: uiFadeDown 0.5s cubic-bezier(0.22,1,0.36,1) both; }
        `}</style>
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
