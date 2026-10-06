import { describe, expect, it } from 'vitest';
import { getStack } from './board';
import { emptyHand, handTotal } from './pieces';
import {
  createInitialState,
  executePlacementMove,
  placementMoves,
  validatePlacementMove,
} from './setup';
import type { PlacementMove } from './setup';
import { positionKey } from './repetition';
import type { GameState, PieceKind, PlaceMove, PlayerSide } from './types';
import { MoveError } from './types';

const place = (player: PlayerSide, kind: PieceKind, file: number, rank: number): PlaceMove => ({
  type: 'place',
  player,
  kind,
  to: { file, rank },
});
const finish = (player: PlayerSide): PlacementMove => ({ type: 'finishPlacement', player });

function run(state: GameState, ...moves: PlacementMove[]): GameState {
  return moves.reduce((s, m) => {
    const error = validatePlacementMove(s, m);
    if (error) throw new Error(`unexpected ${error} for ${JSON.stringify(m)}`);
    return executePlacementMove(s, m);
  }, state);
}

const errorOf = (state: GameState, move: PlacementMove) => validatePlacementMove(state, move);

/** A hand holding a single piece of `kind`. */
const oneLeft = (kind: PieceKind) => ({ ...emptyHand(), [kind]: 1 });

/** Both marshals placed, black to move. */
const withMarshals = () =>
  run(createInitialState(), place('black', 'marshal', 4, 0), place('white', 'marshal', 4, 8));

