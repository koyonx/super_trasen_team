/**
 * Initial placement (draft) phase (§9).
 *
 * Functions here check pseudo-legality only. Marshal safety (§10.1, §9.5) is
 * layered on top in engine.ts.
 */

import {
  allSquares,
  createEmptyBoard,
  findMarshal,
  getStack,
  isInTerritory,
  isValidSquare,
  setStack,
} from './board';
import { ROSTER, handTotal, isPieceKind, opponent, withHandDelta } from './pieces';
import { placingError } from './placing';
import type { FinishPlacementMove, GameState, PieceKind, PlaceMove, PlayerSide } from './types';
import { MoveError, PIECE_KINDS } from './types';

export type PlacementMove = PlaceMove | FinishPlacementMove;

export interface InitialStateOptions {
  /**
   * §9.1 the side that places first and moves first in play (先手). The
   * official rules decide it by a ritual the server or UI reproduces; the
   * result is passed in here. Defaults to black.
   */
  readonly firstPlayer?: PlayerSide;
}

/** §9.1 empty board, full hands, the first player to place. */
export function createInitialState(options: InitialStateOptions = {}): GameState {
  const firstPlayer = options.firstPlayer ?? 'black';
  if (firstPlayer !== 'black' && firstPlayer !== 'white') {
    throw new RangeError(`invalid first player: ${String(firstPlayer)}`);
  }
  return {
    phase: 'placement',
    board: createEmptyBoard(),
    hands: { black: { ...ROSTER }, white: { ...ROSTER } },
    turn: firstPlayer,
    firstPlayer,
    placementDone: { black: false, white: false },
    captured: { black: [], white: [] },
    ply: 0,
    quietPlies: 0,
    result: null,
  };
}

export function hasPlacedMarshal(state: GameState, side: PlayerSide): boolean {
  return findMarshal(state.board, side) !== undefined;
}

/** §9.4 starts the play phase with the first player to move. */
function startPlay(state: GameState): GameState {
  return {
    ...state,
    phase: 'play',
    turn: state.firstPlayer,
    placementDone: { black: true, white: true },
  };
}

/**
 * §9.3 / §9.4 the second player finishing ends placement for both sides;
 * otherwise the turn goes to whoever still places.
 */
function advancePlacement(state: GameState, mover: PlayerSide): GameState {
  const done = state.placementDone;
  if (done[opponent(state.firstPlayer)]) return startPlay(state);
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
  return placingError(state.board, move.player, move.to);
}

export function validateFinishPlacement(
  state: GameState,
  move: FinishPlacementMove,
): MoveError | null {
  if (state.phase !== 'placement') return MoveError.WRONG_PHASE;
  if (move.player !== state.turn) return MoveError.NOT_YOUR_TURN;
  if (!hasPlacedMarshal(state, move.player)) return MoveError.MARSHAL_FIRST;
  return null;
}

export function validatePlacementMove(state: GameState, move: PlacementMove): MoveError | null {
  return move.type === 'place' ? validatePlace(state, move) : validateFinishPlacement(state, move);
}

/** Applies a validated placement-phase move. */
export function executePlacementMove(state: GameState, move: PlacementMove): GameState {
  if (move.type === 'finishPlacement') {
    // §9.3 the first player stops alone; the second player ends the phase.
    const placementDone = { ...state.placementDone, [move.player]: true };
    return advancePlacement(
      { ...state, placementDone, ply: state.ply + 1, quietPlies: 0 },
      move.player,
    );
  }
  const stack = getStack(state.board, move.to);
  const hand = withHandDelta(state.hands[move.player], move.kind, -1);
  const placed: GameState = {
    ...state,
    board: setStack(state.board, move.to, [...stack, { kind: move.kind, owner: move.player }]),
    hands: { ...state.hands, [move.player]: hand },
    // §9.3 placing the last piece in hand counts as finishing (R-7).
    placementDone: { ...state.placementDone, [move.player]: handTotal(hand) === 0 },
    ply: state.ply + 1,
    quietPlies: 0,
  };
  return advancePlacement(placed, move.player);
}

/** All pseudo-legal placement-phase moves for the side to move. */
export function placementMoves(state: GameState): PlacementMove[] {
  if (state.phase !== 'placement') return [];
  const player = state.turn;
  const marshalPlaced = hasPlacedMarshal(state, player);
  const kinds: PieceKind[] = marshalPlaced
    ? PIECE_KINDS.filter((k) => state.hands[player][k] > 0)
    : ['marshal'];
  const moves: PlacementMove[] = [];
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
