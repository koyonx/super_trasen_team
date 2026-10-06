import { BOARD_SIZE, MAX_STACK_HEIGHT } from '@gungi/shared';
import { allSquares, createEmptyBoard, getStack, isValidSquare, setStack } from './board';
import { PIECE_GLYPHS, ROSTER, emptyHand, isPieceKind, opponent } from './pieces';
import { ARMY_LIMIT } from './placing';
import { isInCheck } from './rules';
import type {
  Board,
  GameEndReason,
  GamePhase,
  GameState,
  Hand,
  Piece,
  PieceKind,
  PlayerSide,
  Square,
} from './types';
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

/** §12.1 reasons `createPosition` rejects a setup and `stateError` rejects a state. */
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
  /** `stateError` only: unknown phase, or a phase that contradicts `placementDone`. */
  INVALID_PHASE: 'INVALID_PHASE',
  /** `stateError` only: `result` missing, malformed or set outside the finished phase. */
  INVALID_RESULT: 'INVALID_RESULT',
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

const NO_CAPTURES: Readonly<Record<PlayerSide, readonly PieceKind[]>> = { black: [], white: [] };

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

/**
 * A dense copy of `value`, or `undefined` if it is not an array. Holes in a
 * sparse array become `undefined`, which the element checks then reject;
 * `every` would skip them and later loops would read them and throw.
 */
function denseArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? Array.from(value as unknown[]) : undefined;
}

