/**
 * Shared constants and types used by client, server and gungi-engine.
 * Validation schemas (Zod) and the kifu file format will live here.
 */

export const BOARD_SIZE = 9;
export const MAX_STACK_HEIGHT = 3;

export type PlayerSide = 'black' | 'white';

export interface Position {
  /** 0-indexed file (column), 0..BOARD_SIZE-1 */
  file: number;
  /** 0-indexed rank (row), 0..BOARD_SIZE-1 */
  rank: number;
  /** 0-indexed tier in the stack, 0..MAX_STACK_HEIGHT-1 */
  tier: number;
}
