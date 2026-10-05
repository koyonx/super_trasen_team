/**
 * Gungi rule engine (server-authoritative).
 *
 * Implements docs/GUNGI_RULES.md as pure functions over immutable, plain JSON
 * state. Consumed by:
 *  - server: authoritative move validation (`applyMove`)
 *  - client: pre-validation and UI hints (`legalMoves`, `validateMove`)
 *  - AI: search over legal moves
 */

import { BOARD_SIZE, MAX_STACK_HEIGHT } from '@gungi/shared';

export { BOARD_SIZE, MAX_STACK_HEIGHT };

export type {
  AgreeDrawMove,
  Board,
  BoardMove,
  DropMove,
  FinishPlacementMove,
  GameEndReason,
  GamePhase,
  GameResult,
  GameState,
  Hand,
  Move,
  MoveResult,
  Piece,
  PieceKind,
  PlaceMove,
  PlayerSide,
  ResignMove,
  Square,
  Stack,
  TimeoutMove,
} from './types';
export { MoveError, PIECE_KINDS } from './types';

export { PIECE_GLYPHS, ROSTER, opponent } from './pieces';
export { getStack, topPiece, isInDropZone, isInTerritory } from './board';
export { MOVE_RULES, reachableSquares } from './movement';
export type { Direction, MoveRule, TieredRules } from './movement';
export { ARMY_LIMIT } from './placing';
export { createInitialState } from './setup';
export {
  InvalidPositionError,
  PositionError,
  createPosition,
  positionError,
  positionKey,
} from './position';
export type { PositionSetup } from './position';
export {
  QUIET_PLY_LIMIT,
  applyMove,
  inCheck,
  isGameOver,
  legalMoves,
  validateMove,
} from './engine';
