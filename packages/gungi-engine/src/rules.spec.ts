import { describe, expect, it } from 'vitest';
import { createEmptyBoard, getStack, setStack } from './board';
import { createPosition } from './position';
import { boardMoves, executeBoardMove, isInCheck, validateBoardMove } from './rules';
import { B, W, at, sq } from './test-helpers';
import type { BoardMove, GameState, Piece, PlayerSide, Square } from './types';
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

/**
 * A state whose board is put together directly, without the §12.1 checks of
 * `createPosition`. Used only where the side to move can take the enemy
 * marshal, which no legal game reaches (§11.1) but the move rules still define.
 */
function raw(turn: PlayerSide, ...stacks: { square: Square; pieces: Piece[] }[]): GameState {
  const base = createPosition({ stacks: KINGS, turn });
  const board = stacks.reduce((b, s) => setStack(b, s.square, s.pieces), createEmptyBoard());
  return { ...base, board };
}

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
    expect(validateBoardMove(s, mv('move', sq(4, 4), sq(4, 6)))).toBe(MoveError.UNREACHABLE);
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
    const next = play(s, mv('move', sq(4, 4), sq(4, 6)));
    expect(getStack(next.board, sq(4, 4))).toEqual([B('fortress')]);
    expect(getStack(next.board, sq(4, 6))).toEqual([B('pawn')]);
  });

  it('a buried own piece cannot be moved', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn'), W('pawn'))] });
    expect(validateBoardMove(s, mv('move', sq(4, 4), sq(4, 5)))).toBe(MoveError.NOT_YOUR_PIECE);
  });

  it('§4.3 the landing tier sets the movement of the next turn', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('lancer'), B('pawn')), at(4, 5, B('lancer'), B('lancer'))],
    });
    // A tier-2 pawn steps two squares.
    expect(validateBoardMove(s, mv('move', sq(4, 4), sq(4, 2)))).toBeNull();
    expect(validateBoardMove(s, mv('move', sq(4, 4), sq(4, 1)))).toBe(MoveError.UNREACHABLE);
    const next = play(s, mv('stack', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([B('lancer'), B('lancer'), B('pawn')]);
    // On tier 3 it steps three squares.
    const again = { ...next, turn: 'black' as const };
    expect(validateBoardMove(again, mv('move', sq(4, 5), sq(4, 8)))).toBeNull();
  });
});

