/**
 * Rules shared by placement (§9.2) and drops (§8.3): which square a piece
 * from hand may be put on.
 */

import { MAX_STACK_HEIGHT } from '@gungi/shared';
import { getStack, topPiece } from './board';
import type { Board, Square } from './types';
import { MoveError } from './types';

/**
 * §8.3 / §9.2 why a piece from hand may not be put on `to`, ignoring hand
 * contents, the phase-specific zone and marshal safety.
 */
export function placingError(board: Board, to: Square): MoveError | null {
  const stack = getStack(board, to);
  const top = topPiece(stack);
  if (top) {
    if (top.kind === 'marshal') return MoveError.CANNOT_STACK_ON_MARSHAL;
    if (stack.length >= MAX_STACK_HEIGHT) return MoveError.STACK_FULL;
  }
  return null;
}
