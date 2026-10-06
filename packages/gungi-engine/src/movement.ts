/**
 * Piece movement patterns (§5).
 *
 * Directions are written relative to the moving side: `[df, dr]` where
 * `dr > 0` is forward. They are rotated by 180 degrees for white (§2.2).
 * The table holds tier-1 patterns; higher tiers extend them (§5.2).
 */

import { forwardOf, getStack, isOnBoard } from './board';
import type { Board, Piece, PieceKind, Square } from './types';

export type Direction = readonly [df: number, dr: number];

export type MoveRule =
  /** §5.1 step up to `range` squares at tier 1 (extended by tier, §5.2). */
  | { readonly kind: 'step'; readonly dir: Direction; readonly range: number }
  /** §5.1 slide any distance (not affected by tier). */
  | { readonly kind: 'slide'; readonly dir: Direction }
  /**
   * §5.1 / §5.4 a jump ray. The tier-1 landing is `land`, reached by passing
   * over the `over` squares; each extra tier adds a landing one `extend`
   * further along the ray (§5.2), passing over every earlier landing as well.
   */
  | {
      readonly kind: 'jump';
      readonly over: readonly Direction[];
      readonly land: Direction;
      readonly extend: Direction;
    };

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

const step = (range: number, ...dirs: Direction[]): MoveRule[] =>
  dirs.map((dir) => ({ kind: 'step', dir, range }));
const slide = (...dirs: Direction[]): MoveRule[] => dirs.map((dir) => ({ kind: 'slide', dir }));
const jump = (land: Direction, extend: Direction, ...over: Direction[]): MoveRule => ({
  kind: 'jump',
  over,
  land,
  extend,
});

/** §5.3 movement table at tier 1. */
export const MOVE_RULES: Readonly<Record<PieceKind, readonly MoveRule[]>> = {
  marshal: step(1, ...ORTHOGONAL, ...DIAGONAL),
  general: [...slide(...ORTHOGONAL), ...step(1, ...DIAGONAL)],
  lieutenant: [...slide(...DIAGONAL), ...step(1, ...ORTHOGONAL)],
  major: step(1, F, FL, FR, L, R, B),
  samurai: step(1, F, FL, FR, B),
  lancer: [...step(2, F), ...step(1, FL, FR, B)],
  knight: [...step(2, F, B), ...step(1, L, R)],
  shinobi: step(2, ...DIAGONAL),
  fortress: step(1, F, L, R, BL, BR),
  pawn: step(1, F, B),
  cannon: [jump([0, 3], F, F, [0, 2]), ...step(1, L, R, B)],
  archer: [jump([-1, 2], FL, FL), jump([0, 2], F, F), jump([1, 2], FR, FR), ...step(1, B)],
  musket: [jump([0, 2], F, F), ...step(1, BL, BR)],
  tactician: step(1, FL, FR, B),
};

export interface JumpSquare {
  /** Landing offset, relative to the mover. */
  readonly landing: Direction;
  /** Offsets passed over on the way, nearest first (§5.4). */
  readonly over: readonly Direction[];
}

/**
 * §5.2 / §5.4 the landings of a jump ray at `tier`, nearest first, each with
 * the squares it passes over: the ray's `over` squares plus every earlier
 * landing.
 */
export function jumpSquares(rule: Extract<MoveRule, { kind: 'jump' }>, tier: number): JumpSquare[] {
  const out: JumpSquare[] = [];
  const passed: Direction[] = [...rule.over];
  for (let k = 0; k < tier; k++) {
    const landing: Direction = [
      rule.land[0] + rule.extend[0] * k,
      rule.land[1] + rule.extend[1] * k,
    ];
    out.push({ landing, over: [...passed] });
    passed.push(landing);
  }
  return out;
}

/**
 * Squares reached by one rule of the piece at `from` (see `reachableSquares`).
 * Exposed so the movement diagrams can tell step, slide and jump squares apart.
 */
export function ruleSquares(
  board: Board,
  from: Square,
  piece: Piece,
  rule: MoveRule,
  tier: number,
): Square[] {
  const s = forwardOf(piece.owner);
  const at = ([df, dr]: Direction): Square => ({
    file: from.file + df * s,
    rank: from.rank + dr * s,
  });
  const height = (sq: Square): number => getStack(board, sq).length;
  const out: Square[] = [];

  if (rule.kind === 'jump') {
    // §5.4 a stack higher than the mover's tier on the ray blocks the jump to
    // every landing beyond it; the landing square itself is never "passed".
    if (rule.over.some((d) => isOnBoard(at(d).file, at(d).rank) && height(at(d)) > tier)) {
      return out;
    }
    for (const { landing } of jumpSquares(rule, tier)) {
      const sq = at(landing);
      if (!isOnBoard(sq.file, sq.rank)) break;
      out.push(sq);
      if (height(sq) > tier) break;
    }
    return out;
  }

  const max = rule.kind === 'slide' ? Infinity : rule.range + tier - 1;
  for (let k = 1; k <= max; k++) {
    const sq = at([rule.dir[0] * k, rule.dir[1] * k]);
    if (!isOnBoard(sq.file, sq.rank)) break;
    out.push(sq);
    if (height(sq) > 0) break;
  }
  return out;
}

/**
 * Squares the piece could land on from `from` when it sits at `tier` (1-based),
 * considering only its movement pattern, line-of-sight blocking and the jump
 * height limit (§5). Whether the landing is a legal move/capture/stack is
 * decided by the rules module (§6).
 */
export function reachableSquares(board: Board, from: Square, piece: Piece, tier: number): Square[] {
  const seen = new Set<number>();
  const out: Square[] = [];
  for (const rule of MOVE_RULES[piece.kind]) {
    for (const sq of ruleSquares(board, from, piece, rule, tier)) {
      const key = sq.rank * 16 + sq.file;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(sq);
    }
  }
  return out;
}
