import React, { useRef } from 'react'

const CELL = 68
const GAP = 8

function RowDragger({ chars, offset, onOffsetChange, pinyin, correctIndex, isWon }) {
  const drag = useRef(null)

  function onPointerDown(e) {
    drag.current = { startX: e.clientX, startOffset: offset }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e) {
    if (!drag.current) return
    const dx = e.clientX - drag.current.startX
    const steps = -Math.round(dx / (CELL + GAP))
    const next = Math.max(0, Math.min(3, drag.current.startOffset + steps))
    onOffsetChange(next)
  }

  function onPointerUp() {
    drag.current = null
  }

  return (
    <div style={{ userSelect: 'none' }}>
      <div
        style={{ display: 'flex', gap: GAP, touchAction: 'none', cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {chars.map((char, i) => {
          const isActive = i === offset
          const isCorrect = isActive && i === correctIndex && isWon
          return (
            <div
              key={i}
              style={{
                width: CELL,
                height: CELL,
                borderRadius: 12,
                border: '1.5px solid',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: "'Noto Serif SC', serif",
                fontSize: 28,
                fontWeight: 700,
                flexShrink: 0,
                transition: 'all 0.15s ease',
                ...(isWon && isActive
                  ? { background: '#d4edda', color: '#2d7a4f', borderColor: '#2d7a4f', transform: 'scale(1.08)' }
                  : isActive
                    ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)', transform: 'scale(1.05)' }
                    : { background: 'white', color: '#c8bfaa', borderColor: '#e8e4dc' }
                ),
              }}
            >
              {char}
            </div>
          )
        })}
      </div>
      <div style={{
        fontSize: 10,
        color: '#c8bfaa',
        fontFamily: "'Playfair Display', serif",
        fontStyle: 'italic',
        marginTop: 5,
        paddingLeft: offset * (CELL + GAP),
        transition: 'padding 0.15s ease',
        whiteSpace: 'nowrap',
      }}>
        {chars[offset]}
      </div>
    </div>
  )
}

export default function SlidingScreen({ puzzle, offsets, won, updateOffset }) {
  const forming = puzzle.chengyus.map((cy, i) => cy.chars[offsets[i]])

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.logoWrap}>
          <span style={s.logoZh}>谜语</span>
          <span style={s.logoEn}>RiddleYu</span>
        </div>
        <span style={s.phaseTag}>隐藏成语</span>
      </div>

      <div style={s.body}>
        <div style={s.instrWrap}>
          <p style={s.instrZh}>拖动每一行，组成隐藏的成语。</p>
          <p style={s.instrEn}>Drag each row to select a character. Find the hidden 成语.</p>
        </div>

        {/* Rows */}
        <div style={s.rows}>
          {puzzle.chengyus.map((cy, i) => (
            <RowDragger
              key={i}
              chars={cy.chars}
              offset={offsets[i]}
              onOffsetChange={newOffset => updateOffset(i, newOffset)}
              pinyin={cy.pinyin}
              correctIndex={puzzle.hiddenPositions[i]}
              isWon={won}
            />
          ))}
        </div>

        {/* Forming preview */}
        <div style={s.formingSection}>
          <div style={s.formingLabel}>
            {won ? '发现了！· Revealed!' : '正在组合… · forming'}
          </div>
          <div style={s.forming}>
            {forming.map((char, i) => {
              const correct = char === puzzle.hidden.chars[i]
              return (
                <div key={i} style={{
                  ...s.formingChar,
                  ...(won
                    ? { background: '#d4edda', color: '#2d7a4f', borderColor: '#2d7a4f' }
                    : correct
                      ? { background: '#fef3cd', color: '#c97d10', borderColor: '#c97d10' }
                      : { background: 'white', color: '#c8bfaa', borderColor: '#e0d9ce' }
                  ),
                  transition: 'all 0.2s ease',
                }}>
                  {char}
                </div>
              )
            })}
          </div>
          {won && (
            <div style={s.hiddenReveal}>
              <div style={s.hiddenPinyin}>{puzzle.hidden.pinyin}</div>
              <div style={s.hiddenMeaning}>{puzzle.hidden.meaning}</div>
            </div>
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
    position: 'sticky',
    top: 0,
    zIndex: 10,
    background: 'var(--paper)',
  },
  logoWrap: { display: 'flex', flexDirection: 'column', lineHeight: 1 },
  logoZh: { fontFamily: "'Noto Serif SC', serif", fontSize: 20, fontWeight: 900, color: 'var(--ink)' },
  logoEn: { fontFamily: "'Playfair Display', serif", fontSize: 9, color: 'var(--grey)', letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 },
  phaseTag: {
    fontFamily: "'Noto Sans SC', sans-serif",
    fontSize: 10,
    color: 'var(--grey)',
    letterSpacing: 1,
    border: '1px solid #d4cabb',
    borderRadius: 20,
    padding: '3px 12px',
  },
  body: {
    flex: 1,
    padding: '28px 20px 32px',
    display: 'flex',
    flexDirection: 'column',
    gap: 28,
    overflowX: 'hidden',
  },
  instrWrap: { textAlign: 'center' },
  instrZh: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 15,
    color: 'var(--ink)',
    lineHeight: 1.8,
    marginBottom: 4,
  },
  instrEn: {
    fontSize: 11,
    color: 'var(--grey)',
    fontStyle: 'italic',
    lineHeight: 1.6,
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    overflowX: 'hidden',
  },
  formingSection: {
    textAlign: 'center',
    padding: '20px',
    background: 'var(--paper2)',
    borderRadius: 16,
    border: '1px solid #e8e4dc',
  },
  formingLabel: {
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: 'var(--grey)',
    marginBottom: 14,
    fontFamily: "'Noto Sans SC', sans-serif",
  },
  forming: {
    display: 'flex',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 14,
  },
  formingChar: {
    width: 58,
    height: 58,
    borderRadius: 10,
    border: '1.5px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 26,
    fontWeight: 700,
  },
  hiddenReveal: {
    marginTop: 4,
  },
  hiddenPinyin: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 13,
    color: 'var(--grey)',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  hiddenMeaning: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 14,
    color: 'var(--ink)',
    lineHeight: 1.7,
  },
}
