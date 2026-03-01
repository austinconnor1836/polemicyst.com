import { Card, CardType, Player } from './engine';

// Simple AI that evaluates cards based on what it has already played

function cardScore(card: Card, played: Card[]): number {
  const counts = (type: CardType) => played.filter((c) => c.type === type).length;

  switch (card.type) {
    case 'tempura': {
      // Value higher if we already have 1 tempura (completing a pair)
      return counts('tempura') % 2 === 1 ? 8 : 4;
    }
    case 'sashimi': {
      const n = counts('sashimi') % 3;
      // Near completion is very valuable
      if (n === 2) return 10;
      if (n === 1) return 5;
      return 3;
    }
    case 'dumpling': {
      // Increasing marginal value up to 5
      const n = counts('dumpling');
      return Math.min(n + 2, 7);
    }
    case 'maki1':
      return 2;
    case 'maki2':
      return 4;
    case 'maki3':
      return 6;
    case 'squid_nigiri': {
      const hasWasabi = played.some((c) => c.type === 'wasabi' && !isWasabiUsed(played, c));
      return hasWasabi ? 12 : 4;
    }
    case 'salmon_nigiri': {
      const hasWasabi = played.some((c) => c.type === 'wasabi' && !isWasabiUsed(played, c));
      return hasWasabi ? 8 : 3;
    }
    case 'egg_nigiri': {
      const hasWasabi = played.some((c) => c.type === 'wasabi' && !isWasabiUsed(played, c));
      return hasWasabi ? 5 : 1.5;
    }
    case 'wasabi': {
      return 5;
    }
    case 'chopsticks': {
      // More valuable early in the round
      return played.length < 3 ? 4 : 1;
    }
    case 'pudding': {
      return 3.5;
    }
    default:
      return 1;
  }
}

function isNigiri(type: CardType): boolean {
  return type === 'salmon_nigiri' || type === 'squid_nigiri' || type === 'egg_nigiri';
}

function isWasabiUsed(played: Card[], wasabiCard: Card): boolean {
  // A wasabi is "used" if there's a nigiri played after it
  const wasabiIdx = played.indexOf(wasabiCard);
  for (let i = wasabiIdx + 1; i < played.length; i++) {
    if (isNigiri(played[i].type)) return true;
  }
  return false;
}

export function aiPickCard(player: Player): number {
  if (player.hand.length === 0) return -1;

  let bestScore = -Infinity;
  let bestId = player.hand[0].id;

  for (const card of player.hand) {
    const score = cardScore(card, player.played) + Math.random() * 0.5; // slight randomness
    if (score > bestScore) {
      bestScore = score;
      bestId = card.id;
    }
  }

  return bestId;
}
