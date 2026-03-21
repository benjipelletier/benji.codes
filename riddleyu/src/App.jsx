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
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'Noto Serif SC', serif",
          fontSize: 24,
          color: 'var(--grey)',
          gap: 16,
        }}>
          {game.loadError ? (
            <>
              <span style={{ fontSize: 16 }}>今天的谜语还没准备好</span>
              <button
                onClick={game.retryLoad}
                style={{
                  fontFamily: "'Noto Serif SC', serif",
                  fontSize: 14,
                  padding: '10px 24px',
                  borderRadius: 8,
                  border: '1.5px solid #d4cabb',
                  background: 'white',
                  color: 'var(--ink)',
                  cursor: 'pointer',
                }}
              >
                重试
              </button>
            </>
          ) : '谜语...'}
        </div>
      </>
    )
  }

  return (
    <>
      <Analytics />
      {game.phase === 'intro' && <IntroScreen onStart={game.startGame} />}
      {game.phase === 'game' && (
        <GameScreen
          puzzle={game.puzzle}
          selected={game.selected}
          opened={game.opened}
          claims={game.claims}
          viewingClaim={game.viewingClaim}
          nextPosition={game.nextPosition}
          wrongFlash={game.wrongFlash}
          selectChar={game.selectChar}
          declareZai={game.declareZai}
          declareBuzai={game.declareBuzai}
        />
      )}
      {game.phase === 'result' && (
        <ResultScreen
          puzzle={game.puzzle}
          declarations={game.declarations}
        />
      )}
    </>
  )
}
