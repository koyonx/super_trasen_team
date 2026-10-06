import { BOARD_SIZE, MAX_STACK_HEIGHT } from '@gungi/shared';
import { allSquares, createEmptyBoard, getStack, isValidSquare, setStack } from './board';
import { ROSTER, emptyHand, handTotal, isPieceKind, opponent } from './pieces';
import { REPETITION_LIMIT, isPositionHash, positionHash, recordPosition } from './repetition';
import { isInCheck } from './rules';
import type {
  Board,
  GameEndReason,
  GamePhase,
  GameResult,
  GameState,
  Hand,
  Piece,
  PieceKind,
  PlayerSide,
  Square,
} from './types';
import { PIECE_KINDS } from './types';

export interface PositionSetup {
  /** Stacks to put on an otherwise empty board (pieces bottom to top). */
  readonly stacks?: readonly { readonly square: Square; readonly pieces: readonly Piece[] }[];
  /** Hand contents; unspecified kinds default to 0. */
  readonly hands?: Partial<Record<PlayerSide, Partial<Hand>>>;
  readonly turn?: PlayerSide;
  /** §9.1 the first player of the game (default black). Does not affect play-phase rules. */
  readonly firstPlayer?: PlayerSide;
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
  ROSTER_EXCEEDED: 'ROSTER_EXCEEDED',
  INVALID_COUNT: 'INVALID_COUNT',
  INVALID_TURN: 'INVALID_TURN',
  /** §10.1 the side not to move is in check, which no legal move leaves behind. */
  OPPONENT_IN_CHECK: 'OPPONENT_IN_CHECK',
  /** `stateError` only: unknown phase, or a phase that contradicts `placementDone`. */
  INVALID_PHASE: 'INVALID_PHASE',
  /** `stateError` only: `result` missing, malformed or set outside the finished phase. */
  INVALID_RESULT: 'INVALID_RESULT',
  /** `stateError` only: `positionCounts` contradicts the phase or the current position (§11.4). */
  INVALID_HISTORY: 'INVALID_HISTORY',
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
 * §3.1 / §9.3 material invariants. `captured` lists what each side
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
 * move is not in check. In placement the first player may have finished and
 * then be checked by the second player's placements, which it cannot answer
 * (§9.5, §9.6); `allowed` tells whether the position is such a one. There is
 * no exception in play: play starts with the first player to move, and the
 * second player can only end placement while not in check (§9.3, §9.5), so
 * the side not to move is never in check, whoever moves first.
 */
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
  readonly firstPlayer: PlayerSide;
}

/** Parses and validates a setup into fresh data. Never throws. */
function parseSetup(setup: unknown): Parsed<ParsedSetup> {
  if (!isRecord(setup)) return fail(PositionError.MALFORMED);
  const { turn = 'black', firstPlayer = 'black' } = setup;
  if (!isSide(turn) || !isSide(firstPlayer)) return fail(PositionError.INVALID_TURN);
  const board = parseStacks(setup.stacks);
  if (!board.ok) return board;
  const hands = parseHands(setup.hands);
  if (!hands.ok) return hands;
  const error =
    boardError(board.value) ??
    // A play-phase position always has both marshals on the board (§9.3, §11.1).
    materialError(board.value, hands.value, NO_CAPTURES, () => true) ??
    opponentCheckError(board.value, turn, false);
  if (error) return fail(error);
  return {
    ok: true,
    value: { board: board.value, hands: hands.value, turn, firstPlayer },
  };
}

