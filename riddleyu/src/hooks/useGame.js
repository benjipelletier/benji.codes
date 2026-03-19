import { useState, useEffect } from 'react'
import { getPuzzleForDate, getTodayString } from '../puzzles'

const MAX_LIVES = 5

export function useGame() {
  const [puzzle, setPuzzle] = useState(null)
  const [phase, setPhase] = useState('intro') // intro | connections | sliding | result
  const [currentChengyu, setCurrentChengyu] = useState(0) // 0–3
  const [selected, setSelected] = useState([]) // grid indices currently selected
  const [solvedGroups, setSolvedGroups] = useState([false, false, false, false])
  const [lives, setLives] = useState(MAX_LIVES)
  const [attempts, setAttempts] = useState([]) // { group, chars, correct }
  const [wrongFlash, setWrongFlash] = useState(false)
  const [offsets, setOffsets] = useState([0, 0, 0, 0]) // sliding phase: active char index per row
  const [won, setWon] = useState(false)

  useEffect(() => {
    getPuzzleForDate(getTodayString()).then(setPuzzle)
  }, [])

  function startGame() {
    setPhase('connections')
  }

  // --- CONNECTIONS PHASE ---

  function toggleSelect(gridIndex) {
    const group = puzzle.gridGroups[gridIndex]
    if (solvedGroups[group]) return
    if (selected.includes(gridIndex)) {
      setSelected(selected.filter(i => i !== gridIndex))
    } else if (selected.length < 4) {
      setSelected([...selected, gridIndex])
    }
  }

  function submitGroup() {
    if (selected.length !== 4) return
    const selectedGroups = selected.map(i => puzzle.gridGroups[i])
    const correct = selectedGroups.every(g => g === currentChengyu)
    const selectedChars = selected.map(i => puzzle.grid[i])
    setAttempts(prev => [...prev, { group: currentChengyu, chars: selectedChars, correct }])

    if (correct) {
      const newSolved = [...solvedGroups]
      newSolved[currentChengyu] = true
      setSolvedGroups(newSolved)
      setSelected([])
      if (currentChengyu === 3) {
        setTimeout(() => setPhase('sliding'), 700)
      } else {
        setTimeout(() => setCurrentChengyu(prev => prev + 1), 400)
      }
    } else {
      setWrongFlash(true)
      setTimeout(() => {
        setWrongFlash(false)
        setSelected([])
        const newLives = lives - 1
        setLives(newLives)
        if (newLives === 0) setPhase('result')
      }, 600)
    }
  }

  function resetSelection() {
    setSelected([])
  }

  // --- SLIDING PHASE ---

  function updateOffset(rowIndex, newOffset) {
    const clamped = Math.max(0, Math.min(3, newOffset))
    const next = [...offsets]
    next[rowIndex] = clamped
    setOffsets(next)

    // Check win: each row's active char must match hidden.chars[rowIndex]
    const allCorrect = puzzle.chengyus.every((cy, i) => {
      return cy.chars[next[i]] === puzzle.hidden.chars[i]
    })
    if (allCorrect) {
      setWon(true)
      setTimeout(() => setPhase('result'), 1400)
    }
  }

  return {
    puzzle,
    phase,
    currentChengyu,
    selected,
    solvedGroups,
    lives,
    maxLives: MAX_LIVES,
    attempts,
    wrongFlash,
    offsets,
    won,
    startGame,
    toggleSelect,
    submitGroup,
    resetSelection,
    updateOffset,
  }
}
