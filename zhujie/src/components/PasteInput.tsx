'use client';

import { useState } from 'react';
import { colors, fonts } from '@/styles/theme';
import type { ContentMapResponse } from '@/lib/types';

interface PasteInputProps {
  onComplete: (data: ContentMapResponse) => void;
}

export default function PasteInput({ onComplete }: PasteInputProps) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/content-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          title: title || undefined,
          artist: artist || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to annotate');
      }

      const data: ContentMapResponse = await res.json();
      if (data.metadata.title && !title) setTitle(data.metadata.title);
      if (data.metadata.artist && !artist) setArtist(data.metadata.artist);
      onComplete(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const s = {
    container: {
      maxWidth: 600,
      margin: '0 auto',
      padding: '60px 24px',
    } as React.CSSProperties,
    header: {
      textAlign: 'center' as const,
      marginBottom: 40,
    } as React.CSSProperties,
    logo: {
      fontSize: 32,
      fontWeight: 700,
      fontFamily: fonts.chinese,
      color: colors.vocab,
      letterSpacing: 4,
      marginBottom: 6,
    } as React.CSSProperties,
    tagline: {
      fontSize: 13,
      color: colors.textFaint,
    } as React.CSSProperties,
    textarea: {
      width: '100%',
      minHeight: 200,
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: 16,
      color: colors.text,
      fontFamily: fonts.chinese,
      fontSize: 16,
      lineHeight: 2,
      resize: 'vertical' as const,
      outline: 'none',
    } as React.CSSProperties,
    metaRow: {
      display: 'flex',
      gap: 12,
      marginTop: 16,
    } as React.CSSProperties,
    metaField: {
      flex: 1,
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 6,
      padding: '10px 12px',
    } as React.CSSProperties,
    metaLabel: {
      fontSize: 11,
      color: colors.textFaint,
      marginBottom: 4,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.5,
    } as React.CSSProperties,
    metaInput: {
      width: '100%',
      background: 'transparent',
      border: 'none',
      color: colors.vocab,
      fontSize: 14,
      fontFamily: fonts.body,
      outline: 'none',
    } as React.CSSProperties,
    button: {
      display: 'block',
      width: '100%',
      marginTop: 24,
      padding: '12px 32px',
      background: loading ? colors.textFaint : colors.vocab,
      color: colors.bg,
      fontWeight: 600,
      fontSize: 15,
      border: 'none',
      borderRadius: 6,
      cursor: loading ? 'wait' : 'pointer',
      fontFamily: fonts.body,
    } as React.CSSProperties,
    error: {
      marginTop: 12,
      color: colors.grammar,
      fontSize: 13,
      textAlign: 'center' as const,
    } as React.CSSProperties,
  };

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div style={s.logo}>注解</div>
        <div style={s.tagline}>Pre-study every line before you press play</div>
      </div>

      <textarea
        style={s.textarea}
        placeholder="Paste Chinese content..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={loading}
      />

      <div style={s.metaRow}>
        <div style={s.metaField}>
          <div style={s.metaLabel}>Title</div>
          <input
            style={s.metaInput}
            placeholder="Auto-detected"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={loading}
          />
        </div>
        <div style={s.metaField}>
          <div style={s.metaLabel}>Artist</div>
          <input
            style={s.metaInput}
            placeholder="Auto-detected"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            disabled={loading}
          />
        </div>
      </div>

      <button style={s.button} onClick={handleSubmit} disabled={loading}>
        {loading ? 'Analyzing...' : 'Annotate'}
      </button>

      {error && <div style={s.error}>{error}</div>}
    </div>
  );
}
