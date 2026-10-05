import type { Hand, PieceKind, PlayerSide } from './types';
import { PIECE_KINDS } from './types';

/** §3.1 number of pieces of each kind per player. */
export const ROSTER: Hand = {
  marshal: 1,
  general: 6,
  lieutenant: 4,
  major: 4,
  samurai: 2,
  knight: 2,
  shinobi: 2,
  fortress: 2,
  pawn: 9,
  cannon: 2,
  archer: 2,
  musket: 1,
  tactician: 1,
};

/** Kanji glyph of each piece kind (notation / debugging, not UI text). */
export const PIECE_GLYPHS: Readonly<Record<PieceKind, string>> = {
  marshal: '帥',
  general: '大',
  lieutenant: '中',
  major: '小',
  samurai: '侍',
  knight: '馬',
  shinobi: '忍',
  fortress: '砦',
  pawn: '兵',
  cannon: '砲',
  archer: '弓',
  musket: '筒',
  tactician: '謀',
};

export function isPieceKind(value: unknown): value is PieceKind {
  return typeof value === 'string' && (PIECE_KINDS as readonly string[]).includes(value);
}

export function emptyHand(): Hand {
  return Object.fromEntries(PIECE_KINDS.map((k) => [k, 0])) as Record<PieceKind, number>;
}

export function handTotal(hand: Hand): number {
  return PIECE_KINDS.reduce((sum, k) => sum + hand[k], 0);
}

export function withHandDelta(hand: Hand, kind: PieceKind, delta: number): Hand {
  return { ...hand, [kind]: hand[kind] + delta };
}

export function opponent(side: PlayerSide): PlayerSide {
  return side === 'black' ? 'white' : 'black';
}
