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

export default function ClaimBar({ text, label, subPhase, clusterChars }) {
  if (!text) return null

  const isPicking = subPhase === 'picking'

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
      <p style={{ ...s.text, ...(isPicking ? {} : s.textChoosing) }}>{text}</p>
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
    background: '#fff8f0',
    borderColor: 'var(--red)',
    boxShadow: '0 2px 12px rgba(192, 57, 43, 0.1)',
  },
  labelRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  icon: {
    display: 'flex',
    alignItems: 'center',
  },
  iconPicking: {
    color: 'var(--grey)',
  },
  iconChoosing: {
    color: 'var(--red)',
  },
  label: {
    fontSize: 10,
    letterSpacing: 1,
    color: 'var(--grey)',
    fontFamily: "'Noto Sans SC', sans-serif",
    textTransform: 'uppercase',
  },
  labelChoosing: {
    color: 'var(--red)',
  },
  text: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 15,
    lineHeight: 1.8,
    color: 'var(--ink)',
  },
  textChoosing: {
    color: '#5a2a1a',
  },
  charRow: {
    display: 'flex',
    gap: 6,
    marginTop: 10,
    justifyContent: 'center',
  },
  miniChar: {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    border: '1.5px solid #d4cabb',
    background: 'white',
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--ink)',
  },
}
