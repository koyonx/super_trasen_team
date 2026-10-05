import { describe, expect, it } from 'vitest';
import { getStack } from './board';
import { createPosition } from './position';
import { boardMoves, executeBoardMove, isInCheck, validateBoardMove } from './rules';
import { B, W, at, sq } from './test-helpers';
import type { BoardMove, GameState, Square } from './types';
import { MoveError } from './types';

const mv = (
  type: BoardMove['type'],
  from: Square,
  to: Square,
  player: BoardMove['player'] = 'black',
): BoardMove => ({ type, player, from, to });

function play(state: GameState, move: BoardMove): GameState {
  const error = validateBoardMove(state, move);
  if (error) throw new Error(`unexpected ${error}`);
  return executeBoardMove(state, move);
}

/** Kings far apart so they do not interfere. */
const KINGS = [at(0, 0, B('marshal')), at(8, 8, W('marshal'))];

describe('§6.1 move to an empty square', () => {
  const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn'))] });

  it('moves the piece and passes the turn', () => {
    const next = play(s, mv('move', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 4))).toEqual([]);
    expect(getStack(next.board, sq(4, 5))).toEqual([B('pawn')]);
    expect(next.turn).toBe('white');
    expect(next.ply).toBe(1);
  });

  it('rejects a square outside the movement pattern', () => {
    expect(validateBoardMove(s, mv('move', sq(4, 4), sq(5, 5)))).toBe(MoveError.UNREACHABLE);
    expect(validateBoardMove(s, mv('move', sq(4, 4), sq(4, 4)))).toBe(MoveError.UNREACHABLE);
  });

  it('rejects `move` onto an occupied square', () => {
    const t = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('pawn'))] });
    expect(validateBoardMove(t, mv('move', sq(4, 4), sq(4, 5)))).toBe(MoveError.TARGET_NOT_EMPTY);
  });

  it('rejects moving from an empty square or an enemy piece', () => {
    expect(validateBoardMove(s, mv('move', sq(3, 3), sq(3, 4)))).toBe(MoveError.NO_PIECE);
    expect(validateBoardMove(s, mv('move', sq(8, 8), sq(8, 7)))).toBe(MoveError.NOT_YOUR_PIECE);
  });

  it('rejects the wrong player, wrong phase and invalid squares', () => {
    expect(validateBoardMove(s, mv('move', sq(4, 4), sq(4, 5), 'white'))).toBe(
      MoveError.NOT_YOUR_TURN,
    );
    expect(validateBoardMove({ ...s, phase: 'placement' }, mv('move', sq(4, 4), sq(4, 5)))).toBe(
      MoveError.WRONG_PHASE,
    );
    expect(validateBoardMove(s, mv('move', sq(4, 4), sq(4, 9)))).toBe(MoveError.INVALID_SQUARE);
  });

  it('does not mutate the input state', () => {
    const snapshot = JSON.stringify(s);
    play(s, mv('move', sq(4, 4), sq(4, 5)));
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('§4.2 only the top piece moves', () => {
  it('moving the top reveals the piece below as the new top', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('fortress'), B('pawn'))] });
    const next = play(s, mv('move', sq(4, 4), sq(4, 6)));
    expect(getStack(next.board, sq(4, 4))).toEqual([B('fortress')]);
    expect(getStack(next.board, sq(4, 6))).toEqual([B('pawn')]);
  });

  it('a buried own piece cannot be moved', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn'), W('pawn'))] });
    expect(validateBoardMove(s, mv('move', sq(4, 4), sq(4, 5)))).toBe(MoveError.NOT_YOUR_PIECE);
  });
});

describe('§6.2 height rule (同段以下)', () => {
  it('a tier-1 piece cannot capture a height-2 stack', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('pawn'), W('samurai'))],
    });
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(4, 5)))).toBe(MoveError.TARGET_TOO_HIGH);
    expect(validateBoardMove(s, mv('stack', sq(4, 4), sq(4, 5)))).toBe(MoveError.TARGET_TOO_HIGH);
  });

  it('a tier-2 piece can capture a height-2 stack', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('fortress'), B('pawn')), at(4, 5, W('pawn'), W('samurai'))],
    });
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(4, 5)))).toBeNull();
  });

  it('a tier-1 piece can capture or stack on a height-1 stack', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('pawn'))] });
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(4, 5)))).toBeNull();
    expect(validateBoardMove(s, mv('stack', sq(4, 4), sq(4, 5)))).toBeNull();
  });
});

