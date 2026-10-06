import { describe, expect, it } from 'vitest';
import { getStack } from './board';
import { applyBetrayal, betrayalError } from './betrayal';
import { applyMove, legalMoves, validateMove } from './engine';
import { emptyHand } from './pieces';
import { createPosition, stateError } from './position';
import { positionKey } from './repetition';
import { boardMoves, validateBoardMove } from './rules';
import { createInitialState } from './setup';
import { B, W, at, sq } from './test-helpers';
import type { BoardMove, GameState, Hand, Move, PieceKind, PlayerSide, Square } from './types';
import { MoveError } from './types';

const KINGS = [at(0, 0, B('marshal')), at(8, 8, W('marshal'))];

const stackOn = (
  from: Square,
  to: Square,
  betray?: boolean,
  player: PlayerSide = 'black',
): BoardMove => ({
  type: 'stack',
  player,
  from,
  to,
  ...(betray === undefined ? {} : { betray }),
});

function play(state: GameState, move: Move): GameState {
  const r = applyMove(state, move);
  if (!r.ok) throw new Error(`unexpected ${r.error} for ${JSON.stringify(move)}`);
  return r.state;
}

const hand = (counts: Partial<Record<PieceKind, number>>): Hand => ({ ...emptyHand(), ...counts });

/** A black tactician on (4, 4) next to `target` on (4, 3) (its B step), with `held` in hand. */
const setup = (
  target: ReturnType<typeof B>[],
  held: Partial<Record<PieceKind, number>>,
): GameState =>
  createPosition({
    stacks: [...KINGS, at(4, 4, B('tactician')), at(4, 3, ...target)],
    hands: { black: held },
  });

const T = sq(4, 4);
const TARGET = sq(4, 3);

