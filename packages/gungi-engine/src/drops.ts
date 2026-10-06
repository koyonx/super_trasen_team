/**
 * Drops from hand (新, §8).
 */

import { allSquares, getStack, isValidSquare, setStack } from './board';
import { isPieceKind, opponent, withHandDelta } from './pieces';
import { placingError } from './placing';
import type { Board, DropMove, GameState, PlayerSide } from './types';
import { MoveError, PIECE_KINDS } from './types';

/**
 * §8.2 the most advanced rank holding any piece of `side`, buried pieces
 * included (R-5), or `null` if the side has no piece on the board.
 */
export function frontLineRank(board: Board, side: PlayerSide): number | null {
  let front: number | null = null;
  for (const sq of allSquares()) {
    if (!getStack(board, sq).some((p) => p.owner === side)) continue;
    if (front === null || (side === 'black' ? sq.rank > front : sq.rank < front)) front = sq.rank;
  }
  return front;
}

/** §8.2 whether `rank` lies between the side's back rank and its front line. */
export function isInDropZone(board: Board, side: PlayerSide, rank: number): boolean {
  const front = frontLineRank(board, side);
  if (front === null) return false;
  return side === 'black' ? rank <= front : rank >= front;
}

export function validateDrop(state: GameState, move: DropMove): MoveError | null {
  if (state.phase !== 'play') return MoveError.WRONG_PHASE;
  if (move.player !== state.turn) return MoveError.NOT_YOUR_TURN;
  if (!isPieceKind(move.kind)) return MoveError.INVALID_MOVE;
  if (!isValidSquare(move.to)) return MoveError.INVALID_SQUARE;
  if (state.hands[move.player][move.kind] <= 0) return MoveError.NOT_IN_HAND;
  if (!isInDropZone(state.board, move.player, move.to.rank)) return MoveError.OUTSIDE_DROP_ZONE;
  // §8.3 empty squares and own stacks only; no height condition.
  return placingError(state.board, move.player, move.to);
}

/** Applies a validated drop. */
export function executeDrop(state: GameState, move: DropMove): GameState {
  const stack = getStack(state.board, move.to);
  return {
    ...state,
    board: setStack(state.board, move.to, [...stack, { kind: move.kind, owner: move.player }]),
    hands: {
      ...state.hands,
      [move.player]: withHandDelta(state.hands[move.player], move.kind, -1),
    },
    turn: opponent(move.player),
    ply: state.ply + 1,
  };
}

/** All valid drops for `side` (pseudo-legal; marshal safety is checked by the engine). */
export function dropMoves(state: GameState, side: PlayerSide): DropMove[] {
  const hand = state.hands[side];
  const kinds = PIECE_KINDS.filter((k) => hand[k] > 0);
  if (kinds.length === 0) return [];
  const front = frontLineRank(state.board, side);
  if (front === null) return [];
  const moves: DropMove[] = [];
  for (const to of allSquares()) {
    if (side === 'black' ? to.rank > front : to.rank < front) continue;
    if (placingError(state.board, side, to) !== null) continue;
    for (const kind of kinds) moves.push({ type: 'drop', player: side, kind, to });
  }
  return moves;
}
