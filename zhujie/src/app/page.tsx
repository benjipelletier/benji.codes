'use client';

import { useRouter } from 'next/navigation';
import PasteInput from '@/components/PasteInput';
import type { ContentMapResponse } from '@/lib/types';

export default function Home() {
  const router = useRouter();

  const handleComplete = (data: ContentMapResponse) => {
    sessionStorage.setItem(`content:${data.contentHash}`, JSON.stringify(data));
    router.push(`/content/${data.contentHash}`);
  };

  return <PasteInput onComplete={handleComplete} />;
}
