import React from 'react'

export default function ClaimBar({ text, label }) {
  if (!text) return null

  return (
    <div style={s.root}>
      {label && <div style={s.label}>{label}</div>}
      <p style={s.text}>{text}</p>
    </div>
  )
}

const s = {
  root: {
    padding: '16px 20px 12px',
    background: 'white',
    margin: '0 16px',
    borderRadius: 12,
    border: '1.5px solid #d4cabb',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
  },
  label: {
    fontSize: 10,
    letterSpacing: 1,
    color: 'var(--grey)',
    fontFamily: "'Noto Sans SC', sans-serif",
    marginBottom: 6,
  },
  text: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 15,
    lineHeight: 1.8,
    color: 'var(--ink)',
  },
}
