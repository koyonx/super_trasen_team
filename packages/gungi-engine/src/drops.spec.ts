import { describe, expect, it } from 'vitest';
import { getStack, isInDropZone, setStack } from './board';
import { dropMoves, executeDrop, validateDrop } from './drops';
import { ARMY_LIMIT } from './placing';
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
    expect(validateDrop(base(), drop('lancer' as PieceKind, 2, 2))).toBe(MoveError.INVALID_MOVE);
    expect(validateDrop(base(), drop('pawn', 2, 6, 'white'))).toBe(MoveError.NOT_YOUR_TURN);
    expect(validateDrop({ ...base(), phase: 'placement' }, drop('pawn', 2, 2))).toBe(
      MoveError.WRONG_PHASE,
    );
  });
});

describe('§8.2 / §2.4 drop zone (own six ranks)', () => {
  it('black may drop on ranks 0..5 only', () => {
    expect([0, 1, 2, 3, 4, 5].every((r) => isInDropZone('black', r))).toBe(true);
    expect([6, 7, 8].some((r) => isInDropZone('black', r))).toBe(false);
    expect(validateDrop(base(), drop('general', 2, 5))).toBeNull();
    expect(validateDrop(base(), drop('general', 2, 6))).toBe(MoveError.OUTSIDE_DROP_ZONE);
  });

  it('white may drop on ranks 3..8 only', () => {
    expect([3, 4, 5, 6, 7, 8].every((r) => isInDropZone('white', r))).toBe(true);
    expect([0, 1, 2].some((r) => isInDropZone('white', r))).toBe(false);
    const s = base(undefined, 'white');
    expect(validateDrop(s, drop('general', 2, 3, 'white'))).toBeNull();
    expect(validateDrop(s, drop('general', 2, 2, 'white'))).toBe(MoveError.OUTSIDE_DROP_ZONE);
  });

  it('the zone does not depend on where own pieces stand', () => {
    const s = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 8, W('marshal'))],
      hands: { black: { general: 1 } },
    });
    expect(validateDrop(s, drop('general', 0, 5))).toBeNull();
  });
});

describe('§8.3 drop targets', () => {
  it('may stack onto an own piece', () => {
    const next = apply(base(), drop('general', 0, 4));
    expect(getStack(next.board, sq(0, 4))).toEqual([B('pawn'), B('general')]);
  });

  it('may stack onto an enemy piece without capturing it', () => {
    const s = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 8, W('marshal')), at(1, 3, W('pawn'), W('general'))],
      hands: { black: { general: 1 } },
    });
    const next = apply(s, drop('general', 1, 3));
    expect(getStack(next.board, sq(1, 3))).toEqual([W('pawn'), W('general'), B('general')]);
    expect(next.captured.black).toEqual([]);
  });

  it('§4.4 / §4.1 may not drop onto a marshal or a full stack', () => {
    expect(validateDrop(base(), drop('general', 4, 0))).toBe(MoveError.CANNOT_STACK_ON_MARSHAL);
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 8, W('marshal')),
        at(0, 4, W('pawn'), B('general'), W('general')),
      ],
      hands: { black: { general: 1 } },
    });
    expect(validateDrop(s, drop('general', 0, 4))).toBe(MoveError.STACK_FULL);
  });

  it('§4.5 a fortress may only be dropped on an empty square', () => {
    expect(validateDrop(base(), drop('fortress', 0, 4))).toBe(MoveError.FORTRESS_CANNOT_STACK);
    expect(validateDrop(base(), drop('fortress', 1, 4))).toBeNull();
  });

  it('forbids a pawn on a file that already holds an own pawn (any rank or tier)', () => {
    expect(validateDrop(base(), drop('pawn', 0, 1))).toBe(MoveError.PAWN_FILE_OCCUPIED);
    expect(validateDrop(base(), drop('pawn', 0, 4))).toBe(MoveError.PAWN_FILE_OCCUPIED);
    const buried = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 8, W('marshal')), at(6, 7, B('pawn'), W('general'))],
      hands: { black: { pawn: 1 } },
    });
    expect(validateDrop(buried, drop('pawn', 6, 1))).toBe(MoveError.PAWN_FILE_OCCUPIED);
    expect(validateDrop(buried, drop('pawn', 5, 1))).toBeNull();
  });

  it('an enemy pawn on the file does not block', () => {
    const s = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 8, W('marshal')), at(2, 6, W('pawn'))],
      hands: { black: { pawn: 1 } },
    });
    expect(validateDrop(s, drop('pawn', 2, 1))).toBeNull();
  });

  it('§3.3 rejects drops while 26 own pieces are on the board', () => {
    let s = base({ general: 1 });
    let n = 2; // marshal + pawn
    for (let rank = 1; rank <= 3 && n < ARMY_LIMIT; rank++) {
      for (let file = 0; file < 9 && n < ARMY_LIMIT; file++) {
        s = { ...s, board: setStack(s.board, sq(file, rank), [B('general')]) };
        n++;
      }
    }
    expect(validateDrop(s, drop('general', 8, 5))).toBe(MoveError.ARMY_LIMIT);
    expect(dropMoves(s, 'black')).toEqual([]);
  });

  it('dropMoves only yields valid drops inside the zone', () => {
    const s = base();
    const moves = dropMoves(s, 'black');
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(validateDrop(s, m)).toBeNull();
    expect(moves.some((m) => m.to.rank > 5)).toBe(false);
    expect(moves.some((m) => m.kind === 'pawn' && m.to.file === 0)).toBe(false);
    expect(moves).toContainEqual(drop('general', 0, 4));
    expect(moves).not.toContainEqual(drop('fortress', 0, 4));
  });

  it('dropMoves is empty with an empty hand', () => {
    expect(dropMoves(base({}), 'black')).toEqual([]);
  });
});
