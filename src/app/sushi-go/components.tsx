'use client';

import React from 'react';
import { Card, CARD_INFO, countMaki, Player } from './engine';
import { ChopsticksState } from './useGameState';

// ── Card Component ──────────────────────────────────────────────────────────

interface CardViewProps {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  small?: boolean;
  faceDown?: boolean;
  disabled?: boolean;
}

export function CardView({ card, onClick, selected, small, faceDown, disabled }: CardViewProps) {
  const info = CARD_INFO[card.type];
  const makiDots =
    card.type === 'maki1' ? 1 : card.type === 'maki2' ? 2 : card.type === 'maki3' ? 3 : 0;

  if (faceDown) {
    return (
      <div
        className={`
          ${small ? 'w-16 h-22' : 'w-20 h-28 sm:w-24 sm:h-34'}
          rounded-xl border-2 border-zinc-600
          bg-gradient-to-br from-red-900 via-red-800 to-red-900
          flex items-center justify-center
          shadow-md
        `}
      >
        <span className="text-2xl opacity-50">🍣</span>
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        ${small ? 'w-16 h-22' : 'w-20 h-28 sm:w-24 sm:h-34'}
        rounded-xl border-2 transition-all duration-200
        flex flex-col items-center justify-between p-1.5 sm:p-2
        shadow-md hover:shadow-lg
        ${
          selected
            ? 'border-yellow-400 ring-2 ring-yellow-400 scale-110 -translate-y-2'
            : 'border-zinc-300 dark:border-zinc-600 hover:-translate-y-1'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:scale-95'}
      `}
      style={{
        backgroundColor: info.color + '22',
        borderColor: selected ? undefined : info.color + '66',
      }}
    >
      <span className={`${small ? 'text-xl' : 'text-2xl sm:text-3xl'} leading-none`}>
        {info.emoji}
      </span>
      {makiDots > 0 && (
        <div className="flex gap-0.5">
          {Array.from({ length: makiDots }).map((_, i) => (
            <div key={i} className="w-2 h-2 rounded-full bg-red-500" />
          ))}
        </div>
      )}
      <div
        className={`text-center leading-tight ${small ? 'text-[8px]' : 'text-[10px] sm:text-xs'}`}
      >
        <div className="font-bold truncate max-w-full">{info.name}</div>
        {!small && <div className="opacity-70 text-[8px] sm:text-[10px]">{info.description}</div>}
      </div>
    </button>
  );
}

// ── Hand Component ──────────────────────────────────────────────────────────

interface HandProps {
  cards: Card[];
  onPick: (cardId: number) => void;
  selectedId?: number | null;
  disabled?: boolean;
  chopsticks: ChopsticksState;
}

export function Hand({ cards, onPick, selectedId, disabled, chopsticks }: HandProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2 sm:gap-3 p-2">
      {cards.map((card) => (
        <CardView
          key={card.id}
          card={card}
          onClick={() => onPick(card.id)}
          selected={
            card.id === selectedId || (chopsticks.using && card.id === chopsticks.firstCardId)
          }
          disabled={disabled}
        />
      ))}
    </div>
  );
}

// ── Played Cards Area ───────────────────────────────────────────────────────

interface PlayedAreaProps {
  player: Player;
  showCards?: boolean;
  highlight?: boolean;
}

export function PlayedArea({ player, showCards = true, highlight }: PlayedAreaProps) {
  const makiCount = countMaki(player.played);

  return (
    <div
      className={`
      rounded-xl p-3 transition-all
      ${
        highlight
          ? 'bg-yellow-500/10 border border-yellow-500/30'
          : 'bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700'
      }
    `}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm">{player.name}</span>
          {player.isHuman && (
            <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">
              YOU
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs opacity-70">
          <span>Score: {player.score}</span>
          {makiCount > 0 && <span>Maki: {makiCount}</span>}
          {player.puddings > 0 && <span>Puddings: {player.puddings}</span>}
        </div>
      </div>
      {showCards && player.played.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {player.played.map((card) => (
            <CardView key={card.id} card={card} small disabled />
          ))}
        </div>
      )}
      {showCards && player.played.length === 0 && (
        <div className="text-xs opacity-40 italic">No cards played yet</div>
      )}
    </div>
  );
}

// ── Scoreboard ──────────────────────────────────────────────────────────────

interface ScoreboardProps {
  players: Player[];
  round: number;
  turnInRound: number;
  totalTurns: number;
}

export function Scoreboard({ players, round, turnInRound, totalTurns }: ScoreboardProps) {
  return (
    <div className="bg-zinc-100 dark:bg-zinc-800/70 rounded-xl p-3 border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold text-sm">Round {round} / 3</span>
        <span className="text-xs opacity-60">
          Turn {turnInRound} / {totalTurns}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {players.map((p) => (
          <div
            key={p.id}
            className={`text-center p-2 rounded-lg ${
              p.isHuman
                ? 'bg-blue-500/10 border border-blue-500/20'
                : 'bg-zinc-200/50 dark:bg-zinc-700/50'
            }`}
          >
            <div className="text-xs font-medium">{p.name}</div>
            <div className="text-lg font-bold">{p.score}</div>
            <div className="text-[10px] opacity-60">{p.puddings} pudding</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Round Summary ───────────────────────────────────────────────────────────

interface RoundSummaryProps {
  players: Player[];
  round: number;
  onNext: () => void;
}

export function RoundSummary({ players, round, onNext }: RoundSummaryProps) {
  const sorted = [...players].sort((a, b) => b.score - a.score);

  return (
    <div className="flex flex-col items-center gap-6 p-6">
      <h2 className="text-2xl font-bold">Round {round} Complete!</h2>
      <div className="w-full max-w-md space-y-3">
        {sorted.map((p, i) => (
          <div
            key={p.id}
            className={`
              flex items-center justify-between p-3 rounded-xl
              ${p.isHuman ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700'}
            `}
          >
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold opacity-40">#{i + 1}</span>
              <span className="font-medium">{p.name}</span>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold">{p.score} pts</div>
              <div className="text-xs opacity-60">+{p.roundScore} this round</div>
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={onNext}
        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
      >
        Start Round {round + 1}
      </button>
    </div>
  );
}

// ── Game Over ───────────────────────────────────────────────────────────────

interface GameOverProps {
  players: Player[];
  onPlayAgain: () => void;
}

export function GameOver({ players, onPlayAgain }: GameOverProps) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const humanWon = winner.isHuman;

  return (
    <div className="flex flex-col items-center gap-6 p-6">
      <h2 className="text-3xl font-bold">{humanWon ? 'You Win!' : `${winner.name} Wins!`}</h2>
      <div className="text-6xl">{humanWon ? '🎉' : '🍣'}</div>
      <div className="w-full max-w-md space-y-3">
        {sorted.map((p, i) => (
          <div
            key={p.id}
            className={`
              flex items-center justify-between p-4 rounded-xl
              ${i === 0 ? 'bg-yellow-500/10 border-2 border-yellow-500/40' : 'bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700'}
              ${p.isHuman ? 'ring-2 ring-blue-400/30' : ''}
            `}
          >
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold opacity-40">{i === 0 ? '🏆' : `#${i + 1}`}</span>
              <div>
                <span className="font-medium">{p.name}</span>
                <div className="text-xs opacity-60">{p.puddings} puddings</div>
              </div>
            </div>
            <div className="text-2xl font-bold">{p.score}</div>
          </div>
        ))}
      </div>
      <button
        onClick={onPlayAgain}
        className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors text-lg"
      >
        Play Again
      </button>
    </div>
  );
}

