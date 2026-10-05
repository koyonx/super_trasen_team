import { allSquares, createEmptyBoard, getStack, setStack } from './board';
import { PIECE_GLYPHS, emptyHand } from './pieces';
import type { GameState, Hand, Piece, PlayerSide, Square } from './types';
import { PIECE_KINDS } from './types';

function handKey(hand: Hand): string {
  return PIECE_KINDS.map((k) => hand[k]).join('');
}

/**
 * §12.1 canonical key identifying a position: board, both hands and side to
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

export interface PositionSetup {
  /** Stacks to put on an otherwise empty board (pieces bottom to top). */
  readonly stacks?: readonly { readonly square: Square; readonly pieces: readonly Piece[] }[];
  /** Hand contents; unspecified kinds default to 0. */
  readonly hands?: Partial<Record<PlayerSide, Partial<Hand>>>;
  readonly turn?: PlayerSide;
  /** §11.4 quiet-ply counter to start from (default 0). */
  readonly quietPlies?: number;
}

/** Builds a play-phase state from an arbitrary position (tests, AI, kifu import). */
export function createPosition(setup: PositionSetup = {}): GameState {
  let board = createEmptyBoard();
  for (const { square, pieces } of setup.stacks ?? []) {
    board = setStack(board, square, [...pieces]);
  }
  const hand = (side: PlayerSide): Hand => ({ ...emptyHand(), ...setup.hands?.[side] });
  return {
    phase: 'play',
    board,
    hands: { black: hand('black'), white: hand('white') },
    turn: setup.turn ?? 'black',
    placementDone: { black: true, white: true },
    captured: { black: [], white: [] },
    ply: 0,
    quietPlies: setup.quietPlies ?? 0,
    result: null,
  };
}