describe('§6.2 height condition', () => {
  it('a tier-1 piece may neither capture nor stack onto a 2-high stack', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('pawn'), W('samurai'))],
    });
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(4, 5)))).toBe(MoveError.TARGET_TOO_HIGH);
    expect(validateBoardMove(s, mv('stack', sq(4, 4), sq(4, 5)))).toBe(MoveError.TARGET_TOO_HIGH);
    expect(boardMoves(s, 'black').filter((m) => m.to.rank === 5 && m.to.file === 4)).toEqual([]);
  });

  it('a tier-2 piece may capture or stack onto a 2-high stack', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('lancer'), B('pawn')), at(4, 5, W('pawn'), W('samurai'))],
    });
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(4, 5)))).toBeNull();
    const next = play(s, mv('stack', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([W('pawn'), W('samurai'), B('pawn')]);
  });

  it('a tier-2 piece may not take a 3-high stack', () => {
    const s = createPosition({
      stacks: [
        ...KINGS,
        at(4, 4, B('lancer'), B('pawn')),
        at(4, 5, W('pawn'), W('samurai'), W('lancer')),
      ],
    });
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(4, 5)))).toBe(MoveError.TARGET_TOO_HIGH);
  });

  it('a higher piece may always take or stack onto a lower stack', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn'), B('pawn'), B('lancer')), at(4, 5, W('samurai'))],
    });
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(4, 5)))).toBeNull();
    expect(validateBoardMove(s, mv('stack', sq(4, 4), sq(4, 5)))).toBeNull();
  });

  it('the height condition is checked after reachability', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn')), at(5, 5, W('pawn'), W('samurai'))],
    });
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(5, 5)))).toBe(MoveError.UNREACHABLE);
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
    const t = raw('white', at(4, 2, B('marshal')), at(4, 3, W('pawn')), at(8, 8, W('marshal')));
    expect(validateBoardMove(t, mv('stack', sq(4, 3), sq(4, 2), 'white'))).toBe(
      MoveError.CANNOT_STACK_ON_MARSHAL,
    );
  });

  it('§4.4 the marshal itself may stack onto another piece', () => {
    const s = createPosition({ stacks: [at(4, 4, B('marshal')), at(4, 5, B('pawn')), KINGS[1]!] });
    const next = play(s, mv('stack', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([B('pawn'), B('marshal')]);
  });

  it('§4.5 a fortress may stack onto own and enemy pieces', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('fortress')), at(4, 5, B('pawn')), at(5, 4, W('pawn'))],
    });
    expect(validateBoardMove(s, mv('stack', sq(4, 4), sq(4, 5)))).toBeNull();
    expect(validateBoardMove(s, mv('stack', sq(4, 4), sq(5, 4)))).toBeNull();
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(5, 4)))).toBeNull();
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

  it('removes every enemy piece of the stack and keeps own pieces below the capturer', () => {
    // The worked example of §6.4: [白兵, 黒侍, 白槍] taken by a tier-3 black general.
    const s = createPosition({
      stacks: [
        ...KINGS,
        at(4, 2, B('pawn'), B('pawn'), B('general')),
        at(4, 5, W('pawn'), B('samurai'), W('lancer')),
      ],
    });
    const next = play(s, mv('capture', sq(4, 2), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([B('samurai'), B('general')]);
    expect(getStack(next.board, sq(4, 2))).toEqual([B('pawn'), B('pawn')]);
    expect(next.captured.black).toEqual(['pawn', 'lancer']);
    expect(next.turn).toBe('white');
    expect(next.ply).toBe(1);
  });

  it('takes an enemy piece buried under the enemy top as well', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('lancer'), B('pawn')), at(4, 5, W('samurai'), W('lancer'))],
    });
    const next = play(s, mv('capture', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([B('pawn')]);
    expect(next.captured.black).toEqual(['samurai', 'lancer']);
  });

  it('own pieces under the enemy top stay and the capturer lands on them', () => {
    const s = createPosition({
      stacks: [
        ...KINGS,
        at(4, 4, B('pawn'), B('pawn'), B('lancer')),
        at(4, 5, B('pawn'), B('samurai'), W('lancer')),
      ],
    });
    const next = play(s, mv('capture', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([B('pawn'), B('samurai'), B('lancer')]);
    expect(next.captured.black).toEqual(['lancer']);
  });

  it('an enemy piece buried under an own top cannot be captured (stack only)', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('lancer'), B('pawn')), at(4, 5, W('samurai'), B('pawn'))],
    });
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(4, 5)))).toBe(
      MoveError.CANNOT_CAPTURE_OWN,
    );
    expect(validateBoardMove(s, mv('stack', sq(4, 4), sq(4, 5)))).toBeNull();
  });

  it('a capturer leaving a stack uncovers the piece below it', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn'), B('lancer')), at(5, 5, W('samurai'))],
    });
    const next = play(s, mv('capture', sq(4, 4), sq(5, 5)));
    expect(getStack(next.board, sq(5, 5))).toEqual([B('lancer')]);
    expect(getStack(next.board, sq(4, 4))).toEqual([B('pawn')]);
  });

  it('§4.5 a capturing fortress lands on its own pieces and moves at its new tier', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn'), B('fortress')), at(4, 5, B('pawn'), W('samurai'))],
    });
    const next = play(s, mv('capture', sq(4, 4), sq(4, 5)));
    expect(getStack(next.board, sq(4, 5))).toEqual([B('pawn'), B('fortress')]);
    // §5.3.9 F, L, R, BL, BR with range 2 at tier 2.
    const back = { ...next, turn: 'black' as const };
    const fromFortress = boardMoves(back, 'black').filter((m) => m.from.rank === 5);
    expect(fromFortress).toHaveLength(10);
  });

  it('§4.4 capturing a marshal leaves no enemy piece behind', () => {
    const s = raw(
      'white',
      at(4, 2, B('pawn'), B('marshal')),
      at(4, 6, W('pawn'), W('general')),
      at(8, 8, W('marshal')),
    );
    const next = play(s, mv('capture', sq(4, 6), sq(4, 2), 'white'));
    expect(getStack(next.board, sq(4, 2))).toEqual([W('general')]);
    expect(next.captured.white).toEqual(['pawn', 'marshal']);
  });

  it('rejects capturing an own piece', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, B('samurai'))] });
    expect(validateBoardMove(s, mv('capture', sq(4, 4), sq(4, 5)))).toBe(
      MoveError.CANNOT_CAPTURE_OWN,
    );
  });

  it('white captures toward lower ranks', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 3, B('pawn')), at(4, 5, W('lancer'))],
      turn: 'white',
    });
    const next = play(s, mv('capture', sq(4, 5), sq(4, 3), 'white'));
    expect(getStack(next.board, sq(4, 3))).toEqual([W('lancer')]);
    expect(next.captured.white).toEqual(['pawn']);
    expect(next.turn).toBe('black');
  });

  it('§5.4 a jumping piece captures over a low blocker but not over a taller one', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 2, B('cannon')), at(4, 3, W('pawn')), at(4, 5, W('lancer'))],
    });
    expect(validateBoardMove(s, mv('capture', sq(4, 2), sq(4, 5)))).toBeNull();
    const t = createPosition({
      stacks: [
        ...KINGS,
        at(4, 2, B('cannon')),
        at(4, 3, W('pawn'), W('pawn')),
        at(4, 5, W('lancer')),
      ],
    });
    expect(validateBoardMove(t, mv('capture', sq(4, 2), sq(4, 5)))).toBe(MoveError.UNREACHABLE);
  });
});

