import { describe, expect, it } from 'vitest';
import { createEmptyBoard, getStack, setStack } from './board';
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
    expect(validateBoardMove(s, mv('move', sq(4, 4), sq(4, 3)))).toBe(MoveError.UNREACHABLE);
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
    expect(validateBoardMove(s, mv('move', sq(-1, 4), sq(4, 5)))).toBe(MoveError.INVALID_SQUARE);
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
    const next = play(s, mv('move', sq(4, 4), sq(3, 5)));
    expect(getStack(next.board, sq(4, 4))).toEqual([B('fortress')]);
    expect(getStack(next.board, sq(3, 5))).toEqual([B('pawn')]);
  });

  it('a buried own piece cannot be moved', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn'), W('pawn'))] });
    expect(validateBoardMove(s, mv('move', sq(4, 4), sq(4, 5)))).toBe(MoveError.NOT_YOUR_PIECE);
  });

  it('§4.3 the landing tier sets the movement of the next turn', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('cannon')), at(4, 5, B('general'), B('general'))],
    });
    const next = play(s, mv('stack', sq(4, 4), sq(4, 5)));
    const again = { ...next, turn: 'black' as const };
    // A tier-1 cannon steps one square; on tier 3 it slides to the board edge.
    expect(validateBoardMove(s, mv('move', sq(4, 4), sq(3, 4)))).toBeNull();
    expect(validateBoardMove(s, mv('move', sq(4, 4), sq(2, 4)))).toBe(MoveError.UNREACHABLE);
    expect(validateBoardMove(again, mv('move', sq(4, 5), sq(4, 8)))).toBeNull();
    expect(validateBoardMove(again, mv('move', sq(4, 5), sq(0, 5)))).toBeNull();
  });
});

describe('§6.2 no height condition', () => {
  it('a tier-1 piece may capture the top of a 3-high stack', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('pawn'), W('pawn'), W('general'))],
    });
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(4, 5)))).toBeNull();
  });

  it('a tier-1 piece may stack onto a 2-high stack', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('pawn'), W('samurai'))],
    });
    const next = play(s, mv('stack', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([W('pawn'), W('samurai'), B('pawn')]);
  });
});

describe('§6.3 stack (ツケ)', () => {
  it('stacks onto an own piece and gains a tier', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, B('samurai'))] });
    const next = play(s, mv('stack', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([B('samurai'), B('pawn')]);
    expect(getStack(next.board, sq(4, 4))).toEqual([]);
  });

  it('stacks onto an enemy piece without capturing it', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('samurai'))] });
    const next = play(s, mv('stack', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([W('samurai'), B('pawn')]);
    expect(next.captured.black).toEqual([]);
  });

  it('§4.1 rejects a 4th tier (capture remains possible)', () => {
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

  it('§4.5 a fortress may not stack onto any piece', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('fortress')), at(4, 5, B('pawn')), at(5, 5, W('pawn'))],
    });
    expect(validateBoardMove(s, mv('stack', sq(4, 4), sq(4, 5)))).toBe(
      MoveError.FORTRESS_CANNOT_STACK,
    );
    expect(validateBoardMove(s, mv('stack', sq(4, 4), sq(5, 5)))).toBe(
      MoveError.FORTRESS_CANNOT_STACK,
    );
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(5, 5)))).toBeNull();
  });

  it('§4.5 other pieces may stack onto a fortress', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('fortress'))] });
    expect(validateBoardMove(s, mv('stack', sq(4, 4), sq(4, 5)))).toBeNull();
  });

  it('rejects stack/capture onto an empty square', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn'))] });
    expect(validateBoardMove(s, mv('stack', sq(4, 4), sq(4, 5)))).toBe(MoveError.TARGET_EMPTY);
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(4, 5)))).toBe(MoveError.TARGET_EMPTY);
  });
});