/**
 * §12.1 why `setup` does not describe a reachable play-phase position, or
 * `null`. Never throws, whatever the input (it may come straight from JSON).
 * Checks only invariants every legal game keeps: the shape of the setup,
 * square validity, stack height, one marshal per side on top of its stack,
 * the roster and that the side not to move is not in check.
 *
 * Not checked: mate or stalemate (returned unconcluded; see `legalMoves`)
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
  const { board, hands, turn, firstPlayer } = parsed.value;
  const state: GameState = {
    phase: 'play',
    board,
    hands,
    turn,
    firstPlayer,
    placementDone: { black: true, white: true },
    captured: { black: [], white: [] },
    ply: 0,
    positionCounts: {},
    result: null,
  };
  // §11.4 the given position is the first occurrence.
  return recordPosition(state, true);
}

const PHASES: ReadonlySet<unknown> = new Set<GamePhase>(['placement', 'play', 'finished']);

/** §11 end reasons and whether each one has a winner. */
const END_REASONS: Readonly<Record<GameEndReason, boolean>> = {
  marshalCaptured: true,
  checkmate: true,
  stalemate: false,
  fourfoldRepetition: false,
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

/** A `positionCounts` record: string keys, counts of at least 1. Never throws. */
function parseCounts(value: unknown): Parsed<Readonly<Record<string, number>>> {
  if (!isRecord(value)) return fail(PositionError.MALFORMED);
  if (!Object.values(value).every((n) => isCount(n) && n >= 1)) {
    return fail(PositionError.INVALID_COUNT);
  }
  return { ok: true, value: value as Record<string, number> };
}

/**
 * §11.4 `positionCounts` against the phase and the current position: every
 * key is a `positionHash`; empty in placement; in play the current position
 * (by hash) has appeared and no position more than 3 times (the 4th ends the
 * game); after the end, a count of 4 only for the current position of a
 * `fourfoldRepetition` result, which needs it.
 */
function historyError(
  phase: GamePhase,
  counts: Readonly<Record<string, number>>,
  key: string,
  repeated: boolean,
): PositionError | null {
  const entries = Object.entries(counts);
  if (!entries.every(([k]) => isPositionHash(k))) return PositionError.INVALID_HISTORY;
  if (phase === 'placement') return entries.length === 0 ? null : PositionError.INVALID_HISTORY;
  const current = Object.hasOwn(counts, key) ? counts[key] : undefined;
  if (phase === 'play' && current === undefined) return PositionError.INVALID_HISTORY;
  if (repeated && current !== REPETITION_LIMIT) return PositionError.INVALID_HISTORY;
  const tooMany = entries.some(
    ([k, n]) => n >= REPETITION_LIMIT && !(repeated && k === key && n === REPETITION_LIMIT),
  );
  return tooMany ? PositionError.INVALID_HISTORY : null;
}

/**
 * §9.3 / §9.4 placement-phase consistency of `placementDone` and the turn.
 * The second player finishing ends the phase, a side with an empty hand has
 * finished (R-7), the turn never goes to a side that has finished, and while
 * neither side has finished every ply was a `place` alternating from the
 * first player, so the first player has placed as many pieces as the second
 * (its turn) or one more (the second player's turn).
 */
function placementError(
  board: Board,
  hands: Readonly<Record<PlayerSide, Hand>>,
  done: Readonly<Record<PlayerSide, boolean>>,
  turn: PlayerSide,
  firstPlayer: PlayerSide,
): PositionError | null {
  const second = opponent(firstPlayer);
  if (done[second]) return PositionError.INVALID_PHASE;
  if (SIDES.some((side) => !done[side] && handTotal(hands[side]) === 0)) {
    return PositionError.INVALID_PHASE;
  }
  if (done[turn]) return PositionError.INVALID_TURN;
  if (!done[firstPlayer]) {
    const lead = countOnBoard(board, firstPlayer) - countOnBoard(board, second);
    if (lead !== (turn === firstPlayer ? 0 : 1)) return PositionError.INVALID_TURN;
  }
  return null;
}

/**
 * §12.1 why `state` is not a game state the engine can work with, or `null`.
 * Never throws, whatever the input. Use it as the gate before handing a state
 * restored from storage or the network to `applyMove` / `legalMoves`, which
 * assume a well-formed state and may throw on a corrupt one.
 *
 * Checks the shape of every field, the result against the phase, the board
 * invariants of `positionError`, phase-aware material (in placement a side
 * has its marshal once it has placed anything (§9.2), in play both marshals
 * are on the board, and captured pieces count against the roster), the
 * placement turn order for either first player (`placementError`), the
 * repetition counts (`historyError`) and that the side not to move is not in
 * check. The latter is allowed only in placement, for a first player that
 * has finished (§9.5, §9.6). Like `positionError` it accepts an unconcluded
 * mate or stalemate, and it does not replay history.
 */
export function stateError(state: unknown): PositionError | null {
  if (!isRecord(state)) return PositionError.MALFORMED;
  const { phase, turn, firstPlayer } = state;
  if (!PHASES.has(phase)) return PositionError.INVALID_PHASE;
  if (!isSide(turn) || !isSide(firstPlayer)) return PositionError.INVALID_TURN;
  if (!isCount(state.ply)) return PositionError.INVALID_COUNT;
  const board = parseBoard(state.board);
  if (!board.ok) return board.error;
  const hands = parsePair(state.hands, parseFullHand);
  if (!hands.ok) return hands.error;
  const done = parsePair(state.placementDone, parseFlag);
  if (!done.ok) return done.error;
  const captured = parsePair(state.captured, parseCaptured);
  if (!captured.ok) return captured.error;
  const counts = parseCounts(state.positionCounts);
  if (!counts.ok) return counts.error;
  const gamePhase = phase as GamePhase;
  const resultErr = resultError(gamePhase, state.result);
  if (resultErr) return resultErr;

  // §9.4 play starts once placement has ended, which marks both sides done.
  const bothDone = done.value.black && done.value.white;
  if (gamePhase === 'play' && !bothDone) return PositionError.INVALID_PHASE;
  if (gamePhase === 'placement') {
    const error = placementError(board.value, hands.value, done.value, turn, firstPlayer);
    if (error) return error;
  }

  const marshalRequired = (side: PlayerSide): boolean => {
    if (gamePhase === 'play') return true;
    if (gamePhase === 'finished') return false;
    return done.value[side] || countOnBoard(board.value, side) > 0;
  };
  const error =
    boardError(board.value) ??
    materialError(board.value, hands.value, captured.value, marshalRequired);
  if (error) return error;

  if (gamePhase !== 'finished') {
    const waiting = gamePhase === 'placement' && done.value[opponent(turn)];
    const checkErr = opponentCheckError(board.value, turn, waiting);
    if (checkErr) return checkErr;
  }
  const repeated = (state.result as GameResult | null)?.reason === 'fourfoldRepetition';
  const key = positionHash({ board: board.value, hands: hands.value, turn });
  return historyError(gamePhase, counts.value, key, repeated);
}
