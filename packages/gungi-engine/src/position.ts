import { allSquares, getStack } from './board';
import { PIECE_GLYPHS } from './pieces';
import type { GameState, Hand } from './types';
import { PIECE_KINDS } from './types';

function handKey(hand: Hand): string {
  return PIECE_KINDS.map((k) => hand[k]).join('');
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
