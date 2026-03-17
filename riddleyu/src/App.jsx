import React from 'react'
import { Analytics } from '@vercel/analytics/react'
import Game from './Game'

export default function App() {
  return (
    <>
      <Analytics />
      <Game />
    </>
  )
}
