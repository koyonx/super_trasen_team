/**
 * Core data types of the Gungi engine.
 *
 * Every type here is plain JSON data (no classes, Maps or Sets) so a GameState
 * can be sent over WebSocket and persisted as JSONB without conversion.
 * Section references (§) point to docs/GUNGI_RULES.md.
 */

import type { PlayerSide, Square } from '@gungi/shared';

export type { PlayerSide, Square };

/** §3.1 piece kinds. */
export const PIECE_KINDS = [
  'marshal',
  'general',
  'lieutenant',
  'major',
  'samurai',
  'knight',
  'shinobi',
  'fortress',
  'pawn',
  'cannon',
  'archer',
  'musket',
  'tactician',
] as const;

export type PieceKind = (typeof PIECE_KINDS)[number];

export interface Piece {
  readonly kind: PieceKind;
  readonly owner: PlayerSide;
}

/** Pieces on one square, ordered bottom (index 0) to top. */
export type Stack = readonly Piece[];

/** `board[rank][file]`. */
export type Board = readonly (readonly Stack[])[];

/** Count of each piece kind held in hand. */
export type Hand = Readonly<Record<PieceKind, number>>;

export type GamePhase = 'placement' | 'play' | 'finished';

export type GameEndReason =
  | 'marshalCaptured'
  | 'checkmate'
  | 'stalemate'
  | 'repetition'
  | 'resignation'
  | 'timeout'
  | 'agreement';

export interface GameResult {
  /** `null` for a draw. */
  readonly winner: PlayerSide | null;
  readonly reason: GameEndReason;
}

export interface GameState {
  readonly phase: GamePhase;
  readonly board: Board;
  readonly hands: Readonly<Record<PlayerSide, Hand>>;
  readonly turn: PlayerSide;
  /** §9.3 whether each side has finished the placement phase. */
  readonly placementDone: Readonly<Record<PlayerSide, boolean>>;
  /** Pieces removed from the game, keyed by the side that removed them. */
  readonly captured: Readonly<Record<PlayerSide, readonly PieceKind[]>>;
  /** Number of moves applied so far (all phases). */
  readonly ply: number;
  /** §11.4 occurrence count of each play-phase position key. */
  readonly positionCounts: Readonly<Record<string, number>>;
  readonly result: GameResult | null;
}

export interface PlaceMove {
  readonly type: 'place';
  readonly player: PlayerSide;
  readonly kind: PieceKind;
  readonly to: Square;
}

export interface FinishPlacementMove {
  readonly type: 'finishPlacement';
  readonly player: PlayerSide;
}

export interface BoardMove {
  readonly type: 'move' | 'capture' | 'stack';
  readonly player: PlayerSide;
  readonly from: Square;
  readonly to: Square;
}

export interface DropMove {
  readonly type: 'drop';
  readonly player: PlayerSide;
  readonly kind: PieceKind;
  readonly to: Square;
}

export interface ResignMove {
  readonly type: 'resign';
  readonly player: PlayerSide;
}

export interface TimeoutMove {
  readonly type: 'timeout';
  /** The side that ran out of time (loses). */
  readonly player: PlayerSide;
}

export interface AgreeDrawMove {
  readonly type: 'agreeDraw';
}

export type Move =
  PlaceMove | FinishPlacementMove | BoardMove | DropMove | ResignMove | TimeoutMove | AgreeDrawMove;

/** §12.3 rule-violation codes. */
export const MoveError = {
  GAME_FINISHED: 'GAME_FINISHED',
  WRONG_PHASE: 'WRONG_PHASE',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  INVALID_SQUARE: 'INVALID_SQUARE',
  NOT_IN_HAND: 'NOT_IN_HAND',
  MARSHAL_FIRST: 'MARSHAL_FIRST',
  OUTSIDE_TERRITORY: 'OUTSIDE_TERRITORY',
  OUTSIDE_DROP_ZONE: 'OUTSIDE_DROP_ZONE',
  OCCUPIED_BY_ENEMY: 'OCCUPIED_BY_ENEMY',
  STACK_FULL: 'STACK_FULL',
  CANNOT_STACK_ON_MARSHAL: 'CANNOT_STACK_ON_MARSHAL',
  FORTRESS_CANNOT_STACK: 'FORTRESS_CANNOT_STACK',
  NO_PIECE: 'NO_PIECE',
  NOT_YOUR_PIECE: 'NOT_YOUR_PIECE',
  UNREACHABLE: 'UNREACHABLE',
  TARGET_NOT_EMPTY: 'TARGET_NOT_EMPTY',
  TARGET_EMPTY: 'TARGET_EMPTY',
  CANNOT_CAPTURE_OWN: 'CANNOT_CAPTURE_OWN',
  SELF_CHECK: 'SELF_CHECK',
  INVALID_MOVE: 'INVALID_MOVE',
} as const;

export type MoveError = (typeof MoveError)[keyof typeof MoveError];

export type MoveResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly error: MoveError };
