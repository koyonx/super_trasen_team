/**
 * Piece movement patterns (§5, §7).
 *
 * Directions are written relative to the moving side: `[df, dr]` where
 * `dr > 0` is forward. They are rotated by 180 degrees for white (§2.2).
 * Every tier has its own explicit rule list (§5.3); there is no generic
 * extension by tier.
 */

import { forwardOf, getStack, isOnBoard } from './board';
import type { Board, Piece, PieceKind, Square } from './types';

export type Direction = readonly [df: number, dr: number];

export type MoveRule =
  /** §5.1 step up to `range` squares, blocked by the first occupied square. */
  | { readonly kind: 'step'; readonly dir: Direction; readonly range: number }
  /** §5.1 slide any distance, blocked by the first occupied square. */
  | { readonly kind: 'slide'; readonly dir: Direction }
  /**
   * §5.1 land directly on `offset`, ignoring pieces in between. With `via`,
   * the landing is only possible while the `via` square is empty.
   */
  | { readonly kind: 'jump'; readonly offset: Direction; readonly via?: Direction }
  /** §7.2 borrow the movement of the piece directly below. */
  | { readonly kind: 'mimic' };

/** Rule lists for tiers 1, 2 and 3. */
export type TieredRules = readonly [
  tier1: readonly MoveRule[],
  tier2: readonly MoveRule[],
  tier3: readonly MoveRule[],
];

const F: Direction = [0, 1];
const B: Direction = [0, -1];
const L: Direction = [-1, 0];
const R: Direction = [1, 0];
const FL: Direction = [-1, 1];
const FR: Direction = [1, 1];
const BL: Direction = [-1, -1];
const BR: Direction = [1, -1];

const ORTHOGONAL = [F, B, L, R] as const;
const DIAGONAL = [FL, FR, BL, BR] as const;
const ALL8 = [...ORTHOGONAL, ...DIAGONAL] as const;

const step = (range: number, ...dirs: Direction[]): MoveRule[] =>
  dirs.map((dir) => ({ kind: 'step', dir, range }));
const slide = (...dirs: Direction[]): MoveRule[] => dirs.map((dir) => ({ kind: 'slide', dir }));
const jump = (...offsets: Direction[]): MoveRule[] =>
  offsets.map((offset) => ({ kind: 'jump', offset }));

/** Every offset at Chebyshev distance exactly `d` (the ring of a square). */
function ring(d: number): Direction[] {
  const out: Direction[] = [];
  for (let dr = -d; dr <= d; dr++) {
    for (let df = -d; df <= d; df++) {
      if (Math.max(Math.abs(df), Math.abs(dr)) === d) out.push([df, dr]);
    }
  }
  return out;
}

const KING = step(1, ...ALL8);
const GOLD = step(1, F, FL, FR, L, R, B);
const SILVER = step(1, F, FL, FR, BL, BR);

/** §5.3 movement table, one rule list per tier. */
export const MOVE_RULES: Readonly<Record<PieceKind, TieredRules>> = {
  marshal: [KING, KING, KING],
  general: [
    GOLD,
    KING,
    [
      ...KING,
      { kind: 'jump', offset: [-1, 2], via: [-1, 1] },
      { kind: 'jump', offset: [0, 2], via: [0, 1] },
      { kind: 'jump', offset: [1, 2], via: [1, 1] },
    ],
  ],
  lieutenant: [SILVER, step(1, F, FL, FR, B, BL, BR), KING],
  major: [step(1, FL, FR), SILVER, GOLD],
  samurai: [step(1, ...DIAGONAL), jump([-2, 2], [2, 2], [-2, -2], [2, -2]), slide(...DIAGONAL)],
  knight: [
    jump([-1, 0], [1, 0], [-1, 2], [1, 2]),
    jump([-2, 1], [-1, 2], [1, 2], [2, 1]),
    jump([-1, 2], [1, 2], [-2, 1], [2, 1], [-1, -2], [1, -2], [-2, -1], [2, -1]),
  ],
  shinobi: [step(1, F), step(1, ...DIAGONAL), slide(...ALL8)],
  fortress: [KING, KING, KING],
  pawn: [step(1, F), step(1, F, FL, FR), step(1, F, FL, FR)],
  cannon: [step(1, ...ORTHOGONAL), step(2, ...ORTHOGONAL), slide(...ORTHOGONAL)],
  archer: [KING, jump(...ring(2)), jump(...ring(3))],
  musket: [step(1, F), step(2, F), slide(F)],
  tactician: [KING, [{ kind: 'mimic' }], [{ kind: 'mimic' }]],
};

/**
 * §7.2 what a tactician at `from` borrows: the kind below it, `'king'` when it
 * sits on another tactician with nothing further to borrow, or `null` when
 * there is no piece below at all (it then has no moves).
 */
function mimickedKind(board: Board, from: Square, tier: number): PieceKind | 'king' | null {
  const stack = getStack(board, from);
  const below = stack[tier - 2];
  if (!below) return null;
  if (below.kind !== 'tactician') return below.kind;
  const deeper = tier === 3 ? stack[0] : undefined;
  return deeper && deeper.kind !== 'tactician' ? deeper.kind : 'king';
}

/**
 * Squares the piece could land on from `from` when it sits at `tier` (1-based),
 * considering only its movement pattern and line-of-sight blocking (§5).
 * Whether the landing is a legal move/capture/stack is decided by the rules
 * module (§6).
 */
export function reachableSquares(board: Board, from: Square, piece: Piece, tier: number): Square[] {
  const s = forwardOf(piece.owner);
  const seen = new Set<number>();
  const out: Square[] = [];
  const push = (file: number, rank: number): void => {
    const key = rank * 16 + file;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ file, rank });
  };
  const occupied = (file: number, rank: number): boolean =>
    getStack(board, { file, rank }).length > 0;

  const rules = MOVE_RULES[piece.kind][tier - 1] ?? [];
  for (const rule of rules) {
    if (rule.kind === 'mimic') {
      // §7.2 a tactician on top of a stack moves like the piece below it.
      const kind = mimickedKind(board, from, tier);
      if (kind === null) continue;
      const squares =
        kind === 'king'
          ? reachableSquares(board, from, { kind: 'marshal', owner: piece.owner }, 1)
          : reachableSquares(board, from, { kind, owner: piece.owner }, tier);
      for (const sq of squares) push(sq.file, sq.rank);
      continue;
    }
    if (rule.kind === 'jump') {
      const [df, dr] = rule.offset;
      const file = from.file + df * s;
      const rank = from.rank + dr * s;
      if (!isOnBoard(file, rank)) continue;
      if (rule.via) {
        const [vf, vr] = rule.via;
        if (occupied(from.file + vf * s, from.rank + vr * s)) continue;
      }
      push(file, rank);
      continue;
    }
    const [df, dr] = rule.dir;
    const max = rule.kind === 'slide' ? Infinity : rule.range;
    for (let k = 1; k <= max; k++) {
      const file = from.file + df * s * k;
      const rank = from.rank + dr * s * k;
      if (!isOnBoard(file, rank)) break;
      push(file, rank);
      if (occupied(file, rank)) break;
    }
  }
  return out;
}
