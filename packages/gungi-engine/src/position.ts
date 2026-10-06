import { MAX_STACK_HEIGHT } from '@gungi/shared';
import { allSquares, createEmptyBoard, getStack, isValidSquare, setStack } from './board';
import { PIECE_GLYPHS, ROSTER, emptyHand, isPieceKind, opponent } from './pieces';
import { ARMY_LIMIT } from './placing';
import { isInCheck } from './rules';
import type { Board, GameState, Hand, Piece, PieceKind, PlayerSide, Square } from './types';
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
  /** Not the expected shape (e.g. `stacks` is not an array, a hand is not an object). */
  MALFORMED: 'MALFORMED',
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
  /** §10.1 the side not to move is in check, which no legal move leaves behind. */
  OPPONENT_IN_CHECK: 'OPPONENT_IN_CHECK',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSide(value: unknown): value is PlayerSide {
  return value === 'black' || value === 'white';
}

function isPiece(value: unknown): value is Piece {
  if (!isRecord(value)) return false;
  return isPieceKind(value.kind) && isSide(value.owner);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: PositionError };

const fail = (error: PositionError): Parsed<never> => ({ ok: false, error });

/** Structural parse of `setup.stacks` into a board. Never throws. */
function parseStacks(stacks: unknown): Parsed<Board> {
  if (stacks === undefined) return { ok: true, value: createEmptyBoard() };
  if (!Array.isArray(stacks)) return fail(PositionError.MALFORMED);
  let board = createEmptyBoard();
  const seen = new Set<string>();
  for (const entry of stacks as unknown[]) {
    if (!isRecord(entry)) return fail(PositionError.MALFORMED);
    const { square, pieces } = entry;
    if (!isValidSquare(square)) return fail(PositionError.INVALID_SQUARE);
    const key = `${square.file},${square.rank}`;
    if (seen.has(key)) return fail(PositionError.DUPLICATE_SQUARE);
    seen.add(key);
    if (!Array.isArray(pieces) || !pieces.every(isPiece)) return fail(PositionError.INVALID_PIECE);
    board = setStack(
      board,
      square,
      pieces.map((p: Piece) => ({ kind: p.kind, owner: p.owner })),
    );
  }
  return { ok: true, value: board };
}

/** Structural parse of one side's partial hand. Never throws. */
function parseHand(hand: unknown): Parsed<Hand> {
  if (hand === undefined) return { ok: true, value: emptyHand() };
  if (!isRecord(hand)) return fail(PositionError.MALFORMED);
  const out: Record<PieceKind, number> = { ...emptyHand() };
  for (const [kind, count] of Object.entries(hand)) {
    if (!isPieceKind(kind)) return fail(PositionError.INVALID_PIECE);
    if (!isCount(count)) return fail(PositionError.INVALID_COUNT);
    out[kind] = count;
  }
  return { ok: true, value: out };
}

function parseHands(hands: unknown): Parsed<Record<PlayerSide, Hand>> {
  if (hands !== undefined && !isRecord(hands)) return fail(PositionError.MALFORMED);
  const black = parseHand(hands?.black);
  if (!black.ok) return black;
  const white = parseHand(hands?.white);
  if (!white.ok) return white;
  return { ok: true, value: { black: black.value, white: white.value } };
}

/** §4.1 / §4.4 per-stack invariants on a structurally valid board. */
function boardError(board: Board): PositionError | null {
  for (const sq of allSquares()) {
    const stack = getStack(board, sq);
    if (stack.length > MAX_STACK_HEIGHT) return PositionError.STACK_TOO_HIGH;
    // §4.4 nothing ever sits on a marshal, captures included (§6.4).
    if (stack.slice(0, -1).some((p) => p.kind === 'marshal')) {
      return PositionError.MARSHAL_NOT_ON_TOP;
    }
  }
  return null;
}

function countOnBoard(board: Board, side: PlayerSide, kind?: PieceKind): number {
  let n = 0;
  for (const sq of allSquares()) {
    for (const p of getStack(board, sq)) if (p.owner === side && (!kind || p.kind === kind)) n++;
  }
  return n;
}

