import { describe, expect, expectTypeOf, it } from 'vitest';
import { MoveError, PIECE_KINDS, createInitialState, legalMoves } from '@gungi/engine';
import type { Move, PlayerSide } from '@gungi/engine';
import { ENGINE_MOVE_ERROR_CODES, WS_PIECE_KINDS, clientMoveSchema } from '@gungi/shared';
import type { ClientMove } from '@gungi/shared';

/**
 * `@gungi/shared` cannot import the engine (the engine depends on it), so the
 * WebSocket contract mirrors a few engine definitions. These specs keep the
 * mirrors in sync.
 */
describe('ws contract mirrors the engine', () => {
  it('lists exactly the engine move error codes', () => {
    expect([...ENGINE_MOVE_ERROR_CODES].sort()).toEqual(Object.values(MoveError).sort());
  });

  it('lists exactly the engine piece kinds', () => {
    expect([...WS_PIECE_KINDS]).toEqual([...PIECE_KINDS]);
  });

  it('types a client move with its seat side as an engine move', () => {
    expectTypeOf<ClientMove & { player: PlayerSide }>().toExtend<Move>();
  });

  it('accepts every legal engine move of a placement position', () => {
    const state = createInitialState();
    for (const move of legalMoves(state)) {
      expect(clientMoveSchema.parse(move)).toEqual(move);
    }
  });
});
