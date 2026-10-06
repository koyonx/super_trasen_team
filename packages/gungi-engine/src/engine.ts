/**
 * Public game lifecycle: placement -> play -> finished.
 *
 * `applyMove` is the single authoritative entry point. It never throws for
 * rule violations; it returns `{ ok: false, error }` and leaves the input
 * state untouched.
 *
 * Every function here assumes a state that keeps the §12.1 invariants (as
 * produced by `createInitialState`, `createPosition` or `applyMove`). On a
 * corrupt state they may give wrong answers or throw programmer errors, so a
 * state restored from storage or the network must pass `stateError` first.
 */

import { getStack, topPiece } from './board';
import { dropMoves, executeDrop, validateDrop } from './drops';
import { opponent } from './pieces';
import { boardMoves, executeBoardMove, isInCheck, validateBoardMove } from './rules';
import type { PlacementMove } from './setup';
import { executePlacementMove, placementMoves, validatePlacementMove } from './setup';
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

/** Moves that change the board or the phase (everything but terminal actions). */
type GameMove = PlacementMove | BoardMove | DropMove;

/** §11.4 the game is drawn once more than this many quiet plies have been played. */
export const QUIET_PLY_LIMIT = 50;

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

/**
 * First gate for untrusted input (e.g. a WebSocket payload): a known `type`
 * and, except for `agreeDraw`, a valid `player`. The payload is checked by
 * the per-type validators, which reject bad squares with `INVALID_SQUARE` and
 * unknown piece kinds with `INVALID_MOVE` before touching the board, so a
 * malformed move never throws (see the §12.2 malformed-input specs).
 */
function isWellFormed(move: unknown): move is Move {
  if (typeof move !== 'object' || move === null) return false;
  const { type, player } = move as Record<string, unknown>;
  if (typeof type !== 'string' || !MOVE_TYPES.has(type)) return false;
  return type === 'agreeDraw' || isSide(player);
}

function finish(state: GameState, result: GameResult): GameState {
  return { ...state, phase: 'finished', result };
}

/** §11.1 whether the move takes the enemy marshal (always a top piece, §4.4). */
function capturesMarshal(state: GameState, move: GameMove): boolean {
  return move.type === 'capture' && topPiece(getStack(state.board, move.to))?.kind === 'marshal';
}

function validatePseudo(state: GameState, move: GameMove): MoveError | null {
  switch (move.type) {
    case 'place':
    case 'finishPlacement':
      return validatePlacementMove(state, move);
    case 'drop':
      return validateDrop(state, move);
    default:
      return validateBoardMove(state, move);
  }
}

function execute(state: GameState, move: GameMove): GameState {
  switch (move.type) {
    case 'place':
    case 'finishPlacement':
      return executePlacementMove(state, move);
    case 'drop':
      return executeDrop(state, move);
    default:
      return executeBoardMove(state, move);
  }
}

/** Pseudo-legal moves for the side to move in the current phase. */
function pseudoMoves(state: GameState): GameMove[] {
  if (state.phase === 'placement') return placementMoves(state);
  if (state.phase !== 'play') return [];
  return [...boardMoves(state, state.turn), ...dropMoves(state, state.turn)];
}

/**
 * §10.1 whether the move keeps the mover's marshal out of reach.
 * `inCheck` is the mover's check status before the move. Fast path: putting a
 * piece from hand on an empty square or an own stack can only block lines and
 * raise stacks that jumps pass over (§5.4), so it never exposes the marshal
 * when it is not already attacked.
 */
function keepsMarshalSafe(state: GameState, move: GameMove, inCheck: boolean): boolean {
  if ((move.type === 'place' || move.type === 'drop') && !inCheck) return true;
  if (move.type === 'finishPlacement') return !inCheck;
  // §10.1 no exception for capturing the enemy marshal.
  return !isInCheck(execute(state, move).board, move.player);
}

function legalGameMoves(state: GameState): GameMove[] {
  const inCheck = isInCheck(state.board, state.turn);
  return pseudoMoves(state).filter((m) => keepsMarshalSafe(state, m, inCheck));
}

function hasLegalMove(state: GameState): boolean {
  const inCheck = isInCheck(state.board, state.turn);
  return pseudoMoves(state).some((m) => keepsMarshalSafe(state, m, inCheck));
}

/**
 * §11.2–§11.4 ends the game after a move: the fifty-move draw first (it takes
 * precedence over a simultaneous mate), then checkmate (loss) or stalemate
 * (draw) when the side to move has no legal move.
 */
function conclude(state: GameState): GameState {
  if (state.phase === 'finished') return state;
  if (state.quietPlies > QUIET_PLY_LIMIT) {
    return finish(state, { winner: null, reason: 'fiftyMoveRule' });
  }
  if (hasLegalMove(state)) return state;
  return isInCheck(state.board, state.turn)
    ? finish(state, { winner: opponent(state.turn), reason: 'checkmate' })
    : finish(state, { winner: null, reason: 'stalemate' });
}

function applyGameMove(state: GameState, move: GameMove): MoveResult {
  const error = validatePseudo(state, move);
  if (error) return { ok: false, error };
  if (!keepsMarshalSafe(state, move, isInCheck(state.board, move.player))) {
    return { ok: false, error: MoveError.SELF_CHECK };
  }

  const tookMarshal = capturesMarshal(state, move);
  const next = execute(state, move);
  if (tookMarshal) {
    return { ok: true, state: finish(next, { winner: move.player, reason: 'marshalCaptured' }) };
  }
  return { ok: true, state: conclude(next) };
}

/**
 * Applies any move. Returns the next state or a rule-violation code.
 *
 * The move may be untrusted input; the state may not. It must keep the §12.1
 * invariants: on a corrupt state (e.g. restored from JSON without passing
 * `stateError`) this may throw instead of returning an error code.
 */
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
    default:
      return applyGameMove(state, move);
  }
}

/**
 * `null` if the move is legal, otherwise the reason it is not. Same state
 * precondition as `applyMove`.
 */
export function validateMove(state: GameState, move: Move): MoveError | null {
  const result = applyMove(state, move);
  return result.ok ? null : result.error;
}

/**
 * Every legal move for the side to move (placement or play phase). Terminal
 * actions (`resign`, `timeout`, `agreeDraw`) are always available and are not
 * listed. An empty list on an unfinished state means mate or stalemate that
 * has not been concluded (possible for `createPosition`, §12.1).
 *
 * Same state precondition as `applyMove`: it may throw on a state that breaks
 * the §12.1 invariants, so check restored states with `stateError` first.
 */
export function legalMoves(state: GameState): Move[] {
  return legalGameMoves(state);
}

export function isGameOver(state: GameState): boolean {
  return state.phase === 'finished';
}

/** §10.1 / §9.5 whether the side to move currently has its marshal under attack. */
export function inCheck(state: GameState): boolean {
  return state.phase !== 'finished' && isInCheck(state.board, state.turn);
}
