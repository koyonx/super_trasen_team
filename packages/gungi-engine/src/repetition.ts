/**
 * Position identity and repetition counting (§11.4).
 */

import { allSquares, getStack } from './board';
import { PIECE_GLYPHS } from './pieces';
import type { GameState, Hand } from './types';
import { PIECE_KINDS } from './types';

/** §11.4 the game ends when the same position appears for this many times. */
export const REPETITION_LIMIT = 4;

function handKey(hand: Hand): string {
  return PIECE_KINDS.map((k) => hand[k]).join(',');
}

/**
 * §11.4 canonical key identifying a position: board, both hands and side to
 * move. Black pieces are prefixed with `+`, white with `-`. Human-readable,
 * for kifu, analysis and AI; the engine stores `positionHash` instead.
 */
export function positionKey(state: Pick<GameState, 'board' | 'hands' | 'turn'>): string {
  const squares = allSquares().map((sq) =>
    getStack(state.board, sq)
      .map((p) => (p.owner === 'black' ? '+' : '-') + PIECE_GLYPHS[p.kind])
      .join(''),
  );
  return [
    squares.join('/'),
    handKey(state.hands.black),
    handKey(state.hands.white),
    state.turn === 'black' ? 'b' : 'w',
  ].join(' ');
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** Number of hex digits in a `positionHash` (64 bits). */
export const POSITION_HASH_LENGTH = 16;

/** The UTF-8 bytes of `text` (lone surrogates are encoded as U+FFFD). */
function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    let cp = char.codePointAt(0) ?? 0;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return bytes;
}

/** 64-bit FNV-1a of the UTF-8 bytes of `text`, as 16 lowercase hex digits. */
export function fnv1a64(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of utf8(text)) hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
  return hash.toString(16).padStart(POSITION_HASH_LENGTH, '0');
}

/**
 * §11.4 compact identity of a position: the 64-bit FNV-1a hash of
 * `positionKey`, as 16 hex digits. `positionCounts` is keyed by it so the
 * history stays small (a raw key is ~140 characters).
 *
 * Collisions: a false fourfold repetition needs two distinct positions of
 * the same counting window to share a hash. The window holds at most one
 * position per ply since the last irreversible move, so n is a few hundred
 * in practice. By the birthday bound the chance of any collision is at most
 * n^2 / 2^65: about 2.4e-15 for n = 300 and 2.7e-12 even for n = 10,000.
 * That is negligible next to any real failure, so 64 bits suffice.
 */
export function positionHash(state: Pick<GameState, 'board' | 'hands' | 'turn'>): string {
  return fnv1a64(positionKey(state));
}

/** Whether `key` has the form of a `positionHash` (16 lowercase hex digits). */
export function isPositionHash(key: string): boolean {
  return /^[0-9a-f]{16}$/.test(key);
}

function countOf(counts: Readonly<Record<string, number>>, hash: string): number {
  return Object.hasOwn(counts, hash) ? (counts[hash] ?? 0) : 0;
}

/** How often the current position has appeared since the last irreversible move. */
export function repetitions(state: GameState): number {
  return countOf(state.positionCounts, positionHash(state));
}

/**
 * §11.4 records the current position of a play-phase state. After an
 * irreversible move (capture, drop, betrayal) no earlier position can recur,
 * since pieces only leave the board and the hands, so counting restarts.
 */
export function recordPosition(state: GameState, irreversible: boolean): GameState {
  const hash = positionHash(state);
  if (irreversible) return { ...state, positionCounts: { [hash]: 1 } };
  const count = countOf(state.positionCounts, hash) + 1;
  return { ...state, positionCounts: { ...state.positionCounts, [hash]: count } };
}
