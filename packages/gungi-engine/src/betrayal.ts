/**
 * Tactician betrayal (§7). Indices refer to positions in the target stack
 * before the tactician lands on it (bottom = 0).
 */

import type { Hand, PieceKind, PlayerSide, Stack } from './types';

/** §7.1 / §7.2 whether `betray` is a valid selection. */
export function isValidBetrayal(
  stack: Stack,
  player: PlayerSide,
  mover: PieceKind,
  hand: Hand,
  betray: readonly number[] | undefined,
): boolean {
  if (betray === undefined) return true;
  if (!Array.isArray(betray)) return false;
  if (betray.length === 0) return true;
  if (mover !== 'tactician') return false;
  const seen = new Set<number>();
  const need = new Map<PieceKind, number>();
  for (const index of betray) {
    if (!Number.isInteger(index) || seen.has(index)) return false;
    const piece = stack[index];
    if (!piece || piece.owner === player) return false;
    seen.add(index);
    need.set(piece.kind, (need.get(piece.kind) ?? 0) + 1);
  }
  for (const [kind, count] of need) {
    if (hand[kind] < count) return false;
  }
  return true;
}

export interface BetrayalOutcome {
  readonly stack: Stack;
  readonly hand: Hand;
  /** Kinds of the enemy pieces removed from the game. */
  readonly removed: PieceKind[];
}

/** §7.2 converts the selected enemy pieces, paying one hand piece per conversion. */
export function applyBetrayal(
  stack: Stack,
  player: PlayerSide,
  hand: Hand,
  betray: readonly number[] | undefined,
): BetrayalOutcome {
  if (!betray || betray.length === 0) return { stack, hand, removed: [] };
  const selected = new Set(betray);
  const nextHand = { ...hand };
  const removed: PieceKind[] = [];
  const nextStack = stack.map((piece, index) => {
    if (!selected.has(index)) return piece;
    nextHand[piece.kind] -= 1;
    removed.push(piece.kind);
    return { kind: piece.kind, owner: player };
  });
  return { stack: nextStack, hand: nextHand, removed };
}

/** Every valid betrayal selection, including "none" (`[]`). */
export function betrayalOptions(stack: Stack, player: PlayerSide, hand: Hand): number[][] {
  const enemyIndices = stack.flatMap((p, i) => (p.owner === player ? [] : [i]));
  const options: number[][] = [];
  const total = 1 << enemyIndices.length;
  for (let mask = 0; mask < total; mask++) {
    const subset = enemyIndices.filter((_, bit) => (mask >> bit) & 1);
    if (isValidBetrayal(stack, player, 'tactician', hand, subset)) options.push(subset);
  }
  return options;
}
