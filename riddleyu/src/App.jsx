import React from 'react'
import { Analytics } from '@vercel/analytics/react'
import { useGame } from './hooks/useGame'
import IntroScreen from './components/IntroScreen'
import GameScreen from './components/GameScreen'
import SlidingScreen from './components/SlidingScreen'
import ResultScreen from './components/ResultScreen'

export default function App() {
  const game = useGame()

  if (!game.puzzle) {
    return (
      <>
        <Analytics />
        <div style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'Noto Serif SC', serif",
          fontSize: 24,
          color: 'var(--grey)',
        }}>
          谜语...
        </div>
      </>
    )
  }

  if (game.phase === 'intro') return (
    <><Analytics /><IntroScreen onStart={game.startGame} /></>
  )

  if (game.phase === 'connections') return (
    <>
      <Analytics />
      <GameScreen
        puzzle={game.puzzle}
        currentChengyu={game.currentChengyu}
        selected={game.selected}
        solvedGroups={game.solvedGroups}
        lives={game.lives}
        maxLives={game.maxLives}
        wrongFlash={game.wrongFlash}
        toggleSelect={game.toggleSelect}
        submitGroup={game.submitGroup}
        resetSelection={game.resetSelection}
      />
    </>
  )

  if (game.phase === 'sliding') return (
    <>
      <Analytics />
      <SlidingScreen
        puzzle={game.puzzle}
        offsets={game.offsets}
        won={game.won}
        updateOffset={game.updateOffset}
      />
    </>
  )

  return (
    <>
      <Analytics />
      <ResultScreen
        puzzle={game.puzzle}
        won={game.won}
        attempts={game.attempts}
        lives={game.lives}
        maxLives={game.maxLives}
      />
    </>
  )
}
