import type { Metadata, Viewport } from 'next';
import { Providers } from '@ifakepro/components/ui';
import { Shell } from '@ifakepro/components/Pages';
import '@ifakepro/styles/ifakepro.css';

export const metadata: Metadata = {
  title: { default: 'iFake Pro', template: '%s · iFake Pro' },
  description: 'Lead sheets for the band: import from iReal Pro, edit together, comment on bars, keep every version.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f1e6' },
    { media: '(prefers-color-scheme: dark)', color: '#16140f' },
  ],
};

export default function IFakeProLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600&family=Noto+Music&display=swap"
      />
      <div className="ifp">
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </div>
    </>
  );
}
