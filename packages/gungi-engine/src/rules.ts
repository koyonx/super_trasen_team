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
  hasRoom,
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

/** §6.3 / §4.4 why a piece may not be stacked onto `target`, if at all. */
export function stackError(target: Stack): MoveError | null {
  if (topPiece(target)?.kind === 'marshal') return MoveError.CANNOT_STACK_ON_MARSHAL;
  if (target.length >= MAX_STACK_HEIGHT) return MoveError.STACK_FULL;
  return null;
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

  const target = getStack(state.board, move.to);
  const top = topPiece(target);
  if (move.type === 'move') return top ? MoveError.TARGET_NOT_EMPTY : null;
  if (!top) return MoveError.TARGET_EMPTY;
  if (move.type === 'capture' && top.owner === move.player) return MoveError.CANNOT_CAPTURE_OWN;
  // §6.2 only stacks no higher than the mover's tier can be taken or stacked on.
  if (target.length > origin.length) return MoveError.TARGET_TOO_HIGH;
  return move.type === 'capture' ? null : stackError(target);
}

/** Applies a pseudo-legal board move. Caller must have validated it. */
export function executeBoardMove(state: GameState, move: BoardMove): GameState {
  const origin = getStack(state.board, move.from);
  const piece = topPiece(origin);
  if (!piece) throw new Error('executeBoardMove: no piece at origin');
  const target = getStack(state.board, move.to);
  const advance = (board: Board): GameState => ({
    ...state,
    board,
    turn: opponent(move.player),
    ply: state.ply + 1,
  });

  const lift = (board: Board): Board => setStack(board, move.from, origin.slice(0, -1));

  if (move.type === 'capture') {
    // §6.4 every enemy piece in the stack is removed; own pieces stay below
    // in their order and the capturer lands on top of them.
    const victims = target.filter((p) => p.owner !== move.player);
    const remaining = target.filter((p) => p.owner === move.player);
    // Unreachable from a valid position: the top is an enemy piece, so at most
    // 2 own pieces remain (§4.1), and an own marshal is never below another
    // piece (§4.4).
    if (
      victims.length === 0 ||
      !hasRoom(remaining) ||
      remaining.some((p) => p.kind === 'marshal')
    ) {
      throw new Error('executeBoardMove: corrupt target stack');
    }
    return {
      ...advance(setStack(lift(state.board), move.to, [...remaining, piece])),
      captured: {
        ...state.captured,
        [move.player]: [...state.captured[move.player], ...victims.map((p) => p.kind)],
      },
    };
  }

  const landed: Stack = move.type === 'stack' ? [...target, piece] : [piece];
  return advance(setStack(lift(state.board), move.to, landed));
}

/** All pseudo-legal board moves for `side`. */
export function boardMoves(state: GameState, side: PlayerSide): BoardMove[] {
  const moves: BoardMove[] = [];
  for (const from of allSquares()) {
    const origin = getStack(state.board, from);
    const piece = topPiece(origin);
    if (!piece || piece.owner !== side) continue;
    for (const to of reachableSquares(state.board, from, piece, origin.length)) {
      const target = getStack(state.board, to);
      const top = topPiece(target);
      if (!top) {
        moves.push({ type: 'move', player: side, from, to });
        continue;
      }
      if (target.length > origin.length) continue;
      if (stackError(target) === null) moves.push({ type: 'stack', player: side, from, to });
      if (top.owner !== side) moves.push({ type: 'capture', player: side, from, to });
    }
  }
  return moves;
}

/** Whether any top piece of `attacker` could capture on `target` (§6.2, §10.1). */
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
