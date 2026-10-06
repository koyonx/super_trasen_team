import { MAX_STACK_HEIGHT } from '@gungi/shared';
import { allSquares, createEmptyBoard, getStack, isValidSquare, setStack } from './board';
import { PIECE_GLYPHS, ROSTER, emptyHand, isPieceKind } from './pieces';
import { ARMY_LIMIT } from './placing';
import type { GameState, Hand, Piece, PieceKind, PlayerSide, Square } from './types';
import { PIECE_KINDS } from './types';

function handKey(hand: Hand): string {
  return PIECE_KINDS.map((k) => hand[k]).join('');
}

/**
 * §12.1 canonical key identifying a position: board, both hands and side to
 * move. Black pieces are prefixed with `+`, white with `-`.
 *
 * Intended for kifu storage, analysis and AI transposition tables. The rules
 * themselves never use it: there is no repetition rule (§15), so two equal
 * keys mean nothing to `applyMove`.
 */
export function positionKey(state: Pick<GameState, 'board' | 'hands' | 'turn'>): string {
  const squares = allSquares().map((sq) =>
    getStack(state.board, sq)
      .map((p) => (p.owner === 'black' ? '+' : '-') + PIECE_GLYPHS[p.kind])
      .join(''),
  );
  return [
    squares.join('/'),
    handKey(state.hands.black),
    handKey(state.hands.white),
    state.turn === 'black' ? 'b' : 'w',
  ].join(' ');
}

export interface PositionSetup {
  /** Stacks to put on an otherwise empty board (pieces bottom to top). */
  readonly stacks?: readonly { readonly square: Square; readonly pieces: readonly Piece[] }[];
  /** Hand contents; unspecified kinds default to 0. */
  readonly hands?: Partial<Record<PlayerSide, Partial<Hand>>>;
  readonly turn?: PlayerSide;
  /** §11.4 quiet-ply counter to start from (default 0). */
  readonly quietPlies?: number;
}

/** §12.1 reasons `createPosition` rejects a setup. */
export const PositionError = {
  INVALID_SQUARE: 'INVALID_SQUARE',
  DUPLICATE_SQUARE: 'DUPLICATE_SQUARE',
  INVALID_PIECE: 'INVALID_PIECE',
  STACK_TOO_HIGH: 'STACK_TOO_HIGH',
  MARSHAL_COUNT: 'MARSHAL_COUNT',
  MARSHAL_NOT_ON_TOP: 'MARSHAL_NOT_ON_TOP',
  ARMY_LIMIT: 'ARMY_LIMIT',
  ROSTER_EXCEEDED: 'ROSTER_EXCEEDED',
  INVALID_COUNT: 'INVALID_COUNT',
  INVALID_TURN: 'INVALID_TURN',
} as const;

export type PositionError = (typeof PositionError)[keyof typeof PositionError];

/** Thrown by `createPosition` when the setup breaks a board invariant. */
export class InvalidPositionError extends Error {
  constructor(readonly reason: PositionError) {
    super(`invalid position: ${reason}`);
    this.name = 'InvalidPositionError';
  }
}

const SIDES: readonly PlayerSide[] = ['black', 'white'];

function isSide(value: unknown): value is PlayerSide {
  return value === 'black' || value === 'white';
}

function isPiece(value: unknown): value is Piece {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, owner } = value as Record<string, unknown>;
  return isPieceKind(kind) && isSide(owner);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function stacksError(setup: PositionSetup): PositionError | null {
  const seen = new Set<string>();
  for (const { square, pieces } of setup.stacks ?? []) {
    if (!isValidSquare(square)) return PositionError.INVALID_SQUARE;
    const key = `${square.file},${square.rank}`;
    if (seen.has(key)) return PositionError.DUPLICATE_SQUARE;
    seen.add(key);
    if (!Array.isArray(pieces) || !pieces.every(isPiece)) return PositionError.INVALID_PIECE;
    if (pieces.length > MAX_STACK_HEIGHT) return PositionError.STACK_TOO_HIGH;
    // §4.4 nothing ever sits on a marshal, captures included (§6.4).
    if (pieces.slice(0, -1).some((p) => p.kind === 'marshal')) {
      return PositionError.MARSHAL_NOT_ON_TOP;
    }
  }
  return null;
}

function countsError(setup: PositionSetup): PositionError | null {
  const onBoard = (side: PlayerSide, kind?: PieceKind): number =>
    (setup.stacks ?? []).reduce(
      (n, { pieces }) =>
        n + pieces.filter((p) => p.owner === side && (!kind || p.kind === kind)).length,
      0,
    );
  for (const side of SIDES) {
    const hand: Record<string, unknown> = setup.hands?.[side] ?? {};
    for (const [kind, count] of Object.entries(hand)) {
      if (!isPieceKind(kind)) return PositionError.INVALID_PIECE;
      if (!isCount(count)) return PositionError.INVALID_COUNT;
    }
    // A play-phase position always has both marshals on the board (§9.3, §11.1).
    if (onBoard(side, 'marshal') !== 1) return PositionError.MARSHAL_COUNT;
    if (onBoard(side) > ARMY_LIMIT) return PositionError.ARMY_LIMIT;
    for (const kind of PIECE_KINDS) {
      const inHand = (hand[kind] as number | undefined) ?? 0;
      if (onBoard(side, kind) + inHand > ROSTER[kind]) return PositionError.ROSTER_EXCEEDED;
    }
  }
  return null;
}

/**
 * §12.1 why `setup` does not describe a reachable play-phase position, or
 * `null`. Checks only invariants every legal game keeps: square validity,
 * stack height, one marshal per side on top of its stack, the army limit and
 * the roster. A fortress above tier 1 is allowed (§4.5, reached by capture).
 */
export function positionError(setup: PositionSetup): PositionError | null {
  if (setup.turn !== undefined && !isSide(setup.turn)) return PositionError.INVALID_TURN;
  if (setup.quietPlies !== undefined && !isCount(setup.quietPlies)) {
    return PositionError.INVALID_COUNT;
  }
  return stacksError(setup) ?? countsError(setup);
}

/**
 * Builds a play-phase state from an arbitrary position (tests, AI, kifu import).
 *
 * Throws `InvalidPositionError` when the setup breaks an invariant checked by
 * `positionError`; a corrupt state would otherwise surface later as wrong
 * rulings. Callers handling untrusted input can call `positionError` first.
 */
export function createPosition(setup: PositionSetup): GameState {
  const error = positionError(setup);
  if (error) throw new InvalidPositionError(error);
  let board = createEmptyBoard();
  for (const { square, pieces } of setup.stacks ?? []) {
    board = setStack(board, square, [...pieces]);
  }
  const hand = (side: PlayerSide): Hand => ({ ...emptyHand(), ...setup.hands?.[side] });
  return {
    phase: 'play',
    board,
    hands: { black: hand('black'), white: hand('white') },
    turn: setup.turn ?? 'black',
    placementDone: { black: true, white: true },
    captured: { black: [], white: [] },
    ply: 0,
    quietPlies: setup.quietPlies ?? 0,
    result: null,
  };
}
