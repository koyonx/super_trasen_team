import { describe, expect, it } from 'vitest';
import { createEmptyBoard, forwardOf, setStack } from './board';
import { MOVE_RULES, reachableSquares } from './movement';
import { PIECE_GLYPHS } from './pieces';
import type { Board, Piece, PieceKind, PlayerSide, Square } from './types';
import { PIECE_KINDS } from './types';

const CENTER: Square = { file: 4, rank: 4 };
const SIDES: PlayerSide[] = ['black', 'white'];

/** Builds a stack of `tier` pieces at `at` with `kind` on top (fortresses below). */
function placeAtTier(board: Board, at: Square, kind: PieceKind, owner: PlayerSide, tier: number) {
  const below: Piece[] = Array.from({ length: tier - 1 }, () => ({ kind: 'fortress', owner }));
  return setStack(board, at, [...below, { kind, owner }]);
}

/** Converts absolute squares to offsets relative to the mover ("df,dr", dr>0 = forward). */
function relative(squares: Square[], at: Square, owner: PlayerSide): string[] {
  const s = forwardOf(owner);
  return squares.map((sq) => `${(sq.file - at.file) * s},${(sq.rank - at.rank) * s}`).sort();
}

/** Reachable squares as relative offsets on an otherwise empty (or `setup`) board. */
function reach(
  kind: PieceKind,
  tier = 1,
  owner: PlayerSide = 'black',
  setup: (b: Board) => Board = (b) => b,
  at: Square = CENTER,
): string[] {
  const board = setup(placeAtTier(createEmptyBoard(), at, kind, owner, tier));
  return relative(reachableSquares(board, at, { kind, owner }, tier), at, owner);
}

type Offset = [number, number];
const offsets = (...pairs: Offset[]) => pairs.map(([f, r]) => `${f},${r}`).sort();

/** Offsets of a ray from 1..n squares. */
const ray = (df: number, dr: number, n: number): Offset[] =>
  Array.from({ length: n }, (_, i) => [df * (i + 1), dr * (i + 1)]);

const ORTH: Offset[] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];
const DIAG: Offset[] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
const KING8: Offset[] = [...ORTH, ...DIAG];
const GOLD: Offset[] = [
  [0, 1],
  [-1, 1],
  [1, 1],
  [-1, 0],
  [1, 0],
  [0, -1],
];
const SILVER: Offset[] = [
  [0, 1],
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
];
/** Chebyshev ring of radius d. */
const ring = (d: number): Offset[] => {
  const out: Offset[] = [];
  for (let r = -d; r <= d; r++)
    for (let f = -d; f <= d; f++) if (Math.max(Math.abs(f), Math.abs(r)) === d) out.push([f, r]);
  return out;
};
/** Slides from the centre reach 4 squares in every direction on an empty board. */
const slides = (dirs: Offset[]): Offset[] => dirs.flatMap(([f, r]) => ray(f, r, 4));
const KNIGHT8: Offset[] = [
  [-1, 2],
  [1, 2],
  [-2, 1],
  [2, 1],
  [-1, -2],
  [1, -2],
  [-2, -1],
  [2, -1],
];

/** §5.3 expected reach from the centre of an empty board, per tier. */
const TABLE: Record<Exclude<PieceKind, 'tactician'>, [Offset[], Offset[], Offset[]]> = {
  marshal: [KING8, KING8, KING8],
  general: [GOLD, KING8, [...KING8, [-1, 2], [0, 2], [1, 2]]],
  lieutenant: [
    SILVER,
    [
      [0, 1],
      [-1, 1],
      [1, 1],
      [0, -1],
      [-1, -1],
      [1, -1],
    ],
    KING8,
  ],
  major: [
    [
      [-1, 1],
      [1, 1],
    ],
    SILVER,
    GOLD,
  ],
  samurai: [
    DIAG,
    [
      [-2, 2],
      [2, 2],
      [-2, -2],
      [2, -2],
    ],
    slides(DIAG),
  ],
  knight: [
    [
      [-1, 0],
      [1, 0],
      [-1, 2],
      [1, 2],
    ],
    [
      [-2, 1],
      [-1, 2],
      [1, 2],
      [2, 1],
    ],
    KNIGHT8,
  ],
  shinobi: [[[0, 1]], DIAG, slides(KING8)],
  fortress: [KING8, KING8, KING8],
  pawn: [
    [[0, 1]],
    [
      [0, 1],
      [-1, 1],
      [1, 1],
    ],
    [
      [0, 1],
      [-1, 1],
      [1, 1],
    ],
  ],
  cannon: [ORTH, ORTH.flatMap(([f, r]) => ray(f, r, 2)), slides(ORTH)],
  archer: [KING8, ring(2), ring(3)],
  musket: [[[0, 1]], ray(0, 1, 2), ray(0, 1, 4)],
};