/** Structural parse of `setup.stacks` into a board. Never throws. */
function parseStacks(value: unknown): Parsed<Board> {
  if (value === undefined) return { ok: true, value: createEmptyBoard() };
  const stacks = denseArray(value);
  if (!stacks) return fail(PositionError.MALFORMED);
  let board = createEmptyBoard();
  const seen = new Set<string>();
  for (const entry of stacks) {
    if (!isRecord(entry)) return fail(PositionError.MALFORMED);
    const { square } = entry;
    if (!isValidSquare(square)) return fail(PositionError.INVALID_SQUARE);
    const key = `${square.file},${square.rank}`;
    if (seen.has(key)) return fail(PositionError.DUPLICATE_SQUARE);
    seen.add(key);
    const pieces = denseArray(entry.pieces);
    if (!pieces?.every(isPiece)) return fail(PositionError.INVALID_PIECE);
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

/**
 * §3.1 / §3.3 / §9.3 material invariants. `captured` lists what each side
 * has taken; those pieces still count against their owner's roster.
 * `marshalRequired` tells whether the side must have its marshal on the
 * board (always in play; in placement once it has placed anything).
 */
function materialError(
  board: Board,
  hands: Readonly<Record<PlayerSide, Hand>>,
  captured: Readonly<Record<PlayerSide, readonly PieceKind[]>>,
  marshalRequired: (side: PlayerSide) => boolean,
): PositionError | null {
  for (const side of SIDES) {
    const marshals = countOnBoard(board, side, 'marshal');
    if (marshals > 1 || (marshals === 0 && marshalRequired(side))) {
      return PositionError.MARSHAL_COUNT;
    }
    if (countOnBoard(board, side) > ARMY_LIMIT) return PositionError.ARMY_LIMIT;
    const lost = captured[opponent(side)];
    for (const kind of PIECE_KINDS) {
      const total =
        countOnBoard(board, side, kind) + hands[side][kind] + lost.filter((k) => k === kind).length;
      if (total > ROSTER[kind]) return PositionError.ROSTER_EXCEEDED;
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
  return opponentCheckError(board, turn, atPlayStart && turn === 'white');
}

/** `OPPONENT_IN_CHECK` unless that is allowed here and the side to move is safe. */
function opponentCheckError(
  board: Board,
  turn: PlayerSide,
  allowed: boolean,
): PositionError | null {
  if (!isInCheck(board, opponent(turn))) return null;
  if (allowed && !isInCheck(board, turn)) return null;
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
    // A play-phase position always has both marshals on the board (§9.3, §11.1).
    materialError(board.value, hands.value, NO_CAPTURES, () => true) ??
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

const PHASES: ReadonlySet<unknown> = new Set<GamePhase>(['placement', 'play', 'finished']);

/** §11 end reasons and whether each one has a winner. */
const END_REASONS: Readonly<Record<GameEndReason, boolean>> = {
  marshalCaptured: true,
  checkmate: true,
  stalemate: false,
  fiftyMoveRule: false,
  resignation: true,
  timeout: true,
  agreement: false,
};

/** A full `board[rank][file]` grid of piece arrays, as a dense copy. Never throws. */
function parseBoard(value: unknown): Parsed<Board> {
  const grid = (v: unknown): unknown[] | undefined => {
    const arr = denseArray(v);
    return arr?.length === BOARD_SIZE ? arr : undefined;
  };
  const rows = grid(value)?.map(grid);
  if (!rows?.every((row) => row !== undefined)) return fail(PositionError.MALFORMED);
  const cells = rows.map((row) => row.map(denseArray));
  if (!cells.every((row) => row.every((stack) => stack !== undefined))) {
    return fail(PositionError.MALFORMED);
  }
  const board = cells as unknown[][][];
  if (!board.every((row) => row.every((stack) => stack.every(isPiece)))) {
    return fail(PositionError.INVALID_PIECE);
  }
  return { ok: true, value: board as Board };
}

/** A hand listing every piece kind exactly once. Never throws. */
function parseFullHand(hand: unknown): Parsed<Hand> {
  if (!isRecord(hand)) return fail(PositionError.MALFORMED);
  if (!Object.keys(hand).every(isPieceKind)) return fail(PositionError.INVALID_PIECE);
  if (!PIECE_KINDS.every((kind) => isCount(hand[kind]))) return fail(PositionError.INVALID_COUNT);
  return { ok: true, value: hand as Hand };
}

/** A `{ black, white }` pair whose two values pass `parse`. Never throws. */
function parsePair<T>(
  value: unknown,
  parse: (side: unknown) => Parsed<T>,
): Parsed<Record<PlayerSide, T>> {
  if (!isRecord(value)) return fail(PositionError.MALFORMED);
  const black = parse(value.black);
  if (!black.ok) return black;
  const white = parse(value.white);
  if (!white.ok) return white;
  return { ok: true, value: { black: black.value, white: white.value } };
}

const parseFlag = (value: unknown): Parsed<boolean> =>
  typeof value === 'boolean' ? { ok: true, value } : fail(PositionError.MALFORMED);

function parseCaptured(value: unknown): Parsed<readonly PieceKind[]> {
  const captured = denseArray(value);
  if (!captured) return fail(PositionError.MALFORMED);
  if (!captured.every(isPieceKind)) return fail(PositionError.INVALID_PIECE);
  return { ok: true, value: captured as PieceKind[] };
}

function resultError(phase: GamePhase, result: unknown): PositionError | null {
  if (phase !== 'finished') return result === null ? null : PositionError.INVALID_RESULT;
  if (!isRecord(result) || typeof result.reason !== 'string') return PositionError.INVALID_RESULT;
  if (!Object.hasOwn(END_REASONS, result.reason)) return PositionError.INVALID_RESULT;
  const hasWinner = END_REASONS[result.reason as GameEndReason];
  const ok = hasWinner ? isSide(result.winner) : result.winner === null;
  return ok ? null : PositionError.INVALID_RESULT;
}

/**
 * §12.1 why `state` is not a game state the engine can work with, or `null`.
 * Never throws, whatever the input. Use it as the gate before handing a state
 * restored from storage or the network to `applyMove` / `legalMoves`, which
 * assume a well-formed state and may throw on a corrupt one.
 *
 * Checks the shape of every field, the result against the phase, the board
 * invariants of `positionError` and phase-aware material: in placement a
 * side has its marshal once it has placed anything (§9.2), in play both
 * marshals are on the board, and captured pieces count against the roster.
 * The side not to move may be in check in placement once that side has
 * finished (§9.5), and in play at the position right after placement
 * (§11.1). For the latter only necessary conditions are checked: white to
 * move, no quiet ply, no capture yet, and `ply` either 0 (`createPosition`)
 * or the pieces on the board plus 2 (one ply per `place`, one per
 * `finishPlacement`). A forged state can still pass, e.g. one where only
 * capture-free drops followed placement, since each drop also adds one ply
 * and one piece and resets the quiet-ply counter. Like `positionError` it
 * accepts an unconcluded mate, stalemate or quiet-ply counter past the
 * limit, and it does not replay history.
 */
export function stateError(state: unknown): PositionError | null {
  if (!isRecord(state)) return PositionError.MALFORMED;
  const { phase, turn } = state;
  if (!PHASES.has(phase)) return PositionError.INVALID_PHASE;
  if (!isSide(turn)) return PositionError.INVALID_TURN;
  if (!isCount(state.ply) || !isCount(state.quietPlies)) return PositionError.INVALID_COUNT;
  const board = parseBoard(state.board);
  if (!board.ok) return board.error;
  const hands = parsePair(state.hands, parseFullHand);
  if (!hands.ok) return hands.error;
  const done = parsePair(state.placementDone, parseFlag);
  if (!done.ok) return done.error;
  const captured = parsePair(state.captured, parseCaptured);
  if (!captured.ok) return captured.error;
  const gamePhase = phase as GamePhase;
  const resultErr = resultError(gamePhase, state.result);
  if (resultErr) return resultErr;

  // §9.3 / §9.4 play starts once both sides have finished placing, and the
  // turn never goes to a side that has finished.
  const bothDone = done.value.black && done.value.white;
  if ((gamePhase === 'play' && !bothDone) || (gamePhase === 'placement' && bothDone)) {
    return PositionError.INVALID_PHASE;
  }
  if (gamePhase === 'placement' && done.value[turn]) return PositionError.INVALID_TURN;

  const marshalRequired = (side: PlayerSide): boolean => {
    if (gamePhase === 'play') return true;
    if (gamePhase === 'finished') return false;
    return done.value[side] || countOnBoard(board.value, side) > 0;
  };
  const error =
    boardError(board.value) ??
    materialError(board.value, hands.value, captured.value, marshalRequired);
  if (error) return error;

  if (gamePhase === 'placement') {
    return opponentCheckError(board.value, turn, done.value[opponent(turn)]);
  }
  if (gamePhase === 'play') {
    const noCaptures = captured.value.black.length === 0 && captured.value.white.length === 0;
    // `createPosition` starts at ply 0. `createInitialState` starts there too,
    // and each `place` adds one ply and one piece, plus one ply per side for
    // `finishPlacement`, so play starts at ply = pieces on board + 2.
    const onBoard = countOnBoard(board.value, 'black') + countOnBoard(board.value, 'white');
    const startPly = state.ply === 0 || state.ply === onBoard + 2;
    return checkError(board.value, turn, state.quietPlies === 0 && noCaptures && startPly);
  }
  return null;
}
