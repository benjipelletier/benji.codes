import React from 'react'
import ClaimBar from './ClaimBar'
import CharacterGrid from './CharacterGrid'

export default function GameScreen({
  puzzle, selected, opened, claims, nextPosition, wrongFlash,
  selectChar, declareZai, declareBuzai,
}) {
  const canDeclare = selected && !wrongFlash

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

      {/* Claim bar */}
      <ClaimBar claims={claims} />

      {/* Progress dots */}
      <div style={s.progress}>
        {[0, 1, 2, 3].map(i => (
          <div key={i}
            className={i === nextPosition && nextPosition <= 3 ? 'dot-pulse' : undefined}
            style={{
              ...s.dot,
              ...(i < nextPosition
                ? s.dotFilled
                : i === nextPosition
                  ? s.dotCurrent
                  : s.dotEmpty),
            }}
          />
        ))}
      </div>

      {/* Grid */}
      <CharacterGrid
        grid={puzzle.grid}
        opened={opened}
        selected={selected}
        wrongFlash={wrongFlash}
        onSelect={selectChar}
      />

      {/* Action bar */}
      <div style={s.actionBar}>
        <button
          style={{ ...s.btn, ...s.btnBuzai, ...(canDeclare ? {} : s.btnDisabled) }}
          onClick={declareBuzai}
          disabled={!canDeclare}
        >
          不在
        </button>
        <button
          style={{ ...s.btn, ...s.btnZai, ...(canDeclare ? {} : s.btnDisabled) }}
          onClick={declareZai}
          disabled={!canDeclare}
        >
          在
        </button>
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
  btnBuzai: {
    background: 'transparent',
    border: '1.5px solid #d4cabb',
    color: 'var(--grey)',
  },
  btnZai: {
    background: '#2d7a4f',
    border: 'none',
    color: 'white',
    boxShadow: '0 4px 12px rgba(45,122,79,0.3)',
  },
  btnDisabled: {
    opacity: 0.3,
    cursor: 'default',
  },
}
