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
  green: '#2d6a4f',
}

// ── Persistence ───────────────────────────────────────────────

function loadSaved(date) {
  try {
    const raw = localStorage.getItem('riddleyu_v1')
    if (!raw) return null
    const data = JSON.parse(raw)
    return data.date === date ? data : null
  } catch { return null }
}

function persist(data) {
  try { localStorage.setItem('riddleyu_v1', JSON.stringify(data)) } catch {}
}

function loadArchive() {
  try { return JSON.parse(localStorage.getItem('riddleyu_archive') || '[]') } catch { return [] }
}

function pushToArchive(entry) {
  try {
    const archive = loadArchive()
    if (!archive.find(e => e.date === entry.date)) {
      localStorage.setItem('riddleyu_archive', JSON.stringify([entry, ...archive].slice(0, 60)))
    }
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────

function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function buildShareText(puzzle, dateLabel) {
  return [
    `谜语 RiddleYu · ${dateLabel}`,
    puzzle.riddles.map(r => r.emoji).join(' '),
    puzzle.chengyu.join(''),
    puzzle.pinyin,
    'riddleyu.benji.codes',
  ].join('\n')
}

// ── Fallback archive entries (for Echo variety before real history accumulates) ──

const FALLBACK_ENTRIES = [
  { date: '2026-03-16', dateLabel: 'Mar 16', idiom: '一石二鸟', emojis: ['🪨', '🗿', '✌️', '🐦'], pinyin: 'yī shí èr niǎo' },
  { date: '2026-03-15', dateLabel: 'Mar 15', idiom: '如鱼得水', emojis: ['🌊', '🐟', '🎣', '🍽️'], pinyin: 'rú yú dé shuǐ' },
  { date: '2026-03-14', dateLabel: 'Mar 14', idiom: '春风得意', emojis: ['🌸', '🌿', '🦋', '☁️'], pinyin: 'chūn fēng dé yì' },
]

const FALLBACK_IDIOMS = ['画蛇添足', '杯弓蛇影', '守株待兔', '亡羊补牢', '狐假虎威', '滥竽充数']

function mergeArchive(local) {
  const seen = new Set(local.map(e => e.date))
  const merged = [...local]
  for (const f of FALLBACK_ENTRIES) {
    if (!seen.has(f.date)) merged.push(f)
  }
  return merged.sort((a, b) => b.date.localeCompare(a.date))
}

function buildEchoChoices(subject, allEntries) {
  const choices = [subject.idiom]
  const others = allEntries.filter(e => e.date !== subject.date).map(e => e.idiom)
  const pool = [...new Set([...others, ...FALLBACK_IDIOMS])].sort(() => Math.random() - 0.5)
  for (const o of pool) {
    if (choices.length >= 4) break
    if (!choices.includes(o)) choices.push(o)
  }
  return choices.sort(() => Math.random() - 0.5)
}

// ── Main component ────────────────────────────────────────────

export default function Game() {
  const [puzzle, setPuzzle] = useState(null)
  const [solved, setSolved] = useState([false, false, false, false])
  const [activeChar, setActiveChar] = useState(0)
  const [witnessIndex, setWitnessIndex] = useState(0)
  const [view, setView] = useState('game')
  const [copied, setCopied] = useState(false)

  const dateStr = getTodayString()
  const dateLabel = formatDateLabel(dateStr)

  useEffect(() => {
    getPuzzleForDate(dateStr).then(p => {
      setPuzzle(p)
      const saved = loadSaved(dateStr)
      if (saved) {
        setSolved(saved.solved)
        setActiveChar(saved.activeChar ?? 0)
      }
    })
  }, [])

  const allSolved = solved.every(Boolean)

  function solveChar(i) {
    const next = solved.map((s, idx) => idx === i ? true : s)
    const nextActive = i < 3 ? i + 1 : i
    setSolved(next)
    setActiveChar(nextActive)
    setWitnessIndex(0)
    persist({ date: dateStr, solved: next, activeChar: nextActive })
    if (next.every(Boolean) && puzzle) {
      pushToArchive({
        date: dateStr,
        dateLabel,
        idiom: puzzle.chengyu.join(''),
        emojis: puzzle.riddles.map(r => r.emoji),
        pinyin: puzzle.pinyin,
      })
    }
  }

  function handleShare() {
    if (!puzzle) return
    navigator.clipboard.writeText(buildShareText(puzzle, dateLabel))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
      .catch(() => {})
  }

  if (!puzzle) {
    return (
      <div style={{ background: c.paper, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Noto Serif SC', serif", fontSize: 24, color: c.grey }}>
        谜语…
      </div>
    )
  }

  const riddle = puzzle.riddles[activeChar]

  return (
    <div style={{ background: c.paper, minHeight: '100vh', fontFamily: "'Noto Sans SC', sans-serif", color: c.ink }}>
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '16px 16px 40px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <span style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, fontWeight: 700 }}>谜语</span>
            <span style={{ color: c.grey, fontSize: 13, marginLeft: 6 }}>RiddleYu</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: c.grey, fontFamily: 'Playfair Display, serif' }}>{dateLabel}</span>
            <button
              onClick={() => setView(v => v === 'archive' ? 'game' : 'archive')}
              style={{ background: 'none', border: `1px solid ${c.paper3}`, borderRadius: 8, padding: '4px 10px', fontSize: 13, color: view === 'archive' ? c.active : c.grey, cursor: 'pointer' }}
            >
              {view === 'archive' ? '← game' : '📜'}
            </button>
          </div>
        </div>

        {view === 'archive' ? (
          <Archive todayPuzzle={puzzle} todayDateLabel={dateLabel} todaySolved={allSolved} />
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

            {allSolved ? (
              <VictorySection
                puzzle={puzzle}
                copied={copied}
                onShare={handleShare}
                onViewArchive={() => setView('archive')}
              />
            ) : (
              <>
                <WitnessBox
                  riddle={riddle}
                  char={puzzle.chengyu[activeChar]}
                  witnessIndex={witnessIndex}
                  onNextWitness={() => setWitnessIndex(i => Math.min(i + 1, riddle.witnesses.length - 1))}
                  onSolve={() => solveChar(activeChar)}
                />
                <CharNav
                  riddles={puzzle.riddles}
                  chengyu={puzzle.chengyu}
                  solved={solved}
                  activeChar={activeChar}
                  onSelect={i => { setActiveChar(i); setWitnessIndex(0) }}
                />
              </>
            )}
          </>
        )}

      </div>
    </div>
  )
}

// ── Story Canvas ──────────────────────────────────────────────

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

// ── Witness Box ───────────────────────────────────────────────

function WitnessBox({ riddle, char, witnessIndex, onNextWitness, onSolve }) {
  const canAdd = witnessIndex < riddle.witnesses.length - 1

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
            opacity: i < witnessIndex ? 0.55 : 1,
            transition: 'opacity 0.3s',
          }}>
            <div style={{ fontSize: 11, color: c.grey, marginBottom: 4, fontFamily: 'Playfair Display, serif' }}>
              {riddle.witnesses[i].speaker}
            </div>
            <div style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 3 }}>
              {riddle.witnesses[i].text}
            </div>
            <div style={{ fontSize: 12, color: c.grey, fontStyle: 'italic', fontFamily: 'Playfair Display, serif' }}>
              {riddle.witnesses[i].translation}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {canAdd && (
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

// ── Char Nav ──────────────────────────────────────────────────

function CharNav({ riddles, chengyu, solved, activeChar, onSelect }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
      {riddles.map((r, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          style={{
            width: 36, height: 36, borderRadius: 8,
            background: solved[i] ? c.gold : i === activeChar ? c.active : c.paper2,
            color: solved[i] || i === activeChar ? '#fff' : c.grey,
            border: 'none', fontSize: 18, cursor: 'pointer',
            opacity: solved[i] ? 0.7 : 1,
            transition: 'background 0.25s',
          }}
        >
          {solved[i] ? chengyu[i] : r.emoji}
        </button>
      ))}
    </div>
  )
}

// ── Victory Section ───────────────────────────────────────────

function VictorySection({ puzzle, copied, onShare, onViewArchive }) {
  return (
    <div style={{ marginTop: 4 }}>
      {/* Seal stamp */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <span style={{
          display: 'inline-block',
          border: `2px solid ${c.seal}`,
          borderRadius: 8,
          padding: '4px 18px',
          color: c.seal,
          fontFamily: 'Noto Serif SC, serif',
          fontSize: 22,
          letterSpacing: 6,
          background: `${c.seal}08`,
        }}>
          成功
        </span>
      </div>

      {/* Origin */}
      <div style={{
        background: c.paper2,
        border: `1px solid ${c.paper3}`,
        borderRadius: 12,
        padding: '16px 20px',
        marginBottom: 12,
      }}>
        <div style={{ fontSize: 11, color: c.grey, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12, fontFamily: 'Playfair Display, serif' }}>
          Origin
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.75, color: c.ink, marginBottom: puzzle.origin_zh ? 10 : 0 }}>
          {puzzle.origin}
        </div>
        {puzzle.origin_zh && (
          <div style={{ fontSize: 14, lineHeight: 1.75, color: c.grey, fontFamily: 'Noto Serif SC, serif' }}>
            {puzzle.origin_zh}
          </div>
        )}
      </div>

      {/* Share */}
      <button
        onClick={onShare}
        style={{
          display: 'block', width: '100%',
          padding: '12px', borderRadius: 10,
          background: copied ? c.green : c.active,
          border: 'none', color: '#fff',
          fontSize: 14, fontWeight: 600, cursor: 'pointer',
          marginBottom: 8, transition: 'background 0.25s',
        }}
      >
        {copied ? '✓ copied to clipboard' : '↗ share'}
      </button>

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '10px 0', fontSize: 12, color: c.grey, fontFamily: 'Playfair Display, serif' }}>
        New puzzle tomorrow ·{' '}
        <span onClick={onViewArchive} style={{ color: c.active, cursor: 'pointer' }}>
          view archive
        </span>
      </div>
    </div>
  )
}

