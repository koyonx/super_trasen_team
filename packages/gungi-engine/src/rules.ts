/**
 * Play-phase move rules (§6): move, capture and stack.
 *
 * Functions here check pseudo-legality only. Marshal safety (§10.1) and game
 * end detection (§11) are layered on top in engine.ts.
 */

import { MAX_STACK_HEIGHT } from '@gungi/shared';
import {
  allSquares,
  findMarshal,
  getStack,
  isValidSquare,
  sameSquare,
  setStack,
  topPiece,
} from './board';
import { reachableSquares } from './movement';
import { opponent } from './pieces';
import type { Board, BoardMove, GameState, PlayerSide, Square, Stack } from './types';
import { MoveError } from './types';

function canReach(board: Board, from: Square, to: Square): boolean {
  const stack = getStack(board, from);
  const piece = topPiece(stack);
  if (!piece) return false;
  return reachableSquares(board, from, piece, stack.length).some((sq) => sameSquare(sq, to));
}

export function validateBoardMove(state: GameState, move: BoardMove): MoveError | null {
  if (state.phase !== 'play') return MoveError.WRONG_PHASE;
  if (move.player !== state.turn) return MoveError.NOT_YOUR_TURN;
  if (!isValidSquare(move.from) || !isValidSquare(move.to)) return MoveError.INVALID_SQUARE;

  const origin = getStack(state.board, move.from);
  const piece = topPiece(origin);
  if (!piece) return MoveError.NO_PIECE;
  if (piece.owner !== move.player) return MoveError.NOT_YOUR_PIECE;
  if (sameSquare(move.from, move.to) || !canReach(state.board, move.from, move.to)) {
    return MoveError.UNREACHABLE;
  }

  const tier = origin.length;
  const target = getStack(state.board, move.to);
  const top = topPiece(target);

  if (move.type === 'move') {
    if (top) return MoveError.TARGET_NOT_EMPTY;
  } else {
    if (!top) return MoveError.TARGET_EMPTY;
    if (move.type === 'capture' && top.owner === move.player) return MoveError.CANNOT_CAPTURE_OWN;
    // §6.2 only stacks no higher than the mover's tier can be taken or stacked on.
    if (target.length > tier) return MoveError.TARGET_TOO_HIGH;
    if (move.type === 'stack') {
      if (top.kind === 'marshal') return MoveError.CANNOT_STACK_ON_MARSHAL;
      if (target.length >= MAX_STACK_HEIGHT) return MoveError.STACK_FULL;
    }
  }

  if (move.betray !== undefined && move.betray.length > 0) return MoveError.INVALID_BETRAYAL;
  return null;
}

/** Applies a pseudo-legal board move. Caller must have validated it. */
export function executeBoardMove(state: GameState, move: BoardMove): GameState {
  const origin = getStack(state.board, move.from);
  const piece = topPiece(origin);
  if (!piece) throw new Error('executeBoardMove: no piece at origin');
  const target = getStack(state.board, move.to);

  let landed: Stack;
  let captured = state.captured;
  if (move.type === 'capture') {
    // §6.4 every enemy piece in the stack is removed; own pieces stay below.
    const enemies = target.filter((p) => p.owner !== move.player);
    landed = [...target.filter((p) => p.owner === move.player), piece];
    captured = {
      ...captured,
      [move.player]: [...captured[move.player], ...enemies.map((p) => p.kind)],
    };
  } else {
    landed = [...target, piece];
  }

  const board = setStack(setStack(state.board, move.from, origin.slice(0, -1)), move.to, landed);
  return {
    ...state,
    board,
    captured,
    turn: opponent(move.player),
    ply: state.ply + 1,
  };
}

/** All pseudo-legal board moves for `side`. */
export function boardMoves(state: GameState, side: PlayerSide): BoardMove[] {
  const moves: BoardMove[] = [];
  for (const from of allSquares()) {
    const origin = getStack(state.board, from);
    const piece = topPiece(origin);
    if (!piece || piece.owner !== side) continue;
    const tier = origin.length;
    for (const to of reachableSquares(state.board, from, piece, tier)) {
      const target = getStack(state.board, to);
      const top = topPiece(target);
      if (!top) {
        moves.push({ type: 'move', player: side, from, to });
        continue;
      }
      if (target.length > tier) continue;
      if (top.owner !== side) moves.push({ type: 'capture', player: side, from, to });
      if (top.kind !== 'marshal' && target.length < MAX_STACK_HEIGHT) {
        moves.push({ type: 'stack', player: side, from, to });
      }
    }
  }
  return moves;
}

/** Whether any top piece of `attacker` could capture on `target` (§6.2). */
export function isSquareAttacked(board: Board, target: Square, attacker: PlayerSide): boolean {
  const targetHeight = getStack(board, target).length;
  for (const from of allSquares()) {
    const origin = getStack(board, from);
    const piece = topPiece(origin);
    if (!piece || piece.owner !== attacker || targetHeight > origin.length) continue;
    if (reachableSquares(board, from, piece, origin.length).some((sq) => sameSquare(sq, target))) {
      return true;
    }
  }
  return false;
}

/** §10.1 whether `side`'s marshal could be captured by the opponent's next move. */
export function isInCheck(board: Board, side: PlayerSide): boolean {
  const marshal = findMarshal(board, side);
  return marshal !== undefined && isSquareAttacked(board, marshal, opponent(side));
}
