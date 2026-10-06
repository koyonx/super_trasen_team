import { describe, expect, it } from 'vitest';
import { createEmptyBoard, getStack, setStack } from './board';
import { dropMoves, executeDrop, frontLineRank, isInDropZone, validateDrop } from './drops';
import { placingError } from './placing';
import { createPosition } from './position';
import { B, W, at, sq } from './test-helpers';
import type { DropMove, GameState, PieceKind, PlayerSide } from './types';
import { MoveError } from './types';

const drop = (
  kind: PieceKind,
  file: number,
  rank: number,
  player: PlayerSide = 'black',
): DropMove => ({ type: 'drop', player, kind, to: sq(file, rank) });

function apply(state: GameState, move: DropMove): GameState {
  const error = validateDrop(state, move);
  if (error) throw new Error(`unexpected ${error}`);
  return executeDrop(state, move);
}

/** Black's front line is rank 4 (the pawn), white's is rank 8 (the marshal only). */
const base = (
  hand: Partial<Record<PieceKind, number>> = { pawn: 2, general: 1, fortress: 1 },
  turn: PlayerSide = 'black',
) =>
  createPosition({
    stacks: [at(4, 0, B('marshal')), at(4, 8, W('marshal')), at(0, 4, B('pawn'))],
    hands: { black: hand, white: hand },
    turn,
  });

describe('§8.1 drop basics', () => {
  it('places a hand piece on an empty square and passes the turn', () => {
    const next = apply(base(), drop('pawn', 2, 2));
    expect(getStack(next.board, sq(2, 2))).toEqual([B('pawn')]);
    expect(next.hands.black.pawn).toBe(1);
    expect(next.turn).toBe('white');
    expect(next.ply).toBe(1);
  });

  it('does not mutate the input state', () => {
    const s = base();
    const snapshot = JSON.stringify(s);
    apply(s, drop('pawn', 2, 2));
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('rejects pieces not in hand', () => {
    expect(validateDrop(base(), drop('archer', 2, 2))).toBe(MoveError.NOT_IN_HAND);
  });

  it('rejects malformed input, wrong turn and wrong phase', () => {
    expect(validateDrop(base(), drop('pawn', 2, 9))).toBe(MoveError.INVALID_SQUARE);
    expect(validateDrop(base(), drop('spear' as PieceKind, 2, 2))).toBe(MoveError.INVALID_MOVE);
    expect(validateDrop(base(), drop('pawn', 2, 8, 'white'))).toBe(MoveError.NOT_YOUR_TURN);
    expect(validateDrop({ ...base(), phase: 'placement' }, drop('pawn', 2, 2))).toBe(
      MoveError.WRONG_PHASE,
    );
  });
});

describe('§8.2 front line', () => {
  it('black may drop from its back rank up to its most advanced piece', () => {
    expect(frontLineRank(base().board, 'black')).toBe(4);
    expect(validateDrop(base(), drop('general', 8, 4))).toBeNull();
    expect(validateDrop(base(), drop('general', 8, 0))).toBeNull();
    expect(validateDrop(base(), drop('general', 8, 5))).toBe(MoveError.OUTSIDE_DROP_ZONE);
  });

  it('white counts its front line toward lower ranks', () => {
    const s = base(undefined, 'white');
    expect(frontLineRank(s.board, 'white')).toBe(8);
    expect(validateDrop(s, drop('general', 2, 8, 'white'))).toBeNull();
    expect(validateDrop(s, drop('general', 2, 7, 'white'))).toBe(MoveError.OUTSIDE_DROP_ZONE);
    const advanced = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 8, W('marshal')), at(7, 3, W('pawn'))],
      hands: { white: { general: 1 } },
      turn: 'white',
    });
    expect(validateDrop(advanced, drop('general', 0, 3, 'white'))).toBeNull();
    expect(validateDrop(advanced, drop('general', 0, 2, 'white'))).toBe(
      MoveError.OUTSIDE_DROP_ZONE,
    );
  });

  it('only the marshal on the back rank means drops on the back rank only', () => {
    const s = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 8, W('marshal'))],
      hands: { black: { general: 1 } },
    });
    expect(dropMoves(s, 'black').map((m) => m.to.rank)).toEqual(Array(8).fill(0));
  });

  it('R-5 a buried own piece counts toward the front line', () => {
    const s = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 8, W('marshal')), at(2, 6, B('pawn'), W('lancer'))],
      hands: { black: { general: 1 } },
    });
    expect(frontLineRank(s.board, 'black')).toBe(6);
    expect(validateDrop(s, drop('general', 7, 6))).toBeNull();
    expect(validateDrop(s, drop('general', 7, 7))).toBe(MoveError.OUTSIDE_DROP_ZONE);
  });

  it('enemy pieces do not move the front line', () => {
    const s = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 8, W('marshal')), at(2, 2, W('lancer'))],
      hands: { black: { general: 1 } },
    });
    expect(frontLineRank(s.board, 'black')).toBe(0);
  });

  it('a side with no piece on the board has no drop zone', () => {
    const board = setStack(createEmptyBoard(), sq(4, 4), [W('pawn')]);
    expect(frontLineRank(board, 'black')).toBeNull();
    expect(isInDropZone(board, 'black', 0)).toBe(false);
    expect(isInDropZone(board, 'white', 8)).toBe(true);
    expect(isInDropZone(board, 'white', 3)).toBe(false);
  });
});