// ── Archive ───────────────────────────────────────────────────

function Archive({ todayPuzzle, todayDateLabel, todaySolved }) {
  const [echoChoices] = useState(() => {
    const archive = mergeArchive(loadArchive())
    const subject = archive[0] || null
    return subject ? { subject, choices: buildEchoChoices(subject, archive) } : null
  })
  const [echoGuess, setEchoGuess] = useState(null)
  const [echoResult, setEchoResult] = useState(null)

  function handleEchoGuess(idiom) {
    if (echoResult) return
    setEchoGuess(idiom)
    setEchoResult(idiom === echoChoices.subject.idiom ? 'correct' : 'wrong')
  }

  const localArchive = loadArchive()
  const allEntries = mergeArchive(localArchive)

  const todayEntry = {
    date: getTodayString(),
    dateLabel: todayDateLabel,
    idiom: todayPuzzle.chengyu.join(''),
    emojis: todayPuzzle.riddles.map(r => r.emoji),
    pinyin: todayPuzzle.pinyin,
    isToday: true,
    completed: todaySolved,
  }

  const displayEntries = [todayEntry, ...allEntries.filter(e => e.date !== todayEntry.date)]

  return (
    <div>
      <div style={{ fontSize: 11, color: c.grey, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 16, fontFamily: 'Playfair Display, serif' }}>
        Your Collection
      </div>

      {displayEntries.map((entry, i) => (
        <div key={entry.date} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderRadius: 10,
          background: entry.isToday ? `${c.active}08` : 'transparent',
          border: `1px solid ${entry.isToday ? c.active + '30' : c.paper3}`,
          marginBottom: 8,
        }}>
          <div style={{ fontSize: 11, color: c.grey, width: 40, flexShrink: 0, fontFamily: 'Playfair Display, serif' }}>
            {entry.dateLabel}
          </div>
          <div style={{ fontSize: 22, letterSpacing: 2, flexShrink: 0 }}>
            {entry.emojis.join('')}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontFamily: 'Noto Serif SC, serif', letterSpacing: 2 }}>
              {entry.completed || !entry.isToday ? entry.idiom : '????'}
            </div>
            {entry.pinyin && (entry.completed || !entry.isToday) && (
              <div style={{ fontSize: 11, color: c.grey, marginTop: 2 }}>{entry.pinyin}</div>
            )}
          </div>
          {entry.isToday && (
            <div style={{ fontSize: 11, color: entry.completed ? c.green : c.active, flexShrink: 0 }}>
              {entry.completed ? '✓' : '今天'}
            </div>
          )}
        </div>
      ))}

      {echoChoices && (
        <EchoWidget
          subject={echoChoices.subject}
          choices={echoChoices.choices}
          guess={echoGuess}
          result={echoResult}
          onGuess={handleEchoGuess}
        />
      )}
    </div>
  )
}

