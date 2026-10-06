/**
 * Drops from hand (新, §8).
 */

import { allSquares, isInDropZone, isValidSquare, setStack, getStack } from './board';
import { isPieceKind, opponent, withHandDelta } from './pieces';
import { placingError } from './placing';
import type { DropMove, GameState, PlayerSide } from './types';
import { MoveError, PIECE_KINDS } from './types';

export function validateDrop(state: GameState, move: DropMove): MoveError | null {
  if (state.phase !== 'play') return MoveError.WRONG_PHASE;
  if (move.player !== state.turn) return MoveError.NOT_YOUR_TURN;
  if (!isPieceKind(move.kind)) return MoveError.INVALID_MOVE;
  if (!isValidSquare(move.to)) return MoveError.INVALID_SQUARE;
  if (state.hands[move.player][move.kind] <= 0) return MoveError.NOT_IN_HAND;
  if (!isInDropZone(move.player, move.to.rank)) return MoveError.OUTSIDE_DROP_ZONE;
  // §8.3 the top may be an enemy piece; no capture happens.
  return placingError(state.board, move.to);
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
    quietPlies: 0,
  };
}

/** All valid drops for `side` (pseudo-legal; marshal safety is checked by the engine). */
export function dropMoves(state: GameState, side: PlayerSide): DropMove[] {
  const hand = state.hands[side];
  const kinds = PIECE_KINDS.filter((k) => hand[k] > 0);
  if (kinds.length === 0) return [];
  const moves: DropMove[] = [];
  for (const to of allSquares()) {
    if (!isInDropZone(side, to.rank) || placingError(state.board, to) !== null) continue;
    for (const kind of kinds) moves.push({ type: 'drop', player: side, kind, to });
  }
  return moves;
}
