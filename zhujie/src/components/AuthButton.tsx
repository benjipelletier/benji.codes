'use client';

import { useSession, signIn, signOut } from 'next-auth/react';
import { colors } from '@/styles/theme';

export default function AuthButton() {
  const { data: session, status } = useSession();

  if (status === 'loading') return null;

  if (session) {
    return (
      <button
        onClick={() => signOut()}
        style={{
          background: 'transparent',
          border: `1px solid ${colors.border}`,
          color: colors.textMuted,
          padding: '6px 12px',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        {session.user?.name ?? 'Signed in'} · Sign out
      </button>
    );
  }

  return (
    <button
      onClick={() => signIn()}
      style={{
        background: colors.vocabBg,
        border: `1px solid ${colors.vocabBorder}`,
        color: colors.vocab,
        padding: '6px 12px',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      Sign in to track progress
    </button>
  );
}