describe('§11.4 quiet-ply counter', () => {
  const s = createPosition({
    stacks: [...KINGS, at(4, 4, B('pawn')), at(4, 5, W('pawn')), at(2, 5, B('general'))],
    quietPlies: 10,
  });
  it('move and stack increment it', () => {
    expect(play(s, mv('stack', sq(4, 4), sq(4, 5))).quietPlies).toBe(11);
    expect(play(s, mv('move', sq(2, 5), sq(2, 6))).quietPlies).toBe(11);
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
    // A 3-high stack is out of reach for a tier-2 piece (§6.2).
    expect(moves.filter((m) => m.to.file === 5 && m.to.rank === 5)).toEqual([]);
  });

  it('offers only capture against an enemy marshal', () => {
    const s = raw('white', at(4, 2, B('marshal')), at(4, 6, W('general')), at(8, 8, W('marshal')));
    const toMarshal = boardMoves(s, 'white').filter((m) => m.to.file === 4 && m.to.rank === 2);
    expect(toMarshal).toEqual([mv('capture', sq(4, 6), sq(4, 2), 'white')]);
  });

  it('offers a fortress both stack and capture against an enemy piece', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('fortress')), at(4, 5, W('samurai')), at(3, 4, B('pawn'))],
    });
    const fromFortress = boardMoves(s, 'black').filter((m) => m.from.file === 4);
    expect(fromFortress).toContainEqual(mv('stack', sq(4, 4), sq(4, 5)));
    expect(fromFortress).toContainEqual(mv('capture', sq(4, 4), sq(4, 5)));
    expect(fromFortress).toContainEqual(mv('stack', sq(4, 4), sq(3, 4)));
  });

  it('a lone tier-1 pawn in the middle has exactly two moves', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('pawn'))] });
    const pawnMoves = boardMoves(s, 'black').filter((m) => m.from.file === 4);
    expect(pawnMoves).toEqual([mv('move', sq(4, 4), sq(4, 5)), mv('move', sq(4, 4), sq(4, 3))]);
  });

  it('buried pieces generate nothing', () => {
    const s = createPosition({ stacks: [...KINGS, at(4, 4, B('cannon'), W('pawn'))] });
    expect(boardMoves(s, 'black').some((m) => m.from.file === 4)).toBe(false);
    // The white pawn on tier 2 steps two squares forward and back.
    expect(
      boardMoves(s, 'white')
        .filter((m) => m.from.file === 4 && m.from.rank === 4)
        .map((m) => `${m.to.file},${m.to.rank}`)
        .sort(),
    ).toEqual(['4,2', '4,3', '4,5', '4,6']);
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

  it('§6.2 a marshal on a 2-high stack is safe from tier-1 pieces only', () => {
    const low = createPosition({
      stacks: [at(4, 4, B('pawn'), B('marshal')), at(4, 5, W('pawn')), at(8, 8, W('marshal'))],
    }).board;
    expect(isInCheck(low, 'black')).toBe(false);
    const high = createPosition({
      stacks: [
        at(4, 4, B('pawn'), B('marshal')),
        at(4, 5, W('lancer'), W('pawn')),
        at(8, 8, W('marshal')),
      ],
    }).board;
    expect(isInCheck(high, 'black')).toBe(true);
  });

  it('a slide attack is blocked by an intervening piece', () => {
    const open = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 8, W('general')), at(0, 8, W('marshal'))],
    });
    expect(isInCheck(open.board, 'black')).toBe(true);
    const blocked = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 3, B('pawn')),
        at(4, 8, W('general')),
        at(0, 8, W('marshal')),
      ],
    });
    expect(isInCheck(blocked.board, 'black')).toBe(false);
  });

  it('§5.4 a jump attack passes over low stacks only', () => {
    const over = (height: number) =>
      createPosition({
        stacks: [
          at(4, 0, B('marshal')),
          at(4, 1, ...Array.from({ length: height }, () => B('pawn'))),
          at(4, 3, W('cannon')),
          at(0, 8, W('marshal')),
        ],
      }).board;
    expect(isInCheck(over(1), 'black')).toBe(true);
    expect(isInCheck(over(2), 'black')).toBe(false);
  });

  it('buried enemy pieces do not attack', () => {
    const board = createPosition({
      stacks: [at(4, 4, B('marshal')), at(4, 5, W('pawn'), B('pawn')), at(8, 8, W('marshal'))],
    }).board;
    expect(isInCheck(board, 'black')).toBe(false);
  });

  it('a side without a marshal is never in check', () => {
    const board = setStack(createEmptyBoard(), sq(4, 4), [W('pawn')]);
    expect(isInCheck(board, 'black')).toBe(false);
  });
});
