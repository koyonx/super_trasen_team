import { describe, expect, it } from 'vitest';
import { getStack } from './board';
import { dropMoves, executeDrop, frontLineRank, isInDropZone, validateDrop } from './drops';
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

/** Black front line at rank 4 (the pawn), kings far apart. */
const base = (hand: Partial<Record<PieceKind, number>> = { pawn: 2, tactician: 1 }) =>
  createPosition({
    stacks: [at(4, 0, B('marshal')), at(4, 8, W('marshal')), at(0, 4, B('pawn'))],
    hands: { black: hand, white: { pawn: 1 } },
  });

describe('§8.1 drop basics', () => {
  it('places a hand piece on an empty square and passes the turn', () => {
    const next = apply(base(), drop('pawn', 2, 2));
    expect(getStack(next.board, sq(2, 2))).toEqual([B('pawn')]);
    expect(next.hands.black.pawn).toBe(1);
    expect(next.turn).toBe('white');
    expect(next.ply).toBe(1);
  });

  it('rejects pieces not in hand', () => {
    expect(validateDrop(base(), drop('general', 2, 2))).toBe(MoveError.NOT_IN_HAND);
  });

  it('rejects malformed input, wrong turn and wrong phase', () => {
    expect(validateDrop(base(), drop('pawn', 2, 9))).toBe(MoveError.INVALID_SQUARE);
    expect(validateDrop(base(), drop('nope' as PieceKind, 2, 2))).toBe(MoveError.INVALID_MOVE);
    expect(validateDrop(base(), drop('pawn', 2, 6, 'white'))).toBe(MoveError.NOT_YOUR_TURN);
    expect(validateDrop({ ...base(), phase: 'placement' }, drop('pawn', 2, 2))).toBe(
      MoveError.WRONG_PHASE,
    );
  });
});

describe('§8.2 drop zone (front line)', () => {
  it('front line is the most advanced rank with an own top piece', () => {
    const s = base();
    expect(frontLineRank(s.board, 'black')).toBe(4);
    expect(frontLineRank(s.board, 'white')).toBe(8);
  });

  it('allows ranks up to the front line and rejects beyond it', () => {
    expect(validateDrop(base(), drop('pawn', 2, 4))).toBeNull();
    expect(validateDrop(base(), drop('pawn', 2, 5))).toBe(MoveError.OUTSIDE_DROP_ZONE);
  });

  it('a buried own piece does not extend the front line', () => {
    const s = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 8, W('marshal')), at(0, 6, B('pawn'), W('pawn'))],
    });
    expect(frontLineRank(s.board, 'black')).toBe(0);
    expect(isInDropZone(s.board, 'black', 1)).toBe(false);
  });

  it('white zone extends toward lower ranks', () => {
    const s = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 8, W('marshal')), at(3, 5, W('pawn'))],
    });
    expect(isInDropZone(s.board, 'white', 5)).toBe(true);
    expect(isInDropZone(s.board, 'white', 4)).toBe(false);
  });
});

describe('§8.3 drop targets', () => {
  it('may stack onto an own piece', () => {
    const next = apply(base(), drop('pawn', 0, 4));
    expect(getStack(next.board, sq(0, 4))).toEqual([B('pawn'), B('pawn')]);
  });

  it('may not drop onto an enemy piece (except tactician)', () => {
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 8, W('marshal')),
        at(0, 4, B('pawn')),
        at(1, 3, W('pawn')),
      ],
      hands: { black: { pawn: 1, tactician: 1 } },
    });
    expect(validateDrop(s, drop('pawn', 1, 3))).toBe(MoveError.OCCUPIED_BY_ENEMY);
    expect(validateDrop(s, drop('tactician', 1, 3))).toBeNull();
  });

  it('may not drop onto a marshal or a full stack', () => {
    expect(validateDrop(base(), drop('pawn', 4, 0))).toBe(MoveError.CANNOT_STACK_ON_MARSHAL);
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 8, W('marshal')),
        at(0, 4, B('pawn'), B('pawn'), B('pawn')),
      ],
      hands: { black: { pawn: 1 } },
    });
    expect(validateDrop(s, drop('pawn', 0, 4))).toBe(MoveError.STACK_FULL);
  });

  it('dropMoves only yields valid drops', () => {
    const s = base();
    const moves = dropMoves(s, 'black');
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(validateDrop(s, m)).toBeNull();
    expect(moves.some((m) => m.to.rank > 4)).toBe(false);
  });

  it('dropMoves is empty with an empty hand', () => {
    expect(dropMoves(base({}), 'black')).toEqual([]);
  });
});