describe('§6.4 capture', () => {
  it('captures a lone enemy piece and moves onto the emptied square', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('samurai'))] });
    const next = play(s, mv('capture', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([B('pawn')]);
    expect(getStack(next.board, sq(4, 4))).toEqual([]);
    expect(next.captured.black).toEqual(['samurai']);
    expect(next.hands.black.samurai).toBe(0);
    expect(next.turn).toBe('white');
  });

  it('removes only the top and the capturer lands on the remaining stack', () => {
    // The worked example of §6.4: [白兵, 黒侍, 白大] taken by a black cannon.
    const s = createPosition({
      stacks: [
        ...KINGS,
        at(4, 4, B('pawn'), B('general'), B('cannon')),
        at(4, 5, W('pawn'), B('samurai'), W('general')),
      ],
    });
    const next = play(s, mv('capture', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([W('pawn'), B('samurai'), B('cannon')]);
    expect(getStack(next.board, sq(4, 4))).toEqual([B('pawn'), B('general')]);
    expect(next.captured.black).toEqual(['general']);
    expect(next.turn).toBe('white');
    expect(next.ply).toBe(1);
  });

  it('the capturer lands on an uncovered enemy piece', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('samurai'), W('general'))],
    });
    const next = play(s, mv('capture', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([W('samurai'), B('pawn')]);
    expect(getStack(next.board, sq(4, 4))).toEqual([]);
  });

  it('the capturer lands on an uncovered own piece', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, B('samurai'), W('general'))],
    });
    const next = play(s, mv('capture', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([B('samurai'), B('pawn')]);
  });

  it('§4.1 capturing the top of a 3-high stack keeps it at 3', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('pawn'), W('samurai'), W('general'))],
    });
    const next = play(s, mv('capture', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([W('pawn'), W('samurai'), B('pawn')]);
  });

  it('a capturer leaving a stack uncovers the piece below it', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn'), B('pawn')), at(5, 5, W('samurai'))],
    });
    const next = play(s, mv('capture', sq(4, 4), sq(5, 5)));
    expect(getStack(next.board, sq(5, 5))).toEqual([B('pawn')]);
    expect(getStack(next.board, sq(4, 4))).toEqual([B('pawn')]);
  });

  it('§4.5 a capturing fortress rises to tier 2 and keeps its movement', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('fortress')), at(4, 5, W('pawn'), W('samurai'))],
    });
    const next = play(s, mv('capture', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([W('pawn'), B('fortress')]);
    // §5.3.8 eight directions, one step, whatever the tier.
    const back = { ...next, turn: 'black' as const };
    const fromFortress = boardMoves(back, 'black').filter((m) => m.from.rank === 5);
    expect(fromFortress.filter((m) => m.type === 'move')).toHaveLength(8);
  });

  it('§4.5 a fortress reached by capture may be stacked on, and may climb to tier 3', () => {
    // A tier-2 black fortress is reachable as shown above; white then stacks on it.
    const s = createPosition({
      stacks: [
        ...KINGS,
        at(4, 4, W('pawn'), B('fortress'), W('general')),
        at(4, 3, B('fortress')),
        at(3, 3, B('pawn'), B('pawn'), W('samurai')),
      ],
      turn: 'white',
    });
    expect(validateBoardMove(s, mv('stack', sq(3, 3), sq(4, 4), 'white'))).toBe(
      MoveError.STACK_FULL,
    );
    const black = { ...s, turn: 'black' as const };
    // The second fortress still cannot stack, but its capture lands on tier 3.
    expect(validateBoardMove(black, mv('stack', sq(4, 3), sq(4, 4)))).toBe(
      MoveError.FORTRESS_CANNOT_STACK,
    );
    const next = play(black, mv('capture', sq(4, 3), sq(4, 4)));
    expect(getStack(next.board, sq(4, 4))).toEqual([W('pawn'), B('fortress'), B('fortress')]);
    expect(getStack(next.board, sq(4, 3))).toEqual([]);
  });

  it('§4.4 capturing a marshal on top of a stack lands on what is below it', () => {
    const s = createPosition({
      stacks: [at(0, 0, B('marshal')), at(4, 4, B('pawn')), at(4, 5, W('pawn'), W('marshal'))],
    });
    const next = play(s, mv('capture', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([W('pawn'), B('pawn')]);
    expect(next.captured.black).toEqual(['marshal']);
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
    expect(next.captured.white).toEqual(['pawn']);
    expect(next.turn).toBe('black');
  });

  it('a jumping piece captures over a blocker', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 2, B('knight')), at(4, 3, W('pawn')), at(5, 4, W('general'))],
    });
    expect(validateBoardMove(s, mv('capture', sq(4, 2), sq(5, 4)))).toBeNull();
  });
});

describe('§11.4 quiet-ply counter', () => {
  const s = createPosition({
    stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('pawn')), at(3, 5, B('general'))],
    quietPlies: 10,
  });
  it('move and stack increment it', () => {
    expect(play(s, mv('stack', sq(4, 4), sq(4, 5))).quietPlies).toBe(11);
    expect(play(s, mv('move', sq(3, 5), sq(3, 6))).quietPlies).toBe(11);
  });
  it('capture resets it', () => {
    expect(play(s, mv('capture', sq(4, 4), sq(4, 5))).quietPlies).toBe(0);
  });
});

