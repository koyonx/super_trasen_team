import { describe, expect, it } from 'vitest';
import { applyMove, inCheck, isGameOver, legalMoves } from './engine';
import { ARMY_LIMIT } from './placing';
import type { PositionSetup } from './position';
import { InvalidPositionError, PositionError, createPosition, positionError } from './position';
import { B, W, at, rng, sq } from './test-helpers';
import type { Piece, PieceKind } from './types';

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
      hands: { black: { pawn: 8 }, white: { general: 6 } },
      turn: 'white',
      quietPlies: 3,
    };
    expect(positionError(setup)).toBeNull();
    expect(createPosition(setup).turn).toBe('white');
  });

  it('§4.5 accepts a fortress above tier 1 (reachable by capture)', () => {
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
      { stacks: [...KINGS, at(4, 4, { kind: 'lancer', owner: 'black' } as unknown as Piece)] },
      PositionError.INVALID_PIECE,
    );
    expectRejected(
      { stacks: [...KINGS, at(4, 4, { kind: 'pawn', owner: 'red' } as unknown as Piece)] },
      PositionError.INVALID_PIECE,
    );
    expectRejected(
      { stacks: KINGS, hands: { black: { lancer: 1 } as never } },
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

  it('§3.3 rejects more than 26 own pieces on the board', () => {
    // Marshal + 26 others, all within the §3.1 roster.
    const kinds: PieceKind[] = [
      ...Array<PieceKind>(6).fill('general'),
      ...Array<PieceKind>(4).fill('lieutenant'),
      ...Array<PieceKind>(4).fill('major'),
      ...Array<PieceKind>(9).fill('pawn'),
      'samurai',
      'samurai',
      'knight',
    ];
    expect(kinds.length).toBe(ARMY_LIMIT);
    const armyOf = (pieces: PieceKind[]) =>
      Array.from({ length: Math.ceil(pieces.length / 3) }, (_, i) =>
        at(i, 3, ...pieces.slice(i * 3, i * 3 + 3).map(B)),
      );
    const base = [at(4, 0, B('marshal')), at(0, 8, W('marshal'))];
    expect(positionError({ stacks: [...base, ...armyOf(kinds.slice(1))] })).toBeNull();
    const army = armyOf(kinds);
    expectRejected({ stacks: [...base, ...army] }, PositionError.ARMY_LIMIT);
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
  /** A white tier-3 cannon on (4, 6) attacking down file 4 (§5.3). */
  const whiteTower = at(4, 6, W('general'), W('general'), W('cannon'));
  /** Black's marshal on (4, 2), in reach of `whiteTower`. */
  const checked = [at(4, 2, B('marshal')), at(8, 8, W('marshal')), whiteTower];

  it('rejects black to move with white in check', () => {
    expectRejected(
      { stacks: [at(0, 0, B('marshal')), at(4, 4, B('pawn')), at(4, 5, W('marshal'))] },
      PositionError.OPPONENT_IN_CHECK,
    );
  });

  it('§11.1 accepts white to move with black in check at the start of play', () => {
    // Black finished placing first; white's last placement attacks black's marshal.
    expect(positionError({ stacks: checked, turn: 'white' })).toBeNull();
  });

  it('rejects that position once a quiet ply has been played', () => {
    expectRejected(
      { stacks: checked, turn: 'white', quietPlies: 1 },
      PositionError.OPPONENT_IN_CHECK,
    );
  });

  it('rejects it when white is in check as well (§9.5 white could not have finished)', () => {
    expectRejected(
      {
        stacks: [
          at(4, 2, B('marshal')),
          whiteTower,
          at(0, 2, B('general'), B('general'), B('cannon')),
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
    // Two white tier-3 cannons cover files 0 and 1 (§5.3).
    const s = createPosition({
      stacks: [
        at(0, 0, B('marshal')),
        at(0, 6, W('general'), W('general'), W('cannon')),
        at(1, 6, W('general'), W('general'), W('cannon')),
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
    if (rand() < 0.5) return Array.from({ length: size }, () => randomValue(rand, depth - 1));
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
