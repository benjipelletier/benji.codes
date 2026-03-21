import { useState, useEffect } from 'react'
import { getPuzzleForDate, getTodayString } from '../puzzles'

export function useGame() {
  const [puzzle, setPuzzle] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [phase, setPhase] = useState('intro')
  const [currentCluster, setCurrentCluster] = useState(0)
  const [subPhase, setSubPhase] = useState('picking') // 'picking' | 'choosing'
  const [selected, setSelected] = useState(new Set())  // multi-select for picking
  const [solvedClusters, setSolvedClusters] = useState([]) // indices of solved clusters
  const [answers, setAnswers] = useState([]) // answer chars found
  const [declarations, setDeclarations] = useState([]) // { type, correct } for share
  const [wrongFlash, setWrongFlash] = useState(null) // Set of chars flashing

  function shuffle(arr) {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  function loadPuzzle() {
    setLoadError(false)
    setPuzzle(null)
    getPuzzleForDate(getTodayString())
      .then(p => setPuzzle({
        ...p,
        grid: shuffle(p.grid),
        clusters: p.clusters.map(c => ({ ...c, chars: shuffle(c.chars) })),
      }))
      .catch(() => setLoadError(true))
  }

  useEffect(() => { loadPuzzle() }, [])

  function reloadPuzzle() {
    setPhase('intro')
    setCurrentCluster(0)
    setSubPhase('picking')
    setSelected(new Set())
    setSolvedClusters([])
    setAnswers([])
    setDeclarations([])
    setWrongFlash(null)
    loadPuzzle()
  }

  function startGame() {
    if (!puzzle) return
    setPhase('game')
    setCurrentCluster(0)
    setSubPhase('picking')
  }

  function toggleSelect(char) {
    if (subPhase !== 'picking' || wrongFlash) return
    // Can't select solved chars
    const solvedChars = new Set(solvedClusters.flatMap(i => puzzle.clusters[i].chars))
    if (solvedChars.has(char)) return

    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(char)) {
        next.delete(char)
      } else if (next.size < 4) {
        next.add(char)
      }
      return next
    })
  }

  function submitCluster() {
    if (selected.size !== 4 || subPhase !== 'picking' || wrongFlash) return

    const cluster = puzzle.clusters[currentCluster]
    const clusterSet = new Set(cluster.chars)
    const isCorrect = [...selected].every(c => clusterSet.has(c)) && selected.size === clusterSet.size

    if (isCorrect) {
      setSolvedClusters(prev => [...prev, currentCluster])
      setSelected(new Set())
      setSubPhase('choosing')
    } else {
      setDeclarations(prev => [...prev, { type: 'cluster', correct: false }])
      setWrongFlash(new Set(selected))
      setTimeout(() => {
        setWrongFlash(null)
        setSelected(new Set())
      }, 600)
    }
  }

  function chooseAnswer(char) {
    if (subPhase !== 'choosing' || wrongFlash) return
    const cluster = puzzle.clusters[currentCluster]
    if (!cluster.chars.includes(char)) return

    if (char === cluster.answer) {
      setDeclarations(prev => [...prev, { type: 'specific', correct: true }])
      setAnswers(prev => [...prev, char])

      const nextCluster = currentCluster + 1
      if (nextCluster >= 4) {
        setTimeout(() => setPhase('result'), 1500)
      } else {
        setCurrentCluster(nextCluster)
        setSubPhase('picking')
      }
    } else {
      setDeclarations(prev => [...prev, { type: 'specific', correct: false }])
      setWrongFlash(new Set([char]))
      setTimeout(() => setWrongFlash(null), 600)
    }
  }

  function selectChar(char) {
    if (subPhase === 'picking') {
      toggleSelect(char)
    } else if (subPhase === 'choosing') {
      chooseAnswer(char)
    }
  }

  return {
    puzzle,
    loadError,
    retryLoad: loadPuzzle,
    phase,
    currentCluster,
    subPhase,
    selected,
    solvedClusters,
    answers,
    declarations,
    wrongFlash,
    startGame,
    selectChar,
    submitCluster,
    reloadPuzzle,
  }
}
