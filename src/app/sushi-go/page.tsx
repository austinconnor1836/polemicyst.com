'use client'

import React, { useState } from 'react'
import { handSizeForPlayerCount, hasChopsticks } from './engine'
import { useGameState } from './useGameState'
import {
  CardView,
  ChopsticksPrompt,
  GameOver,
  Hand,
  PlayedArea,
  RoundSummary,
  Scoreboard,
  SetupScreen,
} from './components'

export default function SushiGoPage() {
  const {
    game,
    chopsticks,
    startGame,
    pickCard,
    startChopsticksPlay,
    cancelChopsticks,
    confirmReveal,
    startNextRound,
    resetGame,
  } = useGameState()

  const [selectedCardId, setSelectedCardId] = useState<number | null>(null)
  const [showChopsticksPrompt, setShowChopsticksPrompt] = useState(false)

  // ── Setup Screen ──────────────────────────────────────────────────────
  if (!game) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950">
        <SetupScreen onStart={startGame} />
      </div>
    )
  }

  const human = game.players.find(p => p.isHuman)!
  const opponents = game.players.filter(p => !p.isHuman)
  const totalTurns = handSizeForPlayerCount(game.players.length)

  // ── Round End ─────────────────────────────────────────────────────────
  if (game.phase === 'round_end') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950">
        <RoundSummary players={game.players} round={game.round} onNext={startNextRound} />
      </div>
    )
  }

  // ── Game Over ─────────────────────────────────────────────────────────
  if (game.phase === 'game_end') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950">
        <GameOver players={game.players} onPlayAgain={resetGame} />
      </div>
    )
  }

  // ── Pick / Reveal Phase ───────────────────────────────────────────────
  const isPicking = game.phase === 'pick'
  const isRevealing = game.phase === 'reveal'
  const humanHasChopsticks = hasChopsticks(human.played)

  const handleCardClick = (cardId: number) => {
    if (!isPicking) return

    if (chopsticks.using) {
      // This is the second card pick for chopsticks
      if (cardId !== chopsticks.firstCardId) {
        pickCard(cardId)
        setSelectedCardId(null)
        setShowChopsticksPrompt(false)
      }
      return
    }

    // First card selection
    if (selectedCardId === cardId) {
      setSelectedCardId(null)
      setShowChopsticksPrompt(false)
    } else {
      setSelectedCardId(cardId)
      // Show chopsticks prompt if player has chopsticks and more than 1 card left
      setShowChopsticksPrompt(humanHasChopsticks && human.hand.length > 1)
    }
  }

  const handleConfirmPick = () => {
    if (selectedCardId === null) return
    pickCard(selectedCardId)
    setSelectedCardId(null)
    setShowChopsticksPrompt(false)
  }

  const handleUseChopsticks = () => {
    if (selectedCardId === null) return
    startChopsticksPlay(selectedCardId)
    setSelectedCardId(null)
    setShowChopsticksPrompt(false)
  }

  const handleSkipChopsticks = () => {
    setShowChopsticksPrompt(false)
  }

  // Find the last card played by each player this turn (for reveal)
  const getLastPlayed = (p: typeof human) => {
    if (p.played.length === 0) return null
    return p.played[p.played.length - 1]
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 flex flex-col">
      {/* Header */}
      <div className="p-3 sm:p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🍣</span>
          <span className="font-bold text-sm sm:text-base">Sushi Go!</span>
        </div>
        <button
          onClick={resetGame}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
        >
          New Game
        </button>
      </div>

      {/* Scoreboard */}
      <div className="p-3 sm:p-4">
        <Scoreboard
          players={game.players}
          round={game.round}
          turnInRound={game.turnInRound}
          totalTurns={totalTurns}
        />
      </div>

      {/* Opponents */}
      <div className="px-3 sm:px-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
        {opponents.map(p => (
          <PlayedArea key={p.id} player={p} />
        ))}
      </div>

      {/* Reveal Banner */}
      {isRevealing && (
        <div className="mx-3 sm:mx-4 mt-3">
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium">Cards Revealed!</span>
                <div className="flex gap-2 mt-2">
                  {game.players.map(p => {
                    const last = getLastPlayed(p)
                    return last ? (
                      <div key={p.id} className="text-center">
                        <CardView card={last} small disabled />
                        <div className="text-[10px] mt-1 opacity-60">{p.name}</div>
                      </div>
                    ) : null
                  })}
                </div>
              </div>
              <button
                onClick={confirmReveal}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors shrink-0"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1 min-h-4" />

      {/* Player Area */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
        {/* Player's played cards */}
        <div className="px-3 sm:px-4 pt-3">
          <PlayedArea player={human} highlight />
        </div>

        {/* Chopsticks prompt */}
        {isPicking && showChopsticksPrompt && selectedCardId !== null && (
          <div className="px-3 sm:px-4 mt-2">
            <ChopsticksPrompt
              onUse={handleUseChopsticks}
              onSkip={handleSkipChopsticks}
            />
          </div>
        )}

        {/* Chopsticks mode banner */}
        {chopsticks.using && (
          <div className="px-3 sm:px-4 mt-2">
            <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3">
              <span className="text-lg">🥢</span>
              <span className="text-sm flex-1">Pick your second card!</span>
              <button
                onClick={cancelChopsticks}
                className="px-3 py-1.5 bg-zinc-600 hover:bg-zinc-700 text-white rounded-lg text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Hand label */}
        <div className="px-3 sm:px-4 mt-2 flex items-center justify-between">
          <span className="text-xs opacity-50">Your Hand ({human.hand.length} cards)</span>
          {isPicking && selectedCardId !== null && !chopsticks.using && !showChopsticksPrompt && (
            <button
              onClick={handleConfirmPick}
              className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm transition-colors"
            >
              Play Card
            </button>
          )}
        </div>

        {/* Hand */}
        <div className="pb-4 sm:pb-6">
          <Hand
            cards={human.hand}
            onPick={handleCardClick}
            selectedId={selectedCardId}
            disabled={!isPicking}
            chopsticks={chopsticks}
          />
        </div>
      </div>
    </div>
  )
}