describe('§6.3 stack (ツケ)', () => {
  it('stacks onto an own piece and gains a tier', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, B('samurai'))] });
    const next = play(s, mv('stack', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([B('samurai'), B('pawn')]);
  });

  it('stacks onto an enemy piece without capturing it', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('samurai'))] });
    const next = play(s, mv('stack', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([W('samurai'), B('pawn')]);
    expect(next.captured.black).toEqual([]);
  });

  it('§4.1 rejects a 4th tier', () => {
    const s = createPosition({
      stacks: [
        ...KINGS,
        at(4, 4, B('pawn'), B('pawn'), B('pawn')),
        at(4, 5, W('pawn'), W('pawn'), W('pawn')),
      ],
    });
    expect(validateBoardMove(s, mv('stack', sq(4, 4), sq(4, 5)))).toBe(MoveError.STACK_FULL);
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(4, 5)))).toBeNull();
  });

  it('§4.4 rejects stacking on a marshal (own or enemy)', () => {
    const s = createPosition({
      stacks: [at(4, 5, B('marshal')), at(4, 4, B('pawn')), at(8, 8, W('marshal'))],
    });
    expect(validateBoardMove(s, mv('stack', sq(4, 4), sq(4, 5)))).toBe(
      MoveError.CANNOT_STACK_ON_MARSHAL,
    );
    const t = createPosition({
      stacks: [at(0, 0, B('marshal')), at(4, 4, B('pawn')), at(4, 5, W('marshal'))],
    });
    expect(validateBoardMove(t, mv('stack', sq(4, 4), sq(4, 5)))).toBe(
      MoveError.CANNOT_STACK_ON_MARSHAL,
    );
  });

  it('§4.4 the marshal itself may stack onto another piece', () => {
    const s = createPosition({ stacks: [at(4, 4, B('marshal')), at(4, 5, B('pawn')), KINGS[1]!] });
    const next = play(s, mv('stack', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([B('pawn'), B('marshal')]);
  });

  it('rejects stack/capture onto an empty square', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn'))] });
    expect(validateBoardMove(s, mv('stack', sq(4, 4), sq(4, 5)))).toBe(MoveError.TARGET_EMPTY);
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(4, 5)))).toBe(MoveError.TARGET_EMPTY);
  });

  it('rejects betrayal for non-tactician moves', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('samurai'))] });
    expect(validateBoardMove(s, { ...mv('stack', sq(4, 4), sq(4, 5)), betray: [0] })).toBe(
      MoveError.INVALID_BETRAYAL,
    );
  });
});

describe('§6.4 capture', () => {
  it('captures a single enemy piece', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('samurai'))] });
    const next = play(s, mv('capture', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([B('pawn')]);
    expect(next.captured.black).toEqual(['samurai']);
    expect(next.hands.black.samurai).toBe(0);
  });

  it('removes every enemy piece in the stack and keeps own pieces', () => {
    const s = createPosition({
      stacks: [
        ...KINGS,
        at(4, 4, B('pawn'), B('pawn'), B('samurai')),
        at(4, 5, W('pawn'), B('fortress'), W('lancer')),
      ],
    });
    const next = play(s, mv('capture', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([B('fortress'), B('samurai')]);
    expect([...next.captured.black].sort()).toEqual(['lancer', 'pawn']);
    expect(getStack(next.board, sq(4, 4))).toEqual([B('pawn'), B('pawn')]);
  });

  it('rejects capturing an own piece', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, B('samurai'))] });
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(4, 5)))).toBe(
      MoveError.CANNOT_CAPTURE_OWN,
    );
  });

  it('white captures toward lower ranks', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('pawn'))],
      turn: 'white',
    });
    const next = play(s, mv('capture', sq(4, 5), sq(4, 4), 'white'));
    expect(getStack(next.board, sq(4, 4))).toEqual([W('pawn')]);
    expect(next.turn).toBe('black');
  });

  it('a jumping piece captures over a blocker', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 2, B('cannon')), at(4, 3, W('pawn')), at(4, 5, W('general'))],
    });
    expect(validateBoardMove(s, mv('capture', sq(4, 2), sq(4, 5)))).toBeNull();
  });
});

