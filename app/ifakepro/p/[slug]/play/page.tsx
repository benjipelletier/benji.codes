import { Suspense } from 'react';
import { SetlistMode } from '@ifakepro/components/Stage';

export const metadata = { title: 'Setlist' };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense>
      <SetlistMode slug={slug} />
    </Suspense>
  );
}