describe('§8.3 drop targets', () => {
  it('may stack onto an own piece', () => {
    const next = apply(base(), drop('general', 0, 4));
    expect(getStack(next.board, sq(0, 4))).toEqual([B('pawn'), B('general')]);
  });

  it('may not drop onto an enemy piece', () => {
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 8, W('marshal')),
        at(0, 4, B('pawn')),
        at(1, 3, W('pawn'), W('general')),
      ],
      hands: { black: { general: 1 } },
    });
    expect(validateDrop(s, drop('general', 1, 3))).toBe(MoveError.OCCUPIED_BY_ENEMY);
    expect(dropMoves(s, 'black')).not.toContainEqual(drop('general', 1, 3));
  });

  it('may drop onto an own top above a buried enemy piece', () => {
    const s = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 8, W('marshal')), at(1, 3, W('pawn'), B('samurai'))],
      hands: { black: { general: 1 } },
    });
    const next = apply(s, drop('general', 1, 3));
    expect(getStack(next.board, sq(1, 3))).toEqual([W('pawn'), B('samurai'), B('general')]);
    expect(next.captured.black).toEqual([]);
  });

  it('the height condition does not apply to drops', () => {
    const s = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 8, W('marshal')), at(1, 3, B('pawn'), B('samurai'))],
      hands: { black: { general: 1 } },
    });
    expect(getStack(apply(s, drop('general', 1, 3)).board, sq(1, 3))).toHaveLength(3);
  });

  it('§4.4 / §4.1 may not drop onto a marshal or a full stack', () => {
    expect(validateDrop(base(), drop('general', 4, 0))).toBe(MoveError.CANNOT_STACK_ON_MARSHAL);
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 8, W('marshal')),
        at(0, 4, W('pawn'), W('samurai'), B('samurai')),
      ],
      hands: { black: { general: 1 } },
    });
    expect(validateDrop(s, drop('general', 0, 4))).toBe(MoveError.STACK_FULL);
  });

  it('§4.5 a fortress may be dropped onto a stack like any other piece', () => {
    const next = apply(base(), drop('fortress', 0, 4));
    expect(getStack(next.board, sq(0, 4))).toEqual([B('pawn'), B('fortress')]);
  });

  it('§8.4 a pawn may be dropped on a file that already holds an own pawn', () => {
    expect(validateDrop(base(), drop('pawn', 0, 1))).toBeNull();
    const next = apply(base(), drop('pawn', 0, 4));
    expect(getStack(next.board, sq(0, 4))).toEqual([B('pawn'), B('pawn')]);
  });

  it('placingError checks owner, marshal and height in that order', () => {
    const board = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 8, W('marshal')),
        at(2, 2, B('pawn'), B('pawn'), B('pawn')),
      ],
    }).board;
    expect(placingError(board, 'white', sq(4, 0))).toBe(MoveError.OCCUPIED_BY_ENEMY);
    expect(placingError(board, 'black', sq(4, 0))).toBe(MoveError.CANNOT_STACK_ON_MARSHAL);
    expect(placingError(board, 'black', sq(2, 2))).toBe(MoveError.STACK_FULL);
    expect(placingError(board, 'black', sq(3, 3))).toBeNull();
  });

  it('dropMoves only yields valid drops inside the zone', () => {
    const s = base();
    const moves = dropMoves(s, 'black');
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(validateDrop(s, m)).toBeNull();
    expect(moves.some((m) => m.to.rank > 4)).toBe(false);
    expect(moves).toContainEqual(drop('pawn', 0, 3));
    expect(moves).toContainEqual(drop('general', 0, 4));
    expect(moves).toContainEqual(drop('fortress', 0, 4));
    expect(moves).not.toContainEqual(drop('pawn', 4, 0));
    // 5 ranks x 9 files, minus the marshal square, for 3 kinds.
    expect(moves).toHaveLength((5 * 9 - 1) * 3);
  });

  it('dropMoves is empty with an empty hand', () => {
    expect(dropMoves(base({}), 'black')).toEqual([]);
  });
});
