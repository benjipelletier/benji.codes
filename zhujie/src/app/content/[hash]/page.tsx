'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { colors } from '@/styles/theme';
import type { ContentMapResponse } from '@/lib/types';
import type { LineDecomposition, YuKuai, UserYuKuai } from '@/lib/yukuai-types';
import LineList from '@/components/LineList';
import AnnotationView from '@/components/AnnotationView';

const MOBILE_BREAKPOINT = 640;

interface DecomposeResult {
  decomposition: LineDecomposition;
  yukuai: YuKuai[];
  userState: UserYuKuai[] | null;
  recallIds: string[];
}

export default function ContentWorkspace() {
  const params = useParams();
  const router = useRouter();
  const hash = params.hash as string;

  const [contentData, setContentData] = useState<ContentMapResponse | null>(null);
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);
  const [decompositions, setDecompositions] = useState<Map<number, DecomposeResult>>(new Map());
  const [annotatedLines, setAnnotatedLines] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showAnnotation, setShowAnnotation] = useState(false);
  const touchStartX = useRef(0);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem(`content:${hash}`);
    if (stored) {
      setContentData(JSON.parse(stored));
      return;
    }
    fetch(`/api/content-map?hash=${hash}`)
      .then((res) => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then((data) => {
        sessionStorage.setItem(`content:${hash}`, JSON.stringify(data));
        setContentData(data);
      })
      .catch(() => router.push('/'));
  }, [hash, router]);

  const handleLineClick = useCallback(
    async (lineIndex: number) => {
      setActiveLineIndex(lineIndex);
      if (isMobile) setShowAnnotation(true);
      if (decompositions.has(lineIndex)) return;

      setLoading(true);
      try {
        const res = await fetch('/api/decompose-line', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentHash: hash, lineIndex }),
        });
        if (!res.ok) throw new Error('Failed to decompose');
        const result: DecomposeResult = await res.json();
        setDecompositions((prev) => new Map(prev).set(lineIndex, result));
        setAnnotatedLines((prev) => new Set(prev).add(lineIndex));
      } catch (error) {
        console.error('Decomposition error:', error);
      } finally {
        setLoading(false);
      }
    },
    [hash, decompositions, isMobile],
  );

  const handleRecallResult = useCallback(
    async (yukuaiId: string, result: 'success' | 'fail') => {
      try {
        await fetch('/api/recall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ yukuaiId, contentHash: hash, result }),
        });
      } catch (error) {
        console.error('Recall error:', error);
      }
    },
    [hash],
  );

  const handleLineJump = useCallback(
    (lineIndex: number) => {
      handleLineClick(lineIndex);
    },
    [handleLineClick],
  );

  const handleBack = useCallback(() => {
    setShowAnnotation(false);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!contentData || activeLineIndex === null) return;
      const diff = e.changedTouches[0].clientX - touchStartX.current;
      const threshold = 80;
      if (diff > threshold && activeLineIndex > 0) {
        handleLineClick(activeLineIndex - 1);
      } else if (diff < -threshold && activeLineIndex < contentData.lines.length - 1) {
        handleLineClick(activeLineIndex + 1);
      }
    },
    [contentData, activeLineIndex, handleLineClick],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!contentData) return;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const next = activeLineIndex === null ? 0 : Math.min(activeLineIndex + 1, contentData.lines.length - 1);
        handleLineClick(next);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const prev = activeLineIndex === null ? 0 : Math.max(activeLineIndex - 1, 0);
        handleLineClick(prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contentData, activeLineIndex, handleLineClick]);

  if (!contentData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: colors.textMuted }}>
        Loading...
      </div>
    );
  }

  const activeResult = activeLineIndex !== null ? decompositions.get(activeLineIndex) ?? null : null;

  if (isMobile) {
    return (
      <div
        style={{ height: '100vh', background: colors.bg }}
        onTouchStart={showAnnotation ? handleTouchStart : undefined}
        onTouchEnd={showAnnotation ? handleTouchEnd : undefined}
      >
        {showAnnotation ? (
          <AnnotationView
            lineIndex={activeLineIndex}
            decomposition={activeResult?.decomposition ?? null}
            yukuai={activeResult?.yukuai ?? []}
            userState={activeResult?.userState ?? null}
            recallIds={activeResult?.recallIds ?? []}
            loading={loading}
            lines={contentData.lines}
            isMobile={true}
            onLineJump={handleLineJump}
            onBack={handleBack}
            onRecallResult={handleRecallResult}
          />
        ) : (
          <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
            <LineList
              lines={contentData.lines}
              activeLineIndex={activeLineIndex}
              annotatedLines={annotatedLines}
              onLineClick={handleLineClick}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: colors.bg }}>
      <LineList
        lines={contentData.lines}
        activeLineIndex={activeLineIndex}
        annotatedLines={annotatedLines}
        onLineClick={handleLineClick}
      />
      <AnnotationView
        lineIndex={activeLineIndex}
        decomposition={activeResult?.decomposition ?? null}
        yukuai={activeResult?.yukuai ?? []}
        userState={activeResult?.userState ?? null}
        recallIds={activeResult?.recallIds ?? []}
        loading={loading}
        lines={contentData.lines}
        isMobile={false}
        onLineJump={handleLineJump}
        onRecallResult={handleRecallResult}
      />
    </div>
  );
}
