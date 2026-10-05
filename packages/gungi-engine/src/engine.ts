/**
 * Public game lifecycle: placement -> play -> finished.
 *
 * `applyMove` is the single authoritative entry point. It never throws for
 * rule violations; it returns `{ ok: false, error }` and leaves the input
 * state untouched.
 */

import { getStack } from './board';
import { dropMoves, executeDrop, validateDrop } from './drops';
import { opponent } from './pieces';
import { positionKey } from './position';
import { boardMoves, executeBoardMove, isInCheck, validateBoardMove } from './rules';
import { applyPlacementMove, placementMoves } from './setup';
import type {
  BoardMove,
  DropMove,
  GameResult,
  GameState,
  Move,
  MoveResult,
  PlayerSide,
} from './types';
import { MoveError } from './types';

const MOVE_TYPES: ReadonlySet<string> = new Set([
  'place',
  'finishPlacement',
  'move',
  'capture',
  'stack',
  'drop',
  'resign',
  'timeout',
  'agreeDraw',
]);

function isSide(value: unknown): value is PlayerSide {
  return value === 'black' || value === 'white';
}

/** Structural check for untrusted input (e.g. a WebSocket payload). */
function isWellFormed(move: unknown): move is Move {
  if (typeof move !== 'object' || move === null) return false;
  const { type, player, betray } = move as Record<string, unknown>;
  if (typeof type !== 'string' || !MOVE_TYPES.has(type)) return false;
  if (type !== 'agreeDraw' && !isSide(player)) return false;
  if (betray !== undefined && !Array.isArray(betray)) return false;
  return true;
}

function finish(state: GameState, result: GameResult): GameState {
  return { ...state, phase: 'finished', result };
}

function capturesMarshal(state: GameState, move: BoardMove): boolean {
  return (
    move.type === 'capture' &&
    getStack(state.board, move.to).some((p) => p.kind === 'marshal' && p.owner !== move.player)
  );
}

/** Pseudo-legal play-phase moves for the side to move. */
function pseudoMoves(state: GameState): (BoardMove | DropMove)[] {
  return [...boardMoves(state, state.turn), ...dropMoves(state, state.turn)];
}

function executePlay(state: GameState, move: BoardMove | DropMove): GameState {
  return move.type === 'drop' ? executeDrop(state, move) : executeBoardMove(state, move);
}

/**
 * §10.1 whether the move keeps the mover's marshal out of capture.
 * `inCheck` is the mover's check status before the move (drop fast path:
 * a drop can never expose the marshal, it can only fail to block).
 */
function keepsMarshalSafe(state: GameState, move: BoardMove | DropMove, inCheck: boolean): boolean {
  if (move.type === 'drop' && !inCheck) return true;
  if (move.type !== 'drop' && capturesMarshal(state, move)) return true;
  return !isInCheck(executePlay(state, move).board, move.player);
}

function hasLegalMove(state: GameState): boolean {
  const inCheck = isInCheck(state.board, state.turn);
  return pseudoMoves(state).some((m) => keepsMarshalSafe(state, m, inCheck));
}

/** §11.2 / §11.3 ends the game if the side to move has no legal move. */
function concludeIfStuck(state: GameState): GameState {
  if (state.phase !== 'play' || hasLegalMove(state)) return state;
  return finish(state, {
    winner: opponent(state.turn),
    reason: isInCheck(state.board, state.turn) ? 'checkmate' : 'stalemate',
  });
}

function applyPlayMove(state: GameState, move: BoardMove | DropMove): MoveResult {
  const error = move.type === 'drop' ? validateDrop(state, move) : validateBoardMove(state, move);
  if (error) return { ok: false, error };
  if (!keepsMarshalSafe(state, move, isInCheck(state.board, move.player))) {
    return { ok: false, error: MoveError.SELF_CHECK };
  }

  const tookMarshal = move.type !== 'drop' && capturesMarshal(state, move);
  const next = executePlay(state, move);
  if (tookMarshal) {
    return { ok: true, state: finish(next, { winner: move.player, reason: 'marshalCaptured' }) };
  }

  const key = positionKey(next);
  const occurrences = (next.positionCounts[key] ?? 0) + 1;
  const counted: GameState = {
    ...next,
    positionCounts: { ...next.positionCounts, [key]: occurrences },
  };
  const concluded = concludeIfStuck(counted);
  if (concluded.phase === 'finished') return { ok: true, state: concluded };
  // §11.4 fourth occurrence of the same position is a draw.
  if (occurrences >= 4) {
    return { ok: true, state: finish(counted, { winner: null, reason: 'repetition' }) };
  }
  return { ok: true, state: counted };
}

/** Applies any move. Returns the next state or a rule-violation code. */
export function applyMove(state: GameState, move: Move): MoveResult {
  if (state.phase === 'finished') return { ok: false, error: MoveError.GAME_FINISHED };
  if (!isWellFormed(move)) return { ok: false, error: MoveError.INVALID_MOVE };

  switch (move.type) {
    case 'resign':
      return {
        ok: true,
        state: finish(state, { winner: opponent(move.player), reason: 'resignation' }),
      };
    case 'timeout':
      return {
        ok: true,
        state: finish(state, { winner: opponent(move.player), reason: 'timeout' }),
      };
    case 'agreeDraw':
      return { ok: true, state: finish(state, { winner: null, reason: 'agreement' }) };
    case 'place':
    case 'finishPlacement': {
      const result = applyPlacementMove(state, move);
      return result.ok ? { ok: true, state: concludeIfStuck(result.state) } : result;
    }
    case 'move':
    case 'capture':
    case 'stack':
    case 'drop':
      return applyPlayMove(state, move);
  }
}

/** `null` if the move is legal, otherwise the reason it is not. */
export function validateMove(state: GameState, move: Move): MoveError | null {
  const result = applyMove(state, move);
  return result.ok ? null : result.error;
}

/**
 * Every legal move for the side to move (placement or play phase). Terminal
 * actions (`resign`, `timeout`, `agreeDraw`) are always available and are not
 * listed.
 */
export function legalMoves(state: GameState): Move[] {
  if (state.phase === 'placement') return placementMoves(state);
  if (state.phase !== 'play') return [];
  const inCheck = isInCheck(state.board, state.turn);
  return pseudoMoves(state).filter((m) => keepsMarshalSafe(state, m, inCheck));
}

export function isGameOver(state: GameState): boolean {
  return state.phase === 'finished';
}

/** Whether the side to move currently has its marshal under attack. */
export function inCheck(state: GameState): boolean {
  return state.phase === 'play' && isInCheck(state.board, state.turn);
}
