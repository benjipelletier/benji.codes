import React, { useState, useEffect } from 'react'

function buildShareText(puzzle, declarations) {
  const tiles = declarations.flatMap(d => {
    if (d.type === 'cluster' && !d.correct) return ['🟨','🟨','🟨','🟨']
    if (d.type === 'specific' && !d.correct) return ['🟨']
    if (d.type === 'specific' && d.correct) return ['🟩']
    return []
  }).join('')
  return `谜语 ${puzzle.date}\n${tiles}\nriddleyu.benji.codes`
}

function getTimeUntilMidnightET() {
  const now = new Date()
  const tomorrow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const diff = tomorrow - nowET
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const sec = Math.floor((diff % 60000) / 1000)
  return `${h}h ${m}m ${sec}s`
}

export default function ResultScreen({ puzzle, declarations }) {
  const [copied, setCopied] = useState(false)
  const [countdown, setCountdown] = useState(getTimeUntilMidnightET())

  useEffect(() => {
    const timer = setInterval(() => setCountdown(getTimeUntilMidnightET()), 1000)
    return () => clearInterval(timer)
  }, [])

  function handleShare() {
    const text = buildShareText(puzzle, declarations)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={s.root}>
      <div style={s.card}>
        <div style={s.seal}>谜</div>
        <div style={s.badge}>成功</div>

        <div style={s.charRow}>
          {puzzle.chengyu.chars.map((c, i) => (
            <div key={i} style={s.chengyuChar}>{c}</div>
          ))}
        </div>
        <div style={s.pinyin}>{puzzle.chengyu.pinyin}</div>
        <p style={s.meaning}>{puzzle.chengyu.meaning}</p>

        <div style={s.divider} />
        <p style={s.story}>{puzzle.story}</p>

        <div style={s.divider} />

        <button style={s.shareBtn} onClick={handleShare}>
          {copied ? '已复制 · Copied!' : '分享 · Share'}
        </button>

        <p style={s.countdown}>Next puzzle in {countdown}</p>
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
  badge: {
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
  charRow: {
    display: 'flex',
    gap: 6,
    justifyContent: 'center',
    marginBottom: 12,
  },
  chengyuChar: {
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
  pinyin: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 13,
    color: 'var(--grey)',
    fontStyle: 'italic',
    marginBottom: 6,
  },
  meaning: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 14,
    color: 'var(--ink)',
    lineHeight: 1.7,
  },
  story: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 13,
    color: 'var(--grey)',
    lineHeight: 1.8,
    textAlign: 'left',
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
  countdown: {
    fontSize: 12,
    color: '#c8bfaa',
    fontStyle: 'italic',
  },
}
