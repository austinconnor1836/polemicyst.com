// ── Card Types ──────────────────────────────────────────────────────────────

export type CardType =
  | 'tempura'
  | 'sashimi'
  | 'dumpling'
  | 'maki1'
  | 'maki2'
  | 'maki3'
  | 'salmon_nigiri'
  | 'squid_nigiri'
  | 'egg_nigiri'
  | 'wasabi'
  | 'chopsticks'
  | 'pudding';

export interface Card {
  id: number;
  type: CardType;
}

export interface Player {
  id: number;
  name: string;
  isHuman: boolean;
  hand: Card[];
  played: Card[];
  score: number;
  puddings: number;
  roundScore: number;
}

export interface GameState {
  phase: 'setup' | 'pick' | 'reveal' | 'round_end' | 'game_end';
  round: number;
  players: Player[];
  selectedCardIds: Map<number, number[]>; // playerId -> cardIds chosen this turn
  deck: Card[];
  turnInRound: number;
}

// ── Deck Composition (108 cards) ────────────────────────────────────────────

const DECK_COMPOSITION: [CardType, number][] = [
  ['tempura', 14],
  ['sashimi', 14],
  ['dumpling', 14],
  ['maki2', 12],
  ['maki3', 8],
  ['maki1', 6],
  ['salmon_nigiri', 10],
  ['squid_nigiri', 5],
  ['egg_nigiri', 5],
  ['wasabi', 6],
  ['chopsticks', 4],
  ['pudding', 10],
];

export function createDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (const [type, count] of DECK_COMPOSITION) {
    for (let i = 0; i < count; i++) {
      cards.push({ id: id++, type });
    }
  }
  return cards;
}

// ── Shuffle ─────────────────────────────────────────────────────────────────

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Hand Size ───────────────────────────────────────────────────────────────

export function handSizeForPlayerCount(playerCount: number): number {
  switch (playerCount) {
    case 2:
      return 10;
    case 3:
      return 9;
    case 4:
      return 8;
    case 5:
      return 7;
    default:
      return 8;
  }
}

// ── Deal ────────────────────────────────────────────────────────────────────

export function dealHands(
  deck: Card[],
  playerCount: number
): { hands: Card[][]; remaining: Card[] } {
  const handSize = handSizeForPlayerCount(playerCount);
  const hands: Card[][] = [];
  let idx = 0;
  for (let p = 0; p < playerCount; p++) {
    hands.push(deck.slice(idx, idx + handSize));
    idx += handSize;
  }
  return { hands, remaining: deck.slice(idx) };
}

// ── Scoring ─────────────────────────────────────────────────────────────────

function countCards(played: Card[], type: CardType): number {
  return played.filter((c) => c.type === type).length;
}

function isNigiri(type: CardType): boolean {
  return type === 'salmon_nigiri' || type === 'squid_nigiri' || type === 'egg_nigiri';
}

function nigiriValue(type: CardType): number {
  switch (type) {
    case 'egg_nigiri':
      return 1;
    case 'salmon_nigiri':
      return 2;
    case 'squid_nigiri':
      return 3;
    default:
      return 0;
  }
}

export function scoreTempura(played: Card[]): number {
  const count = countCards(played, 'tempura');
  return Math.floor(count / 2) * 5;
}

export function scoreSashimi(played: Card[]): number {
  const count = countCards(played, 'sashimi');
  return Math.floor(count / 3) * 10;
}

export function scoreDumpling(played: Card[]): number {
  const count = countCards(played, 'dumpling');
  const lookup = [0, 1, 3, 6, 10, 15];
  if (count >= lookup.length) return 15;
  return lookup[count];
}

export function scoreNigiriAndWasabi(played: Card[]): number {
  let total = 0;
  let wasabiPending = false;

  // Wasabi applies to the NEXT nigiri played after it.
  // We process cards in the order they were played.
  for (const card of played) {
    if (card.type === 'wasabi') {
      wasabiPending = true;
    } else if (isNigiri(card.type)) {
      const base = nigiriValue(card.type);
      total += wasabiPending ? base * 3 : base;
      wasabiPending = false;
    }
  }
  return total;
}

export function countMaki(played: Card[]): number {
  let total = 0;
  for (const card of played) {
    if (card.type === 'maki1') total += 1;
    else if (card.type === 'maki2') total += 2;
    else if (card.type === 'maki3') total += 3;
  }
  return total;
}

export function scoreMaki(players: Player[]): Map<number, number> {
  const scores = new Map<number, number>();
  const makiCounts = players.map((p) => ({ id: p.id, count: countMaki(p.played) }));

  // Find first and second highest
  const sorted = [...new Set(makiCounts.map((m) => m.count))].sort((a, b) => b - a);
  const first = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;

  if (first === 0) return scores;

  const firstPlayers = makiCounts.filter((m) => m.count === first);
  const secondPlayers = makiCounts.filter((m) => m.count === second && second > 0);

  const firstPts = Math.floor(6 / firstPlayers.length);
  for (const p of firstPlayers) {
    scores.set(p.id, firstPts);
  }

  if (firstPlayers.length === 1 && second > 0) {
    const secondPts = Math.floor(3 / secondPlayers.length);
    for (const p of secondPlayers) {
      scores.set(p.id, secondPts);
    }
  }

  return scores;
}