describe('§6 boardMoves generation', () => {
  it('generates move/capture/stack options consistent with validation', () => {
    const s = createPosition({
      stacks: [
        ...KINGS,
        at(4, 4, B('fortress'), B('major')),
        at(4, 5, W('pawn')),
        at(3, 4, B('pawn')),
        at(5, 5, W('pawn'), W('pawn'), W('pawn')),
      ],
    });
    const moves = boardMoves(s, 'black');
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(validateBoardMove(s, m)).toBeNull();
    expect(moves).toContainEqual(mv('capture', sq(4, 4), sq(4, 5)));
    expect(moves).toContainEqual(mv('stack', sq(4, 4), sq(4, 5)));
    expect(moves).toContainEqual(mv('stack', sq(4, 4), sq(3, 4)));
    expect(moves.some((m) => m.to.file === 5 && m.to.rank === 5)).toBe(false);
  });

  it('a lone pawn in the middle has exactly two moves', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn'))] });
    const pawnMoves = boardMoves(s, 'black').filter((m) => m.from.file === 4);
    expect(pawnMoves).toHaveLength(2);
  });
});

describe('§10.1 check detection', () => {
  it('detects a marshal attacked by an adjacent enemy', () => {
    const board = createPosition({
      stacks: [at(4, 4, B('marshal')), at(4, 5, W('pawn')), at(8, 8, W('marshal'))],
    }).board;
    expect(isInCheck(board, 'black')).toBe(true);
    expect(isInCheck(board, 'white')).toBe(false);
  });

  it('a marshal on a taller stack is safe from a lower attacker', () => {
    const board = createPosition({
      stacks: [at(4, 4, B('pawn'), B('marshal')), at(4, 5, W('pawn')), at(8, 8, W('marshal'))],
    }).board;
    expect(isInCheck(board, 'black')).toBe(false);
  });

  it('a slide attack is blocked by an intervening piece', () => {
    const board = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 3, B('pawn')), at(4, 8, W('general')), KINGS[1]!],
    }).board;
    expect(isInCheck(board, 'black')).toBe(false);
  });
});

describe('§7 betrayal on a board stack move', () => {
  const setup = (hand: Partial<Record<'samurai' | 'pawn', number>>) =>
    createPosition({
      stacks: [...KINGS, at(4, 4, B('tactician')), at(3, 5, W('samurai'))],
      hands: { black: hand },
    });

  it('a tactician stacking onto an enemy may convert it', () => {
    const s = setup({ samurai: 1 });
    const next = play(s, { ...mv('stack', sq(4, 4), sq(3, 5)), betray: [0] });
    expect(getStack(next.board, sq(3, 5))).toEqual([B('samurai'), B('tactician')]);
    expect(next.hands.black.samurai).toBe(0);
    expect(next.captured.black).toEqual(['samurai']);
  });

  it('betrayal is not allowed with capture or plain move', () => {
    const s = setup({ samurai: 1 });
    expect(validateBoardMove(s, { ...mv('capture', sq(4, 4), sq(3, 5)), betray: [0] })).toBe(
      MoveError.INVALID_BETRAYAL,
    );
  });

  it('boardMoves offers stack with and without betrayal', () => {
    const moves = boardMoves(setup({ samurai: 1 }), 'black').filter(
      (m) => m.type === 'stack' && m.to.file === 3 && m.to.rank === 5,
    );
    expect(moves.map((m) => m.betray ?? [])).toEqual([[], [0]]);
  });

  it('without the matching hand piece only the plain stack is offered', () => {
    const moves = boardMoves(setup({ pawn: 1 }), 'black').filter(
      (m) => m.type === 'stack' && m.to.file === 3 && m.to.rank === 5,
    );
    expect(moves).toEqual([mv('stack', sq(4, 4), sq(3, 5))]);
  });
});