describe('§9.1 initial state', () => {
  it('starts in placement with an empty board and full hands', () => {
    const s = createInitialState();
    expect(s.phase).toBe('placement');
    expect(s.turn).toBe('black');
    expect(handTotal(s.hands.black)).toBe(25);
    expect(handTotal(s.hands.white)).toBe(25);
    expect(s.board.flat().every((st) => st.length === 0)).toBe(true);
    expect(s.placementDone).toEqual({ black: false, white: false });
    expect(s.result).toBeNull();
  });

  it('is plain JSON data', () => {
    const s = createInitialState();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('§9.2 place', () => {
  it('requires the marshal first', () => {
    expect(errorOf(createInitialState(), place('black', 'pawn', 0, 0))).toBe(
      MoveError.MARSHAL_FIRST,
    );
  });

  it('places a piece and passes the turn', () => {
    const s = run(createInitialState(), place('black', 'marshal', 4, 0));
    expect(getStack(s.board, { file: 4, rank: 0 })).toEqual([{ kind: 'marshal', owner: 'black' }]);
    expect(s.hands.black.marshal).toBe(0);
    expect(s.turn).toBe('white');
    expect(s.ply).toBe(1);
  });

  it('does not mutate the input state', () => {
    const before = createInitialState();
    const snapshot = JSON.stringify(before);
    run(before, place('black', 'marshal', 4, 0));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('§2.3 rejects placement outside the 3 back ranks', () => {
    expect(errorOf(createInitialState(), place('black', 'marshal', 4, 3))).toBe(
      MoveError.OUTSIDE_TERRITORY,
    );
    const s = run(createInitialState(), place('black', 'marshal', 4, 2));
    expect(errorOf(s, place('white', 'marshal', 4, 5))).toBe(MoveError.OUTSIDE_TERRITORY);
    expect(errorOf(s, place('white', 'marshal', 4, 6))).toBeNull();
  });

  it('rejects the wrong player', () => {
    expect(errorOf(createInitialState(), place('white', 'marshal', 4, 8))).toBe(
      MoveError.NOT_YOUR_TURN,
    );
  });

  it('rejects pieces not in hand', () => {
    expect(errorOf(withMarshals(), place('black', 'marshal', 3, 0))).toBe(MoveError.NOT_IN_HAND);
  });

  it('rejects malformed squares and kinds', () => {
    expect(errorOf(createInitialState(), place('black', 'marshal', 9, 0))).toBe(
      MoveError.INVALID_SQUARE,
    );
    expect(
      errorOf(createInitialState(), {
        ...place('black', 'marshal', 4, 0),
        kind: 'spear' as PieceKind,
      }),
    ).toBe(MoveError.INVALID_MOVE);
  });

  it('§4.1 allows stacking on own pieces up to 3 tiers', () => {
    const s = run(
      withMarshals(),
      place('black', 'pawn', 0, 0),
      place('white', 'pawn', 0, 8),
      place('black', 'pawn', 0, 0),
      place('white', 'pawn', 0, 8),
      place('black', 'pawn', 0, 0),
      place('white', 'pawn', 0, 8),
    );
    expect(getStack(s.board, { file: 0, rank: 0 })).toHaveLength(3);
    expect(errorOf(s, place('black', 'samurai', 0, 0))).toBe(MoveError.STACK_FULL);
  });

  it('§4.4 forbids placing on the marshal', () => {
    expect(errorOf(withMarshals(), place('black', 'general', 4, 0))).toBe(
      MoveError.CANNOT_STACK_ON_MARSHAL,
    );
  });

  it('§4.5 a fortress may be placed onto a stack like any other piece', () => {
    const s = run(withMarshals(), place('black', 'general', 0, 0), place('white', 'general', 0, 8));
    expect(errorOf(s, place('black', 'fortress', 0, 0))).toBeNull();
  });

  it('§4.5 pieces may be placed onto a fortress', () => {
    const s = run(withMarshals(), place('black', 'fortress', 0, 0), place('white', 'pawn', 0, 8));
    expect(errorOf(s, place('black', 'general', 0, 0))).toBeNull();
  });

  it('§8.4 several own pawns may share a file, stacked or not', () => {
    const s = run(withMarshals(), place('black', 'pawn', 2, 2), place('white', 'pawn', 3, 6));
    expect(errorOf(s, place('black', 'pawn', 2, 0))).toBeNull();
    expect(errorOf(s, place('black', 'pawn', 2, 2))).toBeNull();
  });

  it('rejects placement during play', () => {
    const s = run(withMarshals(), finish('black'), finish('white'));
    expect(s.phase).toBe('play');
    expect(errorOf(s, place('black', 'pawn', 0, 0))).toBe(MoveError.WRONG_PHASE);
    expect(errorOf(s, finish('black'))).toBe(MoveError.WRONG_PHASE);
  });
});

describe('§9.3 finishPlacement', () => {
  it('cannot be declared before placing the marshal', () => {
    expect(errorOf(createInitialState(), finish('black'))).toBe(MoveError.MARSHAL_FIRST);
  });

  it('rejects the wrong player', () => {
    expect(errorOf(withMarshals(), finish('white'))).toBe(MoveError.NOT_YOUR_TURN);
  });

  it('black finishing lets white keep placing alone', () => {
    let s = run(withMarshals(), finish('black'));
    expect(s.phase).toBe('placement');
    expect(s.turn).toBe('white');
    s = run(s, place('white', 'pawn', 0, 8));
    expect(s.turn).toBe('white');
    s = run(s, place('white', 'pawn', 1, 8));
    expect(s.turn).toBe('white');
    expect(errorOf(s, place('black', 'pawn', 0, 0))).toBe(MoveError.NOT_YOUR_TURN);
  });

  it('the second player finishing ends placement for both, even if black has not finished', () => {
    const s = run(withMarshals(), place('black', 'pawn', 0, 0), finish('white'));
    expect(s.phase).toBe('play');
    expect(s.placementDone).toEqual({ black: true, white: true });
    expect(errorOf(s, place('black', 'pawn', 1, 0))).toBe(MoveError.WRONG_PHASE);
  });

  it('§9.4 play starts with the first player (black) to move; unplaced pieces stay in hand', () => {
    const s = run(withMarshals(), place('black', 'pawn', 0, 0), finish('white'));
    expect(s.turn).toBe('black');
    expect(s.hands.black.pawn).toBe(3);
    expect(s.hands.white.pawn).toBe(4);
    expect(handTotal(s.hands.black)).toBe(23);
  });

  it('black finishing first and white finishing later also starts play with black to move', () => {
    const s = run(withMarshals(), finish('black'), place('white', 'pawn', 0, 8), finish('white'));
    expect(s.phase).toBe('play');
    expect(s.turn).toBe('black');
  });

  it('is not declared automatically while pieces remain in hand', () => {
    const s = run(withMarshals(), place('black', 'pawn', 0, 0));
    expect(s.placementDone).toEqual({ black: false, white: false });
  });

  it('R-7 placing the last piece in hand finishes the first player', () => {
    const last = { ...withMarshals(), hands: { ...withMarshals().hands, black: oneLeft('pawn') } };
    const s = run(last, place('black', 'pawn', 0, 0));
    expect(s.placementDone).toEqual({ black: true, white: false });
    expect(s.phase).toBe('placement');
    expect(s.turn).toBe('white');
    expect(
      placementMoves(run(s, place('white', 'pawn', 0, 8))).every((m) => m.player === 'white'),
    ).toBe(true);
  });

  it('R-7 placing the last piece in hand as the second player ends placement', () => {
    const base = run(withMarshals(), place('black', 'pawn', 0, 0));
    const last = { ...base, hands: { ...base.hands, white: oneLeft('pawn') } };
    const s = run(last, place('white', 'pawn', 0, 8));
    expect(s.phase).toBe('play');
    expect(s.turn).toBe('black');
  });

  it('§11.4 placement records no positions; play starts with the first occurrence', () => {
    const placing = run(withMarshals(), place('black', 'pawn', 0, 0));
    expect(placing.positionCounts).toEqual({});
    const s = run(placing, finish('white'));
    expect(s.positionCounts).toEqual({ [positionKey(s)]: 1 });
  });
});

describe('§9.1 first player option', () => {
  const whiteFirst = () => createInitialState({ firstPlayer: 'white' });

  it('defaults to black and records the first player in the state', () => {
    expect(createInitialState().firstPlayer).toBe('black');
    expect(createInitialState({}).turn).toBe('black');
    expect(whiteFirst()).toMatchObject({ firstPlayer: 'white', turn: 'white' });
  });

  it('rejects an unknown first player', () => {
    expect(() => createInitialState({ firstPlayer: 'red' as PlayerSide })).toThrow(RangeError);
  });

  it('white places its marshal first and the sides alternate from white', () => {
    expect(errorOf(whiteFirst(), place('black', 'marshal', 4, 0))).toBe(MoveError.NOT_YOUR_TURN);
    let s = run(whiteFirst(), place('white', 'marshal', 4, 8));
    expect(s.turn).toBe('black');
    s = run(s, place('black', 'marshal', 4, 0), place('white', 'pawn', 0, 8));
    expect(s.turn).toBe('black');
  });

  it('white (first) finishing lets black keep placing alone', () => {
    let s = run(whiteFirst(), place('white', 'marshal', 4, 8), place('black', 'marshal', 4, 0));
    s = run(s, finish('white'));
    expect(s).toMatchObject({ phase: 'placement', turn: 'black' });
    s = run(s, place('black', 'pawn', 0, 0), place('black', 'pawn', 1, 0));
    expect(s.turn).toBe('black');
    expect(errorOf(s, place('white', 'pawn', 0, 8))).toBe(MoveError.NOT_YOUR_TURN);
  });

  it('black (second) finishing ends placement and white moves first in play', () => {
    const s = run(
      whiteFirst(),
      place('white', 'marshal', 4, 8),
      place('black', 'marshal', 4, 0),
      place('white', 'pawn', 0, 8),
      finish('black'),
    );
    expect(s).toMatchObject({ phase: 'play', turn: 'white' });
    expect(s.placementDone).toEqual({ black: true, white: true });
  });
});

describe('§9 placementMoves', () => {
  it('offers only marshal placements before the marshal is placed', () => {
    const moves = placementMoves(createInitialState());
    expect(moves).toHaveLength(27);
    expect(moves.every((m) => m.type === 'place' && m.kind === 'marshal')).toBe(true);
  });

  it('includes finishPlacement once the marshal is placed', () => {
    const moves = placementMoves(withMarshals());
    expect(moves).toContainEqual(finish('black'));
    expect(moves.filter((m) => m.type === 'place').length).toBeGreaterThan(0);
  });

  it('every generated move is accepted', () => {
    const s = run(withMarshals(), place('black', 'pawn', 3, 1), place('white', 'pawn', 3, 7));
    const moves = placementMoves(s);
    for (const m of moves) expect(errorOf(s, m)).toBeNull();
    const onPawn = moves.filter((m) => m.type === 'place' && m.to.file === 3 && m.to.rank === 1);
    expect(onPawn).toContainEqual(place('black', 'pawn', 3, 1));
    expect(onPawn).toContainEqual(place('black', 'fortress', 3, 1));
    expect(moves.some((m) => m.type === 'place' && m.to.file === 4 && m.to.rank === 0)).toBe(false);
  });

  it('is empty outside the placement phase', () => {
    expect(placementMoves(run(withMarshals(), finish('black'), finish('white')))).toEqual([]);
  });
});
