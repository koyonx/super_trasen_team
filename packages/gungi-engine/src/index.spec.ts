import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, MAX_STACK_HEIGHT } from './index';

describe('gungi-engine constants', () => {
  it('uses a 9x9 board', () => {
    expect(BOARD_SIZE).toBe(9);
  });

  it('allows stacks up to 3 tiers', () => {
    expect(MAX_STACK_HEIGHT).toBe(3);
  });
});