/** §3.1 / §3.3 / §9.3 material invariants of a play-phase position. */
function materialError(
  board: Board,
  hands: Readonly<Record<PlayerSide, Hand>>,
): PositionError | null {
  for (const side of SIDES) {
    // A play-phase position always has both marshals on the board (§9.3, §11.1).
    if (countOnBoard(board, side, 'marshal') !== 1) return PositionError.MARSHAL_COUNT;
    if (countOnBoard(board, side) > ARMY_LIMIT) return PositionError.ARMY_LIMIT;
    for (const kind of PIECE_KINDS) {
      if (countOnBoard(board, side, kind) + hands[side][kind] > ROSTER[kind]) {
        return PositionError.ROSTER_EXCEEDED;
      }
    }
  }
  return null;
}

/**
 * §10.1 a move never leaves the mover's marshal attacked, so the side not to
 * move is not in check. The one exception is the first move of the play
 * phase (§11.1): black may finish placing first, after which white can place
 * pieces that attack black's marshal and then finish itself. Such a position
 * has white to move, white not in check (§9.5) and a fresh quiet-ply counter
 * (`finishPlacement` resets it, §11.4); `atPlayStart` tells whether the
 * position can be that one.
 */
function checkError(board: Board, turn: PlayerSide, atPlayStart: boolean): PositionError | null {
  if (!isInCheck(board, opponent(turn))) return null;
  if (atPlayStart && turn === 'white' && !isInCheck(board, turn)) return null;
  return PositionError.OPPONENT_IN_CHECK;
}

interface ParsedSetup {
  readonly board: Board;
  readonly hands: Readonly<Record<PlayerSide, Hand>>;
  readonly turn: PlayerSide;
  readonly quietPlies: number;
}

/** Parses and validates a setup into fresh data. Never throws. */
function parseSetup(setup: unknown): Parsed<ParsedSetup> {
  if (!isRecord(setup)) return fail(PositionError.MALFORMED);
  const { turn = 'black', quietPlies = 0 } = setup;
  if (!isSide(turn)) return fail(PositionError.INVALID_TURN);
  if (!isCount(quietPlies)) return fail(PositionError.INVALID_COUNT);
  const board = parseStacks(setup.stacks);
  if (!board.ok) return board;
  const hands = parseHands(setup.hands);
  if (!hands.ok) return hands;
  const error =
    boardError(board.value) ??
    materialError(board.value, hands.value) ??
    checkError(board.value, turn, quietPlies === 0);
  if (error) return fail(error);
  return { ok: true, value: { board: board.value, hands: hands.value, turn, quietPlies } };
}

/**
 * §12.1 why `setup` does not describe a reachable play-phase position, or
 * `null`. Never throws, whatever the input (it may come straight from JSON).
 * Checks only invariants every legal game keeps: the shape of the setup,
 * square validity, stack height, one marshal per side on top of its stack,
 * the army limit, the roster and that the side not to move is not in check.
 * A fortress above tier 1 is allowed (§4.5, reached by capture).
 *
 * Not checked: a quiet-ply counter above `QUIET_PLY_LIMIT` (the next quiet
 * move draws), mate or stalemate (returned unconcluded; see `legalMoves`)
 * and anything that depends on how the position was reached.
 */
export function positionError(setup: PositionSetup): PositionError | null {
  const parsed = parseSetup(setup);
  return parsed.ok ? null : parsed.error;
}

/**
 * Builds a play-phase state from an arbitrary position (tests, AI, kifu import).
 *
 * Throws `InvalidPositionError` when the setup breaks an invariant checked by
 * `positionError`; a corrupt state would otherwise surface later as wrong
 * rulings. Callers handling untrusted input can call `positionError` first.
 * The state never shares arrays or objects with `setup`.
 */
export function createPosition(setup: PositionSetup): GameState {
  const parsed = parseSetup(setup);
  if (!parsed.ok) throw new InvalidPositionError(parsed.error);
  const { board, hands, turn, quietPlies } = parsed.value;
  return {
    phase: 'play',
    board,
    hands,
    turn,
    placementDone: { black: true, white: true },
    captured: { black: [], white: [] },
    ply: 0,
    quietPlies,
    result: null,
  };
}
