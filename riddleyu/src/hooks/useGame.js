import { useState, useEffect, useCallback } from 'react'
import { getPuzzleForDate, getTodayString } from '../puzzles'

export function useGame() {
  const [puzzle, setPuzzle] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [phase, setPhase] = useState('intro')
  const [selected, setSelected] = useState(null)
  const [opened, setOpened] = useState({})       // char → 'zai' | 'buzai'
  const [claims, setClaims] = useState([])        // [{ char, claim, zai }]
  const [declarations, setDeclarations] = useState([]) // [{ char, declared, correct }]
  const [nextPosition, setNextPosition] = useState(1)  // pos 0 is given
  const [wrongFlash, setWrongFlash] = useState(null)

  function loadPuzzle() {
    setLoadError(false)
    getPuzzleForDate(getTodayString())
      .then(setPuzzle)
      .catch(() => setLoadError(true))
  }

  useEffect(() => { loadPuzzle() }, [])

  function startGame() {
    if (!puzzle) return
    // Auto-open position 0 — deliberately NOT added to declarations
    // so it doesn't appear as a tile in the share result
    const firstChar = puzzle.chengyu.chars[0]
    const charData = puzzle.characters[firstChar]
    setOpened({ [firstChar]: 'zai' })
    setClaims([{ char: firstChar, claim: charData.claim, zai: true }])
    setPhase('game')
  }

  const [viewingClaim, setViewingClaim] = useState(null) // char whose claim is being viewed

  function selectChar(char) {
    if (wrongFlash) return
    // Tapping an opened card → view its claim
    if (opened[char]) {
      setViewingClaim(prev => prev === char ? null : char)
      setSelected(null)
      return
    }
    setViewingClaim(null)
    setSelected(prev => prev === char ? null : char)
  }

  function declare(judgment) {
    if (!selected || wrongFlash) return
    const charData = puzzle.characters[selected]
    const actualStatus = charData.zai ? 'zai' : 'buzai'

    // Special: declaring 在 for a character that IS 在 but at wrong position
    let isCorrect
    if (judgment === 'zai' && charData.zai && charData.position !== nextPosition) {
      isCorrect = false
    } else {
      isCorrect = judgment === actualStatus
    }

    const char = selected
    setDeclarations(prev => [...prev, { char, declared: judgment, correct: isCorrect }])

    if (isCorrect) {
      setOpened(prev => ({ ...prev, [char]: judgment }))
      setClaims(prev => [...prev, { char, claim: charData.claim, zai: charData.zai }])
      setSelected(null)
      setViewingClaim(null)
      if (judgment === 'zai') {
        const newPos = nextPosition + 1
        setNextPosition(newPos)
        if (newPos > 3) {
          // Win! All 4 found
          setTimeout(() => setPhase('result'), 1500)
        }
      }
    } else {
      setWrongFlash(char)
      setSelected(null)
      setTimeout(() => setWrongFlash(null), 600)
    }
  }

  return {
    puzzle,
    loadError,
    retryLoad: loadPuzzle,
    phase,
    selected,
    opened,
    claims,
    viewingClaim,
    declarations,
    nextPosition,
    wrongFlash,
    startGame,
    selectChar,
    declareZai: () => declare('zai'),
    declareBuzai: () => declare('buzai'),
  }
}
