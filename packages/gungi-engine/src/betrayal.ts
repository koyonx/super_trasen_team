/**
 * Tactician betrayal (寝返り, §7).
 */

import type { Hand, Piece, PieceKind, PlayerSide, Stack } from './types';
import { MoveError, PIECE_KINDS } from './types';

/** §7.2 how many enemy pieces of each kind the stack holds for `player`. */
function enemyCounts(stack: Stack, player: PlayerSide): Map<PieceKind, number> {
  const need = new Map<PieceKind, number>();
  for (const p of stack) if (p.owner !== player) need.set(p.kind, (need.get(p.kind) ?? 0) + 1);
  return need;
}

/**
 * §7.1 / §7.2 why `piece` may not betray the enemy pieces of `target` when it
 * stacks onto it, paying from `hand`, or `null` if it may.
 */
export function betrayalError(piece: Piece, target: Stack, hand: Hand): MoveError | null {
  if (piece.kind !== 'tactician') return MoveError.INVALID_BETRAYAL;
  const need = enemyCounts(target, piece.owner);
  if (need.size === 0) return MoveError.INVALID_BETRAYAL;
  for (const kind of PIECE_KINDS) {
    if ((need.get(kind) ?? 0) > hand[kind]) return MoveError.BETRAYAL_HAND_SHORT;
  }
  return null;
}

export interface BetrayalOutcome {
  readonly stack: Stack;
  readonly hand: Hand;
  /** Kinds of the enemy pieces removed from the game, bottom to top. */
  readonly removed: PieceKind[];
}

/**
 * §7.2 replaces every enemy piece of `target` with a same-kind piece from
 * `hand`, in place. The caller must have checked `betrayalError`.
 */
export function applyBetrayal(target: Stack, player: PlayerSide, hand: Hand): BetrayalOutcome {
  const nextHand: Record<PieceKind, number> = { ...hand };
  const removed: PieceKind[] = [];
  const stack = target.map((p) => {
    if (p.owner === player) return p;
    nextHand[p.kind] -= 1;
    removed.push(p.kind);
    return { kind: p.kind, owner: player };
  });
  return { stack, hand: nextHand, removed };
}
