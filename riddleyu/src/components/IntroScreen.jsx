import React from 'react'

// Mini grid icon — 4 cards with one highlighted
function IconGrid() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect x="4" y="4" width="18" height="18" rx="3" fill="#fff" stroke="#d4cabb" strokeWidth="1.5"/>
      <rect x="26" y="4" width="18" height="18" rx="3" fill="#fff8f0" stroke="#c0392b" strokeWidth="2"/>
      <rect x="4" y="26" width="18" height="18" rx="3" fill="#fff8f0" stroke="#c0392b" strokeWidth="2"/>
      <rect x="26" y="26" width="18" height="18" rx="3" fill="#fff8f0" stroke="#c0392b" strokeWidth="2"/>
      <text x="13" y="17" textAnchor="middle" fontFamily="'Noto Serif SC', serif" fontSize="10" fontWeight="700" fill="#ccc">走</text>
      <text x="35" y="17" textAnchor="middle" fontFamily="'Noto Serif SC', serif" fontSize="10" fontWeight="700" fill="#c0392b">到</text>
      <text x="13" y="39" textAnchor="middle" fontFamily="'Noto Serif SC', serif" fontSize="10" fontWeight="700" fill="#c0392b">达</text>
      <text x="35" y="39" textAnchor="middle" fontFamily="'Noto Serif SC', serif" fontSize="10" fontWeight="700" fill="#c0392b">至</text>
    </svg>
  )
}

// Repeat icon — 2×2 grid of green tiles forming the idiom
function IconRepeat() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect x="4" y="4" width="18" height="18" rx="3" fill="#e8f5e9" stroke="#2d7a4f" strokeWidth="1.5"/>
      <rect x="26" y="4" width="18" height="18" rx="3" fill="#e8f5e9" stroke="#2d7a4f" strokeWidth="1.5"/>
      <rect x="4" y="26" width="18" height="18" rx="3" fill="#e8f5e9" stroke="#2d7a4f" strokeWidth="1.5"/>
      <rect x="26" y="26" width="18" height="18" rx="3" fill="#e8f5e9" stroke="#2d7a4f" strokeWidth="1.5"/>
      <text x="13" y="17" textAnchor="middle" fontFamily="'Noto Serif SC', serif" fontSize="10" fontWeight="700" fill="#2d7a4f">马</text>
      <text x="35" y="17" textAnchor="middle" fontFamily="'Noto Serif SC', serif" fontSize="10" fontWeight="700" fill="#2d7a4f">到</text>
      <text x="13" y="39" textAnchor="middle" fontFamily="'Noto Serif SC', serif" fontSize="10" fontWeight="700" fill="#2d7a4f">成</text>
      <text x="35" y="39" textAnchor="middle" fontFamily="'Noto Serif SC', serif" fontSize="10" fontWeight="700" fill="#2d7a4f">功</text>
    </svg>
  )
}

// Reveal icon — two chars side by side, correct one green with checkmark
function IconReveal() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect x="2" y="14" width="20" height="20" rx="3" fill="#e0d9ce" stroke="#d4cabb" strokeWidth="1.5"/>
      <rect x="26" y="14" width="20" height="20" rx="3" fill="#e8f5e9" stroke="#2d7a4f" strokeWidth="2"/>
      <text x="12" y="28" textAnchor="middle" fontFamily="'Noto Serif SC', serif" fontSize="10" fontWeight="700" fill="#aaa">达</text>
      <text x="36" y="28" textAnchor="middle" fontFamily="'Noto Serif SC', serif" fontSize="10" fontWeight="700" fill="#2d7a4f">到</text>
    </svg>
  )
}

export default function IntroScreen({ onStart }) {
  return (
    <div style={s.root}>
      <div style={s.card}>
        <div style={s.seal}>谜</div>
        <div style={s.logoZh}>谜语</div>
        <div style={s.logoEn}>RiddleYu</div>
        <div style={s.divider} />
        <p style={s.tagline}>每天一个成语推理。</p>
        <p style={s.sub}>
          One idiom a day. Find the characters, learn the differences.
        </p>

        <div style={s.steps}>
          <div style={s.step}>
            <div style={s.stepIcon}><IconGrid /></div>
            <div style={s.stepContent}>
              <div style={s.stepLabel}>找四个同类字</div>
              <div style={s.stepText}>Read the hint, then select all 4 characters that share the same theme. Submit when you have 4.</div>
            </div>
          </div>

          <div style={s.stepDivider} />

          <div style={s.step}>
            <div style={s.stepIcon}><IconReveal /></div>
            <div style={s.stepContent}>
              <div style={s.stepLabel}>选出成语里的字</div>
              <div style={s.stepText}>Pick the one character from those 4 that belongs in the idiom. Make your guess first — then see the explanation.</div>
            </div>
          </div>

          <div style={s.stepDivider} />

          <div style={s.step}>
            <div style={s.stepIcon}><IconRepeat /></div>
            <div style={s.stepContent}>
              <div style={s.stepLabel}>揭晓成语</div>
              <div style={s.stepText}>Do this for all four positions to reveal today's 成语.</div>
            </div>
          </div>
        </div>

        {/* Example share */}
        <div style={s.example}>
          <span style={s.exampleLabel}>Perfect game</span>
          <span style={s.exampleTiles}>🟩🟩🟩🟩</span>
        </div>

        <button style={s.btn} onClick={onStart}>开始 · Start</button>
        <p style={s.vibe}>Vibecoded with ♥ by <a href="https://instagram.com/benjipelletier" target="_blank" rel="noreferrer" style={s.vibeLink}>笨鸡</a></p>
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
    padding: '40px 28px',
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
  logoZh: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 48,
    fontWeight: 900,
    color: 'var(--ink)',
    lineHeight: 1,
  },
  logoEn: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 13,
    letterSpacing: 4,
    color: 'var(--grey)',
    textTransform: 'uppercase',
    marginTop: 4,
  },
  divider: {
    width: 40,
    height: 2,
    background: 'var(--paper3)',
    margin: '20px auto',
  },
  tagline: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 18,
    lineHeight: 1.8,
    color: 'var(--ink)',
    marginBottom: 8,
  },
  sub: {
    fontSize: 13,
    lineHeight: 1.7,
    color: 'var(--grey)',
    marginBottom: 20,
  },
  steps: {
    background: 'var(--paper2)',
    borderRadius: 14,
    padding: '20px 18px',
    marginBottom: 20,
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  stepIcon: {
    flexShrink: 0,
    width: 48,
    height: 48,
  },
  stepContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  stepLabel: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--ink)',
  },
  stepText: {
    fontSize: 11,
    color: 'var(--grey)',
    lineHeight: 1.5,
  },
  stepDivider: {
    width: '100%',
    height: 1,
    background: '#e8e2d4',
  },
  example: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
  },
  exampleLabel: {
    fontSize: 11,
    color: '#c8bfaa',
    fontStyle: 'italic',
  },
  exampleTiles: {
    fontSize: 16,
    letterSpacing: 2,
  },
  btn: {
    width: '100%',
    padding: '14px 0',
    background: 'var(--ink)',
    color: 'var(--paper)',
    border: 'none',
    borderRadius: 12,
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: 2,
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
  },
  vibe: {
    marginTop: 16,
    fontSize: 11,
    color: '#c8bfaa',
  },
  vibeLink: {
    color: '#c8bfaa',
    textDecoration: 'none',
  },
}
