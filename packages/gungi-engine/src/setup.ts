/**
 * Initial free-placement phase (§9).
 */

import {
  allSquares,
  createEmptyBoard,
  findMarshal,
  getStack,
  hasRoom,
  isInTerritory,
  isValidSquare,
  setStack,
  topPiece,
} from './board';
import { ROSTER, handTotal, isPieceKind, opponent, withHandDelta } from './pieces';
import { positionKey } from './position';
import type {
  FinishPlacementMove,
  GameState,
  Move,
  MoveResult,
  PieceKind,
  PlaceMove,
  PlayerSide,
} from './types';
import { MoveError, PIECE_KINDS } from './types';

/** §9.1 empty board, full hands, black to place. */
export function createInitialState(): GameState {
  return {
    phase: 'placement',
    board: createEmptyBoard(),
    hands: { black: { ...ROSTER }, white: { ...ROSTER } },
    turn: 'black',
    placementDone: { black: false, white: false },
    captured: { black: [], white: [] },
    ply: 0,
    positionCounts: {},
    result: null,
  };
}

export function hasPlacedMarshal(state: GameState, side: PlayerSide): boolean {
  return findMarshal(state.board, side) !== undefined;
}

/** Starts the play phase (§9.4): black moves first, repetition counting begins. */
function startPlay(state: GameState): GameState {
  const next: GameState = {
    ...state,
    phase: 'play',
    turn: 'black',
    placementDone: { black: true, white: true },
  };
  return { ...next, positionCounts: { [positionKey(next)]: 1 } };
}

/** §9.4 hands the turn to whoever still places, or starts play. */
function advancePlacement(state: GameState, mover: PlayerSide): GameState {
  const done = state.placementDone;
  if (done.black && done.white) return startPlay(state);
  const other = opponent(mover);
  return { ...state, turn: done[other] ? mover : other };
}

export function validatePlace(state: GameState, move: PlaceMove): MoveError | null {
  if (state.phase !== 'placement') return MoveError.WRONG_PHASE;
  if (move.player !== state.turn) return MoveError.NOT_YOUR_TURN;
  if (!isPieceKind(move.kind)) return MoveError.INVALID_MOVE;
  if (!isValidSquare(move.to)) return MoveError.INVALID_SQUARE;
  if (state.hands[move.player][move.kind] <= 0) return MoveError.NOT_IN_HAND;
  if (move.kind !== 'marshal' && !hasPlacedMarshal(state, move.player)) {
    return MoveError.MARSHAL_FIRST;
  }
  if (!isInTerritory(move.player, move.to.rank)) return MoveError.OUTSIDE_TERRITORY;
  const stack = getStack(state.board, move.to);
  const top = topPiece(stack);
  if (top) {
    if (top.owner !== move.player) return MoveError.OCCUPIED_BY_ENEMY;
    if (top.kind === 'marshal') return MoveError.CANNOT_STACK_ON_MARSHAL;
    if (!hasRoom(stack)) return MoveError.STACK_FULL;
  }
  return null;
}

function applyPlace(state: GameState, move: PlaceMove): MoveResult {
  const error = validatePlace(state, move);
  if (error) return { ok: false, error };
  const stack = getStack(state.board, move.to);
  const hand = withHandDelta(state.hands[move.player], move.kind, -1);
  const placed: GameState = {
    ...state,
    board: setStack(state.board, move.to, [...stack, { kind: move.kind, owner: move.player }]),
    hands: { ...state.hands, [move.player]: hand },
    placementDone: {
      ...state.placementDone,
      [move.player]: handTotal(hand) === 0 || state.placementDone[move.player],
    },
    ply: state.ply + 1,
  };
  return { ok: true, state: advancePlacement(placed, move.player) };
}

function applyFinishPlacement(state: GameState, move: FinishPlacementMove): MoveResult {
  if (state.phase !== 'placement') return { ok: false, error: MoveError.WRONG_PHASE };
  if (move.player !== state.turn) return { ok: false, error: MoveError.NOT_YOUR_TURN };
  if (!hasPlacedMarshal(state, move.player)) return { ok: false, error: MoveError.MARSHAL_FIRST };
  // §9.3 the second player's declaration ends the phase for both sides.
  const placementDone =
    move.player === 'white'
      ? { black: true, white: true }
      : { ...state.placementDone, black: true };
  const next: GameState = { ...state, placementDone, ply: state.ply + 1 };
  return { ok: true, state: advancePlacement(next, move.player) };
}

/** Applies a placement-phase move (`place` / `finishPlacement`). */
export function applyPlacementMove(
  state: GameState,
  move: PlaceMove | FinishPlacementMove,
): MoveResult {
  return move.type === 'place' ? applyPlace(state, move) : applyFinishPlacement(state, move);
}

/** All legal placement-phase moves for the side to move. */
export function placementMoves(state: GameState): Move[] {
  if (state.phase !== 'placement') return [];
  const player = state.turn;
  const marshalPlaced = hasPlacedMarshal(state, player);
  const kinds: PieceKind[] = marshalPlaced
    ? PIECE_KINDS.filter((k) => state.hands[player][k] > 0)
    : ['marshal'];
  const moves: Move[] = [];
  for (const to of allSquares()) {
    if (!isInTerritory(player, to.rank)) continue;
    for (const kind of kinds) {
      const move: PlaceMove = { type: 'place', player, kind, to };
      if (validatePlace(state, move) === null) moves.push(move);
    }
  }
  if (marshalPlaced) moves.push({ type: 'finishPlacement', player });
  return moves;
}
