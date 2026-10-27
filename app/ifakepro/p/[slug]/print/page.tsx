import { Suspense } from 'react';
import { PrintView } from '@ifakepro/components/Stage';

export const metadata = { title: 'Print' };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense>
      <PrintView slug={slug} />
    </Suspense>
  );
}
