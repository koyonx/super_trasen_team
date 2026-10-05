/** Small builders shared by the spec files. */

import type { Piece, PieceKind, Square } from './types';

export const sq = (file: number, rank: number): Square => ({ file, rank });
export const B = (kind: PieceKind): Piece => ({ kind, owner: 'black' });
export const W = (kind: PieceKind): Piece => ({ kind, owner: 'white' });

/** A stack entry for createPosition: `at(4, 4, B('pawn'), W('samurai'))`. */
export const at = (file: number, rank: number, ...pieces: Piece[]) => ({
  square: sq(file, rank),
  pieces,
});
