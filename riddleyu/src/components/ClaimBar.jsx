import React, { useState, useRef } from 'react'

export default function ClaimBar({ claims, selected, viewingClaim, puzzle }) {
  const [viewIndex, setViewIndex] = useState(null) // null = latest
  const touchStart = useRef(null)

  // Always show latest claim when new one arrives
  const displayIndex = viewIndex ?? claims.length - 1
  const claim = claims[displayIndex]

  React.useEffect(() => {
    setViewIndex(null) // snap to latest on new claim
  }, [claims.length])

  function onTouchStart(e) {
    touchStart.current = e.touches[0].clientX
  }

  function onTouchEnd(e) {
    if (touchStart.current === null) return
    const diff = e.changedTouches[0].clientX - touchStart.current
    touchStart.current = null
    if (Math.abs(diff) < 40) return
    if (diff < 0 && displayIndex > 0) {
      // Swipe left → older claims
      setViewIndex(displayIndex - 1)
    } else if (diff > 0 && displayIndex < claims.length - 1) {
      // Swipe right → newer claims
      setViewIndex(displayIndex + 1)
    }
  }

  // Mode 1: Viewing a specific opened card's claim
  if (viewingClaim && puzzle) {
    const charData = puzzle.characters[viewingClaim]
    return (
      <div style={s.root}>
        <div style={s.label}>来自：{viewingClaim}</div>
        <p style={s.text}>{charData.claim}</p>
      </div>
    )
  }

  // Mode 2: A closed card is selected — show instruction
  if (selected) {
    return (
      <div style={s.root}>
        <div style={s.label}>已选：{selected}</div>
        <p style={s.instruction}>这个字在成语里吗？点击下方 「在」 或 「不在」。</p>
      </div>
    )
  }

  // Mode 3: Default — show claim history
  if (!claim) return null

  return (
    <div
      style={s.root}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div style={s.label}>
        来自：{claim.char}
        {claims.length > 1 && (
          <span style={s.counter}>{displayIndex + 1} / {claims.length}</span>
        )}
      </div>
      <p style={s.text}>{claim.claim}</p>
      {claims.length > 1 && (
        <div style={s.dots}>
          {claims.map((_, i) => (
            <div key={i} style={{
              ...s.dot,
              background: i === displayIndex ? 'var(--ink)' : '#d4cabb',
            }} />
          ))}
        </div>
      )}
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
    position: 'relative',
    touchAction: 'pan-y',
  },
  label: {
    fontSize: 10,
    letterSpacing: 1,
    color: 'var(--grey)',
    fontFamily: "'Noto Sans SC', sans-serif",
    marginBottom: 6,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  counter: {
    fontSize: 9,
    color: '#c8bfaa',
  },
  text: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 15,
    lineHeight: 1.8,
    color: 'var(--ink)',
  },
  instruction: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 14,
    lineHeight: 1.8,
    color: 'var(--grey)',
    fontStyle: 'italic',
  },
  dots: {
    display: 'flex',
    gap: 4,
    justifyContent: 'center',
    marginTop: 8,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    transition: 'background 0.2s',
  },
}
