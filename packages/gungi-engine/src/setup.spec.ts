import { describe, expect, it } from 'vitest';
import { getStack, setStack } from './board';
import { handTotal } from './pieces';
import { ARMY_LIMIT, armySize, hasPawnOnFile } from './placing';
import {
  createInitialState,
  executePlacementMove,
  placementMoves,
  validatePlacementMove,
} from './setup';
import type { PlacementMove } from './setup';
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

/** Both marshals placed, black to move. */
const withMarshals = () =>
  run(createInitialState(), place('black', 'marshal', 4, 0), place('white', 'marshal', 4, 8));

describe('§9.1 initial state', () => {
  it('starts in placement with an empty board and full hands', () => {
    const s = createInitialState();
    expect(s.phase).toBe('placement');
    expect(s.turn).toBe('black');
    expect(handTotal(s.hands.black)).toBe(38);
    expect(handTotal(s.hands.white)).toBe(38);
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
        kind: 'lancer' as PieceKind,
      }),
    ).toBe(MoveError.INVALID_MOVE);
  });

  it('§4.1 allows stacking on own pieces up to 3 tiers', () => {
    const s = run(
      withMarshals(),
      place('black', 'general', 0, 0),
      place('white', 'general', 0, 8),
      place('black', 'general', 0, 0),
      place('white', 'general', 0, 8),
      place('black', 'general', 0, 0),
      place('white', 'general', 0, 8),
    );
    expect(getStack(s.board, { file: 0, rank: 0 })).toHaveLength(3);
    expect(errorOf(s, place('black', 'samurai', 0, 0))).toBe(MoveError.STACK_FULL);
  });

  it('§4.4 forbids placing on the marshal', () => {
    expect(errorOf(withMarshals(), place('black', 'general', 4, 0))).toBe(
      MoveError.CANNOT_STACK_ON_MARSHAL,
    );
  });

  it('§4.5 a fortress may only be placed on an empty square', () => {
    const s = run(withMarshals(), place('black', 'general', 0, 0), place('white', 'general', 0, 8));
    expect(errorOf(s, place('black', 'fortress', 0, 0))).toBe(MoveError.FORTRESS_CANNOT_STACK);
    expect(errorOf(s, place('black', 'fortress', 1, 0))).toBeNull();
  });

  it('§4.5 pieces may be placed onto a fortress', () => {
    const s = run(withMarshals(), place('black', 'fortress', 0, 0), place('white', 'pawn', 0, 8));
    expect(errorOf(s, place('black', 'general', 0, 0))).toBeNull();
  });

  it('§8.3 forbids a second own pawn on the same file, at any rank or tier', () => {
    const s = run(withMarshals(), place('black', 'pawn', 2, 2), place('white', 'pawn', 3, 6));
    expect(errorOf(s, place('black', 'pawn', 2, 0))).toBe(MoveError.PAWN_FILE_OCCUPIED);
    expect(errorOf(s, place('black', 'pawn', 2, 2))).toBe(MoveError.PAWN_FILE_OCCUPIED);
    // An enemy pawn on the file does not count.
    expect(errorOf(s, place('black', 'pawn', 3, 0))).toBeNull();
    const buried = run(s, place('black', 'general', 2, 2), place('white', 'pawn', 5, 6));
    expect(errorOf(buried, place('black', 'pawn', 2, 1))).toBe(MoveError.PAWN_FILE_OCCUPIED);
  });

  it('§3.3 rejects placement once 26 own pieces are on the board', () => {
    let s = withMarshals();
    let board = s.board;
    let n = 1;
    for (let rank = 0; rank <= 2 && n < ARMY_LIMIT; rank++) {
      for (let file = 0; file < 9 && n < ARMY_LIMIT; file++) {
        if (rank === 0 && file === 4) continue;
        board = setStack(board, { file, rank }, [{ kind: 'general', owner: 'black' }]);
        n++;
      }
    }
    s = { ...s, board };
    expect(armySize(s.board, 'black')).toBe(ARMY_LIMIT);
    expect(errorOf(s, place('black', 'general', 8, 2))).toBe(MoveError.ARMY_LIMIT);
    expect(placementMoves(s)).toEqual([finish('black')]);
  });

  it('rejects placement during play', () => {
    const s = run(withMarshals(), finish('black'), finish('white'));
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

  it('white finishing first lets black keep placing alone', () => {
    let s = run(withMarshals(), place('black', 'pawn', 0, 0), finish('white'));
    expect(s.phase).toBe('placement');
    expect(s.placementDone).toEqual({ black: false, white: true });
    expect(s.turn).toBe('black');
    s = run(s, place('black', 'pawn', 1, 0));
    expect(s.turn).toBe('black');
  });

  it('§9.4 both declarations start play with white to move', () => {
    const s = run(withMarshals(), place('black', 'pawn', 0, 0), finish('white'), finish('black'));
    expect(s.phase).toBe('play');
    expect(s.turn).toBe('white');
    expect(s.placementDone).toEqual({ black: true, white: true });
    expect(s.hands.black.pawn).toBe(8);
    expect(s.hands.white.pawn).toBe(9);
  });

  it('is never declared automatically', () => {
    const s = run(withMarshals(), place('black', 'pawn', 0, 0));
    expect(s.placementDone).toEqual({ black: false, white: false });
  });

  it('records the starting position', () => {
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
    const s = run(withMarshals(), place('black', 'pawn', 3, 1), place('white', 'pawn', 3, 7));
    const moves = placementMoves(s);
    for (const m of moves) expect(errorOf(s, m)).toBeNull();
    expect(moves.some((m) => m.type === 'place' && m.kind === 'pawn' && m.to.file === 3)).toBe(
      false,
    );
    const onPawn = moves.filter((m) => m.type === 'place' && m.to.file === 3 && m.to.rank === 1);
    expect(onPawn.length).toBeGreaterThan(0);
    expect(onPawn.some((m) => m.type === 'place' && m.kind === 'fortress')).toBe(false);
  });

  it('is empty outside the placement phase', () => {
    expect(placementMoves(run(withMarshals(), finish('black'), finish('white')))).toEqual([]);
  });
});

describe('§8.3 placing helpers', () => {
  it('hasPawnOnFile looks at every rank and tier of the file for the given side', () => {
    const board = setStack(withMarshals().board, { file: 6, rank: 5 }, [
      { kind: 'pawn', owner: 'white' },
      { kind: 'general', owner: 'black' },
    ]);
    expect(hasPawnOnFile(board, 'white', 6)).toBe(true);
    expect(hasPawnOnFile(board, 'black', 6)).toBe(false);
    expect(hasPawnOnFile(board, 'white', 5)).toBe(false);
  });

  it('armySize counts buried pieces', () => {
    const board = setStack(withMarshals().board, { file: 6, rank: 5 }, [
      { kind: 'pawn', owner: 'white' },
      { kind: 'general', owner: 'black' },
    ]);
    expect(armySize(board, 'white')).toBe(2);
    expect(armySize(board, 'black')).toBe(2);
  });
});
