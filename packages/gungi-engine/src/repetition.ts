/**
 * Position identity and repetition counting (§11.4).
 */

import { allSquares, getStack } from './board';
import { PIECE_GLYPHS } from './pieces';
import type { GameState, Hand } from './types';
import { PIECE_KINDS } from './types';

/** §11.4 the game ends when the same position appears for this many times. */
export const REPETITION_LIMIT = 4;

function handKey(hand: Hand): string {
  return PIECE_KINDS.map((k) => hand[k]).join(',');
}

/**
 * §11.4 canonical key identifying a position: board, both hands and side to
 * move. Black pieces are prefixed with `+`, white with `-`.
 */
export function positionKey(state: Pick<GameState, 'board' | 'hands' | 'turn'>): string {
  const squares = allSquares().map((sq) =>
    getStack(state.board, sq)
      .map((p) => (p.owner === 'black' ? '+' : '-') + PIECE_GLYPHS[p.kind])
      .join(''),
  );
  return [
    squares.join('/'),
    handKey(state.hands.black),
    handKey(state.hands.white),
    state.turn === 'black' ? 'b' : 'w',
  ].join(' ');
}

/** How often the current position has appeared since the last irreversible move. */
export function repetitions(state: GameState): number {
  const key = positionKey(state);
  return Object.hasOwn(state.positionCounts, key) ? (state.positionCounts[key] ?? 0) : 0;
}

/**
 * §11.4 records the current position of a play-phase state. After an
 * irreversible move (capture, drop, betrayal) no earlier position can recur,
 * since pieces only leave the board and the hands, so counting restarts.
 */
export function recordPosition(state: GameState, irreversible: boolean): GameState {
  const key = positionKey(state);
  if (irreversible) return { ...state, positionCounts: { [key]: 1 } };
  return { ...state, positionCounts: { ...state.positionCounts, [key]: repetitions(state) + 1 } };
}
