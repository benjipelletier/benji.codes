import React, { useState } from 'react'

function buildShareText(puzzle, won, attempts, lives, maxLives) {
  const date = puzzle.date
  const solvedCount = attempts.filter(a => a.correct).length
  const result = won ? `${solvedCount}/${maxLives} ❤️` : `X/${maxLives}`
  const rows = attempts.map(a => a.correct ? '🟩🟩🟩🟩' : '⬜⬜⬜⬜').join('\n')
  return `谜语 RiddleYu · ${date}\n${result}\n\n${rows}\n\nriddleyu.benji.codes`
}

export default function ResultScreen({ puzzle, won, attempts, lives, maxLives }) {
  const [copied, setCopied] = useState(false)

  function handleShare() {
    const text = buildShareText(puzzle, won, attempts, lives, maxLives)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const solvedChengyus = puzzle.chengyus.filter((_, i) => {
    return attempts.some(a => a.group === i && a.correct)
  })

  return (
    <div style={s.root}>
      <div style={s.card}>
        <div style={s.seal}>谜</div>

        <div style={won ? s.badgeWon : s.badgeLost}>
          {won ? '成功' : '下次再来'}
        </div>

        {/* The 4 solved chengyus */}
        <div style={s.sectionLabel}>今日成语 · Today's idioms</div>
        <div style={s.chengyuList}>
          {puzzle.chengyus.map((cy, i) => {
            const solved = attempts.some(a => a.group === i && a.correct)
            return (
              <div key={i} style={{ ...s.chengyuItem, opacity: solved ? 1 : 0.35 }}>
                <div style={s.charRow}>
                  {cy.chars.map((c, j) => (
                    <div key={j} style={s.chengyuChar}>{c}</div>
                  ))}
                </div>
                <div style={s.chengyuMeta}>
                  <span style={s.pinyin}>{cy.pinyin}</span>
                  <span style={s.meaning}>{cy.meaning}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* The hidden 5th */}
        {won && (
          <>
            <div style={s.divider} />
            <div style={s.sectionLabel}>隐藏成语 · Hidden idiom</div>
            <div style={s.hiddenSection}>
              <div style={s.charRow}>
                {puzzle.hidden.chars.map((c, i) => (
                  <div key={i} style={s.hiddenChar}>{c}</div>
                ))}
              </div>
              <div style={s.pinyin}>{puzzle.hidden.pinyin}</div>
              <p style={s.hiddenMeaning}>{puzzle.hidden.meaning}</p>
            </div>
          </>
        )}

        <div style={s.divider} />

        <button style={s.shareBtn} onClick={handleShare}>
          {copied ? '已复制 · Copied!' : '分享 · Share'}
        </button>

        <p style={s.comeback}>Come back tomorrow for a new 成语 ✦</p>
      </div>
    </div>
  )
}

const s = {
  root: {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    background: 'var(--paper3)',
  },
  card: {
    background: 'var(--paper)',
    border: '1.5px solid #c8bfaa',
    borderRadius: 24,
    padding: '36px 24px',
    maxWidth: 380,
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
    position: 'relative',
  },
  seal: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 36,
    height: 36,
    border: '2px solid var(--seal)',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--seal)',
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 14,
    fontWeight: 900,
    opacity: 0.35,
    transform: 'rotate(-8deg)',
  },
  badgeWon: {
    display: 'inline-block',
    background: '#d4edda',
    color: '#2d7a4f',
    border: '1.5px solid #2d7a4f',
    borderRadius: 20,
    padding: '4px 16px',
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 20,
    letterSpacing: 1,
  },
  badgeLost: {
    display: 'inline-block',
    background: '#fdecea',
    color: '#c0392b',
    border: '1.5px solid #c0392b',
    borderRadius: 20,
    padding: '4px 16px',
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 20,
    letterSpacing: 1,
  },
  sectionLabel: {
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: 'var(--grey)',
    marginBottom: 14,
    fontFamily: "'Noto Sans SC', sans-serif",
  },
  chengyuList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginBottom: 4,
  },
  chengyuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    textAlign: 'left',
    transition: 'opacity 0.3s',
  },
  charRow: {
    display: 'flex',
    gap: 4,
    flexShrink: 0,
  },
  chengyuChar: {
    width: 36,
    height: 36,
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
  chengyuMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  pinyin: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 11,
    color: 'var(--grey)',
    fontStyle: 'italic',
    display: 'block',
  },
  meaning: {
    fontSize: 11,
    color: 'var(--grey)',
    lineHeight: 1.5,
    display: 'block',
  },
  hiddenSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  hiddenChar: {
    width: 52,
    height: 52,
    background: '#d4edda',
    color: '#2d7a4f',
    border: '1.5px solid #2d7a4f',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 24,
    fontWeight: 700,
  },
  hiddenMeaning: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 14,
    color: 'var(--ink)',
    lineHeight: 1.7,
    marginTop: 4,
  },
  divider: {
    width: '100%',
    height: 1,
    background: 'var(--paper3)',
    margin: '20px 0',
  },
  shareBtn: {
    width: '100%',
    padding: '12px 0',
    marginBottom: 14,
    background: 'var(--ink)',
    color: 'var(--paper)',
    border: 'none',
    borderRadius: 12,
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: 1,
    cursor: 'pointer',
  },
  comeback: {
    fontSize: 12,
    color: '#c8bfaa',
    fontStyle: 'italic',
  },
}