const SECTION: Record<PieceKind, string> = {
  marshal: '§5.3.1',
  general: '§5.3.2',
  lieutenant: '§5.3.3',
  major: '§5.3.4',
  samurai: '§5.3.5',
  knight: '§5.3.6',
  shinobi: '§5.3.7',
  fortress: '§5.3.8',
  pawn: '§5.3.9',
  cannon: '§5.3.10',
  archer: '§5.3.11',
  musket: '§5.3.12',
  tactician: '§5.3.13',
};

describe('§5.3 movement table shape', () => {
  it('defines three tiers for every piece kind', () => {
    for (const kind of PIECE_KINDS) expect(MOVE_RULES[kind]).toHaveLength(3);
  });
  it('archer rings have 16 and 24 squares', () => {
    expect(TABLE.archer[1]).toHaveLength(16);
    expect(TABLE.archer[2]).toHaveLength(24);
  });
});

for (const kind of Object.keys(TABLE) as (keyof typeof TABLE)[]) {
  describe(`${SECTION[kind]} ${PIECE_GLYPHS[kind]} ${kind}`, () => {
    TABLE[kind].forEach((expected, index) => {
      const tier = index + 1;
      it.each(SIDES)(`tier ${tier} (%s)`, (owner) => {
        expect(reach(kind, tier, owner)).toEqual(offsets(...expected));
      });
    });
  });
}

describe('§5.3.13 謀 tactician tier 1', () => {
  it.each(SIDES)('one square in 8 directions (%s)', (owner) => {
    expect(reach('tactician', 1, owner)).toEqual(offsets(...KING8));
  });
});

describe('§2.2 orientation', () => {
  it('a black pawn moves toward higher ranks, a white pawn toward lower ranks', () => {
    for (const owner of SIDES) {
      const board = setStack(createEmptyBoard(), CENTER, [{ kind: 'pawn', owner }]);
      expect(reachableSquares(board, CENTER, { kind: 'pawn', owner }, 1)).toEqual([
        { file: 4, rank: owner === 'black' ? 5 : 3 },
      ]);
    }
  });
  it('the white knight jumps toward lower ranks', () => {
    const board = setStack(createEmptyBoard(), CENTER, [{ kind: 'knight', owner: 'white' }]);
    const squares = reachableSquares(board, CENTER, { kind: 'knight', owner: 'white' }, 1);
    expect(squares).toContainEqual({ file: 3, rank: 2 });
    expect(squares).not.toContainEqual({ file: 3, rank: 6 });
  });
});

describe('§5.1 step and slide blocking', () => {
  const blocker = (file: number, rank: number) => (b: Board) =>
    setStack(b, { file, rank }, [{ kind: 'pawn', owner: 'white' }]);

  it('a step ray stops at the first occupied square (which is still a candidate)', () => {
    const r = reach('cannon', 2, 'black', blocker(4, 5));
    expect(r).toContain('0,1');
    expect(r).not.toContain('0,2');
    expect(r).toContain('0,-2');
  });

  it('a slide stops at the first occupied square, inclusive', () => {
    const r = reach('musket', 3, 'black', blocker(4, 6));
    expect(r).toEqual(offsets([0, 1], [0, 2]));
  });

  it('own pieces block as well', () => {
    const r = reach('samurai', 3, 'black', (b) =>
      setStack(b, { file: 5, rank: 5 }, [{ kind: 'pawn', owner: 'black' }]),
    );
    expect(r).toContain('1,1');
    expect(r).not.toContain('2,2');
  });

  it('the shinobi slides in all 8 directions and is blocked per direction', () => {
    const r = reach('shinobi', 3, 'black', blocker(2, 2));
    expect(r).toContain('-2,-2');
    expect(r).not.toContain('-3,-3');
    expect(r).toContain('4,4');
  });
});

describe('§5.1 jumps', () => {
  const wall = (b: Board) => {
    let out = b;
    for (const [f, r] of KING8) {
      out = setStack(out, { file: 4 + f, rank: 4 + r }, [
        { kind: 'pawn', owner: 'white' },
        { kind: 'pawn', owner: 'white' },
        { kind: 'pawn', owner: 'white' },
      ]);
    }
    return out;
  };

  it('the archer jumps over a full ring of 3-high stacks', () => {
    expect(reach('archer', 2, 'black', wall)).toEqual(offsets(...ring(2)));
    expect(reach('archer', 3, 'black', wall)).toEqual(offsets(...ring(3)));
  });

  it('the samurai tier-2 jump ignores the diagonal neighbour', () => {
    expect(reach('samurai', 2, 'black', wall)).toEqual(offsets(...TABLE.samurai[1]));
  });

  it('the knight jumps over surrounding pieces', () => {
    expect(reach('knight', 3, 'black', wall)).toEqual(offsets(...KNIGHT8));
  });
});

