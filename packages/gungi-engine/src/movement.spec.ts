import { describe, expect, it } from 'vitest';
import { createEmptyBoard, forwardOf, setStack } from './board';
import { reachableSquares } from './movement';
import type { Board, Piece, PieceKind, PlayerSide, Square } from './types';

const CENTER: Square = { file: 4, rank: 4 };

/** Builds a stack of `tier` pieces at `at` with `kind` on top. */
function placeAtTier(board: Board, at: Square, kind: PieceKind, owner: PlayerSide, tier: number) {
  const below: Piece[] = Array.from({ length: tier - 1 }, () => ({ kind: 'pawn', owner }));
  return setStack(board, at, [...below, { kind, owner }]);
}

/** Reachable squares as offsets relative to the mover ("df,dr", dr>0 = forward). */
function reach(
  kind: PieceKind,
  tier = 1,
  owner: PlayerSide = 'black',
  setup: (b: Board) => Board = (b) => b,
  at: Square = CENTER,
): string[] {
  const board = setup(placeAtTier(createEmptyBoard(), at, kind, owner, tier));
  const s = forwardOf(owner);
  return reachableSquares(board, at, { kind, owner }, tier)
    .map((sq) => `${(sq.file - at.file) * s},${(sq.rank - at.rank) * s}`)
    .sort();
}

const offsets = (...pairs: [number, number][]) => pairs.map(([f, r]) => `${f},${r}`).sort();

/** Offsets of a ray from 1..n squares. */
const ray = (df: number, dr: number, n: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => [df * (i + 1), dr * (i + 1)]);

const KING8: [number, number][] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

describe('§5.3.1 帥 marshal', () => {
  it('tier 1: one square in 8 directions', () => {
    expect(reach('marshal')).toEqual(offsets(...KING8));
  });
  it('tier 2: two squares in 8 directions', () => {
    expect(reach('marshal', 2)).toEqual(offsets(...KING8.flatMap(([f, r]) => ray(f, r, 2))));
  });
  it('tier 3: three squares in 8 directions', () => {
    expect(reach('marshal', 3)).toEqual(offsets(...KING8.flatMap(([f, r]) => ray(f, r, 3))));
  });
});

describe('§5.3.2 大 general', () => {
  const orth = [...ray(0, 1, 4), ...ray(0, -1, 4), ...ray(1, 0, 4), ...ray(-1, 0, 4)];
  it('tier 1: orthogonal slides + diagonal step 1', () => {
    expect(reach('general')).toEqual(offsets(...orth, [1, 1], [-1, 1], [1, -1], [-1, -1]));
  });
  it('tier 3: slides unchanged, diagonals extend to 3', () => {
    const diag = [...ray(1, 1, 3), ...ray(-1, 1, 3), ...ray(1, -1, 3), ...ray(-1, -1, 3)];
    expect(reach('general', 3)).toEqual(offsets(...orth, ...diag));
  });
  it('slide is blocked by the first piece in the line (inclusive)', () => {
    const r = reach('general', 1, 'black', (b) =>
      setStack(b, { file: 4, rank: 6 }, [{ kind: 'pawn', owner: 'white' }]),
    );
    expect(r).toContain('0,2');
    expect(r).not.toContain('0,3');
  });
});

describe('§5.3.3 中 lieutenant', () => {
  const diag = [...ray(1, 1, 4), ...ray(-1, 1, 4), ...ray(1, -1, 4), ...ray(-1, -1, 4)];
  it('tier 1: diagonal slides + orthogonal step 1', () => {
    expect(reach('lieutenant')).toEqual(offsets(...diag, [0, 1], [0, -1], [1, 0], [-1, 0]));
  });
  it('tier 2: orthogonal steps extend to 2', () => {
    const orth = [...ray(0, 1, 2), ...ray(0, -1, 2), ...ray(1, 0, 2), ...ray(-1, 0, 2)];
    expect(reach('lieutenant', 2)).toEqual(offsets(...diag, ...orth));
  });
});

describe('§5.3.4 小 major', () => {
  it('tier 1: F, FL, FR, L, R, B', () => {
    expect(reach('major')).toEqual(offsets([0, 1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1]));
  });
  it('tier 2: each direction extends to 2', () => {
    expect(reach('major', 2)).toEqual(
      offsets(
        ...ray(0, 1, 2),
        ...ray(-1, 1, 2),
        ...ray(1, 1, 2),
        ...ray(-1, 0, 2),
        ...ray(1, 0, 2),
        ...ray(0, -1, 2),
      ),
    );
  });
});

