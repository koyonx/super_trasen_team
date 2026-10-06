import { describe, expect, it } from 'vitest';
import { applyMove, inCheck, isGameOver, legalMoves } from './engine';
import type { PositionSetup } from './position';
import {
  InvalidPositionError,
  PositionError,
  createPosition,
  positionError,
  stateError,
} from './position';
import { createInitialState } from './setup';
import { B, W, at, rng, sq } from './test-helpers';
import { ROSTER } from './pieces';
import type { GameState, Piece, PieceKind } from './types';
import { PIECE_KINDS } from './types';

const KINGS = [at(0, 0, B('marshal')), at(8, 8, W('marshal'))];

/** Asserts both the non-throwing check and the throwing constructor agree. */
function expectRejected(setup: PositionSetup, reason: PositionError): void {
  expect(positionError(setup)).toBe(reason);
  expect(() => createPosition(setup)).toThrow(InvalidPositionError);
  try {
    createPosition(setup);
  } catch (e) {
    expect((e as InvalidPositionError).reason).toBe(reason);
  }
}

describe('§12.1 createPosition invariants', () => {
  it('accepts a reachable position', () => {
    const setup: PositionSetup = {
      stacks: [...KINGS, at(4, 4, W('pawn'), B('samurai'), B('cannon'))],
      hands: { black: { pawn: 4 }, white: { general: 1 } },
      turn: 'white',
      quietPlies: 3,
    };
    expect(positionError(setup)).toBeNull();
    expect(createPosition(setup).turn).toBe('white');
  });

  it('§4.5 accepts a fortress above tier 1', () => {
    const setup = { stacks: [...KINGS, at(4, 5, W('pawn'), B('fortress'), W('general'))] };
    expect(positionError(setup)).toBeNull();
  });

  it('rejects squares off the board or used twice', () => {
    expectRejected({ stacks: [...KINGS, at(9, 0, B('pawn'))] }, PositionError.INVALID_SQUARE);
    expectRejected(
      { stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 4, W('pawn'))] },
      PositionError.DUPLICATE_SQUARE,
    );
  });

  it('rejects unknown pieces and owners', () => {
    expectRejected(
      { stacks: [...KINGS, at(4, 4, { kind: 'spear', owner: 'black' } as unknown as Piece)] },
      PositionError.INVALID_PIECE,
    );
    expectRejected(
      { stacks: [...KINGS, at(4, 4, { kind: 'pawn', owner: 'red' } as unknown as Piece)] },
      PositionError.INVALID_PIECE,
    );
    expectRejected(
      { stacks: KINGS, hands: { black: { spear: 1 } as never } },
      PositionError.INVALID_PIECE,
    );
  });

  it('§4.1 rejects a stack higher than 3', () => {
    expectRejected(
      { stacks: [...KINGS, at(4, 4, B('pawn'), B('pawn'), B('pawn'), B('pawn'))] },
      PositionError.STACK_TOO_HIGH,
    );
  });

  it('requires exactly one marshal per side', () => {
    expectRejected({ stacks: [KINGS[0]!] }, PositionError.MARSHAL_COUNT);
    expectRejected({}, PositionError.MARSHAL_COUNT);
    expectRejected({ stacks: [...KINGS, at(4, 4, B('marshal'))] }, PositionError.MARSHAL_COUNT);
  });

  it('§4.4 rejects any piece above a marshal', () => {
    expectRejected(
      { stacks: [at(0, 0, B('marshal'), W('pawn')), KINGS[1]!] },
      PositionError.MARSHAL_NOT_ON_TOP,
    );
    expectRejected(
      { stacks: [KINGS[0]!, at(8, 8, W('pawn'), W('marshal'), W('general'))] },
      PositionError.MARSHAL_NOT_ON_TOP,
    );
    // On top of a stack is fine.
    expect(positionError({ stacks: [KINGS[0]!, at(8, 8, B('pawn'), W('marshal'))] })).toBeNull();
  });

  it('§3.2 accepts all 25 own pieces on the board', () => {
    const kinds = PIECE_KINDS.filter((k) => k !== 'marshal').flatMap((k) =>
      Array<PieceKind>(ROSTER[k]).fill(k),
    );
    expect(kinds).toHaveLength(24);
    const army = Array.from({ length: 8 }, (_, i) =>
      at(i, 3, ...kinds.slice(i * 3, i * 3 + 3).map(B)),
    );
    const base = [at(4, 0, B('marshal')), at(8, 8, W('marshal'))];
    expect(positionError({ stacks: [...base, ...army] })).toBeNull();
    expectRejected(
      { stacks: [...base, ...army], hands: { black: { lancer: 1 } } },
      PositionError.ROSTER_EXCEEDED,
    );
  });

  it('§3.1 rejects more pieces of a kind than the roster holds', () => {
    expectRejected(
      { stacks: [...KINGS, at(4, 4, B('musket')), at(5, 4, B('musket'))] },
      PositionError.ROSTER_EXCEEDED,
    );
    expectRejected(
      { stacks: [...KINGS, at(4, 4, B('pawn'))], hands: { black: { pawn: 9 } } },
      PositionError.ROSTER_EXCEEDED,
    );
  });

  it('§9.1 records the first player, black by default', () => {
    expect(createPosition({ stacks: KINGS }).firstPlayer).toBe('black');
    expect(createPosition({ stacks: KINGS, firstPlayer: 'white' }).firstPlayer).toBe('white');
    expectRejected(
      { stacks: KINGS, firstPlayer: 'red' as unknown as 'black' },
      PositionError.INVALID_TURN,
    );
  });

  it('rejects negative or fractional counts and a bad turn', () => {
    expectRejected({ stacks: KINGS, hands: { white: { pawn: -1 } } }, PositionError.INVALID_COUNT);
    expectRejected({ stacks: KINGS, hands: { white: { pawn: 1.5 } } }, PositionError.INVALID_COUNT);
    expectRejected({ stacks: KINGS, quietPlies: -1 }, PositionError.INVALID_COUNT);
    expectRejected(
      { stacks: KINGS, turn: 'red' as unknown as 'black' },
      PositionError.INVALID_TURN,
    );
  });

  it('builds the board from the stacks without sharing input arrays', () => {
    const pieces = [B('pawn')];
    const s = createPosition({ stacks: [...KINGS, { square: sq(4, 4), pieces }] });
    pieces.push(B('pawn'));
    expect(s.board[4]![4]).toEqual([B('pawn')]);
  });
});