// ── Echo Widget ───────────────────────────────────────────────

function EchoWidget({ subject, choices, guess, result, onGuess }) {
  return (
    <div style={{
      marginTop: 20,
      padding: '16px',
      borderRadius: 10,
      background: c.paper2,
      border: `1px dashed ${c.paper3}`,
    }}>
      <div style={{ fontSize: 11, color: c.grey, marginBottom: 10, fontFamily: 'Playfair Display, serif', letterSpacing: 2, textTransform: 'uppercase' }}>
        Echo · {subject.dateLabel}
      </div>

      <div style={{ textAlign: 'center', fontSize: 30, letterSpacing: 4, marginBottom: 12 }}>
        {subject.emojis.join(' ')}
      </div>

      <div style={{ fontSize: 13, color: c.grey, textAlign: 'center', marginBottom: 14, fontFamily: 'Playfair Display, serif' }}>
        Can you name this idiom?
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {choices.map((opt, i) => {
          let bg = 'none'
          let border = `1px solid ${c.paper3}`
          let color = c.ink
          if (result && opt === subject.idiom) {
            bg = `${c.green}18`; border = `1px solid ${c.green}`; color = c.green
          } else if (result && opt === guess && opt !== subject.idiom) {
            bg = `${c.seal}10`; border = `1px solid ${c.seal}`; color = c.seal
          }
          return (
            <button
              key={i}
              onClick={() => onGuess(opt)}
              disabled={!!result}
              style={{
                padding: '10px 8px', borderRadius: 8, fontSize: 15,
                background: bg, border, color,
                cursor: result ? 'default' : 'pointer',
                fontFamily: 'Noto Serif SC, serif', letterSpacing: 2,
                transition: 'all 0.2s',
              }}
            >
              {opt}
            </button>
          )
        })}
      </div>

      {result && (
        <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12, fontFamily: 'Playfair Display, serif', color: result === 'correct' ? c.green : c.seal }}>
          {result === 'correct' ? '✓ correct' : `✗ it was ${subject.idiom}`}
          {' · '}{subject.pinyin}
        </div>
      )}
    </div>
  )
}
