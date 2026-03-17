import { useState, useEffect } from 'react'
import { getPuzzleForDate, getTodayString } from './puzzles'

const c = {
  paper: '#f5f0e8',
  paper2: '#ede8dc',
  paper3: '#d4c9b0',
  ink: '#2c1810',
  seal: '#c0392b',
  gold: '#b8960c',
  active: '#1a3a5c',
  grey: '#8a8a8a',
}

export default function EmojiPrototype() {
  const [puzzle, setPuzzle] = useState(null)
  const [solved, setSolved] = useState([false, false, false, false])
  const [activeChar, setActiveChar] = useState(0)
  const [witnessIndex, setWitnessIndex] = useState(0)
  const [showArchive, setShowArchive] = useState(false)

  useEffect(() => {
    getPuzzleForDate(getTodayString()).then(p => setPuzzle(p))
  }, [])

  if (!puzzle) {
    return (
      <div style={{ background: c.paper, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Noto Serif SC', serif", fontSize: 24, color: c.grey }}>
        谜语…
      </div>
    )
  }

  const riddle = puzzle.riddles[activeChar]
  const allSolved = solved.every(Boolean)

  function solveChar(i) {
    const next = [...solved]
    next[i] = true
    setSolved(next)
    setWitnessIndex(0)
    if (i < 3) setActiveChar(i + 1)
  }

  function reset() {
    setSolved([false, false, false, false])
    setActiveChar(0)
    setWitnessIndex(0)
    setShowArchive(false)
  }

  return (
    <div style={{ background: c.paper, minHeight: '100vh', fontFamily: "'Noto Sans SC', sans-serif", color: c.ink }}>
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '16px 16px 40px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, fontWeight: 700 }}>
            谜语 <span style={{ color: c.grey, fontSize: 14, fontWeight: 400 }}>RiddleYu</span>
          </div>
          <button
            onClick={() => setShowArchive(!showArchive)}
            style={{ background: 'none', border: `1px solid ${c.paper3}`, borderRadius: 8, padding: '4px 10px', fontSize: 13, color: c.grey, cursor: 'pointer' }}
          >
            {showArchive ? '← game' : '📜 archive'}
          </button>
        </div>

        {showArchive ? (
          <Archive today={puzzle} />
        ) : (
          <>
            <StoryCanvas
              story={puzzle.story}
              riddles={puzzle.riddles}
              solved={solved}
              activeChar={activeChar}
              allSolved={allSolved}
              chengyu={puzzle.chengyu}
              pinyin={puzzle.pinyin}
              meaning={puzzle.meaning}
            />

            {!allSolved && (
              <>
                <WitnessBox
                  riddle={riddle}
                  char={puzzle.chengyu[activeChar]}
                  witnessIndex={witnessIndex}
                  onNextWitness={() => setWitnessIndex(Math.min(witnessIndex + 1, riddle.witnesses.length - 1))}
                  onSolve={() => solveChar(activeChar)}
                />

                {/* Char nav dots */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                  {puzzle.riddles.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => { setActiveChar(i); setWitnessIndex(0) }}
                      style={{
                        width: 36, height: 36, borderRadius: 8,
                        background: solved[i] ? c.gold : i === activeChar ? c.active : c.paper2,
                        color: solved[i] || i === activeChar ? '#fff' : c.grey,
                        border: 'none', fontSize: 18, cursor: 'pointer',
                        opacity: solved[i] ? 0.7 : 1,
                      }}
                    >
                      {solved[i] ? puzzle.chengyu[i] : r.emoji}
                    </button>
                  ))}
                </div>
              </>
            )}

            {allSolved && (
              <button
                onClick={reset}
                style={{ display: 'block', margin: '16px auto 0', background: 'none', border: `1px solid ${c.paper3}`, borderRadius: 8, padding: '8px 20px', color: c.grey, cursor: 'pointer', fontSize: 13 }}
              >
                ↺ reset
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StoryCanvas({ story, riddles, solved, activeChar, allSolved, chengyu, pinyin, meaning }) {
  return (
    <div style={{
      background: c.paper2,
      border: `1px solid ${c.paper3}`,
      borderRadius: 12,
      padding: '16px 20px',
      marginBottom: 16,
      position: 'relative',
    }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 12, background: 'repeating-linear-gradient(0deg, transparent, transparent 28px, rgba(0,0,0,0.02) 28px, rgba(0,0,0,0.02) 29px)', pointerEvents: 'none' }} />

      <div style={{ fontSize: 11, color: c.grey, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12, fontFamily: 'Playfair Display, serif' }}>
        Origin Story
      </div>

      {story.map((line, i) => (
        <div key={i} style={{ fontSize: 17, lineHeight: 2, color: solved[i] ? c.ink : c.grey, transition: 'color 0.4s' }}>
          {line.before}
          <CharSlot
            char={line.char}
            emoji={riddles[i].emoji}
            solved={solved[i]}
            isActive={i === activeChar && !solved[i]}
          />
          {line.after}
        </div>
      ))}

      {allSolved && (
        <div style={{ marginTop: 16, textAlign: 'center', borderTop: `1px solid ${c.paper3}`, paddingTop: 12 }}>
          <div style={{ fontSize: 28, letterSpacing: 6, fontFamily: 'Noto Serif SC, serif', color: c.seal, marginBottom: 4 }}>
            {chengyu.join('')}
          </div>
          <div style={{ fontSize: 13, color: c.grey, marginBottom: 2 }}>{pinyin}</div>
          <div style={{ fontSize: 13, color: c.ink }}>{meaning}</div>
        </div>
      )}
    </div>
  )
}

function CharSlot({ char, emoji, solved, isActive }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 32, height: 32,
      borderRadius: 6,
      border: `1.5px solid ${solved ? c.gold : isActive ? c.active : c.paper3}`,
      background: solved ? `${c.gold}18` : isActive ? `${c.active}10` : 'transparent',
      fontSize: solved ? 18 : 16,
      margin: '0 1px',
      verticalAlign: 'middle',
      fontFamily: solved ? 'Noto Serif SC, serif' : 'inherit',
      color: solved ? c.ink : c.grey,
      transition: 'all 0.35s',
      position: 'relative',
      top: -1,
    }}>
      {solved ? char : emoji}
    </span>
  )
}

function WitnessBox({ riddle, char, witnessIndex, onNextWitness, onSolve }) {
  const canAddWitness = witnessIndex < riddle.witnesses.length - 1

  return (
    <div style={{
      background: c.paper2,
      border: `1px solid ${c.paper3}`,
      borderRadius: 12,
      padding: '20px',
      marginBottom: 12,
    }}>
      <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12, lineHeight: 1 }}>
        {riddle.emoji}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: witnessIndex + 1 }).map((_, i) => (
          <div key={i} style={{
            borderLeft: `2px solid ${c.paper3}`,
            paddingLeft: 12,
            opacity: i < witnessIndex ? 0.6 : 1,
          }}>
            <div style={{ fontSize: 11, color: c.grey, marginBottom: 4, fontFamily: 'Playfair Display, serif' }}>
              {riddle.witnesses[i].speaker}
            </div>
            <div style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 3 }}>
              {riddle.witnesses[i].text}
            </div>
            <div style={{ fontSize: 12, color: c.grey, fontStyle: 'italic' }}>
              {riddle.witnesses[i].translation}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {canAddWitness && (
          <button
            onClick={onNextWitness}
            style={{
              flex: 1, padding: '10px', borderRadius: 8,
              background: 'none', border: `1px solid ${c.paper3}`,
              color: c.grey, fontSize: 13, cursor: 'pointer',
            }}
          >
            + another witness
          </button>
        )}
        <button
          onClick={onSolve}
          style={{
            flex: 2, padding: '10px', borderRadius: 8,
            background: c.active, border: 'none',
            color: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 600,
          }}
        >
          {riddle.emoji} = {char} &nbsp;→ solve
        </button>
      </div>
    </div>
  )
}