describe('§12.1 the side not to move is never in check', () => {
  /** The white general on (4, 6) attacking down file 4 (§5.3.2). */
  const whiteTower = at(4, 6, W('general'));
  /** Black's marshal on (4, 2), in reach of `whiteTower`. */
  const checked = [at(4, 2, B('marshal')), at(8, 8, W('marshal')), whiteTower];

  it('rejects black to move with white in check', () => {
    expectRejected(
      { stacks: [at(0, 0, B('marshal')), at(4, 4, B('pawn')), at(4, 5, W('marshal'))] },
      PositionError.OPPONENT_IN_CHECK,
    );
  });

  it('has no play-start exception: white to move with black in check is rejected', () => {
    // Play starts with the first player to move, and the second player cannot
    // end placement while in check (§9.5), whoever moves first.
    expectRejected({ stacks: checked, turn: 'white' }, PositionError.OPPONENT_IN_CHECK);
    expectRejected(
      { stacks: checked, turn: 'white', firstPlayer: 'white' },
      PositionError.OPPONENT_IN_CHECK,
    );
  });

  it('rejects it when white is in check as well', () => {
    expectRejected(
      {
        stacks: [
          at(4, 2, B('marshal')),
          whiteTower,
          at(0, 2, B('general')),
          at(0, 7, W('marshal')),
        ],
        turn: 'white',
      },
      PositionError.OPPONENT_IN_CHECK,
    );
  });

  it('accepts the side to move being in check', () => {
    expect(positionError({ stacks: checked, turn: 'black' })).toBeNull();
  });
});

