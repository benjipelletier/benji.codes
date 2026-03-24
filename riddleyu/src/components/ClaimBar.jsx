import React from 'react'

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <line x1="13.5" y1="13.5" x2="17" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function TargetIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <circle cx="10" cy="10" r="1" fill="currentColor"/>
    </svg>
  )
}

export default function ClaimBar({ text, label, subPhase, clusterChars, lessonShown }) {
  if (!text) return null

  const isPicking = subPhase === 'picking'

  // In choosing mode, hide lesson until user makes first pick attempt
  const displayText = isPicking
    ? text
    : lessonShown
      ? text
      : null

  const promptText = !isPicking && !lessonShown
    ? '先凭感觉选，选完再看解释。'
    : null

  return (
    <div
      className="claimbar-enter"
      key={`${subPhase}-${label}`}
      style={{ ...s.root, ...(isPicking ? s.rootPicking : s.rootChoosing) }}
    >
      <div style={s.labelRow}>
        <span style={{ ...s.icon, ...(isPicking ? s.iconPicking : s.iconChoosing) }}>
          {isPicking ? <SearchIcon /> : <TargetIcon />}
        </span>
        {label && <div style={{ ...s.label, ...(isPicking ? {} : s.labelChoosing) }}>{label}</div>}
      </div>

      {isPicking && (
        <p style={s.instruction}>找出四个相关的字，选完后提交。</p>
      )}

      {displayText && (
        <p style={{ ...s.text, ...(isPicking ? {} : s.textChoosing) }}>{displayText}</p>
      )}

      {promptText && (
        <p style={s.promptText}>{promptText}</p>
      )}

      {!isPicking && clusterChars && (
        <div style={s.charRow}>
          {clusterChars.map((c, i) => (
            <span key={i} style={s.miniChar}>{c}</span>
          ))}
        </div>
      )}
    </div>
  )
}

const s = {
  root: {
    padding: '14px 18px',
    margin: '0 16px',
    borderRadius: 12,
    border: '1.5px solid',
    transition: 'all 0.3s ease',
  },
  rootPicking: {
    background: 'white',
    borderColor: '#d4cabb',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
  },
  rootChoosing: {
    background: '#f0f4f8',
    borderColor: '#1a3a5c',
    boxShadow: '0 2px 12px rgba(26, 58, 92, 0.1)',
  },
  labelRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  icon: {
    display: 'flex',
    alignItems: 'center',
  },
  iconPicking: {
    color: 'var(--grey)',
  },
  iconChoosing: {
    color: '#1a3a5c',
  },
  label: {
    fontSize: 10,
    letterSpacing: 1,
    color: 'var(--grey)',
    fontFamily: "'Noto Sans SC', sans-serif",
    textTransform: 'uppercase',
  },
  labelChoosing: {
    color: '#1a3a5c',
  },
  instruction: {
    fontFamily: "'Noto Sans SC', sans-serif",
    fontSize: 11,
    color: '#a09880',
    marginBottom: 6,
    lineHeight: 1.5,
  },
  text: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 15,
    lineHeight: 1.8,
    color: 'var(--ink)',
  },
  textChoosing: {
    color: '#1a2a3c',
  },
  promptText: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 14,
    color: '#4a6a8a',
    fontStyle: 'italic',
    lineHeight: 1.7,
  },
  charRow: {
    display: 'flex',
    gap: 8,
    marginTop: 12,
    justifyContent: 'center',
  },
  miniChar: {
    width: 38,
    height: 38,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    border: '1.5px solid #c8bfaa',
    background: 'white',
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--ink)',
    boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
  },
}