describe('§5.3.5 侍 samurai', () => {
  it('tier 1: F, FL, FR, B', () => {
    expect(reach('samurai')).toEqual(offsets([0, 1], [-1, 1], [1, 1], [0, -1]));
  });
  it('tier 3: each direction extends to 3', () => {
    expect(reach('samurai', 3)).toEqual(
      offsets(...ray(0, 1, 3), ...ray(-1, 1, 3), ...ray(1, 1, 3), ...ray(0, -1, 3)),
    );
  });
});

describe('§5.3.6 槍 lancer', () => {
  it('tier 1: F up to 2, FL, FR, B', () => {
    expect(reach('lancer')).toEqual(offsets([0, 1], [0, 2], [-1, 1], [1, 1], [0, -1]));
  });
  it('tier 2: F up to 3, others up to 2', () => {
    expect(reach('lancer', 2)).toEqual(
      offsets(...ray(0, 1, 3), ...ray(-1, 1, 2), ...ray(1, 1, 2), ...ray(0, -1, 2)),
    );
  });
});

describe('§5.3.7 馬 knight', () => {
  it('tier 1: F/B up to 2, L/R 1', () => {
    expect(reach('knight')).toEqual(offsets([0, 1], [0, 2], [0, -1], [0, -2], [1, 0], [-1, 0]));
  });
  it('tier 2: F/B up to 3, L/R up to 2', () => {
    expect(reach('knight', 2)).toEqual(
      offsets(...ray(0, 1, 3), ...ray(0, -1, 3), ...ray(1, 0, 2), ...ray(-1, 0, 2)),
    );
  });
});

describe('§5.3.8 忍 shinobi', () => {
  it('tier 1: diagonals up to 2', () => {
    expect(reach('shinobi')).toEqual(
      offsets(...ray(1, 1, 2), ...ray(-1, 1, 2), ...ray(1, -1, 2), ...ray(-1, -1, 2)),
    );
  });
  it('tier 3: diagonals up to 4', () => {
    expect(reach('shinobi', 3)).toEqual(
      offsets(...ray(1, 1, 4), ...ray(-1, 1, 4), ...ray(1, -1, 4), ...ray(-1, -1, 4)),
    );
  });
});

describe('§5.3.9 砦 fortress', () => {
  it('tier 1: F, L, R, BL, BR', () => {
    expect(reach('fortress')).toEqual(offsets([0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1]));
  });
});

describe('§5.3.10 兵 pawn', () => {
  it('tier 1: F and B one square', () => {
    expect(reach('pawn')).toEqual(offsets([0, 1], [0, -1]));
  });
  it('tier 2: F and B up to 2', () => {
    expect(reach('pawn', 2)).toEqual(offsets(...ray(0, 1, 2), ...ray(0, -1, 2)));
  });
  it('tier 3: F and B up to 3', () => {
    expect(reach('pawn', 3)).toEqual(offsets(...ray(0, 1, 3), ...ray(0, -1, 3)));
  });
});

describe('§5.3.14 謀 tactician', () => {
  it('tier 1: FL, FR, B', () => {
    expect(reach('tactician')).toEqual(offsets([-1, 1], [1, 1], [0, -1]));
  });
});

describe('§2.2 orientation for white', () => {
  it('white pieces move toward lower ranks', () => {
    const board = setStack(createEmptyBoard(), CENTER, [{ kind: 'samurai', owner: 'white' }]);
    const squares = reachableSquares(board, CENTER, { kind: 'samurai', owner: 'white' }, 1);
    expect(squares).toContainEqual({ file: 4, rank: 3 });
    expect(squares).toContainEqual({ file: 4, rank: 5 });
    expect(squares).not.toContainEqual({ file: 3, rank: 5 });
    expect(squares).toContainEqual({ file: 3, rank: 3 });
  });
  it('relative pattern is identical for both sides', () => {
    expect(reach('lancer', 2, 'white')).toEqual(reach('lancer', 2, 'black'));
  });
});

describe('§5.1 step blocking and board edges', () => {
  it('a step ray stops at the first occupied square (which is still a candidate)', () => {
    const r = reach('pawn', 3, 'black', (b) =>
      setStack(b, { file: 4, rank: 5 }, [{ kind: 'pawn', owner: 'black' }]),
    );
    expect(r).toContain('0,1');
    expect(r).not.toContain('0,2');
  });
  it('moves never leave the board', () => {
    const r = reach('marshal', 3, 'black', (b) => b, { file: 0, rank: 0 });
    expect(r).toEqual(offsets(...ray(0, 1, 3), ...ray(1, 0, 3), ...ray(1, 1, 3)));
  });
});