const PAST_PUZZLES = [
  { date: 'Mar 16', emojis: ['🪨', '🗿', '✌️', '🐦'], idiom: '一石二鸟', condition: '略有磨损' },
  { date: 'Mar 15', emojis: ['🌊', '🐟', '🎣', '🍽️'], idiom: '如鱼得水', condition: '完好如初' },
  { date: 'Mar 14', emojis: ['🌸', '🌿', '🦋', '☁️'], idiom: '春风得意', condition: '严重破损' },
]

function Archive({ today }) {
  const todayEntry = {
    date: 'Mar 17',
    emojis: today.riddles.map(r => r.emoji),
    idiom: today.chengyu.join(''),
    condition: '今天',
  }
  const all = [todayEntry, ...PAST_PUZZLES]

  return (
    <div>
      <div style={{ fontSize: 11, color: c.grey, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 16, fontFamily: 'Playfair Display, serif' }}>
        Your Collection
      </div>

      {all.map((entry, i) => (
        <div key={i} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderRadius: 10,
          background: i === 0 ? `${c.active}08` : 'transparent',
          border: `1px solid ${i === 0 ? c.active + '30' : c.paper3}`,
          marginBottom: 8,
        }}>
          <div style={{ fontSize: 11, color: c.grey, width: 40, flexShrink: 0, fontFamily: 'Playfair Display, serif' }}>
            {entry.date}
          </div>
          <div style={{ fontSize: 22, letterSpacing: 2, flexShrink: 0 }}>
            {entry.emojis.join('')}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontFamily: 'Noto Serif SC, serif', letterSpacing: 2 }}>
              {entry.idiom}
            </div>
          </div>
          <div style={{ fontSize: 11, color: i === 0 ? c.active : c.grey }}>
            {entry.condition}
          </div>
        </div>
      ))}

      {/* Echo — spaced recall */}
      <div style={{ marginTop: 20, padding: '12px 16px', borderRadius: 10, background: c.paper2, border: `1px dashed ${c.paper3}` }}>
        <div style={{ fontSize: 11, color: c.grey, marginBottom: 8, fontFamily: 'Playfair Display, serif' }}>
          Echo — spaced recall
        </div>
        <div style={{ textAlign: 'center', fontSize: 32, letterSpacing: 4, marginBottom: 10 }}>
          🪨 🗿 ✌️ 🐦
        </div>
        <div style={{ fontSize: 13, color: c.grey, textAlign: 'center' }}>
          Do you remember this idiom from Mar 16?
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {['一石二鸟', '马到成功', '如鱼得水', '春风得意'].map((opt, i) => (
            <button key={i} style={{
              flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 12,
              background: 'none', border: `1px solid ${c.paper3}`,
              color: c.ink, cursor: 'pointer',
              fontFamily: 'Noto Serif SC, serif',
            }}>
              {opt}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
