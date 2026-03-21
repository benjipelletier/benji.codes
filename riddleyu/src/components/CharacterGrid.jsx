import React from 'react'

export default function CharacterGrid({ grid, opened, selected, wrongFlash, onSelect }) {
  return (
    <div style={s.grid}>
      {grid.map((char, idx) => {
        const status = opened[char] // 'zai' | 'buzai' | undefined
        const isSelected = selected === char
        const isFlashing = wrongFlash === char

        const cardStyle = status === 'zai'
          ? s.cardZai
          : status === 'buzai'
            ? s.cardBuzai
            : isSelected
              ? s.cardSelected
              : isFlashing
                ? s.cardFlash
                : s.cardClosed

        return (
          <button
            key={`${char}-${idx}`}
            className={[isFlashing && 'shake', status === 'zai' && 'card-zai', status === 'buzai' && 'card-buzai'].filter(Boolean).join(' ') || undefined}
            style={{ ...s.card, ...cardStyle }}
            onClick={() => onSelect(char)}
          >
            <span style={s.charText}>{char}</span>
            {status === 'zai' && <span style={s.statusLabel}>在</span>}
            {status === 'buzai' && <span style={s.statusLabel}>不在</span>}
          </button>
        )
      })}
    </div>
  )
}

const s = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 8,
    padding: '0 16px',
  },
  card: {
    aspectRatio: '1',
    borderRadius: 10,
    border: '1.5px solid',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.12s ease',
    position: 'relative',
    background: 'none',
    padding: 0,
  },
  cardClosed: {
    background: 'white',
    borderColor: '#d4cabb',
    cursor: 'pointer',
  },
  cardSelected: {
    background: '#fff8f0',
    borderColor: 'var(--red)',
    borderWidth: 2.5,
    boxShadow: '0 2px 12px rgba(192, 57, 43, 0.15)',
  },
  cardZai: {
    background: '#e8f5e9',
    borderColor: '#2d7a4f',
    cursor: 'pointer',
  },
  cardBuzai: {
    background: 'var(--paper2)',
    borderColor: '#e0d9ce',
    cursor: 'pointer',
    opacity: 0.5,
  },
  cardFlash: {
    background: '#fdecea',
    borderColor: 'var(--red)',
  },
  charText: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 24,
    fontWeight: 700,
    color: 'var(--ink)',
  },
  statusLabel: {
    position: 'absolute',
    bottom: 3,
    right: 5,
    fontSize: 8,
    fontWeight: 700,
    fontFamily: "'Noto Sans SC', sans-serif",
    color: 'var(--grey)',
  },
}
