import { useState, useEffect } from 'react';

export default function ReconstructChallenge({ data, onComplete }) {
  const { characters, distractors, hint } = data;
  const allChars = shuffle([...characters, ...distractors]);
  const [tiles] = useState(allChars);
  const [selected, setSelected] = useState([]);
  const [showHint, setShowHint] = useState(false);
  const [result, setResult] = useState(null); // 'correct' | 'wrong'
  const [wrongIndex, setWrongIndex] = useState(null);

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function handleTile(char) {
    if (result === 'correct') return;
    if (selected.includes(char)) {
      setSelected(selected.filter(c => c !== char));
      return;
    }
    if (selected.length >= characters.length) return;
    const next = [...selected, char];
    setSelected(next);

    // Check each character as it's placed
    const pos = next.length - 1;
    if (next[pos] !== characters[pos]) {
      setWrongIndex(pos);
      setResult('wrong');
      setTimeout(() => {
        setSelected([]);
        setResult(null);
        setWrongIndex(null);
      }, 700);
    } else if (next.length === characters.length) {
      setResult('correct');
      setTimeout(() => onComplete(), 600);
    }
  }

  return (
    <div style={s.wrap}>
      <p style={s.hint2}>{hint}</p>

      {/* Answer slots */}
      <div style={s.slots}>
        {characters.map((_, i) => (
          <div
            key={i}
            style={{
              ...s.slot,
              background: result === 'correct' ? '#C23B22' : result === 'wrong' && wrongIndex === i ? '#8B2A1A' : '#1A1A1A',
              borderColor: result === 'correct' ? '#C23B22' : '#2A2A2A',
              transform: result === 'correct' ? 'scale(1.08)' : 'scale(1)',
              transition: 'all 0.2s ease',
            }}
          >
            <span style={s.slotChar}>{selected[i] || ''}</span>
          </div>
        ))}
      </div>

      {/* Character tiles */}
      <div style={s.tileGrid}>
        {tiles.map((char, i) => {
          const isSelected = selected.includes(char);
          const isDone = result === 'correct';
          return (
            <button
              key={i}
              onClick={() => handleTile(char)}
              disabled={isSelected || isDone}
              style={{
                ...s.tile,
                opacity: isSelected ? 0.25 : 1,
                transform: isSelected ? 'scale(0.9)' : 'scale(1)',
                background: isSelected ? '#C8BFB0' : '#F5F0E8',
              }}
            >
              {char}
            </button>
          );
        })}
      </div>

      {/* Hint button */}
      <button onClick={() => setShowHint(h => !h)} style={s.hintBtn}>
        {showHint ? '隐藏提示' : '提示 →'}
      </button>
      {showHint && <p style={s.hintText}>{hint}</p>}
    </div>
  );
}

const s = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 20,
    padding: '0 4px',
  },
  hint2: {
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    fontSize: 14,
    color: '#6A5A4A',
    textAlign: 'center',
    margin: 0,
  },
  slots: {
    display: 'flex',
    gap: 10,
  },
  slot: {
    width: 54,
    height: 54,
    borderRadius: 6,
    border: '2px solid #2A2A2A',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotChar: {
    fontFamily: "'Noto Serif SC', serif",
    fontWeight: 700,
    fontSize: 26,
    color: '#F5F0E8',
  },
  tileGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    maxWidth: 320,
  },
  tile: {
    width: 58,
    height: 58,
    borderRadius: 8,
    border: '1.5px solid #8A7A6A',
    background: '#F5F0E8',
    fontFamily: "'Noto Serif SC', serif",
    fontWeight: 600,
    fontSize: 26,
    color: '#1A1A1A',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
  },
  hintBtn: {
    background: 'none',
    border: 'none',
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    fontSize: 13,
    color: '#8A7A6A',
    cursor: 'pointer',
    padding: '4px 8px',
    textDecoration: 'underline',
  },
  hintText: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: 13,
    color: '#6A5A4A',
    textAlign: 'center',
    margin: 0,
    padding: '8px 16px',
    background: 'rgba(0,0,0,0.04)',
    borderRadius: 6,
    maxWidth: 280,
  },
};
