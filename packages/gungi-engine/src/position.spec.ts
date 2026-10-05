import { describe, expect, it } from 'vitest';
import { ARMY_LIMIT } from './placing';
import type { PositionSetup } from './position';
import { InvalidPositionError, PositionError, createPosition, positionError } from './position';
import { B, W, at, sq } from './test-helpers';
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
