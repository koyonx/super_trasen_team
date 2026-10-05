/**
 * Piece movement patterns (§5).
 *
 * Directions are written relative to the moving side: `[df, dr]` where
 * `dr > 0` is forward. They are rotated by 180 degrees for white (§2.2).
 */

import { forwardOf, getStack, isOnBoard } from './board';
import type { Board, Piece, PieceKind, Square } from './types';

export type Direction = readonly [df: number, dr: number];

export type MoveRule =
  /** §5.1 step up to `range` squares (extended by tier, §5.2). */
  | { readonly kind: 'step'; readonly dir: Direction; readonly range: number }
  /** §5.1 slide any distance (not affected by tier). */
  | { readonly kind: 'slide'; readonly dir: Direction }
  /**
   * §5.1 jump straight to `offset`, ignoring pieces in between. Each extra tier
   * adds one more landing square further forward (§5.2).
   */
  | { readonly kind: 'jump'; readonly offset: Direction };

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
const jump = (...offsets: Direction[]): MoveRule[] =>
  offsets.map((offset) => ({ kind: 'jump', offset }));

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
  cannon: [...jump([0, 3]), ...step(1, L, R, B)],
  archer: [...jump([0, 2], [-1, 2], [1, 2]), ...step(1, B)],
  musket: [...jump([0, 2]), ...step(1, BL, BR)],
  tactician: step(1, FL, FR, B),
};

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

  for (const rule of MOVE_RULES[piece.kind]) {
    if (rule.kind === 'jump') {
      const [df, dr] = rule.offset;
      for (let k = 0; k < tier; k++) {
        const file = from.file + df * s;
        const rank = from.rank + (dr + k) * s;
        if (isOnBoard(file, rank)) push(file, rank);
      }
      continue;
    }
    const [df, dr] = rule.dir;
    const max = rule.kind === 'slide' ? Infinity : rule.range + tier - 1;
    for (let k = 1; k <= max; k++) {
      const file = from.file + df * s * k;
      const rank = from.rank + dr * s * k;
      if (!isOnBoard(file, rank)) break;
      push(file, rank);
      if (getStack(board, { file, rank }).length > 0) break;
    }
  }
  return out;
}