export function scoreRound(players: Player[]): Player[] {
  const makiScores = scoreMaki(players);

  return players.map((p) => {
    const tempura = scoreTempura(p.played);
    const sashimi = scoreSashimi(p.played);
    const dumpling = scoreDumpling(p.played);
    const nigiri = scoreNigiriAndWasabi(p.played);
    const maki = makiScores.get(p.id) ?? 0;
    const roundScore = tempura + sashimi + dumpling + nigiri + maki;

    return {
      ...p,
      roundScore,
      score: p.score + roundScore,
      puddings: p.puddings + countCards(p.played, 'pudding'),
    };
  });
}

export function scorePudding(players: Player[]): Player[] {
  if (players.length <= 1) return players;

  const counts = players.map((p) => p.puddings);
  const max = Math.max(...counts);
  const min = Math.min(...counts);

  const mostCount = players.filter((p) => p.puddings === max).length;
  const leastCount = players.filter((p) => p.puddings === min).length;

  return players.map((p) => {
    let bonus = 0;
    if (p.puddings === max) {
      bonus += Math.floor(6 / mostCount);
    }
    if (p.puddings === min && max !== min) {
      bonus -= Math.floor(6 / leastCount);
    }
    return { ...p, score: p.score + bonus };
  });
}

// ── Card Display Info ───────────────────────────────────────────────────────

export interface CardInfo {
  name: string;
  emoji: string;
  color: string;
  description: string;
}

export const CARD_INFO: Record<CardType, CardInfo> = {
  tempura: { name: 'Tempura', emoji: '🍤', color: '#C084FC', description: '2 = 5 pts' },
  sashimi: { name: 'Sashimi', emoji: '🍣', color: '#34D399', description: '3 = 10 pts' },
  dumpling: {
    name: 'Dumpling',
    emoji: '🥟',
    color: '#60A5FA',
    description: '1→1, 2→3, 3→6, 4→10, 5→15',
  },
  maki1: { name: 'Maki ×1', emoji: '🍱', color: '#F87171', description: 'Most maki = 6 pts' },
  maki2: { name: 'Maki ×2', emoji: '🍱', color: '#F87171', description: 'Most maki = 6 pts' },
  maki3: { name: 'Maki ×3', emoji: '🍱', color: '#F87171', description: 'Most maki = 6 pts' },
  salmon_nigiri: {
    name: 'Salmon Nigiri',
    emoji: '🐟',
    color: '#FB923C',
    description: '2 pts (×3 w/ wasabi)',
  },
  squid_nigiri: {
    name: 'Squid Nigiri',
    emoji: '🦑',
    color: '#A78BFA',
    description: '3 pts (×3 w/ wasabi)',
  },
  egg_nigiri: {
    name: 'Egg Nigiri',
    emoji: '🥚',
    color: '#FCD34D',
    description: '1 pt (×3 w/ wasabi)',
  },
  wasabi: { name: 'Wasabi', emoji: '🟢', color: '#4ADE80', description: 'Next nigiri ×3' },
  chopsticks: {
    name: 'Chopsticks',
    emoji: '🥢',
    color: '#94A3B8',
    description: 'Swap to play 2 cards',
  },
  pudding: {
    name: 'Pudding',
    emoji: '🍮',
    color: '#FBBF24',
    description: 'End: most +6, least −6',
  },
};

// ── Chopsticks Logic ────────────────────────────────────────────────────────

export function hasChopsticks(played: Card[]): boolean {
  return played.some((c) => c.type === 'chopsticks');
}

export function applyChopsticks(player: Player, secondCardId: number): Player {
  // Remove the second card from hand, add it to played
  // Put chopsticks back into hand
  const secondCard = player.hand.find((c) => c.id === secondCardId);
  if (!secondCard) return player;

  const chopsticksIdx = player.played.findIndex((c) => c.type === 'chopsticks');
  if (chopsticksIdx === -1) return player;

  const chopsticks = player.played[chopsticksIdx];
  const newPlayed = [...player.played];
  newPlayed.splice(chopsticksIdx, 1);
  newPlayed.push(secondCard);

  const newHand = player.hand.filter((c) => c.id !== secondCardId);
  newHand.push(chopsticks);

  return { ...player, hand: newHand, played: newPlayed };
}

// ── Pass Hands (Drafting) ───────────────────────────────────────────────────

export function passHands(players: Player[], round: number): Player[] {
  const hands = players.map((p) => p.hand);
  // Odd rounds: pass left. Even rounds: pass right.
  const direction = round % 2 === 1 ? 1 : -1;
  const n = players.length;

  return players.map((p, i) => {
    const fromIdx = (((i - direction) % n) + n) % n;
    return { ...p, hand: hands[fromIdx] };
  });
}
