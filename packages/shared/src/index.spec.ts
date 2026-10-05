import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, MAX_STACK_HEIGHT } from './index';
import type { Position } from './index';

describe('shared constants and types', () => {
  it('exports board constants', () => {
    expect(BOARD_SIZE).toBe(9);
    expect(MAX_STACK_HEIGHT).toBe(3);
  });

  it('Position covers file/rank/tier', () => {
    const pos: Position = { file: 0, rank: 8, tier: 2 };
    expect(pos.tier).toBeLessThan(MAX_STACK_HEIGHT);
  });
});
