import { describe, expect, it } from 'vitest';
import { getStack } from './board';
import { handTotal } from './pieces';
import { applyPlacementMove, createInitialState, placementMoves } from './setup';
import type { FinishPlacementMove, GameState, PieceKind, PlaceMove, PlayerSide } from './types';
import { MoveError } from './types';

const place = (player: PlayerSide, kind: PieceKind, file: number, rank: number): PlaceMove => ({
  type: 'place',
  player,
  kind,
  to: { file, rank },
});
const finish = (player: PlayerSide): FinishPlacementMove => ({ type: 'finishPlacement', player });

function run(state: GameState, ...moves: (PlaceMove | FinishPlacementMove)[]): GameState {
  return moves.reduce((s, m) => {
    const r = applyPlacementMove(s, m);
    if (!r.ok) throw new Error(`unexpected ${r.error} for ${JSON.stringify(m)}`);
    return r.state;
  }, state);
}

function errorOf(state: GameState, move: PlaceMove | FinishPlacementMove) {
  const r = applyPlacementMove(state, move);
  return r.ok ? null : r.error;
}

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

  it('rejects placement outside the 3 back ranks', () => {
    expect(errorOf(createInitialState(), place('black', 'marshal', 4, 3))).toBe(
      MoveError.OUTSIDE_TERRITORY,
    );
    const s = run(createInitialState(), place('black', 'marshal', 4, 0));
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
        kind: 'dragon' as PieceKind,
      }),
    ).toBe(MoveError.INVALID_MOVE);
  });

  it('allows stacking on own pieces up to 3 tiers', () => {
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

  it('§4.4 forbids stacking on the marshal', () => {
    expect(errorOf(withMarshals(), place('black', 'pawn', 4, 0))).toBe(
      MoveError.CANNOT_STACK_ON_MARSHAL,
    );
  });

  it('rejects placement during play', () => {
    const s = run(withMarshals(), finish('black'), finish('white'));
    expect(errorOf(s, place('black', 'pawn', 0, 0))).toBe(MoveError.WRONG_PHASE);
  });
});

describe('§9.3 finishPlacement', () => {
  it('cannot be declared before placing the marshal', () => {
    expect(errorOf(createInitialState(), finish('black'))).toBe(MoveError.MARSHAL_FIRST);
  });

  it('black finishing lets white keep placing alone', () => {
    let s = run(withMarshals(), finish('black'));
    expect(s.phase).toBe('placement');
    expect(s.turn).toBe('white');
    s = run(s, place('white', 'pawn', 0, 8));
    expect(s.turn).toBe('white');
    s = run(s, finish('white'));
    expect(s.phase).toBe('play');
    expect(s.turn).toBe('black');
  });

  it('white finishing ends the phase for both sides', () => {
    const s = run(withMarshals(), place('black', 'pawn', 0, 0), finish('white'));
    expect(s.phase).toBe('play');
    expect(s.placementDone).toEqual({ black: true, white: true });
    expect(s.turn).toBe('black');
    expect(s.hands.black.pawn).toBe(3);
  });

  it('a side with an empty hand is finished automatically', () => {
    let s = withMarshals();
    s = {
      ...s,
      hands: {
        ...s.hands,
        black: Object.fromEntries(
          Object.keys(s.hands.black).map((k) => [k, k === 'pawn' ? 1 : 0]),
        ) as GameState['hands']['black'],
      },
    };
    s = run(s, place('black', 'pawn', 0, 0));
    expect(s.placementDone.black).toBe(true);
    expect(s.turn).toBe('white');
    s = run(s, place('white', 'pawn', 0, 8));
    expect(s.turn).toBe('white');
  });

  it('records the starting position for repetition counting', () => {
    const s = run(withMarshals(), finish('black'), finish('white'));
    expect(Object.values(s.positionCounts)).toEqual([1]);
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
    const s = withMarshals();
    for (const m of placementMoves(s)) {
      if (m.type === 'place' || m.type === 'finishPlacement') {
        expect(applyPlacementMove(s, m).ok).toBe(true);
      }
    }
  });

  it('is empty outside the placement phase', () => {
    expect(placementMoves(run(withMarshals(), finish('black'), finish('white')))).toEqual([]);
  });
});
