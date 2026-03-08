import { useState } from 'react';

// Handles all multiple-choice challenge types:
// match_achievement, match_era, match_connection, match_radical,
// identify_composition, match_meaning, match_origin, fill_blank,
// match_definition, scenario

export default function MatchChallenge({ data, onComplete }) {
  const { question, correct, distractors, scenario } = data;
  const [options] = useState(shuffle([correct, ...distractors]));
  const [selected, setSelected] = useState(null);
  const [revealed, setRevealed] = useState(false);

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function handleSelect(opt) {
    if (revealed) return;
    setSelected(opt);
    setRevealed(true);

    if (opt === correct) {
      setTimeout(() => onComplete(), 700);
    }
    // If wrong, stay revealed so they can see the correct answer
  }

  function getOptionStyle(opt) {
    if (!revealed) return s.option;
    if (opt === correct) return { ...s.option, ...s.optionCorrect };
    if (opt === selected && opt !== correct) return { ...s.option, ...s.optionWrong };
    return { ...s.option, ...s.optionDimmed };
  }

  return (
    <div style={s.wrap}>
      {scenario && (
        <div style={s.scenarioBox}>
          <p style={s.scenarioText}>{scenario}</p>
        </div>
      )}
      <p style={s.question}>{question}</p>
      <div style={s.options}>
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => handleSelect(opt)}
            style={getOptionStyle(opt)}
          >
            <span style={s.optLabel}>{String.fromCharCode(65 + i)}</span>
            <span style={s.optText}>{opt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const s = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: '0 4px',
  },
  scenarioBox: {
    background: 'rgba(0,0,0,0.04)',
    borderLeft: '3px solid #8A7A6A',
    padding: '10px 14px',
    borderRadius: '0 6px 6px 0',
  },
  scenarioText: {
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    fontSize: 14,
    color: '#4A3A2A',
    margin: 0,
    lineHeight: 1.5,
  },
  question: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 15,
    color: '#1A1A1A',
    margin: 0,
    lineHeight: 1.6,
    textAlign: 'center',
  },
  options: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  option: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px 16px',
    background: '#F5F0E8',
    border: '1.5px solid #C8BFB0',
    borderRadius: 8,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.2s ease',
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  },
  optionCorrect: {
    background: '#E8F5E0',
    borderColor: '#4A8A3A',
    boxShadow: '0 2px 8px rgba(74,138,58,0.2)',
  },
  optionWrong: {
    background: '#F5E0E0',
    borderColor: '#C23B22',
    boxShadow: '0 2px 8px rgba(194,59,34,0.15)',
  },
  optionDimmed: {
    opacity: 0.4,
  },
  optLabel: {
    fontFamily: "'Playfair Display', serif",
    fontWeight: 700,
    fontSize: 13,
    color: '#8A7A6A',
    minWidth: 18,
    paddingTop: 1,
  },
  optText: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: 15,
    color: '#1A1A1A',
    lineHeight: 1.5,
  },
};
