/**
 * Rules shared by placement (§9.2) and drops (§8.3): which square a piece
 * from hand may be put on.
 */

import { MAX_STACK_HEIGHT } from '@gungi/shared';
import { allSquares, getStack, topPiece } from './board';
import type { Board, PieceKind, PlayerSide, Square } from './types';
import { MoveError } from './types';

/** §3.3 maximum number of own pieces on the board. */
export const ARMY_LIMIT = 26;

/** §3.3 number of the side's pieces on the board, buried ones included. */
export function armySize(board: Board, side: PlayerSide): number {
  let count = 0;
  for (const sq of allSquares()) {
    for (const piece of getStack(board, sq)) if (piece.owner === side) count++;
  }
  return count;
}

/** §8.3 whether the side already has a pawn anywhere on the file (any rank, any tier). */
export function hasPawnOnFile(board: Board, side: PlayerSide, file: number): boolean {
  return board.some((row) => (row[file] ?? []).some((p) => p.kind === 'pawn' && p.owner === side));
}

/**
 * §8.3 / §9.2 why `kind` may not be put on `to` by `player`, ignoring hand
 * contents, the phase-specific zone and marshal safety.
 */
export function placingError(
  board: Board,
  player: PlayerSide,
  kind: PieceKind,
  to: Square,
): MoveError | null {
  const stack = getStack(board, to);
  const top = topPiece(stack);
  if (top) {
    if (top.kind === 'marshal') return MoveError.CANNOT_STACK_ON_MARSHAL;
    if (stack.length >= MAX_STACK_HEIGHT) return MoveError.STACK_FULL;
    if (kind === 'fortress') return MoveError.FORTRESS_CANNOT_STACK;
  }
  if (kind === 'pawn' && hasPawnOnFile(board, player, to.file)) {
    return MoveError.PAWN_FILE_OCCUPIED;
  }
  if (armySize(board, player) >= ARMY_LIMIT) return MoveError.ARMY_LIMIT;
  return null;
}