describe('§5.3.2 general tier-3 jump via', () => {
  it('each two-forward landing needs its via square empty', () => {
    const r = reach('general', 3, 'black', (b) =>
      setStack(b, { file: 3, rank: 5 }, [{ kind: 'pawn', owner: 'white' }]),
    );
    expect(r).toContain('-1,1');
    expect(r).not.toContain('-1,2');
    expect(r).toContain('0,2');
    expect(r).toContain('1,2');
  });

  it('the via square is the same-file neighbour, not the straight line', () => {
    const r = reach('general', 3, 'black', (b) =>
      setStack(b, { file: 4, rank: 5 }, [{ kind: 'pawn', owner: 'black' }]),
    );
    expect(r).not.toContain('0,2');
    expect(r).toContain('-1,2');
    expect(r).toContain('1,2');
  });

  it('applies toward lower ranks for white', () => {
    const r = reach('general', 3, 'white', (b) =>
      setStack(b, { file: 4, rank: 3 }, [{ kind: 'pawn', owner: 'black' }]),
    );
    expect(r).not.toContain('0,2');
    expect(r).toContain('1,2');
  });
});

describe('§5 board edges', () => {
  it('moves never leave the board', () => {
    expect(reach('marshal', 1, 'black', (b) => b, { file: 0, rank: 0 })).toEqual(
      offsets([0, 1], [1, 0], [1, 1]),
    );
    expect(reach('archer', 3, 'white', (b) => b, { file: 8, rank: 8 })).toEqual(
      offsets([0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [3, 0]),
    );
  });

  it('slides run to the board edge', () => {
    expect(reach('musket', 3, 'black', (b) => b, { file: 0, rank: 0 })).toEqual(
      offsets(...ray(0, 1, 8)),
    );
  });

  it('the general tier-3 jump is clipped at the edge', () => {
    const r = reach('general', 3, 'black', (b) => b, { file: 4, rank: 7 });
    expect(r).not.toContain('0,2');
    expect(r).toContain('0,1');
  });
});

describe('§7 謀 mimicry', () => {
  const tower = (...pieces: Piece[]) => setStack(createEmptyBoard(), CENTER, pieces);
  const reachOf = (board: Board, owner: PlayerSide, tier: number) =>
    relative(reachableSquares(board, CENTER, { kind: 'tactician', owner }, tier), CENTER, owner);

  it('§7.2 tier 2 borrows the piece below at tier 2', () => {
    const board = tower({ kind: 'archer', owner: 'black' }, { kind: 'tactician', owner: 'black' });
    expect(reachOf(board, 'black', 2)).toEqual(offsets(...ring(2)));
  });

  it('§7.2 tier 3 borrows the piece directly below at tier 3', () => {
    const board = tower(
      { kind: 'pawn', owner: 'black' },
      { kind: 'samurai', owner: 'white' },
      { kind: 'tactician', owner: 'black' },
    );
    expect(reachOf(board, 'black', 3)).toEqual(offsets(...slides(DIAG)));
  });

  it("§7.2 borrows an enemy piece's pattern in the tactician's own direction", () => {
    const board = tower({ kind: 'pawn', owner: 'white' }, { kind: 'tactician', owner: 'black' });
    const squares = reachableSquares(board, CENTER, { kind: 'tactician', owner: 'black' }, 2);
    expect(squares).toContainEqual({ file: 4, rank: 5 });
    expect(squares).not.toContainEqual({ file: 4, rank: 3 });
    expect(reachOf(board, 'black', 2)).toEqual(offsets(...TABLE.pawn[1]));
  });

  it.each(SIDES)('§7.2 every borrowed kind matches the table (%s)', (owner) => {
    for (const kind of Object.keys(TABLE) as (keyof typeof TABLE)[]) {
      const board = tower(
        { kind: 'fortress', owner },
        { kind, owner: owner === 'black' ? 'white' : 'black' },
        { kind: 'tactician', owner },
      );
      expect(reachOf(board, owner, 3)).toEqual(offsets(...TABLE[kind][2]));
    }
  });

  it('§7.2 tier 3 on a tactician borrows the bottom piece', () => {
    const board = tower(
      { kind: 'cannon', owner: 'white' },
      { kind: 'tactician', owner: 'white' },
      { kind: 'tactician', owner: 'black' },
    );
    expect(reachOf(board, 'black', 3)).toEqual(offsets(...slides(ORTH)));
  });

  it('§7.2 tier 2 on a tactician falls back to one square in 8 directions', () => {
    const board = tower(
      { kind: 'tactician', owner: 'white' },
      { kind: 'tactician', owner: 'black' },
    );
    expect(reachOf(board, 'black', 2)).toEqual(offsets(...KING8));
  });

  it('a tactician with nothing below at tier 2 has no moves', () => {
    expect(reachOf(createEmptyBoard(), 'black', 2)).toEqual([]);
  });
});
