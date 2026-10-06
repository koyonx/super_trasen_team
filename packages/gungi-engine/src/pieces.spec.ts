import { describe, expect, it } from 'vitest';
import { PIECE_GLYPHS, ROSTER, emptyHand, handTotal, opponent, withHandDelta } from './pieces';
import { PIECE_KINDS } from './types';

describe('§3.1 piece roster', () => {
  it('defines 14 piece kinds', () => {
    expect(PIECE_KINDS).toHaveLength(14);
  });

  it('gives each player 25 pieces', () => {
    expect(handTotal(ROSTER)).toBe(25);
  });

  it.each([
    ['marshal', 1],
    ['general', 1],
    ['lieutenant', 1],
    ['major', 2],
    ['samurai', 2],
    ['lancer', 3],
    ['knight', 2],
    ['shinobi', 2],
    ['fortress', 2],
    ['pawn', 4],
    ['cannon', 1],
    ['archer', 2],
    ['musket', 1],
    ['tactician', 1],
  ] as const)('has %s x%i', (kind, count) => {
    expect(ROSTER[kind]).toBe(count);
  });

  it('maps every kind to a unique glyph', () => {
    const glyphs = PIECE_KINDS.map((k) => PIECE_GLYPHS[k]);
    expect(new Set(glyphs).size).toBe(14);
    expect(PIECE_GLYPHS.lancer).toBe('槍');
  });
});

describe('hand helpers', () => {
  it('builds an empty hand', () => {
    expect(handTotal(emptyHand())).toBe(0);
  });

  it('updates a hand without mutating the input', () => {
    const before = emptyHand();
    const after = withHandDelta(before, 'pawn', 2);
    expect(after.pawn).toBe(2);
    expect(before.pawn).toBe(0);
  });

  it('returns the opponent side', () => {
    expect(opponent('black')).toBe('white');
    expect(opponent('white')).toBe('black');
  });
});
