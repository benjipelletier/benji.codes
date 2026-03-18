import React from 'react'
import { Analytics } from '@vercel/analytics/react'
import { useGame } from './hooks/useGame'
import IntroScreen from './components/IntroScreen'
import GameScreen from './components/GameScreen'
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

  if (game.phase === 'intro') {
    return (
      <>
        <Analytics />
        <IntroScreen onStart={game.startGame} />
      </>
    )
  }

  if (game.phase === 'result') {
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

  return (
    <>
      <Analytics />
      <GameScreen
        puzzle={game.puzzle}
        currentSlot={game.currentSlot}
        chain={game.chain}
        lives={game.lives}
        maxLives={game.maxLives}
        attempts={game.attempts}
        chainComplete={game.chainComplete}
        selectChar={game.selectChar}
        resetChain={game.resetChain}
        submitChain={game.submitChain}
        isSelectable={game.isSelectable}
        isSelected={game.isSelected}
        getChainPosition={game.getChainPosition}
        unselectSlot={game.unselectSlot}
      />
    </>
  )
}