describe('§12.1 what createPosition deliberately does not check', () => {
  it('§11.4 accepts a quiet-ply counter above the limit; the next quiet move draws', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn'))], quietPlies: 60 });
    expect(s.result).toBeNull();
    const r = applyMove(s, { type: 'move', player: 'black', from: sq(4, 4), to: sq(4, 5) });
    expect(r.ok && r.state.result).toEqual({ winner: null, reason: 'fiftyMoveRule' });
  });

  it('§11.2 returns a mated position unconcluded; the caller detects it', () => {
    // General on file 0, a tier-3 cannon onto (1, 1), lieutenant onto (1, 0) (§5.3).
    const s = createPosition({
      stacks: [
        at(0, 0, B('marshal')),
        at(0, 6, W('general')),
        at(1, 6, W('pawn'), W('pawn'), W('cannon')),
        at(7, 6, W('lieutenant')),
        at(8, 8, W('marshal')),
      ],
    });
    expect(s.result).toBeNull();
    expect(isGameOver(s)).toBe(false);
    expect(legalMoves(s)).toEqual([]);
    expect(inCheck(s)).toBe(true);
  });
});

describe('§12.1 positionError on malformed input', () => {
  /** Feeds arbitrary (JSON-like) data the way an untrusted caller would. */
  const check = (input: unknown) => positionError(input as PositionSetup);

  it('rejects a setup that is not an object', () => {
    for (const input of [null, undefined, 5, 'x', true, [], [KINGS]]) {
      expect(check(input)).toBe(PositionError.MALFORMED);
    }
  });

  it('rejects stacks that are not an array of objects', () => {
    for (const stacks of [5, 'x', null, {}, { 0: KINGS[0] }]) {
      expect(check({ stacks })).toBe(PositionError.MALFORMED);
    }
    for (const entry of [null, 5, 'x', [], [sq(0, 0), [B('marshal')]]]) {
      expect(check({ stacks: [...KINGS, entry] })).toBe(PositionError.MALFORMED);
    }
  });

  it('rejects stack entries with a bad square or pieces', () => {
    expect(check({ stacks: [...KINGS, { pieces: [B('pawn')] }] })).toBe(
      PositionError.INVALID_SQUARE,
    );
    expect(check({ stacks: [...KINGS, { square: null, pieces: [] }] })).toBe(
      PositionError.INVALID_SQUARE,
    );
    for (const pieces of [undefined, null, 5, {}, [null], [5], ['pawn'], [{ kind: 'pawn' }]]) {
      expect(check({ stacks: [...KINGS, { square: sq(4, 4), pieces }] })).toBe(
        PositionError.INVALID_PIECE,
      );
    }
  });

  it('rejects hands that are not objects', () => {
    for (const hands of [null, 5, 'x', [], [{ pawn: 1 }]]) {
      expect(check({ stacks: KINGS, hands })).toBe(PositionError.MALFORMED);
    }
    for (const hand of [null, 5, 'x', true, [], [1, 2]]) {
      expect(check({ stacks: KINGS, hands: { black: hand } })).toBe(PositionError.MALFORMED);
      expect(check({ stacks: KINGS, hands: { white: hand } })).toBe(PositionError.MALFORMED);
    }
    for (const count of [null, '1', [], {}, NaN, Infinity]) {
      expect(check({ stacks: KINGS, hands: { black: { pawn: count } } })).toBe(
        PositionError.INVALID_COUNT,
      );
    }
  });

  it('rejects a non-numeric quietPlies', () => {
    for (const quietPlies of [null, '0', [], {}, NaN]) {
      expect(check({ stacks: KINGS, quietPlies })).toBe(PositionError.INVALID_COUNT);
    }
  });

  it('rejects sparse arrays instead of throwing (holes read as undefined)', () => {
    const pawn = B('pawn');
    const holed = (length: number, entries: Record<number, unknown>): unknown[] => {
      const arr: unknown[] = new Array(length);
      for (const [i, v] of Object.entries(entries)) arr[Number(i)] = v;
      return arr;
    };
    for (const pieces of [holed(2, { 1: pawn }), holed(2, { 0: pawn }), new Array(1)]) {
      expect(check({ stacks: [...KINGS, { square: sq(4, 4), pieces }] })).toBe(
        PositionError.INVALID_PIECE,
      );
    }
    expect(check({ stacks: holed(3, { 0: KINGS[0], 2: KINGS[1] }) })).toBe(PositionError.MALFORMED);
  });

  it('copies the hands so the state does not share them with the setup', () => {
    const hand = { pawn: 1 };
    const s = createPosition({ stacks: KINGS, hands: { black: hand } });
    hand.pawn = 5;
    expect(s.hands.black.pawn).toBe(1);
    expect(s.hands.white.pawn).toBe(0);
  });

  /** A random JSON value biased towards the shapes a setup is made of. */
  function randomValue(rand: () => number, depth: number): unknown {
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    const leaves = [
      null,
      0,
      -1,
      1.5,
      3,
      9,
      '',
      'black',
      'white',
      'pawn',
      'marshal',
      'lancer',
      true,
      false,
    ];
    if (depth <= 0 || rand() < 0.3) return pick(leaves);
    const size = Math.floor(rand() * 4);
    if (rand() < 0.5) {
      const arr = Array.from({ length: size }, () => randomValue(rand, depth - 1));
      // Sometimes sparse (not representable in JSON, but a caller may still pass one).
      if (size > 0 && rand() < 0.2) delete arr[Math.floor(rand() * size)];
      return arr;
    }
    const keys = ['square', 'pieces', 'kind', 'owner', 'file', 'rank', 'black', 'white', 'pawn'];
    return Object.fromEntries(
      Array.from({ length: size }, () => [pick(keys), randomValue(rand, depth - 1)]),
    );
  }

  /** A setup that is valid except for one randomly corrupted part. */
  function mutatedSetup(rand: () => number): unknown {
    const base: Record<string, unknown> = {
      stacks: [...KINGS, at(4, 4, W('pawn'), B('samurai'))],
      hands: { black: { pawn: 2 }, white: { general: 1 } },
      turn: 'white',
      quietPlies: 3,
    };
    const field = ['stacks', 'hands', 'turn', 'quietPlies'][Math.floor(rand() * 4)]!;
    const stacks = base.stacks as unknown[];
    const roll = rand();
    if (field === 'stacks' && roll < 0.5) {
      stacks[Math.floor(rand() * stacks.length)] = randomValue(rand, 3);
    } else if (field === 'hands' && roll < 0.5) {
      base.hands = { black: randomValue(rand, 2), white: { pawn: 1 } };
    } else {
      base[field] = randomValue(rand, 3);
    }
    return base;
  }

  it.each([1, 2, 3, 4, 5])('seed %i: never throws on random malformed setups', (seed) => {
    const rand = rng(seed);
    const codes = new Set<unknown>([null, ...Object.values(PositionError)]);
    for (let i = 0; i < 500; i++) {
      const input = i % 2 === 0 ? randomValue(rand, 4) : mutatedSetup(rand);
      let result: unknown;
      expect(() => (result = check(input))).not.toThrow();
      expect(codes.has(result)).toBe(true);
      // The throwing constructor agrees and only ever throws its own error type.
      if (result === null) expect(() => createPosition(input as PositionSetup)).not.toThrow();
      else expect(() => createPosition(input as PositionSetup)).toThrow(InvalidPositionError);
    }
  });
});

