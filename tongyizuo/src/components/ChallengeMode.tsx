'use client';

import { useState, useCallback } from 'react';
import type { ClusterData, ClusterMember } from '../../lib/types';
import { WORD_COLORS } from './WordNode';

interface Props {
  cluster: ClusterData;
}

type AnswerState = 'unanswered' | 'correct' | 'wrong';

export default function ChallengeMode({ cluster }: Props) {
  const situations = cluster.situations;
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answerState, setAnswerState] = useState<AnswerState>('unanswered');
  const [chosenWordId, setChosenWordId] = useState<number | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  const current = situations[currentIdx];
  const isAnswered = answerState !== 'unanswered';

  const getWordForId = useCallback(
    (wordId: number): ClusterMember | undefined =>
      cluster.members.find((m) => m.id === wordId),
    [cluster.members]
  );

  const answerWord = current ? getWordForId(current.answer_word_id) : undefined;

  function handleAnswer(member: ClusterMember) {
    if (isAnswered) return;

    setChosenWordId(member.id);
    const correct = member.id === current.answer_word_id;
    setAnswerState(correct ? 'correct' : 'wrong');
    setScore((prev) => ({
      correct: prev.correct + (correct ? 1 : 0),
      total: prev.total + 1,
    }));
  }

  function handleNext() {
    setAnswerState('unanswered');
    setChosenWordId(null);
    setCurrentIdx((prev) => (prev + 1) % situations.length);
  }

  if (situations.length === 0) {
    return (
      <div style={s.empty}>
        <p>No challenge situations available for this cluster yet.</p>
      </div>
    );
  }

  const difficultyLabel = ['', 'Obvious', 'Requires thought', 'Tricky'][current.difficulty] ?? '';
  const difficultyColor = ['', 'rgba(65,217,114,0.7)', 'rgba(217,164,65,0.7)', 'rgba(217,65,65,0.7)'][current.difficulty] ?? '#888';

  return (
    <div style={s.wrap}>
      {/* Score + progress */}
      <div style={s.topBar}>
        <div style={s.scoreDisplay}>
          <span style={s.scoreNum}>{score.correct}</span>
          <span style={s.scoreSep}>/</span>
          <span style={s.scoreTotal}>{score.total}</span>
          <span style={s.scoreLabel}>correct</span>
        </div>
        <div style={s.progress}>
          {situations.map((_, i) => (
            <div
              key={i}
              style={{
                ...s.dot,
                background: i === currentIdx
                  ? '#d9a441'
                  : i < currentIdx
                    ? 'rgba(217,164,65,0.4)'
                    : 'rgba(217,164,65,0.1)',
              }}
            />
          ))}
        </div>
        <div style={{ ...s.difficulty, color: difficultyColor }}>
          {difficultyLabel}
        </div>
      </div>

      {/* Situation card */}
      <div style={s.situationCard}>
        <p style={s.situationText}>{current.situation_en}</p>
      </div>

      {/* Word choices */}
      <div style={s.choices}>
        {cluster.members.map((member, i) => {
          const color = WORD_COLORS[i % WORD_COLORS.length];
          const isChosen = chosenWordId === member.id;
          const isCorrect = member.id === current.answer_word_id;

          let border = `1px solid ${color}44`;
          let bg = `${color}08`;
          let glow = '';

          if (isAnswered) {
            if (isCorrect) {
              border = `2px solid ${color}`;
              bg = `${color}18`;
              glow = `0 0 20px ${color}44`;
            } else if (isChosen) {
              border = `2px solid #d9414188`;
              bg = `rgba(217,65,65,0.1)`;
            } else {
              border = `1px solid ${color}22`;
              bg = `${color}04`;
            }
          }

          return (
            <button
              key={member.simplified}
              style={{
                ...s.choiceBtn,
                border,
                background: bg,
                boxShadow: glow || 'none',
                cursor: isAnswered ? 'default' : 'pointer',
                opacity: isAnswered && !isCorrect && !isChosen ? 0.45 : 1,
              }}
              onClick={() => handleAnswer(member)}
            >
              <span className="zh" style={{ fontSize: '36px', color, lineHeight: 1 }}>
                {member.simplified}
              </span>
              <span style={{ fontSize: '11px', color: 'rgba(232,213,176,0.45)' }}>
                {member.pinyin_display ?? member.pinyin}
              </span>
              {isAnswered && isCorrect && (
                <span style={{ fontSize: '18px', marginTop: '4px' }}>✓</span>
              )}
              {isAnswered && isChosen && !isCorrect && (
                <span style={{ fontSize: '18px', marginTop: '4px', color: '#d94141' }}>✗</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Explanation panel (shown after answer) */}
      {isAnswered && (
        <div
          style={{
            ...s.explanation,
            borderColor: answerState === 'correct' ? 'rgba(65,217,114,0.2)' : 'rgba(217,65,65,0.2)',
            background: answerState === 'correct' ? 'rgba(65,217,114,0.04)' : 'rgba(217,65,65,0.04)',
          }}
        >
          <p
            style={{
              fontSize: '14px',
              fontWeight: 500,
              color: answerState === 'correct' ? 'rgba(65,217,114,0.9)' : 'rgba(217,65,65,0.9)',
              marginBottom: '10px',
            }}
          >
            {answerState === 'correct' ? '✓ Correct' : `✗ The answer is ${answerWord?.simplified ?? '?'}`}
          </p>
          <p style={s.explanationText}>{current.explanation}</p>
          {current.example_zh && (
            <p className="zh" style={s.exampleZh}>{current.example_zh}</p>
          )}
        </div>
      )}

      {/* Next button */}
      {isAnswered && (
        <button style={s.nextBtn} onClick={handleNext}>
          {currentIdx < situations.length - 1 ? 'Next situation →' : 'Start over ↺'}
        </button>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    maxWidth: '640px',
    margin: '0 auto',
    width: '100%',
  },
  empty: {
    padding: '40px',
    textAlign: 'center',
    color: 'rgba(232,213,176,0.4)',
    fontSize: '14px',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
  },
  scoreDisplay: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '4px',
  },
  scoreNum: {
    fontSize: '24px',
    color: '#d9a441',
    fontWeight: 500,
  },
  scoreSep: {
    fontSize: '18px',
    color: 'rgba(232,213,176,0.3)',
  },
  scoreTotal: {
    fontSize: '18px',
    color: 'rgba(232,213,176,0.5)',
  },
  scoreLabel: {
    fontSize: '11px',
    color: 'rgba(232,213,176,0.3)',
    marginLeft: '4px',
    letterSpacing: '0.1em',
  },
  progress: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    transition: 'background 0.3s',
  },
  difficulty: {
    fontSize: '11px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
  },
  situationCard: {
    background: 'rgba(217,164,65,0.05)',
    border: '1px solid rgba(217,164,65,0.15)',
    borderRadius: '12px',
    padding: '24px',
  },
  situationText: {
    fontSize: '15px',
    color: '#e8d5b0',
    lineHeight: 1.7,
  },
  choices: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  choiceBtn: {
    borderRadius: '12px',
    padding: '16px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.2s',
    minWidth: '100px',
    fontFamily: 'inherit',
  },
  explanation: {
    border: '1px solid',
    borderRadius: '10px',
    padding: '20px',
    transition: 'all 0.3s',
  },
  explanationText: {
    fontSize: '13px',
    color: 'rgba(232,213,176,0.65)',
    lineHeight: 1.65,
    marginBottom: '12px',
  },
  exampleZh: {
    fontSize: '15px',
    color: 'rgba(217,164,65,0.8)',
    lineHeight: 1.6,
    borderLeft: '2px solid rgba(217,164,65,0.3)',
    paddingLeft: '12px',
  },
  nextBtn: {
    alignSelf: 'center',
    background: 'rgba(217,164,65,0.1)',
    border: '1px solid rgba(217,164,65,0.3)',
    borderRadius: '8px',
    padding: '10px 24px',
    color: '#d9a441',
    fontSize: '13px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};
