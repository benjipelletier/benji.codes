import { Suspense } from 'react';
import { PlaylistPage } from '@ifakepro/components/Pages';

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense>
      <PlaylistPage slug={slug} />
    </Suspense>
  );
}