describe('§12.1 stateError (restoring a state from storage or the network)', () => {
  /** A state as it would come back from JSON, with some fields replaced. */
  const restored = (state: GameState, patch: Record<string, unknown> = {}): unknown => ({
    ...(JSON.parse(JSON.stringify(state)) as Record<string, unknown>),
    ...patch,
  });
  /** `board[rank][file]` as plain JSON with one stack replaced. */
  const boardWith = (state: GameState, file: number, rank: number, stack: unknown[]) => {
    const board = JSON.parse(JSON.stringify(state.board)) as unknown[][][];
    board[rank]![file] = stack;
    return board;
  };
  const midGame = createPosition({
    stacks: [...KINGS, at(4, 4, W('pawn'), B('samurai'))],
    hands: { black: { pawn: 2 } },
    turn: 'white',
    quietPlies: 3,
  });

  it('accepts states the engine produced', () => {
    expect(stateError(restored(createInitialState()))).toBeNull();
    expect(stateError(restored(midGame))).toBeNull();
    expect(
      stateError(
        restored(midGame, { phase: 'finished', result: { winner: 'black', reason: 'timeout' } }),
      ),
    ).toBeNull();
  });

  it('catches a marshal buried under a piece, on which legalMoves would throw', () => {
    // Black's marshal ends up under a white general: [W pawn, B marshal, W general]. Taking
    // the stack would keep the marshal under the capturer, which the engine refuses to build.
    const base = createPosition({
      stacks: [...KINGS, at(4, 1, B('pawn'), B('pawn'), B('lancer'))],
    });
    const board = JSON.parse(JSON.stringify(base.board)) as Piece[][][];
    board[0]![0] = [];
    board[4]![4] = [W('pawn'), B('marshal'), W('general')];
    const corrupt: GameState = { ...base, board };
    expect(stateError(corrupt)).toBe(PositionError.MARSHAL_NOT_ON_TOP);
    expect(() => legalMoves(corrupt)).toThrow('corrupt target stack');
  });

  it('rejects a structurally broken state', () => {
    for (const input of [null, 5, 'x', [], {}]) {
      expect(stateError(input)).not.toBeNull();
    }
    expect(stateError(restored(midGame, { board: undefined }))).toBe(PositionError.MALFORMED);
    expect(stateError(restored(midGame, { board: midGame.board.slice(1) }))).toBe(
      PositionError.MALFORMED,
    );
    expect(stateError(restored(midGame, { board: boardWith(midGame, 4, 4, null as never) }))).toBe(
      PositionError.MALFORMED,
    );
    expect(stateError(restored(midGame, { board: boardWith(midGame, 4, 4, [null]) }))).toBe(
      PositionError.INVALID_PIECE,
    );
    expect(stateError(restored(midGame, { hands: { black: midGame.hands.black } }))).toBe(
      PositionError.MALFORMED,
    );
    const { pawn: _, ...noPawn } = midGame.hands.white;
    expect(stateError(restored(midGame, { hands: { ...midGame.hands, white: noPawn } }))).toBe(
      PositionError.INVALID_COUNT,
    );
    expect(stateError(restored(midGame, { placementDone: { black: 1, white: true } }))).toBe(
      PositionError.MALFORMED,
    );
    expect(stateError(restored(midGame, { captured: { black: ['spear'], white: [] } }))).toBe(
      PositionError.INVALID_PIECE,
    );
    expect(stateError(restored(midGame, { ply: -1 }))).toBe(PositionError.INVALID_COUNT);
    expect(stateError(restored(midGame, { turn: 'red' }))).toBe(PositionError.INVALID_TURN);
  });

  it('rejects sparse board and captured arrays instead of throwing', () => {
    const board = () => JSON.parse(JSON.stringify(midGame.board)) as unknown[][][];
    const rowHole = board();
    rowHole[0] = new Array(9);
    const missingRow = board();
    delete missingRow[4];
    const stackHole = board();
    stackHole[3]![3] = new Array(1);
    const pieceHole = board();
    delete pieceHole[4]![4]![0]; // [<hole>, B samurai]
    expect(stateError(restored(midGame, { board: rowHole }))).toBe(PositionError.MALFORMED);
    expect(stateError(restored(midGame, { board: missingRow }))).toBe(PositionError.MALFORMED);
    expect(stateError(restored(midGame, { board: stackHole }))).toBe(PositionError.INVALID_PIECE);
    expect(stateError(restored(midGame, { board: pieceHole }))).toBe(PositionError.INVALID_PIECE);
    expect(stateError(restored(midGame, { captured: { black: new Array(1), white: [] } }))).toBe(
      PositionError.INVALID_PIECE,
    );
  });

  it('checks the phase against placementDone and the result', () => {
    expect(stateError(restored(midGame, { phase: 'over' }))).toBe(PositionError.INVALID_PHASE);
    expect(stateError(restored(midGame, { placementDone: { black: true, white: false } }))).toBe(
      PositionError.INVALID_PHASE,
    );
    expect(stateError(restored(midGame, { result: { winner: 'black', reason: 'timeout' } }))).toBe(
      PositionError.INVALID_RESULT,
    );
    for (const result of [
      null,
      { winner: 'black', reason: 'stalemate' },
      { winner: null, reason: 'checkmate' },
      { winner: 'black', reason: 'boredom' },
    ]) {
      expect(stateError(restored(midGame, { phase: 'finished', result }))).toBe(
        PositionError.INVALID_RESULT,
      );
    }
  });

  it('§9 checks placement-phase states', () => {
    const initial = createInitialState();
    // §9.2 nothing is placed before the marshal.
    expect(
      stateError(
        restored(initial, { board: boardWith(initial, 4, 1, [B('pawn')]), turn: 'white' }),
      ),
    ).toBe(PositionError.MARSHAL_COUNT);
    // §9.4 the turn never goes to a side that has finished placing.
    expect(stateError(restored(initial, { placementDone: { black: true, white: false } }))).toBe(
      PositionError.INVALID_TURN,
    );
  });

  it('§3.1 counts captured pieces against the roster', () => {
    expect(
      stateError(restored(midGame, { captured: { black: [], white: ['musket'] } })),
    ).toBeNull();
    expect(
      stateError(restored(midGame, { captured: { black: [], white: ['musket', 'musket'] } })),
    ).toBe(PositionError.ROSTER_EXCEEDED);
  });

  it('§10.1 allows the side not to move in check only where a game allows it', () => {
    // Black's marshal on (4, 2) is attacked by the white general on (4, 6).
    const checked = createPosition({
      stacks: [at(4, 2, B('marshal')), at(4, 6, W('general')), KINGS[1]!],
    });
    expect(stateError(restored(checked))).toBeNull();
    // Never in play, whoever moved first.
    expect(stateError(restored(checked, { turn: 'white' }))).toBe(PositionError.OPPONENT_IN_CHECK);
    expect(stateError(restored(checked, { turn: 'white', firstPlayer: 'white' }))).toBe(
      PositionError.OPPONENT_IN_CHECK,
    );
    // §9.5 in placement, once black (first) has finished white may keep placing checks.
    const hands = {
      black: { ...checked.hands.black, pawn: 1 },
      white: { ...checked.hands.white, pawn: 1 },
    };
    const placing = {
      phase: 'placement',
      turn: 'white',
      hands,
      placementDone: { black: true, white: false },
    };
    expect(stateError(restored(checked, placing))).toBeNull();
    expect(
      stateError(
        restored(checked, {
          ...placing,
          // Two more black pawns: black has placed one piece more, so white is to move.
          board: boardWith(
            { ...checked, board: boardWith(checked, 0, 1, [B('pawn')]) as GameState['board'] },
            1,
            1,
            [B('pawn')],
          ),
          placementDone: { black: false, white: false },
        }),
      ),
    ).toBe(PositionError.OPPONENT_IN_CHECK);
    // A finished game may end in any position (e.g. resigned while in check).
    expect(
      stateError(
        restored(checked, {
          phase: 'finished',
          turn: 'black',
          result: { winner: 'white', reason: 'resignation' },
        }),
      ),
    ).toBeNull();
  });

  describe('§9.6 play-start positions after an early finish (即死筋)', () => {
    /** The first player finishes after placing its marshal; the second player then checks it. */
    function earlyFinish(firstPlayer: 'black' | 'white'): GameState {
      let s = createInitialState({ firstPlayer });
      const play = (move: Parameters<typeof applyMove>[1]) => {
        const r = applyMove(s, move);
        if (!r.ok) throw new Error(r.error);
        s = r.state;
      };
      const second = firstPlayer === 'black' ? 'white' : 'black';
      const marshal = (side: 'black' | 'white') => sq(4, side === 'black' ? 2 : 6);
      play({ type: 'place', player: firstPlayer, kind: 'marshal', to: marshal(firstPlayer) });
      play({
        type: 'place',
        player: second,
        kind: 'marshal',
        to: sq(8, second === 'black' ? 0 : 8),
      });
      play({ type: 'finishPlacement', player: firstPlayer });
      play({ type: 'place', player: second, kind: 'general', to: marshal(second) });
      return s;
    }

    it.each(['black', 'white'] as const)(
      'first player %s: placement and play-start positions in check are accepted',
      (firstPlayer) => {
        const placing = earlyFinish(firstPlayer);
        expect(placing.phase).toBe('placement');
        expect(inCheck({ ...placing, turn: firstPlayer })).toBe(true);
        expect(stateError(restored(placing))).toBeNull();
        const r = applyMove(placing, {
          type: 'finishPlacement',
          player: firstPlayer === 'black' ? 'white' : 'black',
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.state).toMatchObject({ phase: 'play', turn: firstPlayer });
        expect(inCheck(r.state)).toBe(true);
        expect(stateError(restored(r.state))).toBeNull();
        // The same board with the checking side to move is not reachable.
        expect(
          stateError(restored(r.state, { turn: firstPlayer === 'black' ? 'white' : 'black' })),
        ).toBe(PositionError.OPPONENT_IN_CHECK);
      },
    );
  });

  it('§9.3 / §9.4 checks the placement turn order for either first player', () => {
    const initial = createInitialState();
    const whiteFirst = createInitialState({ firstPlayer: 'white' });
    expect(stateError(restored(whiteFirst))).toBeNull();
    // Before anything is placed the first player is to move.
    expect(stateError(restored(initial, { turn: 'white' }))).toBe(PositionError.INVALID_TURN);
    expect(stateError(restored(whiteFirst, { turn: 'black' }))).toBe(PositionError.INVALID_TURN);
    // The second player finishing would have ended the phase.
    expect(
      stateError(
        restored(whiteFirst, { turn: 'white', placementDone: { black: true, white: false } }),
      ),
    ).toBe(PositionError.INVALID_PHASE);
    // After one placement by the first player it is the second player's turn.
    const one = applyMove(whiteFirst, {
      type: 'place',
      player: 'white',
      kind: 'marshal',
      to: sq(4, 8),
    });
    expect(one.ok && stateError(restored(one.state))).toBeNull();
    if (one.ok) {
      expect(stateError(restored(one.state, { turn: 'white' }))).toBe(PositionError.INVALID_TURN);
      expect(stateError(restored(one.state, { firstPlayer: 'black' }))).toBe(
        PositionError.INVALID_TURN,
      );
    }
    // A side with nothing left in hand has finished.
    const empty = Object.fromEntries(Object.keys(initial.hands.black).map((k) => [k, 0]));
    expect(stateError(restored(initial, { hands: { ...initial.hands, white: empty } }))).toBe(
      PositionError.INVALID_PHASE,
    );
    expect(stateError(restored(initial, { firstPlayer: 'red' }))).toBe(PositionError.INVALID_TURN);
  });

  it.each([1, 2, 3])('seed %i: never throws on randomly corrupted states', (seed) => {
    const rand = rng(seed);
    const codes = new Set<unknown>([null, ...Object.values(PositionError)]);
    const values = [null, undefined, 0, -1, 2.5, 'black', 'play', 'pawn', true, [], {}, [[]]];
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    for (let i = 0; i < 300; i++) {
      const state = restored(midGame) as Record<string, unknown>;
      const field = pick(Object.keys(state));
      const roll = rand();
      if (field === 'board' && roll < 0.4) {
        state.board = boardWith(midGame, Math.floor(rand() * 9), Math.floor(rand() * 9), [
          pick(values),
        ]);
      } else if (field === 'board' && roll < 0.6) {
        // A hole somewhere in the grid: a missing row, stack or piece.
        const board = boardWith(midGame, 4, 4, [W('pawn'), B('samurai')]);
        const row = board[Math.floor(rand() * 9)]!;
        const depth = Math.floor(rand() * 3);
        if (depth === 0) delete board[Math.floor(rand() * 9)];
        else if (depth === 1) delete row[Math.floor(rand() * 9)];
        else delete board[4]![4]![Math.floor(rand() * 2)];
        state.board = board;
      } else if (roll < 0.8 && isObject(state[field])) {
        (state[field] as Record<string, unknown>)[pick(['black', 'white', 'pawn'])] = pick(values);
      } else {
        state[field] = pick(values);
      }
      let result: unknown;
      expect(() => (result = stateError(state))).not.toThrow();
      expect(codes.has(result)).toBe(true);
    }
  });
});

/** A copy of `board` with `piece` put on top of the stack at (file, rank). */
function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
