import React, { useState } from 'react'

const FB_COLOR = { green: '#2d7a4f', yellow: '#c97d10', grey: '#7a7570' }
const FB_BG = { green: '#d4edda', yellow: '#fef3cd', grey: '#e8e4dc' }

export default function GameScreen({
  puzzle,
  currentSlot,
  chain,
  lives,
  maxLives,
  attempts,
  chainComplete,
  selectChar,
  resetChain,
  submitChain,
  isSelectable,
  isSelected,
  getChainPosition,
  unselectSlot,
}) {
  const [showHint, setShowHint] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [animatingFeedback, setAnimatingFeedback] = useState([null, null, null, null])
  const [flipping, setFlipping] = useState([false, false, false, false])

  // Reset hint when slot changes
  React.useEffect(() => { setShowHint(false) }, [currentSlot])

  function handleSubmit() {
    if (submitting) return
    setSubmitting(true)

    // Calculate feedback for animation
    const feedback = chain.map((char, i) => {
      if (char === puzzle.chengyu[i]) return 'green'
      if (puzzle.chengyu.includes(char)) return 'yellow'
      return 'grey'
    })

    // Staggered flip-reveal per slot
    feedback.forEach((fb, i) => {
      const delay = i * 200
      setTimeout(() => {
        setFlipping(prev => { const n = [...prev]; n[i] = true; return n })
      }, delay)
      setTimeout(() => {
        setFlipping(prev => { const n = [...prev]; n[i] = false; return n })
        setAnimatingFeedback(prev => { const n = [...prev]; n[i] = fb; return n })
      }, delay + 150)
    })

    // Submit after animation finishes
    setTimeout(() => {
      submitChain()
      setAnimatingFeedback([null, null, null, null])
      setFlipping([false, false, false, false])
      setSubmitting(false)
    }, feedback.length * 200 + 150)
  }

  const lastAttempt = attempts[attempts.length - 1]

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

      {/* Attempt history */}
      {attempts.length > 0 && (
        <div style={s.history}>
          <div style={s.historyLabel}>Previous attempts</div>
          {attempts.map((a, ai) => (
            <div key={ai} style={s.attemptRow}>
              {a.chain.map((char, ci) => (
                <React.Fragment key={ci}>
                  <div style={{
                    ...s.histChip,
                    background: FB_BG[a.feedback[ci]],
                    color: FB_COLOR[a.feedback[ci]],
                    border: `1.5px solid ${FB_COLOR[a.feedback[ci]]}`,
                  }}>
                    {char}
                  </div>
                  {ci < 3 && <span style={s.histArrow}>›</span>}
                </React.Fragment>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Chain */}
      <div style={s.chainSection}>
        <div style={s.chainLabel}>Your chain</div>
        <div style={s.chain}>
          {Array.from({ length: 4 }).map((_, i) => {
            const char = chain[i]
            const isActive = i === currentSlot && !chainComplete
            const fbColor = animatingFeedback[i]
            const isFlipping = flipping[i]
            return (
              <React.Fragment key={i}>
                <div
                  onClick={() => char && !submitting && unselectSlot(i)}
                  style={{
                    ...s.slot,
                    transition: 'transform 0.15s ease',
                    transform: isFlipping ? 'scaleY(0)' : 'scaleY(1)',
                    ...(fbColor
                      ? { background: FB_BG[fbColor], borderColor: FB_COLOR[fbColor], color: FB_COLOR[fbColor], borderStyle: 'solid' }
                      : char
                        ? { background: 'white', borderColor: '#1a3a5c', color: 'var(--ink)', borderStyle: 'solid', cursor: 'pointer' }
                        : isActive
                          ? { background: '#dce8f5', borderColor: '#1a3a5c', borderStyle: 'dashed', color: '#1a3a5c' }
                          : { background: 'transparent', borderColor: '#d4cabb', borderStyle: 'dashed', color: '#d4cabb' }
                    ),
                  }}>
                  {char
                    ? <span style={s.slotChar}>{char}</span>
                    : <span style={s.slotNum}>{i + 1}</span>
                  }
                </div>
                {i < 3 && (
                  <div style={s.connector}>
                    <span style={s.connectorArrow}>›</span>
                  </div>
                )}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Riddle */}
      {!chainComplete && (
        <div style={s.riddleBox}>
          <div style={s.riddleTag}>字 {currentSlot + 1} / 4</div>
          <p style={s.riddleText}>{puzzle.riddles[currentSlot].text}</p>
          <p style={s.riddleTranslation}>{puzzle.riddles[currentSlot].translation}</p>
          {showHint
            ? <p style={s.hint}>💡 {puzzle.riddles[currentSlot].hint}</p>
            : <button style={s.hintBtn} onClick={() => setShowHint(true)}>提示 · hint</button>
          }
        </div>
      )}

      {chainComplete && (
        <div style={s.riddleBox}>
          <p style={s.riddleText}>链已完成。准备好了吗？</p>
          <p style={s.hint}>Chain complete — review your picks, then submit.</p>
        </div>
      )}

      {/* Grid */}
      <div style={s.gridWrap}>
        <div style={s.grid}>
          {puzzle.grid.map((char, gi) => {
            const selectable = isSelectable(gi)
            const selected = isSelected(gi)
            const chainPos = getChainPosition(gi)

            let btnStyle = { ...s.charBtn }
            if (selected) {
              btnStyle = {
                ...btnStyle,
                background: '#e8f0f8',
                borderColor: '#1a3a5c',
                color: '#1a3a5c',
                opacity: 0.7,
                cursor: 'default',
                transform: 'scale(0.95)',
              }
            } else if (selectable) {
              btnStyle = {
                ...btnStyle,
                background: 'white',
                borderColor: '#aab8c8',
                color: 'var(--ink)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                cursor: 'pointer',
              }
            } else {
              btnStyle = {
                ...btnStyle,
                background: 'var(--paper2)',
                borderColor: '#e0d9ce',
                color: '#c0b8ae',
                cursor: 'default',
              }
            }

            return (
              <button
                key={gi}
                style={{ ...btnStyle, position: 'relative' }}
                onClick={() => selectChar(gi)}
                disabled={!selectable}
              >
                {char}
                {chainPos && (
                  <span style={s.chainPill}>{chainPos}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Actions */}
      <div style={s.actions}>
        {chain.some(c => c !== null) && (
          <button style={s.resetBtn} onClick={resetChain}>重选 · Reset</button>
        )}
        {chainComplete && (
          <button
            style={{ ...s.submitBtn, opacity: submitting ? 0.6 : 1 }}
            onClick={handleSubmit}
            disabled={submitting}
          >
            提交 · Submit
          </button>
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
  logoWrap: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1,
  },
  logoZh: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 20,
    fontWeight: 900,
    color: 'var(--ink)',
  },
  logoEn: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 9,
    color: 'var(--grey)',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  logoDate: {
    fontFamily: "'Noto Sans SC', sans-serif",
    fontSize: 9,
    color: '#c8bfaa',
    letterSpacing: 1,
    marginTop: 2,
  },
  hearts: {
    display: 'flex',
    gap: 4,
  },
  heart: {
    fontSize: 14,
    color: 'var(--red)',
  },
  history: {
    padding: '10px 20px',
    background: 'var(--paper2)',
    borderBottom: '1px solid #e0d9ce',
  },
  historyLabel: {
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: 'var(--grey)',
    marginBottom: 8,
  },
  attemptRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  histChip: {
    width: 34,
    height: 34,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 16,
    fontWeight: 700,
  },
  histArrow: {
    color: '#c8bfaa',
    fontSize: 12,
  },
  chainSection: {
    padding: '14px 24px 12px',
    borderBottom: '1px solid #e8e4dc',
  },
  chainLabel: {
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: 'var(--grey)',
    marginBottom: 10,
  },
  chain: {
    display: 'flex',
    alignItems: 'center',
  },
  slot: {
    width: 60,
    height: 60,
    borderRadius: 10,
    border: '2px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  slotChar: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 26,
    fontWeight: 700,
  },
  slotNum: {
    fontFamily: "'Noto Sans SC', sans-serif",
    fontSize: 14,
    fontWeight: 300,
  },
  connector: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectorArrow: {
    color: '#c8bfaa',
    fontSize: 18,
  },
  riddleBox: {
    margin: '0 20px 12px',
    marginTop: 14,
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
  gridWrap: {
    padding: '0 20px',
    flex: 1,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 8,
    overflow: 'visible',
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
  },
  chainPill: {
    position: 'absolute',
    top: -6,
    left: -6,
    background: '#1a3a5c',
    color: 'white',
    borderRadius: 99,
    fontSize: 8,
    fontFamily: "'Noto Sans SC', sans-serif",
    fontWeight: 700,
    width: 16,
    height: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    zIndex: 1,
  },
  actions: {
    display: 'flex',
    gap: 10,
    padding: '16px 20px 24px',
  },
  resetBtn: {
    flex: 1,
    padding: '12px 0',
    background: 'transparent',
    border: '1.5px solid #d4cabb',
    borderRadius: 10,
    color: 'var(--grey)',
    fontSize: 13,
    fontFamily: "'Noto Sans SC', sans-serif",
    fontWeight: 500,
    letterSpacing: 0.5,
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