describe('§7.1 / §7.2 betrayal (寝返り)', () => {
  it('swaps the enemy piece for a same-kind hand piece and removes it from the game', () => {
    const s = setup([W('pawn')], { pawn: 1 });
    const next = play(s, stackOn(T, TARGET, true));
    expect(getStack(next.board, TARGET)).toEqual([B('pawn'), B('tactician')]);
    expect(next.hands.black.pawn).toBe(0);
    expect(next.captured.black).toEqual(['pawn']);
    expect(next.turn).toBe('white');
    expect(stateError(JSON.parse(JSON.stringify(next)))).toBeNull();
  });

  it('is optional: the same stack without betrayal leaves the enemy piece', () => {
    const s = setup([W('pawn')], { pawn: 1 });
    for (const betray of [undefined, false]) {
      const next = play(s, stackOn(T, TARGET, betray));
      expect(getStack(next.board, TARGET)).toEqual([W('pawn'), B('tactician')]);
      expect(next.hands.black.pawn).toBe(1);
      expect(next.captured.black).toEqual([]);
    }
  });

  it('needs a same-kind piece in hand for every enemy piece', () => {
    expect(validateMove(setup([W('pawn')], {}), stackOn(T, TARGET, true))).toBe(
      MoveError.BETRAYAL_HAND_SHORT,
    );
    expect(validateMove(setup([W('pawn')], { samurai: 1 }), stackOn(T, TARGET, true))).toBe(
      MoveError.BETRAYAL_HAND_SHORT,
    );
    // The plain stack is still allowed.
    expect(validateMove(setup([W('pawn')], {}), stackOn(T, TARGET))).toBeNull();
  });

  it('must convert all enemy pieces of several kinds at once', () => {
    const target = [W('pawn'), W('samurai')];
    // Only the pawn is covered: no partial betrayal.
    const raised = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn'), B('tactician')), at(4, 3, ...target)],
      hands: { black: { pawn: 1 } },
    });
    expect(validateMove(raised, stackOn(T, TARGET, true))).toBe(MoveError.BETRAYAL_HAND_SHORT);
    const both = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn'), B('tactician')), at(4, 3, ...target)],
      hands: { black: { pawn: 1, samurai: 1 } },
    });
    const next = play(both, stackOn(T, TARGET, true));
    expect(getStack(next.board, TARGET)).toEqual([B('pawn'), B('samurai'), B('tactician')]);
    expect(next.hands.black).toMatchObject({ pawn: 0, samurai: 0 });
    expect(next.captured.black).toEqual(['pawn', 'samurai']);
  });

  it('needs as many hand pieces as enemy pieces of the same kind', () => {
    const target = [W('pawn'), W('pawn')];
    const raised = (pawns: number) =>
      createPosition({
        stacks: [...KINGS, at(4, 4, B('lancer'), B('tactician')), at(4, 3, ...target)],
        hands: { black: { pawn: pawns } },
      });
    expect(validateMove(raised(1), stackOn(T, TARGET, true))).toBe(MoveError.BETRAYAL_HAND_SHORT);
    const next = play(raised(2), stackOn(T, TARGET, true));
    expect(getStack(next.board, TARGET)).toEqual([B('pawn'), B('pawn'), B('tactician')]);
    expect(next.hands.black.pawn).toBe(0);
  });

  it('works on enemy pieces buried under an own top (unlike capture)', () => {
    const target = [W('lancer'), B('pawn')];
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn'), B('tactician')), at(4, 3, ...target)],
      hands: { black: { lancer: 1 } },
    });
    expect(validateMove(s, { type: 'capture', player: 'black', from: T, to: TARGET })).toBe(
      MoveError.CANNOT_CAPTURE_OWN,
    );
    const next = play(s, stackOn(T, TARGET, true));
    expect(getStack(next.board, TARGET)).toEqual([B('lancer'), B('pawn'), B('tactician')]);
    expect(next.hands.black.lancer).toBe(0);
    expect(next.captured.black).toEqual(['lancer']);
  });

  it('own pieces in the stack are kept in place', () => {
    const target = [B('samurai'), W('pawn')];
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('pawn'), B('tactician')), at(4, 3, ...target)],
      hands: { black: { pawn: 1 } },
    });
    const next = play(s, stackOn(T, TARGET, true));
    expect(getStack(next.board, TARGET)).toEqual([B('samurai'), B('pawn'), B('tactician')]);
  });

  it('requires a stack with an enemy piece', () => {
    expect(validateMove(setup([B('pawn')], { pawn: 1 }), stackOn(T, TARGET, true))).toBe(
      MoveError.INVALID_BETRAYAL,
    );
  });

  it('only the tactician betrays', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, B('samurai')), at(4, 3, W('pawn'))],
      hands: { black: { pawn: 1 } },
    });
    expect(validateMove(s, stackOn(T, TARGET, true))).toBe(MoveError.INVALID_BETRAYAL);
  });

  it('only a stack betrays: move, capture, drop and place reject the flag', () => {
    const s = setup([W('pawn')], { pawn: 1 });
    const flagged = (m: object) => ({ ...m, betray: true }) as unknown as Move;
    expect(
      validateMove(s, flagged({ type: 'capture', player: 'black', from: T, to: TARGET })),
    ).toBe(MoveError.INVALID_BETRAYAL);
    expect(validateMove(s, flagged({ type: 'move', player: 'black', from: T, to: sq(3, 5) }))).toBe(
      MoveError.INVALID_BETRAYAL,
    );
    expect(
      validateMove(s, flagged({ type: 'drop', player: 'black', kind: 'pawn', to: sq(2, 2) })),
    ).toBe(MoveError.INVALID_BETRAYAL);
    expect(
      validateMove(
        createInitialState(),
        flagged({ type: 'place', player: 'black', kind: 'marshal', to: sq(4, 0) }),
      ),
    ).toBe(MoveError.INVALID_BETRAYAL);
  });

  it('R-4 dropping a tactician onto a stack with a buried enemy does not betray', () => {
    const s = createPosition({
      stacks: [...KINGS, at(2, 0, W('pawn'), B('samurai'))],
      hands: { black: { tactician: 1, pawn: 1 } },
    });
    const drop = { type: 'drop', player: 'black', kind: 'tactician', to: sq(2, 0) } as const;
    const next = play(s, drop);
    expect(getStack(next.board, sq(2, 0))).toEqual([W('pawn'), B('samurai'), B('tactician')]);
    expect(validateMove(s, { ...drop, betray: true } as unknown as Move)).toBe(
      MoveError.INVALID_BETRAYAL,
    );
  });

  it('§6.2 the height condition still applies', () => {
    const s = setup([W('pawn'), W('pawn')], { pawn: 2 });
    expect(validateMove(s, stackOn(T, TARGET, true))).toBe(MoveError.TARGET_TOO_HIGH);
  });

  it('works for white, toward its own back', () => {
    const s = createPosition({
      stacks: [...KINGS, at(4, 4, W('tactician')), at(4, 5, B('lancer'))],
      hands: { white: { lancer: 1 } },
      turn: 'white',
    });
    const next = play(s, stackOn(T, sq(4, 5), true, 'white'));
    expect(getStack(next.board, sq(4, 5))).toEqual([W('lancer'), W('tactician')]);
    expect(next.captured.white).toEqual(['lancer']);
  });

  it('§10.1 a betrayal that leaves the own marshal attacked is rejected', () => {
    // The tactician on (4, 1) shields the marshal from the white general.
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 1, B('tactician')),
        at(3, 2, W('pawn')),
        at(4, 8, W('general')),
        at(8, 8, W('marshal')),
      ],
      hands: { black: { pawn: 1 } },
    });
    expect(validateMove(s, stackOn(sq(4, 1), sq(3, 2), true))).toBe(MoveError.SELF_CHECK);
  });

  it('§11.4 restarts the repetition count', () => {
    const s = setup([W('pawn')], { pawn: 1 });
    const next = play(s, stackOn(T, TARGET, true));
    expect(next.positionCounts).toEqual({ [positionKey(next)]: 1 });
    const plain = play(s, stackOn(T, TARGET));
    expect(Object.keys(plain.positionCounts)).toHaveLength(2);
  });

  it('the tactician then moves by its own pattern at its new tier', () => {
    const s = setup([W('pawn')], { pawn: 1 });
    const next = { ...play(s, stackOn(T, TARGET, true)), turn: 'black' as const };
    const reach = boardMoves(next, 'black')
      .filter((m) => m.from.file === 4 && m.from.rank === 3)
      .map((m) => `${m.to.file},${m.to.rank}`)
      .sort();
    // Tier 2: FL, FR and B with range 2 (§5.3.14).
    expect(reach).toEqual(['2,5', '3,4', '4,1', '4,2', '5,4', '6,5'].sort());
  });
});

