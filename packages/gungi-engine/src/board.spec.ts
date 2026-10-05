import { describe, expect, it } from 'vitest';
import {
  allSquares,
  createEmptyBoard,
  findMarshal,
  forwardOf,
  getStack,
  hasRoom,
  isInTerritory,
  isValidSquare,
  setStack,
  topPiece,
} from './board';
import type { Piece } from './types';

const bp = (kind: Piece['kind']): Piece => ({ kind, owner: 'black' });

describe('§2.1 board', () => {
  it('is 9x9 and empty initially', () => {
    const board = createEmptyBoard();
    expect(board).toHaveLength(9);
    expect(board.every((row) => row.length === 9 && row.every((s) => s.length === 0))).toBe(true);
    expect(allSquares()).toHaveLength(81);
  });

  it('validates squares', () => {
    expect(isValidSquare({ file: 0, rank: 8 })).toBe(true);
    expect(isValidSquare({ file: 9, rank: 0 })).toBe(false);
    expect(isValidSquare({ file: -1, rank: 0 })).toBe(false);
    expect(isValidSquare({ file: 1.5, rank: 0 })).toBe(false);
    expect(isValidSquare(null)).toBe(false);
    expect(isValidSquare({ file: '1', rank: 0 })).toBe(false);
  });

  it('throws on out-of-board access (programmer error)', () => {
    expect(() => getStack(createEmptyBoard(), { file: 9, rank: 9 })).toThrow(RangeError);
  });
});

describe('§2.2 / §2.3 orientation and territory', () => {
  it('black moves toward higher ranks, white toward lower', () => {
    expect(forwardOf('black')).toBe(1);
    expect(forwardOf('white')).toBe(-1);
  });

  it('territories are the 3 back ranks', () => {
    expect([0, 1, 2].every((r) => isInTerritory('black', r))).toBe(true);
    expect(isInTerritory('black', 3)).toBe(false);
    expect([6, 7, 8].every((r) => isInTerritory('white', r))).toBe(true);
    expect(isInTerritory('white', 5)).toBe(false);
  });
});

describe('§4 stacks', () => {
  it('setStack is immutable', () => {
    const before = createEmptyBoard();
    const after = setStack(before, { file: 4, rank: 0 }, [bp('marshal')]);
    expect(getStack(before, { file: 4, rank: 0 })).toHaveLength(0);
    expect(topPiece(getStack(after, { file: 4, rank: 0 }))).toEqual(bp('marshal'));
    expect(after[1]).toBe(before[1]);
  });

  it('§4.1 allows at most 3 tiers', () => {
    expect(hasRoom([bp('pawn'), bp('pawn')])).toBe(true);
    expect(hasRoom([bp('pawn'), bp('pawn'), bp('pawn')])).toBe(false);
  });

  it('finds the marshal', () => {
    const board = setStack(createEmptyBoard(), { file: 3, rank: 1 }, [bp('pawn'), bp('marshal')]);
    expect(findMarshal(board, 'black')).toEqual({ file: 3, rank: 1 });
    expect(findMarshal(board, 'white')).toBeUndefined();
  });
});
