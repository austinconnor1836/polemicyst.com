import { useCallback, useState } from 'react'
import {
  Card,
  createDeck,
  dealHands,
  GameState,
  handSizeForPlayerCount,
  hasChopsticks,
  passHands,
  Player,
  scorePudding,
  scoreRound,
  shuffle,
  useChopsticks,
} from './engine'
import { aiPickCard } from './ai'

const AI_NAMES = ['Miso', 'Tofu', 'Matcha', 'Wasabi']

function createPlayers(playerCount: number): Player[] {
  const players: Player[] = [
    { id: 0, name: 'You', isHuman: true, hand: [], played: [], score: 0, puddings: 0, roundScore: 0 },
  ]
  for (let i = 1; i < playerCount; i++) {
    players.push({
      id: i,
      name: AI_NAMES[i - 1],
      isHuman: false,
      hand: [],
      played: [],
      score: 0,
      puddings: 0,
      roundScore: 0,
    })
  }
  return players
}

export type ChopsticksState = { using: false } | { using: true; firstCardId: number }

export function useGameState() {
  const [game, setGame] = useState<GameState | null>(null)
  const [chopsticks, setChopsticks] = useState<ChopsticksState>({ using: false })
  const [animatingReveal, setAnimatingReveal] = useState(false)

  const startGame = useCallback((playerCount: number) => {
    const deck = shuffle(createDeck())
    const players = createPlayers(playerCount)
    const { hands, remaining } = dealHands(deck, playerCount)
    const dealtPlayers = players.map((p, i) => ({ ...p, hand: hands[i] }))

    setGame({
      phase: 'pick',
      round: 1,
      players: dealtPlayers,
      selectedCardIds: new Map(),
      deck: remaining,
      turnInRound: 1,
    })
    setChopsticks({ using: false })
  }, [])

  const pickCard = useCallback((cardId: number) => {
    setGame(prev => {
      if (!prev || prev.phase !== 'pick') return prev

      const human = prev.players.find(p => p.isHuman)!

      // If using chopsticks and this is the second pick
      if (chopsticks.using) {
        const firstCardId = chopsticks.firstCardId

        // Remove first card from hand, add to played
        const cardToPlay = human.hand.find(c => c.id === firstCardId)!
        let updatedPlayed = [...human.played, cardToPlay]
        let updatedHand = human.hand.filter(c => c.id !== firstCardId)

        // Now apply chopsticks: remove second card from hand, put chopsticks back
        const updatedPlayer: Player = {
          ...human,
          hand: updatedHand,
          played: updatedPlayed,
        }
        const afterChopsticks = useChopsticks(updatedPlayer, cardId)

        // AI picks
        const newPlayers = prev.players.map(p => {
          if (p.isHuman) return afterChopsticks
          const aiCardId = aiPickCard(p)
          const card = p.hand.find(c => c.id === aiCardId)!
          return {
            ...p,
            hand: p.hand.filter(c => c.id !== aiCardId),
            played: [...p.played, card],
          }
        })

        setChopsticks({ using: false })
        return { ...prev, phase: 'reveal' as const, players: newPlayers }
      }

      // Normal pick — check if player has chopsticks and might want to use them
      // For now, just do the normal pick + AI picks
      const newPlayers = prev.players.map(p => {
        if (p.isHuman) {
          const card = p.hand.find(c => c.id === cardId)!
          return {
            ...p,
            hand: p.hand.filter(c => c.id !== cardId),
            played: [...p.played, card],
          }
        }
        const aiCardId = aiPickCard(p)
        const card = p.hand.find(c => c.id === aiCardId)!
        return {
          ...p,
          hand: p.hand.filter(c => c.id !== aiCardId),
          played: [...p.played, card],
        }
      })

      return { ...prev, phase: 'reveal' as const, players: newPlayers }
    })
  }, [chopsticks])

  const startChopsticksPlay = useCallback((firstCardId: number) => {
    setChopsticks({ using: true, firstCardId })
  }, [])

  const cancelChopsticks = useCallback(() => {
    setChopsticks({ using: false })
  }, [])

  const confirmReveal = useCallback(() => {
    setGame(prev => {
      if (!prev || prev.phase !== 'reveal') return prev

      const handSize = handSizeForPlayerCount(prev.players.length)
      const isLastTurn = prev.turnInRound >= handSize

      if (isLastTurn) {
        // Score the round
        const scored = scoreRound(prev.players)
        const isLastRound = prev.round >= 3

        if (isLastRound) {
          // Score pudding and end game
          const finalScored = scorePudding(scored)
          return {
            ...prev,
            phase: 'game_end' as const,
            players: finalScored.map(p => ({ ...p, played: [], hand: [] })),
          }
        }

        return {
          ...prev,
          phase: 'round_end' as const,
          players: scored,
        }
      }

      // Pass hands and continue
      const passed = passHands(prev.players, prev.round)
      return {
        ...prev,
        phase: 'pick' as const,
        players: passed,
        turnInRound: prev.turnInRound + 1,
      }
    })
    setChopsticks({ using: false })
  }, [])

  const startNextRound = useCallback(() => {
    setGame(prev => {
      if (!prev) return prev

      const newRound = prev.round + 1
      const deck = shuffle(prev.deck.length >= prev.players.length * handSizeForPlayerCount(prev.players.length)
        ? prev.deck
        : createDeck()) // reshuffle if needed

      const shuffled = shuffle(deck)
      const { hands, remaining } = dealHands(shuffled, prev.players.length)

      const newPlayers = prev.players.map((p, i) => ({
        ...p,
        hand: hands[i],
        played: [],
        roundScore: 0,
      }))

      return {
        ...prev,
        phase: 'pick' as const,
        round: newRound,
        players: newPlayers,
        deck: remaining,
        turnInRound: 1,
      }
    })
  }, [])

  const resetGame = useCallback(() => {
    setGame(null)
    setChopsticks({ using: false })
  }, [])

  return {
    game,
    chopsticks,
    animatingReveal,
    startGame,
    pickCard,
    startChopsticksPlay,
    cancelChopsticks,
    confirmReveal,
    startNextRound,
    resetGame,
  }
}
