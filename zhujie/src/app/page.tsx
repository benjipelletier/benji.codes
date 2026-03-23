'use client';

import { useRouter } from 'next/navigation';
import PasteInput from '@/components/PasteInput';
import AuthButton from '@/components/AuthButton';
import type { ContentMapResponse } from '@/lib/types';

export default function Home() {
  const router = useRouter();

  const handleComplete = (data: ContentMapResponse) => {
    sessionStorage.setItem(`content:${data.contentHash}`, JSON.stringify(data));
    router.push(`/content/${data.contentHash}`);
  };

  return (
    <>
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 100 }}>
        <AuthButton />
      </div>
      <PasteInput onComplete={handleComplete} />
      {process.env.NODE_ENV === 'development' && (
        <button
          onClick={() => router.push('/content/5103946e1b8946f522159becbee99102f90a3e1b233c717f9c74df2566450119')}
          style={{ position: 'fixed', bottom: 16, right: 16, padding: '8px 16px', background: '#333', color: '#aaa', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
        >
          DEV: 老伴
        </button>
      )}
    </>
  );
}