// ── Setup Screen ────────────────────────────────────────────────────────────

interface SetupScreenProps {
  onStart: (playerCount: number) => void;
}

export function SetupScreen({ onStart }: SetupScreenProps) {
  const [count, setCount] = React.useState(3);

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] gap-8 p-6">
      <div className="text-center">
        <div className="text-6xl mb-4">🍣</div>
        <h1 className="text-4xl sm:text-5xl font-bold mb-2">Sushi Go!</h1>
        <p className="text-zinc-500 dark:text-zinc-400">The pick-and-pass card game</p>
      </div>

      <div className="w-full max-w-sm space-y-6">
        <div>
          <label className="block text-sm font-medium mb-3 text-center">Number of Players</label>
          <div className="flex justify-center gap-3">
            {[2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                className={`
                  w-14 h-14 rounded-xl font-bold text-lg transition-all
                  ${
                    count === n
                      ? 'bg-blue-600 text-white scale-110 shadow-lg'
                      : 'bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                  }
                `}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs text-center opacity-50 mt-2">
            You + {count - 1} AI opponent{count > 2 ? 's' : ''}
          </p>
        </div>

        <button
          onClick={() => onStart(count)}
          className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg transition-colors"
        >
          Start Game
        </button>

        <div className="text-xs opacity-50 space-y-1 bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4">
          <p className="font-medium mb-1">Quick Rules:</p>
          <p>Pick a card from your hand, pass the rest. Collect sets for points!</p>
          <p>Tempura (2=5pts) | Sashimi (3=10pts) | Dumplings (1-5 = 1-15pts)</p>
          <p>Nigiri (1-3pts, x3 with wasabi) | Maki (most=6pts) | Pudding (end game bonus)</p>
        </div>
      </div>
    </div>
  );
}

// ── Chopsticks Prompt ───────────────────────────────────────────────────────

interface ChopsticksPromptProps {
  onUse: () => void;
  onSkip: () => void;
}

export function ChopsticksPrompt({ onUse, onSkip }: ChopsticksPromptProps) {
  return (
    <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3">
      <span className="text-lg">🥢</span>
      <span className="text-sm flex-1">You have chopsticks! Play two cards this turn?</span>
      <button
        onClick={onUse}
        className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm font-medium"
      >
        Use
      </button>
      <button
        onClick={onSkip}
        className="px-3 py-1.5 bg-zinc-600 hover:bg-zinc-700 text-white rounded-lg text-sm font-medium"
      >
        Skip
      </button>
    </div>
  );
}
