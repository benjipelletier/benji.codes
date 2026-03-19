import React, { useState } from 'react'

function computeDisplaySlots(puzzle, solvedGroups) {
  const slots = []
  for (let i = 0; i < 4; i++) {
    if (solvedGroups[i]) {
      puzzle.chengyus[i].chars.forEach((char, pos) => {
        slots.push({ type: 'solved', group: i, char, charPos: pos })
      })
    }
  }
  puzzle.grid.forEach((char, gi) => {
    const group = puzzle.gridGroups[gi]
    if (!solvedGroups[group]) {
      slots.push({ type: 'unsolved', gridIndex: gi, char, group })
    }
  })
  return slots
}

function getCharPinyin(puzzle, gridIndex) {
  const char = puzzle.grid[gridIndex]
  const group = puzzle.gridGroups[gridIndex]
  const cy = puzzle.chengyus[group]
  const pos = cy.chars.indexOf(char)
  if (pos < 0) return ''
  return cy.pinyin.split(' ')[pos] || ''
}

export default function GameScreen({
  puzzle, currentChengyu, selected, solvedGroups, lives, maxLives,
  wrongFlash, flashCorrect, toggleSelect, submitGroup, resetSelection,
  attempts, solveOverlay, dismissOverlay,
}) {
  const [showSource, setShowSource] = useState(false)
  React.useEffect(() => { setShowSource(false) }, [currentChengyu])

  const riddle = puzzle.chengyus[currentChengyu]
  const displaySlots = computeDisplaySlots(puzzle, solvedGroups)
  const currentAttempts = attempts.filter(a => a.group === currentChengyu && !a.correct)
  const isInteractionDisabled = !!flashCorrect
  const lastWrongAttempt = wrongFlash ? currentAttempts.at(-1) : null
  const showHint = currentAttempts.length > 0

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
        {/* English translation shown by default — accessible to learners */}
        <p style={s.riddleTranslation}>{riddle.riddle_translation}</p>
        {/* Classical Chinese source — optional enrichment */}
        {showSource
          ? <p style={s.riddleText}>{riddle.riddle}</p>
          : <button style={s.hintBtn} onClick={() => setShowSource(true)}>典故 · source</button>
        }
        {/* Hint auto-reveals after first wrong attempt */}
        {showHint && <p style={s.hint}>{riddle.hint}</p>}
        {currentAttempts.length > 0 && (
          <div style={s.attemptHistory}>
            {currentAttempts.map((attempt, i) => (
              <div key={i} style={s.attemptRow}>
                {attempt.colors.map((color, j) => (
                  <div key={j} style={{
                    ...s.attemptBlock,
                    background: color === 'green' ? '#538d4e' : color === 'yellow' ? '#c9a800' : '#aaa49e',
                  }} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      <div style={s.gridWrap}>
        <div style={s.grid}>
          {displaySlots.map((slot, idx) => {
            if (slot.type === 'solved') {
              const pinyin = puzzle.chengyus[slot.group].pinyin.split(' ')[slot.charPos] || ''
              return (
                <div
                  key={`s-${slot.group}-${slot.charPos}`}
                  style={{
                    ...s.charBtn,
                    background: 'var(--ink)',
                    color: 'var(--paper)',
                    borderColor: 'var(--ink)',
                    cursor: 'default',
                    opacity: 0.7,
                    animation: undefined,
                  }}
                >
                  <span>{slot.char}</span>
                  <span style={s.charPinyin}>{pinyin}</span>
                </div>
              )
            }

            const { gridIndex, char, group } = slot
            const isSelected = selected.includes(gridIndex)
            const isCorrectFlashing = flashCorrect && isSelected
            const selectionIdx = isSelected ? selected.indexOf(gridIndex) : -1
            const flashColor = lastWrongAttempt && selectionIdx >= 0 ? lastWrongAttempt.colors[selectionIdx] : null
            const canSelect = !isInteractionDisabled && (isSelected || selected.length < 4)
            const pinyin = getCharPinyin(puzzle, gridIndex)

            const tileStyle = isCorrectFlashing
              ? { background: '#538d4e', color: 'var(--paper)', borderColor: '#538d4e' }
              : isSelected && flashColor === 'green'
                ? { background: '#538d4e', color: 'white', borderColor: '#538d4e', transform: 'scale(0.95)' }
                : isSelected && flashColor === 'yellow'
                  ? { background: '#c9a800', color: 'white', borderColor: '#c9a800', transform: 'scale(0.95)' }
                  : isSelected && flashColor === 'grey'
                    ? { background: '#888', color: 'white', borderColor: '#888', transform: 'scale(0.95)' }
                    : isSelected
                      ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)', transform: 'scale(0.95)' }
                      : canSelect
                        ? { background: 'white', borderColor: '#aab8c8', color: 'var(--ink)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', cursor: 'pointer' }
                        : { background: 'var(--paper2)', borderColor: '#e0d9ce', color: '#c0b8ae', cursor: 'default' }

            return (
              <button
                key={`u-${gridIndex}`}
                className={isCorrectFlashing ? 'tile-correct' : undefined}
                style={{ ...s.charBtn, ...tileStyle }}
                onClick={() => !isInteractionDisabled && toggleSelect(gridIndex)}
                disabled={isInteractionDisabled || (!isSelected && selected.length >= 4)}
              >
                <span>{char}</span>
                <span style={s.charPinyin}>{pinyin}</span>
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
          {selected.length > 0 && !isInteractionDisabled && (
            <button style={s.resetBtn} onClick={resetSelection}>重选 · Reset</button>
          )}
          {selected.length === 4 && !isInteractionDisabled && (
            <button style={s.submitBtn} onClick={submitGroup}>提交 · Submit</button>
          )}
        </div>
      </div>

      {/* Post-solve overlay */}
      {solveOverlay !== null && (() => {
        const cy = puzzle.chengyus[solveOverlay]
        return (
          <div style={s.overlayBg} onClick={dismissOverlay}>
            <div style={s.overlayCard} onClick={e => e.stopPropagation()}>
              <div style={s.overlayChars}>
                {cy.chars.map((c, i) => (
                  <div key={i} style={s.overlayChar}>{c}</div>
                ))}
              </div>
              <div style={s.overlayPinyin}>{cy.pinyin}</div>
              <p style={s.overlayMeaning}>{cy.meaning}</p>
              {cy.derivation && (
                <p style={s.overlayDerivation}>{cy.derivation}</p>
              )}
              <button style={s.overlayBtn} onClick={dismissOverlay}>继续 · Continue</button>
            </div>
          </div>
        )
      })()}
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
  riddleTranslation: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 14,
    fontStyle: 'italic',
    color: 'var(--ink)',
    marginTop: 4,
    lineHeight: 1.7,
  },
  riddleText: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 12,
    lineHeight: 1.8,
    color: 'var(--grey)',
    marginTop: 8,
    borderTop: '1px solid #e8e4dc',
    paddingTop: 8,
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
  attemptHistory: {
    marginTop: 10,
    borderTop: '1px solid #e8e4dc',
    paddingTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  attemptRow: {
    display: 'flex',
    gap: 4,
  },
  attemptBlock: {
    width: 16,
    height: 16,
    borderRadius: 3,
  },
  gridWrap: { padding: '0 20px', flex: 1 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 8,
  },
  charBtn: {
    aspectRatio: '1 / 1.25',
    borderRadius: 10,
    border: '1.5px solid',
    display: 'flex',
    flexDirection: 'column',
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
    gap: 2,
  },
  charPinyin: {
    fontSize: 8,
    fontFamily: "'Noto Sans SC', sans-serif",
    fontWeight: 400,
    opacity: 0.65,
    letterSpacing: 0.3,
    lineHeight: 1,
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
  // Overlay styles
  overlayBg: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(30, 24, 16, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: 24,
    animation: 'fadeIn 0.2s ease',
  },
  overlayCard: {
    background: 'var(--paper)',
    borderRadius: 20,
    padding: '32px 24px 24px',
    maxWidth: 340,
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 12px 48px rgba(0,0,0,0.3)',
    animation: 'slideUp 0.25s ease',
  },
  overlayChars: {
    display: 'flex',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  overlayChar: {
    width: 52,
    height: 52,
    background: 'var(--ink)',
    color: 'var(--paper)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 24,
    fontWeight: 700,
  },
  overlayPinyin: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 13,
    fontStyle: 'italic',
    color: 'var(--grey)',
    marginBottom: 8,
  },
  overlayMeaning: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 14,
    color: 'var(--ink)',
    lineHeight: 1.7,
    marginBottom: 12,
  },
  overlayDerivation: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 11,
    color: 'var(--grey)',
    lineHeight: 1.7,
    fontStyle: 'italic',
    borderTop: '1px solid #e8e4dc',
    paddingTop: 10,
    marginBottom: 16,
    textAlign: 'left',
  },
  overlayBtn: {
    width: '100%',
    padding: '12px 0',
    background: 'var(--ink)',
    color: 'var(--paper)',
    border: 'none',
    borderRadius: 10,
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: 1,
    cursor: 'pointer',
  },
}