describe('§7.3 move generation', () => {
  it('offers both the plain stack and the betrayal when possible', () => {
    const s = setup([W('pawn')], { pawn: 1 });
    const onTarget = legalMoves(s).filter(
      (m) => m.type === 'stack' && m.to.file === 4 && m.to.rank === 3,
    );
    expect(onTarget).toEqual([stackOn(T, TARGET), stackOn(T, TARGET, true)]);
  });

  it('offers only the plain stack when the hand is short', () => {
    const s = setup([W('pawn')], {});
    const onTarget = legalMoves(s).filter((m) => m.type === 'stack' && m.to.rank === 3);
    expect(onTarget).toEqual([stackOn(T, TARGET)]);
  });

  it('every generated move validates, betrayals included', () => {
    const s = createPosition({
      stacks: [
        ...KINGS,
        at(4, 4, B('pawn'), B('tactician')),
        at(3, 5, W('lancer')),
        at(5, 5, W('pawn'), B('pawn')),
        at(4, 3, B('samurai')),
      ],
      hands: { black: { lancer: 1, pawn: 1 } },
    });
    const moves = boardMoves(s, 'black');
    expect(moves.filter((m) => m.betray === true)).toHaveLength(2);
    for (const m of moves) expect(validateBoardMove(s, m)).toBeNull();
  });

  it.each([1, 'yes', null, [], {}])('rejects a non-boolean betray flag %j', (betray) => {
    const s = setup([W('pawn')], { pawn: 1 });
    expect(validateMove(s, { ...stackOn(T, TARGET), betray } as unknown as Move)).toBe(
      MoveError.INVALID_MOVE,
    );
  });
});

describe('betrayal helpers', () => {
  it('betrayalError checks the mover, the enemy pieces and the hand', () => {
    expect(betrayalError(B('samurai'), [W('pawn')], hand({ pawn: 1 }))).toBe(
      MoveError.INVALID_BETRAYAL,
    );
    expect(betrayalError(B('tactician'), [B('pawn')], hand({ pawn: 1 }))).toBe(
      MoveError.INVALID_BETRAYAL,
    );
    expect(betrayalError(B('tactician'), [W('pawn'), W('pawn')], hand({ pawn: 1 }))).toBe(
      MoveError.BETRAYAL_HAND_SHORT,
    );
    expect(betrayalError(W('tactician'), [B('pawn'), W('pawn')], hand({ pawn: 1 }))).toBeNull();
  });

  it('applyBetrayal converts in place without mutating its inputs', () => {
    const stack = [W('pawn'), B('samurai'), W('lancer')];
    const before = hand({ pawn: 1, lancer: 2 });
    const out = applyBetrayal(stack, 'black', before);
    expect(out.stack).toEqual([B('pawn'), B('samurai'), B('lancer')]);
    expect(out.hand).toMatchObject({ pawn: 0, lancer: 1 });
    expect(out.removed).toEqual(['pawn', 'lancer']);
    expect(stack[0]).toEqual(W('pawn'));
    expect(before.pawn).toBe(1);
  });
});
