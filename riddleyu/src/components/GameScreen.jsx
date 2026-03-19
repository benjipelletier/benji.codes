import React, { useState } from 'react'

export default function GameScreen({
  puzzle,
  currentChengyu,
  selected,
  solvedGroups,
  lives,
  maxLives,
  wrongFlash,
  toggleSelect,
  submitGroup,
  resetSelection,
}) {
  const [showHint, setShowHint] = useState(false)

  React.useEffect(() => { setShowHint(false) }, [currentChengyu])

  const riddle = puzzle.chengyus[currentChengyu]
  const solvedCount = solvedGroups.filter(Boolean).length

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.logoWrap}>
          <span style={s.logoZh}>谜语</span>
          <span style={s.logoEn}>RiddleYu</span>
          <span style={s.logoDate}>{puzzle.date}</span>
        </div>
        <div style={s.hearts}>
          {Array.from({ length: maxLives }).map((_, i) => (
            <span key={i} style={{ ...s.heart, opacity: i < lives ? 1 : 0.2 }}>♥</span>
          ))}
        </div>
      </div>

      {/* Solved groups */}
      {solvedGroups.some(Boolean) && (
        <div style={s.solvedSection}>
          {puzzle.chengyus.map((cy, i) => !solvedGroups[i] ? null : (
            <div key={i} style={s.solvedRow}>
              {cy.chars.map((c, j) => (
                <div key={j} style={s.solvedChar}>{c}</div>
              ))}
              <span style={s.solvedPinyin}>{cy.pinyin}</span>
            </div>
          ))}
        </div>
      )}

      {/* Progress */}
      <div style={s.progress}>
        <span style={s.progressLabel}>成语 {currentChengyu + 1} / 4</span>
        <div style={s.progressDots}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{
              ...s.progressDot,
              background: solvedGroups[i] ? 'var(--ink)' : i === currentChengyu ? 'var(--active)' : '#d4cabb',
            }} />
          ))}
        </div>
      </div>

      {/* Riddle */}
      <div style={s.riddleBox}>
        <div style={s.riddleTag}>谜 · riddle</div>
        <p style={s.riddleText}>{riddle.riddle}</p>
        <p style={s.riddleTranslation}>{riddle.riddle_translation}</p>
        {showHint
          ? <p style={s.hint}>💡 {riddle.hint}</p>
          : <button style={s.hintBtn} onClick={() => setShowHint(true)}>提示 · hint</button>
        }
      </div>

      {/* Grid */}
      <div style={s.gridWrap}>
        <div style={s.grid}>
          {puzzle.grid.map((char, gi) => {
            const group = puzzle.gridGroups[gi]
            const isSolvedGroup = solvedGroups[group]
            const isSelected = selected.includes(gi)
            const canSelect = !isSolvedGroup && (isSelected || selected.length < 4)

            return (
              <button
                key={gi}
                style={{
                  ...s.charBtn,
                  ...(isSolvedGroup
                    ? { background: 'var(--paper2)', color: '#d4cabb', borderColor: '#e8e4dc', cursor: 'default' }
                    : isSelected
                      ? { background: wrongFlash ? '#fdecea' : 'var(--ink)', color: wrongFlash ? '#c0392b' : 'var(--paper)', borderColor: wrongFlash ? '#c0392b' : 'var(--ink)', transform: 'scale(0.95)' }
                      : canSelect
                        ? { background: 'white', borderColor: '#aab8c8', color: 'var(--ink)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', cursor: 'pointer' }
                        : { background: 'var(--paper2)', borderColor: '#e0d9ce', color: '#c0b8ae', cursor: 'default' }
                  ),
                }}
                onClick={() => toggleSelect(gi)}
                disabled={isSolvedGroup || (!isSelected && selected.length >= 4)}
              >
                {char}
              </button>
            )
          })}
        </div>
      </div>

      {/* Bottom: preview + actions */}
      <div style={s.bottom}>
        <div style={s.previewRow}>
          {[0,1,2,3].map(i => {
            const char = selected[i] !== undefined ? puzzle.grid[selected[i]] : null
            return (
              <div key={i} style={{
                ...s.previewSlot,
                ...(char ? { background: wrongFlash ? '#fdecea' : 'var(--ink)', color: wrongFlash ? '#c0392b' : 'var(--paper)', borderColor: wrongFlash ? '#c0392b' : 'var(--ink)', borderStyle: 'solid' } : {}),
              }}>
                {char || <span style={s.previewNum}>{i + 1}</span>}
              </div>
            )
          })}
        </div>
        <div style={s.actions}>
          {selected.length > 0 && (
            <button style={s.resetBtn} onClick={resetSelection}>重选 · Reset</button>
          )}
          {selected.length === 4 && (
            <button style={s.submitBtn} onClick={submitGroup}>提交 · Submit</button>
          )}
        </div>
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
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px 14px',
    borderBottom: '1.5px solid #d4cabb',
    background: 'var(--paper)',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  logoWrap: { display: 'flex', flexDirection: 'column', lineHeight: 1 },
  logoZh: { fontFamily: "'Noto Serif SC', serif", fontSize: 20, fontWeight: 900, color: 'var(--ink)' },
  logoEn: { fontFamily: "'Playfair Display', serif", fontSize: 9, color: 'var(--grey)', letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 },
  logoDate: { fontFamily: "'Noto Sans SC', sans-serif", fontSize: 9, color: '#c8bfaa', letterSpacing: 1, marginTop: 2 },
  hearts: { display: 'flex', gap: 4 },
  heart: { fontSize: 14, color: 'var(--red)' },
  solvedSection: {
    padding: '10px 20px',
    background: 'var(--paper2)',
    borderBottom: '1px solid #e0d9ce',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  solvedRow: { display: 'flex', alignItems: 'center', gap: 6 },
  solvedChar: {
    width: 34,
    height: 34,
    background: 'var(--ink)',
    color: 'var(--paper)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 17,
    fontWeight: 700,
  },
  solvedPinyin: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 11,
    color: 'var(--grey)',
    fontStyle: 'italic',
    marginLeft: 4,
  },
  progress: {
    padding: '12px 24px 8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressLabel: {
    fontSize: 11,
    fontFamily: "'Noto Sans SC', sans-serif",
    color: 'var(--grey)',
    letterSpacing: 1,
  },
  progressDots: { display: 'flex', gap: 6 },
  progressDot: { width: 8, height: 8, borderRadius: '50%', transition: 'background 0.3s' },
  riddleBox: {
    margin: '0 20px 14px',
    background: 'white',
    border: '1.5px solid #d4cabb',
    borderRadius: 12,
    padding: '16px 16px 12px',
    position: 'relative',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
  },
  riddleTag: {
    position: 'absolute',
    top: -10,
    left: 14,
    background: 'var(--active)',
    color: 'white',
    fontSize: 9,
    letterSpacing: 1,
    padding: '2px 10px',
    borderRadius: 20,
    fontFamily: "'Noto Sans SC', sans-serif",
    fontWeight: 500,
  },
  riddleText: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 15,
    lineHeight: 1.8,
    color: 'var(--ink)',
    marginTop: 4,
  },
  riddleTranslation: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 11,
    fontStyle: 'italic',
    color: 'var(--grey)',
    marginTop: 2,
    lineHeight: 1.5,
  },
  hint: {
    marginTop: 10,
    fontSize: 11,
    color: 'var(--grey)',
    fontStyle: 'italic',
    borderTop: '1px solid #e8e4dc',
    paddingTop: 8,
    lineHeight: 1.6,
  },
  hintBtn: {
    marginTop: 10,
    background: 'none',
    border: '1px solid #d4cabb',
    borderRadius: 20,
    padding: '3px 12px',
    fontSize: 11,
    color: 'var(--grey)',
    cursor: 'pointer',
    fontFamily: "'Noto Sans SC', sans-serif",
  },
  gridWrap: { padding: '0 20px', flex: 1 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 8,
  },
  charBtn: {
    aspectRatio: '1',
    borderRadius: 10,
    border: '1.5px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 22,
    fontWeight: 700,
    transition: 'all 0.12s ease',
    background: 'var(--paper2)',
    borderColor: '#e0d9ce',
    color: '#c0b8ae',
    cursor: 'pointer',
  },
  bottom: {
    padding: '14px 20px 24px',
    borderTop: '1px solid #e8e4dc',
    marginTop: 12,
  },
  previewRow: {
    display: 'flex',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 12,
  },
  previewSlot: {
    width: 54,
    height: 54,
    borderRadius: 8,
    border: '1.5px dashed #d4cabb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 22,
    fontWeight: 700,
    transition: 'all 0.15s ease',
  },
  previewNum: {
    fontFamily: "'Noto Sans SC', sans-serif",
    fontSize: 12,
    fontWeight: 300,
    color: '#d4cabb',
  },
  actions: { display: 'flex', gap: 10 },
  resetBtn: {
    flex: 1,
    padding: '12px 0',
    background: 'transparent',
    border: '1.5px solid #d4cabb',
    borderRadius: 10,
    color: 'var(--grey)',
    fontSize: 13,
    fontFamily: "'Noto Sans SC', sans-serif",
    cursor: 'pointer',
  },
  submitBtn: {
    flex: 2,
    padding: '12px 0',
    background: 'var(--ink)',
    border: 'none',
    borderRadius: 10,
    color: 'var(--paper)',
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: 1,
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
  },
}
