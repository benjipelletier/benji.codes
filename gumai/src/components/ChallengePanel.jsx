import { useState, useRef, useCallback } from 'react';
import ReconstructChallenge from './ReconstructChallenge';
import MatchChallenge from './MatchChallenge';
import NodeDetail from './NodeDetail';

const RECONSTRUCT_TYPES = ['reconstruct'];
const MATCH_TYPES = [
  'match_achievement', 'match_era', 'match_connection',
  'match_radical', 'identify_composition', 'match_meaning',
  'match_origin', 'fill_blank', 'match_definition', 'scenario'
];

export default function ChallengePanel({ node, connections, nodeMap, isCompleted, onComplete, onClose, onPanTo }) {
  const [phase, setPhase] = useState(isCompleted ? 'detail' : 'challenge');
  const panelRef = useRef(null);
  const dragStartY = useRef(null);
  const dragCurrentY = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);

  function handleChallengeComplete() {
    onComplete(node.id);
    setPhase('reveal');
  }

  // Swipe to dismiss
  function onTouchStart(e) {
    dragStartY.current = e.touches[0].clientY;
    dragCurrentY.current = e.touches[0].clientY;
  }

  function onTouchMove(e) {
    if (dragStartY.current === null) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    dragCurrentY.current = e.touches[0].clientY;
    if (dy > 0) setDragOffset(dy);
  }

  function onTouchEnd() {
    if (dragOffset > 100) {
      onClose();
    } else {
      setDragOffset(0);
    }
    dragStartY.current = null;
  }

  const { challenge } = node;
  const challengeType = challenge?.type;

  const nodeConnections = connections.filter(
    c => c.source_id === node.id || c.target_id === node.id
  );

  return (
    <>
      {/* Backdrop */}
      <div style={s.backdrop} onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        style={{
          ...s.panel,
          transform: `translateY(${dragOffset}px)`,
          transition: dragOffset === 0 ? 'transform 0.3s ease' : 'none',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Drag handle */}
        <div style={s.handle} />

        {/* Scrollable content */}
        <div style={s.scroll}>
          {/* Header */}
          <div style={s.header}>
            <div style={s.titleBlock}>
              <span style={s.mainTitle}>{node.title}</span>
              {phase !== 'challenge' && (
                <span style={s.pinyin}>{node.pinyin}</span>
              )}
            </div>
            <span style={s.dynastyTag}>{node.dynasty}</span>
          </div>

          <p style={s.english}>{node.english}</p>

          {phase === 'challenge' && (
            <>
              <div style={s.divider} />
              {RECONSTRUCT_TYPES.includes(challengeType) && (
                <ReconstructChallenge
                  data={challenge.data}
                  onComplete={handleChallengeComplete}
                />
              )}
              {MATCH_TYPES.includes(challengeType) && (
                <MatchChallenge
                  data={challenge.data}
                  onComplete={handleChallengeComplete}
                />
              )}
            </>
          )}

          {phase === 'reveal' && (
            <>
              <div style={s.completedBadge}>
                <span style={s.completedText}>解锁 · Unlocked</span>
              </div>
              <div style={s.divider} />
              <NodeDetail
                node={node}
                connections={nodeConnections}
                nodeMap={nodeMap}
                onPanTo={(id) => { onPanTo(id); onClose(); }}
              />
            </>
          )}

          {phase === 'detail' && (
            <NodeDetail
              node={node}
              connections={nodeConnections}
              nodeMap={nodeMap}
              onPanTo={(id) => { onPanTo(id); onClose(); }}
            />
          )}
        </div>
      </div>
    </>
  );
}

const s = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(26, 20, 14, 0.35)',
    zIndex: 10,
  },
  panel: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: '#FAF6EF',
    borderRadius: '20px 20px 0 0',
    boxShadow: '0 -4px 40px rgba(0,0,0,0.18)',
    zIndex: 20,
    maxHeight: '72vh',
    display: 'flex',
    flexDirection: 'column',
  },
  handle: {
    width: 40,
    height: 4,
    background: '#C8BFB0',
    borderRadius: 2,
    margin: '12px auto 0',
    flexShrink: 0,
  },
  scroll: {
    overflowY: 'auto',
    padding: '16px 20px 32px',
    flex: 1,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 12,
  },
  titleBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  mainTitle: {
    fontFamily: "'Noto Serif SC', serif",
    fontWeight: 700,
    fontSize: 34,
    color: '#1A1A1A',
    lineHeight: 1,
  },
  pinyin: {
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    fontSize: 16,
    color: '#6A5A4A',
  },
  dynastyTag: {
    fontFamily: "'Ma Shan Zheng', serif",
    fontSize: 13,
    color: '#F5F0E8',
    background: '#4A3A2A',
    padding: '3px 10px',
    borderRadius: 4,
    whiteSpace: 'nowrap',
    marginTop: 4,
  },
  english: {
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    fontSize: 14,
    color: '#6A5A4A',
    margin: '0 0 12px',
  },
  divider: {
    height: 1,
    background: '#D4C8B8',
    margin: '12px 0',
    opacity: 0.6,
  },
  completedBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    background: 'rgba(194, 59, 34, 0.08)',
    border: '1px solid rgba(194, 59, 34, 0.3)',
    borderRadius: 20,
    padding: '4px 14px',
    marginBottom: 8,
  },
  completedText: {
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    fontSize: 13,
    color: '#C23B22',
    letterSpacing: '0.05em',
  },
};
