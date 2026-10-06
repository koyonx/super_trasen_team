import { describe, expect, it } from 'vitest';
import * as engine from './index';
import { BOARD_SIZE, MAX_STACK_HEIGHT } from './index';

describe('gungi-engine constants', () => {
  it('uses a 9x9 board', () => {
    expect(BOARD_SIZE).toBe(9);
  });

  it('allows stacks up to 3 tiers', () => {
    expect(MAX_STACK_HEIGHT).toBe(3);
  });
});

describe('§12 public API', () => {
  it('exposes the lifecycle functions', () => {
    for (const name of [
      'createInitialState',
      'createPosition',
      'applyMove',
      'validateMove',
      'legalMoves',
      'isGameOver',
      'inCheck',
      'positionKey',
      'positionError',
    ] as const) {
      expect(typeof engine[name]).toBe('function');
    }
  });

  it('exposes every §12.3 error code', () => {
    expect(Object.keys(engine.MoveError)).toHaveLength(21);
  });

  it('exposes the createPosition error type', () => {
    expect(() => engine.createPosition({})).toThrow(engine.InvalidPositionError);
    expect(Object.keys(engine.PositionError)).toHaveLength(11);
  });

  it('plays a short game through the public API only', () => {
    const steps: engine.Move[] = [
      { type: 'place', player: 'black', kind: 'marshal', to: { file: 4, rank: 0 } },
      { type: 'place', player: 'white', kind: 'marshal', to: { file: 4, rank: 8 } },
      { type: 'place', player: 'black', kind: 'pawn', to: { file: 4, rank: 2 } },
      { type: 'finishPlacement', player: 'white' },
      { type: 'finishPlacement', player: 'black' },
      { type: 'move', player: 'white', from: { file: 4, rank: 8 }, to: { file: 4, rank: 7 } },
      { type: 'move', player: 'black', from: { file: 4, rank: 2 }, to: { file: 4, rank: 3 } },
      { type: 'resign', player: 'white' },
    ];
    let state = engine.createInitialState();
    for (const move of steps) {
      const result = engine.applyMove(state, move);
      expect(result.ok).toBe(true);
      if (result.ok) state = result.state;
    }
    expect(state.result).toEqual({ winner: 'black', reason: 'resignation' });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
