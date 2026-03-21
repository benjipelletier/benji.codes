import React from 'react'

export default function CharacterGrid({
  grid, selected, solvedClusters, answers, wrongFlash,
  subPhase, currentClusterChars, onSelect,
}) {
  const solvedChars = new Set(solvedClusters)
  const answerSet = new Set(answers)
  const currentSet = new Set(currentClusterChars || [])
  const choosing = subPhase === 'choosing'

  return (
    <div style={s.grid}>
      {grid.map((char, idx) => {
        const isSolvedNonAnswer = solvedChars.has(char) && !answerSet.has(char)
        const isAnswer = answerSet.has(char)
        const isSelected = selected.has(char)
        const isFlashing = wrongFlash && wrongFlash.has(char)
        const isCurrentCluster = currentSet.has(char)

        // During choosing, only current cluster chars are active
        const isDimmed = choosing && !isCurrentCluster && !isAnswer && !isSolvedNonAnswer

        const cardStyle = isAnswer
          ? s.cardAnswer
          : isSolvedNonAnswer
            ? s.cardSolved
            : isSelected
              ? s.cardSelected
              : isFlashing
                ? s.cardFlash
                : choosing && isCurrentCluster
                  ? s.cardClusterActive
                  : isDimmed
                    ? s.cardDimmed
                    : s.cardClosed

        const disabled = isAnswer || isSolvedNonAnswer || isDimmed

        return (
          <button
            key={`${char}-${idx}`}
            className={[
              isFlashing && 'shake',
              isAnswer && 'card-zai',
              isSolvedNonAnswer && 'card-buzai',
            ].filter(Boolean).join(' ') || undefined}
            style={{ ...s.card, ...cardStyle }}
            onClick={() => !disabled && onSelect(char)}
            disabled={disabled}
          >
            <span style={{
              ...s.charText,
              ...(isSolvedNonAnswer ? s.charMuted : {}),
              ...(isDimmed ? s.charDimmed : {}),
            }}>{char}</span>
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
  },
  cardSelected: {
    background: '#fff8f0',
    borderColor: 'var(--red)',
    borderWidth: 2.5,
    boxShadow: '0 2px 12px rgba(192, 57, 43, 0.15)',
  },
  cardAnswer: {
    background: '#e8f5e9',
    borderColor: '#2d7a4f',
    cursor: 'default',
  },
  cardSolved: {
    background: 'var(--paper2)',
    borderColor: '#e0d9ce',
    cursor: 'default',
    opacity: 0.5,
  },
  cardFlash: {
    background: '#fdecea',
    borderColor: 'var(--red)',
  },
  cardClusterActive: {
    background: 'white',
    borderColor: '#d4cabb',
    borderWidth: 2,
  },
  cardDimmed: {
    background: 'var(--paper2)',
    borderColor: '#e0d9ce',
    cursor: 'default',
    opacity: 0.3,
  },
  charText: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 24,
    fontWeight: 700,
    color: 'var(--ink)',
  },
  charMuted: {
    color: 'var(--grey)',
  },
  charDimmed: {
    color: '#ccc',
  },
}
