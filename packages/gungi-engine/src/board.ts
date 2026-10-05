/**
 * Immutable board operations (§2, §4). Every function returns new data and
 * never mutates its arguments.
 */

import { BOARD_SIZE, MAX_STACK_HEIGHT } from '@gungi/shared';
import type { Board, Piece, PlayerSide, Square, Stack } from './types';

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, (): Stack => []),
  );
}

export function isOnBoard(file: number, rank: number): boolean {
  return (
    Number.isInteger(file) &&
    Number.isInteger(rank) &&
    file >= 0 &&
    file < BOARD_SIZE &&
    rank >= 0 &&
    rank < BOARD_SIZE
  );
}

export function isValidSquare(sq: unknown): sq is Square {
  if (typeof sq !== 'object' || sq === null) return false;
  const { file, rank } = sq as Record<string, unknown>;
  return typeof file === 'number' && typeof rank === 'number' && isOnBoard(file, rank);
}

export function sameSquare(a: Square, b: Square): boolean {
  return a.file === b.file && a.rank === b.rank;
}

export function getStack(board: Board, sq: Square): Stack {
  const row = board[sq.rank];
  const stack = row?.[sq.file];
  if (!stack) throw new RangeError(`square out of board: ${sq.file},${sq.rank}`);
  return stack;
}

export function topPiece(stack: Stack): Piece | undefined {
  return stack[stack.length - 1];
}

export function setStack(board: Board, sq: Square, stack: Stack): Board {
  return board.map((row, rank) =>
    rank === sq.rank ? row.map((s, file) => (file === sq.file ? stack : s)) : row,
  );
}

/** §4.1 whether one more piece fits on top of the stack. */
export function hasRoom(stack: Stack): boolean {
  return stack.length < MAX_STACK_HEIGHT;
}

/** §2.2 rank direction considered "forward" for the side. */
export function forwardOf(side: PlayerSide): 1 | -1 {
  return side === 'black' ? 1 : -1;
}

/** §2.3 whether the rank belongs to the side's territory (3 back ranks). */
export function isInTerritory(side: PlayerSide, rank: number): boolean {
  return side === 'black' ? rank >= 0 && rank <= 2 : rank >= 6 && rank < BOARD_SIZE;
}

/** §2.4 whether the rank lies in the side's drop zone (its own six ranks). */
export function isInDropZone(side: PlayerSide, rank: number): boolean {
  return side === 'black' ? rank >= 0 && rank <= 5 : rank >= 3 && rank < BOARD_SIZE;
}

/** All squares in row-major order. */
export function allSquares(): Square[] {
  const out: Square[] = [];
  for (let rank = 0; rank < BOARD_SIZE; rank++) {
    for (let file = 0; file < BOARD_SIZE; file++) out.push({ file, rank });
  }
  return out;
}

/** Locates the side's marshal (always a top piece per §4.4). */
export function findMarshal(board: Board, side: PlayerSide): Square | undefined {
  for (const sq of allSquares()) {
    const stack = getStack(board, sq);
    if (stack.some((p) => p.kind === 'marshal' && p.owner === side)) return sq;
  }
  return undefined;
}