describe('§6 boardMoves generation', () => {
  it('generates move/capture/stack options consistent with validation', () => {
    const s = createPosition({
      stacks: [
        ...KINGS,
        at(4, 4, B('fortress'), B('major')),
        at(4, 5, W('pawn')),
        at(3, 5, B('pawn')),
        at(5, 5, W('pawn'), W('pawn'), W('pawn')),
      ],
    });
    const moves = boardMoves(s, 'black');
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(validateBoardMove(s, m)).toBeNull();
    expect(moves).toContainEqual(mv('capture', sq(4, 4), sq(4, 5)));
    expect(moves).toContainEqual(mv('stack', sq(4, 4), sq(4, 5)));
    expect(moves).toContainEqual(mv('stack', sq(4, 4), sq(3, 5)));
    expect(moves).not.toContainEqual(mv('capture', sq(4, 4), sq(3, 5)));
    // Full enemy stack: capture only.
    expect(moves.filter((m) => m.to.file === 5 && m.to.rank === 5)).toEqual([
      mv('capture', sq(4, 4), sq(5, 5)),
    ]);
  });

  it('offers only capture against an enemy marshal and for a fortress', () => {
    const s = createPosition({
      stacks: [
        at(0, 0, B('marshal')),
        at(4, 4, B('fortress')),
        at(4, 5, W('marshal')),
        at(3, 5, W('pawn')),
      ],
    });
    const fromFortress = boardMoves(s, 'black').filter((m) => m.from.file === 4);
    expect(fromFortress.filter((m) => m.type === 'stack')).toEqual([]);
    expect(fromFortress).toContainEqual(mv('capture', sq(4, 4), sq(4, 5)));
    expect(fromFortress).toContainEqual(mv('capture', sq(4, 4), sq(3, 5)));
  });

  it('a lone tier-1 pawn in the middle has exactly one move', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn'))] });
    const pawnMoves = boardMoves(s, 'black').filter((m) => m.from.file === 4);
    expect(pawnMoves).toEqual([mv('move', sq(4, 4), sq(4, 5))]);
  });

  it('buried pieces generate nothing', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('cannon'), W('pawn'))] });
    expect(boardMoves(s, 'black').some((m) => m.from.file === 4)).toBe(false);
    // The white pawn on tier 2 moves F, FL, FR (toward lower ranks).
    expect(
      boardMoves(s, 'white')
        .filter((m) => m.from.file === 4 && m.from.rank === 4)
        .map((m) => `${m.to.file},${m.to.rank}`)
        .sort(),
    ).toEqual(['3,3', '4,3', '5,3']);
  });
});

describe('§7 謀 mimicry in board moves', () => {
  it('a tier-2 tactician moves like the piece below it', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, W('knight'), B('tactician'))],
    });
    const moves = boardMoves(s, 'black').filter((m) => m.from.file === 4 && m.from.rank === 4);
    expect(moves.map((m) => `${m.to.file},${m.to.rank}`).sort()).toEqual(
      ['2,5', '3,6', '5,6', '6,5'].sort(),
    );
  });

  it('after leaving the stack it moves as a tier-1 tactician', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, W('knight'), B('tactician'))] });
    const next = play(s, mv('move', sq(4, 4), sq(3, 6)));
    const again = { ...next, turn: 'black' as const };
    expect(validateBoardMove(again, mv('move', sq(3, 6), sq(3, 5)))).toBeNull();
    expect(validateBoardMove(again, mv('move', sq(3, 6), sq(5, 7)))).toBe(MoveError.UNREACHABLE);
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

  it('a marshal on a taller stack is still attacked by a tier-1 piece', () => {
    const board = createPosition({
      stacks: [at(4, 4, B('pawn'), B('marshal')), at(4, 5, W('pawn')), at(8, 8, W('marshal'))],
    }).board;
    expect(isInCheck(board, 'black')).toBe(true);
  });

  it('a slide attack is blocked by an intervening piece', () => {
    const tower = at(4, 8, W('general'), W('general'), W('cannon'));
    const open = createPosition({
      stacks: [at(4, 0, B('marshal')), tower, at(0, 8, W('marshal'))],
    });
    expect(isInCheck(open.board, 'black')).toBe(true);
    const blocked = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 3, B('pawn')), tower, at(0, 8, W('marshal'))],
    });
    expect(isInCheck(blocked.board, 'black')).toBe(false);
  });

  it('buried enemy pieces do not attack', () => {
    const board = createPosition({
      stacks: [at(4, 4, B('marshal')), at(4, 5, W('pawn'), B('pawn')), at(8, 8, W('marshal'))],
    }).board;
    expect(isInCheck(board, 'black')).toBe(false);
  });

  it('a mimicking tactician gives check', () => {
    const board = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 4, B('pawn'), B('cannon'), W('tactician')),
        at(8, 8, W('marshal')),
      ],
    }).board;
    expect(isInCheck(board, 'black')).toBe(true);
  });

  it('a side without a marshal is never in check', () => {
    const board = setStack(createEmptyBoard(), sq(4, 4), [W('pawn')]);
    expect(isInCheck(board, 'black')).toBe(false);
  });
});
