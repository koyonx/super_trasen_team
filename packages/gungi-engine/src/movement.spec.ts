import { describe, expect, it } from 'vitest';
import { createEmptyBoard, forwardOf, setStack } from './board';
import { MOVE_RULES, reachableSquares } from './movement';
import { PIECE_GLYPHS } from './pieces';
import type { Board, Piece, PieceKind, PlayerSide, Square } from './types';
import { PIECE_KINDS } from './types';

const CENTER: Square = { file: 4, rank: 4 };
const SIDES: PlayerSide[] = ['black', 'white'];

/** Builds a stack of `tier` pieces at `at` with `kind` on top (pawns below). */
function placeAtTier(board: Board, at: Square, kind: PieceKind, owner: PlayerSide, tier: number) {
  const below: Piece[] = Array.from({ length: tier - 1 }, () => ({ kind: 'pawn', owner }));
  return setStack(board, at, [...below, { kind, owner }]);
}

/** Converts absolute squares to offsets relative to the mover ("df,dr", dr>0 = forward). */
function relative(squares: Square[], at: Square, owner: PlayerSide): string[] {
  const s = forwardOf(owner);
  return squares.map((sq) => `${(sq.file - at.file) * s},${(sq.rank - at.rank) * s}`).sort();
}

/** Places `stack` at the offset (df, dr) relative to `at`, seen from `owner`. */
function putRelative(owner: PlayerSide, df: number, dr: number, stack: Piece[], at = CENTER) {
  const s = forwardOf(owner);
  return (b: Board) => setStack(b, { file: at.file + df * s, rank: at.rank + dr * s }, stack);
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

const F: Offset = [0, 1];
const B: Offset = [0, -1];
const L: Offset = [-1, 0];
const R: Offset = [1, 0];
const FL: Offset = [-1, 1];
const FR: Offset = [1, 1];
const BL: Offset = [-1, -1];
const BR: Offset = [1, -1];
const ORTH = [F, B, L, R];
const DIAG = [FL, FR, BL, BR];
const KING8 = [...ORTH, ...DIAG];

/** Offsets of a ray from 1..n squares. */
const ray = ([df, dr]: Offset, n: number): Offset[] =>
  Array.from({ length: n }, (_, i) => [df * (i + 1), dr * (i + 1)]);
/** Rays of length n in every given direction. */
const steps = (dirs: Offset[], n: number): Offset[] => dirs.flatMap((d) => ray(d, n));
/** Slides from the centre reach 4 squares in every direction on an empty board. */
const slides = (dirs: Offset[]): Offset[] => steps(dirs, 4);
/** Jump landings (df, dr), (df, dr + 1), ... for `tier` squares, kept on the board from the centre. */
const jumps = (df: number, dr: number, tier: number): Offset[] =>
  Array.from({ length: tier }, (_, k): Offset => [df, dr + k]).filter(([, r]) => r <= 4);

/** §5.3 / §5.2 expected reach from the centre of an empty board at tier t. */
const TABLE: Record<PieceKind, (t: number) => Offset[]> = {
  marshal: (t) => steps(KING8, t),
  general: (t) => [...slides(ORTH), ...steps(DIAG, t)],
  lieutenant: (t) => [...slides(DIAG), ...steps(ORTH, t)],
  major: (t) => steps([F, FL, FR, L, R, B], t),
  samurai: (t) => steps([F, FL, FR, B], t),
  lancer: (t) => [...ray(F, t + 1), ...steps([FL, FR, B], t)],
  knight: (t) => [...ray(F, t + 1), ...ray(B, t + 1), ...steps([L, R], t)],
  shinobi: (t) => steps(DIAG, t + 1),
  fortress: (t) => steps([F, L, R, BL, BR], t),
  pawn: (t) => steps([F, B], t),
  cannon: (t) => [...jumps(0, 3, t), ...steps([L, R, B], t)],
  archer: (t) => [...jumps(-1, 2, t), ...jumps(0, 2, t), ...jumps(1, 2, t), ...steps([B], t)],
  musket: (t) => [...jumps(0, 2, t), ...steps([BL, BR], t)],
  tactician: (t) => steps([FL, FR, B], t),
};

const SECTION: Record<PieceKind, string> = {
  marshal: '§5.3.1',
  general: '§5.3.2',
  lieutenant: '§5.3.3',
  major: '§5.3.4',
  samurai: '§5.3.5',
  lancer: '§5.3.6',
  knight: '§5.3.7',
  shinobi: '§5.3.8',
  fortress: '§5.3.9',
  pawn: '§5.3.10',
  cannon: '§5.3.11',
  archer: '§5.3.12',
  musket: '§5.3.13',
  tactician: '§5.3.14',
};

describe('§5.3 movement table shape', () => {
  it('defines a tier-1 pattern for every piece kind', () => {
    for (const kind of PIECE_KINDS) expect(MOVE_RULES[kind].length).toBeGreaterThan(0);
  });

  it('only the cannon, archer and musket jump, and only forward', () => {
    for (const kind of PIECE_KINDS) {
      const jumps = MOVE_RULES[kind].filter((r) => r.kind === 'jump');
      const jumpers: PieceKind[] = ['cannon', 'archer', 'musket'];
      expect(jumps.length > 0).toBe(jumpers.includes(kind));
      for (const r of jumps) if (r.kind === 'jump') expect(r.offset[1]).toBeGreaterThan(0);
    }
  });

  it('only the general and lieutenant slide', () => {
    const sliders = PIECE_KINDS.filter((k) => MOVE_RULES[k].some((r) => r.kind === 'slide'));
    expect(sliders).toEqual(['general', 'lieutenant']);
  });
});

for (const kind of PIECE_KINDS) {
  describe(`${SECTION[kind]} ${PIECE_GLYPHS[kind]} ${kind}`, () => {
    for (const tier of [1, 2, 3]) {
      it.each(SIDES)(`tier ${tier} (%s)`, (owner) => {
        expect(reach(kind, tier, owner)).toEqual(offsets(...TABLE[kind](tier)));
      });
    }
  });
}

describe('§5.2 tier extension examples', () => {
  it('a pawn steps 2 squares at tier 2 and 3 squares at tier 3', () => {
    expect(reach('pawn', 2)).toEqual(offsets([0, 1], [0, 2], [0, -1], [0, -2]));
    expect(reach('pawn', 3)).toContain('0,-3');
  });

  it('a tier-3 marshal steps 3 squares in all 8 directions', () => {
    expect(reach('marshal', 3)).toHaveLength(24);
  });

  it('a tier-2 cannon jumps to the 3rd and 4th squares ahead', () => {
    expect(reach('cannon', 2).filter((o) => o.startsWith('0,') && o !== '0,-1')).toEqual(
      offsets([0, -2], [0, 3], [0, 4]),
    );
  });

  it('a tier-2 archer reaches two ranks of three squares ahead', () => {
    expect(reach('archer', 2)).toEqual(
      offsets([-1, 2], [0, 2], [1, 2], [-1, 3], [0, 3], [1, 3], [0, -1], [0, -2]),
    );
  });

  it('slides are unaffected; the general only gains diagonal range', () => {
    const tier1 = reach('general', 1);
    const tier3 = reach('general', 3);
    expect(tier3.filter((o) => !tier1.includes(o)).sort()).toEqual(
      offsets([-2, 2], [2, 2], [-2, -2], [2, -2], [-3, 3], [3, 3], [-3, -3], [3, -3]),
    );
  });
});

describe('§2.2 orientation', () => {
  it('a black lancer advances toward higher ranks, a white lancer toward lower ranks', () => {
    for (const owner of SIDES) {
      const board = setStack(createEmptyBoard(), CENTER, [{ kind: 'lancer', owner }]);
      const squares = reachableSquares(board, CENTER, { kind: 'lancer', owner }, 1);
      const ahead = owner === 'black' ? 6 : 2;
      const behind = owner === 'black' ? 2 : 6;
      expect(squares).toContainEqual({ file: 4, rank: ahead });
      expect(squares).not.toContainEqual({ file: 4, rank: behind });
    }
  });

  it('the white cannon jumps toward lower ranks', () => {
    const board = setStack(createEmptyBoard(), CENTER, [{ kind: 'cannon', owner: 'white' }]);
    const squares = reachableSquares(board, CENTER, { kind: 'cannon', owner: 'white' }, 1);
    expect(squares).toContainEqual({ file: 4, rank: 1 });
    expect(squares).not.toContainEqual({ file: 4, rank: 7 });
  });
});

describe('§5.1 step and slide blocking', () => {
  const pawnAt = (df: number, dr: number, owner: PlayerSide = 'white') =>
    putRelative('black', df, dr, [{ kind: 'pawn', owner }]);

  it('a step ray stops at the first occupied square (which is still a candidate)', () => {
    const r = reach('knight', 1, 'black', pawnAt(0, 1));
    expect(r).toContain('0,1');
    expect(r).not.toContain('0,2');
    expect(r).toContain('0,-2');
  });

  it('a slide stops at the first occupied square, inclusive', () => {
    const r = reach('general', 1, 'black', pawnAt(0, 2));
    expect(r).toContain('0,2');
    expect(r).not.toContain('0,3');
    expect(r).toContain('0,-4');
  });

  it('own pieces block as well', () => {
    const r = reach('lieutenant', 1, 'black', pawnAt(1, 1, 'black'));
    expect(r).toContain('1,1');
    expect(r).not.toContain('2,2');
  });

  it('tier extension does not let a step pass over a piece', () => {
    const r = reach('shinobi', 3, 'black', pawnAt(-1, -1));
    expect(r).toContain('-1,-1');
    expect(r).not.toContain('-2,-2');
    expect(r).toContain('4,4');
  });

  it('blocking applies the same way for white', () => {
    const r = reach(
      'lancer',
      1,
      'white',
      putRelative('white', 0, 1, [{ kind: 'pawn', owner: 'black' }]),
    );
    expect(r).toContain('0,1');
    expect(r).not.toContain('0,2');
  });
});

describe('§5.4 jump height limit', () => {
  /** A stack of `height` white pawns. */
  const tower = (height: number): Piece[] =>
    Array.from({ length: height }, () => ({ kind: 'pawn', owner: 'white' }));
  const wall =
    (owner: PlayerSide, height: number, ...cells: Offset[]) =>
    (b: Board) =>
      cells.reduce((acc, [df, dr]) => putRelative(owner, df, dr, tower(height))(acc), b);

  it.each(SIDES)('a jump passes over pieces no higher than the mover (%s)', (owner) => {
    expect(reach('cannon', 1, owner, wall(owner, 1, [0, 1], [0, 2]))).toContain('0,3');
    expect(reach('musket', 1, owner, wall(owner, 1, [0, 1]))).toContain('0,2');
    expect(reach('archer', 1, owner, wall(owner, 1, [0, 1]))).toEqual(
      offsets([-1, 2], [0, 2], [1, 2], [0, -1]),
    );
  });

  it.each(SIDES)('a tier-1 jumper cannot pass over a 2-high stack (%s)', (owner) => {
    expect(reach('cannon', 1, owner, wall(owner, 2, [0, 2]))).not.toContain('0,3');
    expect(reach('musket', 1, owner, wall(owner, 2, [0, 1]))).not.toContain('0,2');
    expect(reach('archer', 1, owner, wall(owner, 2, [0, 1]))).toEqual(offsets([0, -1]));
  });

  it('a tier-2 archer passes over a 2-high stack but not a 3-high one', () => {
    expect(reach('archer', 2, 'black', wall('black', 2, [0, 1]))).toContain('0,2');
    expect(reach('archer', 2, 'black', wall('black', 3, [0, 1]))).toEqual(
      offsets([0, -1], [0, -2]),
    );
  });

  it('a tier-3 jumper passes over anything', () => {
    expect(reach('cannon', 3, 'black', wall('black', 3, [0, 1], [0, 2]))).toContain('0,3');
  });

  it('an extended landing also passes over the shorter landing square', () => {
    // Tier-2 cannon: (0,3) passes (0,1),(0,2); (0,4) also passes (0,3).
    const r = reach('cannon', 2, 'black', wall('black', 3, [0, 3]));
    expect(r).toContain('0,3');
    expect(r).not.toContain('0,4');
  });

  it('R-2 the archer diagonal landings pass over the square straight ahead only', () => {
    const r = reach('archer', 1, 'black', wall('black', 3, [-1, 1], [1, 1]));
    expect(r).toEqual(offsets([-1, 2], [0, 2], [1, 2], [0, -1]));
  });

  it('the landing square itself may hold a stack of any height', () => {
    expect(reach('musket', 1, 'black', wall('black', 3, [0, 2]))).toContain('0,2');
  });

  it('pieces passed over are irrelevant to the backward step', () => {
    const r = reach('musket', 1, 'black', wall('black', 3, [0, 1]));
    expect(r).toEqual(offsets([-1, -1], [1, -1]));
  });

  it('non-jumping pieces never pass over a piece, even a low one at a high tier', () => {
    expect(reach('lancer', 3, 'black', wall('black', 1, [0, 1]))).not.toContain('0,2');
  });
});

describe('§5 board edges', () => {
  it('moves never leave the board', () => {
    expect(reach('marshal', 1, 'black', (b) => b, { file: 0, rank: 0 })).toEqual(
      offsets([0, 1], [1, 0], [1, 1]),
    );
    expect(reach('archer', 3, 'white', (b) => b, { file: 8, rank: 8 })).toEqual(
      offsets([0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4]),
    );
  });

  it('slides run to the board edge', () => {
    expect(reach('general', 3, 'black', (b) => b, { file: 0, rank: 0 })).toEqual(
      offsets(...ray(F, 8), ...ray(R, 8), [1, 1], [2, 2], [3, 3]),
    );
  });

  it('jump landings beyond the edge are dropped individually', () => {
    expect(reach('cannon', 3, 'black', (b) => b, { file: 4, rank: 4 })).toContain('0,4');
    expect(reach('cannon', 3, 'black', (b) => b, { file: 4, rank: 5 })).toEqual(
      offsets([0, 3], [-1, 0], [-2, 0], [-3, 0], [1, 0], [2, 0], [3, 0], [0, -1], [0, -2], [0, -3]),
    );
  });
});
