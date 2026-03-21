import React from 'react'
import ClaimBar from './ClaimBar'
import CharacterGrid from './CharacterGrid'

export default function GameScreen({
  puzzle, selected, solvedClusters, answers, currentCluster, subPhase,
  wrongFlash, selectChar, submitCluster,
}) {
  const cluster = puzzle.clusters[currentCluster]
  const solvedChars = new Set(solvedClusters.flatMap(i => puzzle.clusters[i].chars))

  // Hint/lesson text
  const barLabel = subPhase === 'picking'
    ? `第${['一','二','三','四'][currentCluster]}组`
    : '选一个'
  const barText = subPhase === 'picking' ? cluster.hint : cluster.lesson

  const canSubmit = subPhase === 'picking' && selected.size === 4 && !wrongFlash

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.logoWrap}>
          <span style={s.logoZh}>谜语</span>
          <span style={s.logoEn}>RiddleYu</span>
        </div>
        <span style={s.date}>{puzzle.date}</span>
      </div>

      {/* Hint / lesson bar */}
      <ClaimBar
        label={barLabel}
        text={barText}
        subPhase={subPhase}
        clusterChars={cluster.chars}
      />

      {/* Progress dots */}
      <div style={s.progress}>
        {[0, 1, 2, 3].map(i => (
          <div key={i}
            className={i === currentCluster ? 'dot-pulse' : undefined}
            style={{
              ...s.dot,
              ...(i < currentCluster || (i === currentCluster && subPhase === 'choosing')
                ? s.dotFilled
                : i === currentCluster
                  ? s.dotCurrent
                  : s.dotEmpty),
            }}
          />
        ))}
      </div>

      {/* Grid */}
      <CharacterGrid
        grid={puzzle.grid}
        selected={selected}
        solvedClusters={[...solvedChars]}
        answers={answers}
        wrongFlash={wrongFlash}
        subPhase={subPhase}
        currentClusterChars={cluster.chars}
        onSelect={selectChar}
      />

      {/* Action bar */}
      <div style={s.actionBar}>
        {subPhase === 'picking' ? (
          <button
            style={{ ...s.btn, ...s.btnSubmit, ...(canSubmit ? {} : s.btnDisabled) }}
            onClick={submitCluster}
            disabled={!canSubmit}
          >
            提交 ({selected.size}/4)
          </button>
        ) : (
          <div style={s.chooseHint}>点击你认为在成语中的字</div>
        )}
      </div>
    </div>
  )
}

const s = {
  root: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    maxWidth: 420,
    margin: '0 auto',
    background: 'var(--paper)',
    borderLeft: '1px solid #d4cabb',
    borderRight: '1px solid #d4cabb',
    gap: 12,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px 12px',
    borderBottom: '1.5px solid #d4cabb',
  },
  logoWrap: { display: 'flex', flexDirection: 'column', lineHeight: 1 },
  logoZh: { fontFamily: "'Noto Serif SC', serif", fontSize: 20, fontWeight: 900, color: 'var(--ink)' },
  logoEn: { fontFamily: "'Playfair Display', serif", fontSize: 9, color: 'var(--grey)', letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 },
  date: { fontFamily: "'Noto Sans SC', sans-serif", fontSize: 11, color: '#c8bfaa' },
  progress: {
    display: 'flex',
    gap: 8,
    justifyContent: 'center',
    padding: '4px 0',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    transition: 'all 0.3s',
  },
  dotFilled: { background: '#2d7a4f' },
  dotCurrent: { background: 'transparent', border: '2px solid var(--red)' },
  dotEmpty: { background: '#d4cabb' },
  actionBar: {
    display: 'flex',
    gap: 10,
    padding: '16px 20px 28px',
    marginTop: 'auto',
    justifyContent: 'center',
  },
  btn: {
    flex: 1,
    padding: '14px 0',
    borderRadius: 10,
    fontSize: 16,
    fontFamily: "'Noto Serif SC', serif",
    fontWeight: 700,
    letterSpacing: 2,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  btnSubmit: {
    background: 'var(--ink)',
    border: 'none',
    color: 'var(--paper)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
  },
  btnDisabled: {
    opacity: 0.3,
    cursor: 'default',
  },
  chooseHint: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 13,
    color: 'var(--grey)',
    fontStyle: 'italic',
    padding: '14px 0',
  },
}
