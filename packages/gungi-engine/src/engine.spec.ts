import { describe, expect, it } from 'vitest';
import { allSquares, getStack, setStack } from './board';
import { applyMove, inCheck, isGameOver, legalMoves, validateMove } from './engine';
import { handTotal, opponent } from './pieces';
import { createPosition, stateError } from './position';
import { REPETITION_LIMIT, positionKey } from './repetition';
import { createInitialState } from './setup';
import { B, W, at, rng, sq } from './test-helpers';
import type { BoardMove, GameState, Move, PieceKind, PlayerSide, Square } from './types';
import { MoveError, PIECE_KINDS } from './types';

const mv = (
  type: BoardMove['type'],
  from: [number, number],
  to: [number, number],
  player: PlayerSide = 'black',
): BoardMove => ({ type, player, from: sq(...from), to: sq(...to) });

/** The general: slides orthogonally to the board edge at any tier (§5.3.2). */
const rook = (file: number, rank: number, side: PlayerSide) =>
  at(file, rank, (side === 'black' ? B : W)('general'));

function play(state: GameState, ...moves: Move[]): GameState {
  return moves.reduce((s, m) => {
    const r = applyMove(s, m);
    if (!r.ok) throw new Error(`unexpected ${r.error} for ${JSON.stringify(m)}`);
    return r.state;
  }, state);
}

describe('§10.1 self-check is rejected', () => {
  it('a marshal cannot step onto an attacked square', () => {
    const s = createPosition({
      stacks: [at(4, 0, B('marshal')), at(5, 2, W('pawn')), at(8, 8, W('marshal'))],
    });
    expect(validateMove(s, mv('move', [4, 0], [5, 1]))).toBe(MoveError.SELF_CHECK);
    expect(validateMove(s, mv('move', [4, 0], [3, 1]))).toBeNull();
  });

  it('a pinned piece cannot leave the line of attack', () => {
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 1, B('samurai')),
        rook(4, 8, 'white'),
        at(0, 8, W('marshal')),
      ],
    });
    expect(validateMove(s, mv('move', [4, 1], [3, 2]))).toBe(MoveError.SELF_CHECK);
    expect(validateMove(s, mv('move', [4, 1], [4, 2]))).toBeNull();
  });

  it('when in check, only escaping moves are legal', () => {
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(0, 3, B('pawn')),
        rook(4, 8, 'white'),
        at(0, 8, W('marshal')),
      ],
      hands: { black: { pawn: 1 } },
    });
    expect(inCheck(s)).toBe(true);
    const moves = legalMoves(s);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves).not.toContainEqual(mv('move', [0, 3], [0, 4]));
    // Blocking by drop is allowed.
    expect(moves).toContainEqual({ type: 'drop', player: 'black', kind: 'pawn', to: sq(4, 2) });
    for (const m of moves) expect(validateMove(s, m)).toBeNull();
  });

  it('capturing the enemy marshal is rejected if it leaves the own marshal attacked', () => {
    // §10.1 has no exception for taking the marshal. No legal game reaches
    // this position (both marshals attacked, OPPONENT_IN_CHECK in §12.1), so
    // the board is put together directly to pin down the rule code alone.
    const base = createPosition({
      stacks: [at(4, 0, B('marshal')), at(0, 8, W('marshal'))],
    });
    const stacks = [rook(0, 4, 'black'), rook(4, 8, 'white')];
    const s: GameState = {
      ...base,
      board: stacks.reduce((b, { square, pieces }) => setStack(b, square, pieces), base.board),
    };
    expect(validateMove(s, mv('capture', [0, 4], [0, 8]))).toBe(MoveError.SELF_CHECK);
    expect(legalMoves(s).some((m) => m.type === 'capture')).toBe(false);
  });
});

/**
 * §10.1 legality is judged on the board the capture really produces: every
 * enemy piece of the target leaves and the capturer lands on what is left
 * (§6.4).
 */
describe('§10.1 self-check under §6.4 whole-stack capture', () => {
  it('a pinned piece may not capture off the line', () => {
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 1, B('samurai')),
        at(5, 2, W('samurai')),
        rook(4, 8, 'white'),
        at(0, 8, W('marshal')),
      ],
    });
    const capture = mv('capture', [4, 1], [5, 2]);
    expect(validateMove(s, capture)).toBe(MoveError.SELF_CHECK);
    expect(legalMoves(s)).not.toContainEqual(capture);
    expect(validateMove(s, mv('move', [4, 1], [4, 2]))).toBeNull();
  });

  it('a marshal may not capture onto a square the enemy still attacks', () => {
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 1, W('samurai')),
        rook(8, 1, 'white'),
        at(8, 8, W('marshal')),
      ],
    });
    expect(inCheck(s)).toBe(true);
    const capture = mv('capture', [4, 0], [4, 1]);
    expect(validateMove(s, capture)).toBe(MoveError.SELF_CHECK);
    expect(legalMoves(s)).not.toContainEqual(capture);
  });

  it('a raised marshal may escape check by taking a whole 2-high stack', () => {
    const s = createPosition({
      stacks: [
        at(4, 0, B('pawn'), B('marshal')),
        at(4, 1, W('pawn'), W('samurai')),
        at(8, 8, W('marshal')),
      ],
    });
    expect(inCheck(s)).toBe(true);
    const capture = mv('capture', [4, 0], [4, 1]);
    expect(legalMoves(s)).toContainEqual(capture);
    const next = play(s, capture);
    expect(getStack(next.board, sq(4, 1))).toEqual([B('marshal')]);
    expect(getStack(next.board, sq(4, 0))).toEqual([B('pawn')]);
    expect(next.captured.black).toEqual(['pawn', 'samurai']);
    expect(next.phase).toBe('play');
  });

  it('§6.2 a tier-1 marshal cannot escape by taking a 2-high stack', () => {
    const s = createPosition({
      stacks: [at(4, 0, B('marshal')), at(4, 1, W('lancer'), W('samurai')), at(8, 8, W('marshal'))],
    });
    expect(inCheck(s)).toBe(true);
    expect(validateMove(s, mv('capture', [4, 0], [4, 1]))).toBe(MoveError.TARGET_TOO_HIGH);
  });
});

describe('§11.1 marshal capture', () => {
  // Unreachable in a legal game (§10.1): the boards are put together directly
  // to pin down what the engine does if the side to move can take the marshal.
  const opening = (...black: PieceKind[]): GameState => {
    const base = createPosition({ stacks: [at(4, 2, B('marshal')), at(8, 8, W('marshal'))] });
    const stacks = [at(4, 6, W('pawn'), W('general')), at(4, 2, ...black.map(B))];
    const board = stacks.reduce((b, { square, pieces }) => setStack(b, square, pieces), base.board);
    return { ...base, board, turn: 'white' };
  };

  it('ends the game and records the capture', () => {
    const next = play(opening('marshal'), mv('capture', [4, 6], [4, 2], 'white'));
    expect(isGameOver(next)).toBe(true);
    expect(next.phase).toBe('finished');
    expect(next.result).toEqual({ winner: 'white', reason: 'marshalCaptured' });
    expect(next.captured.white).toContain('marshal');
  });

  it('a marshal on top of a stack is captured together with the pieces below', () => {
    const next = play(opening('pawn', 'marshal'), mv('capture', [4, 6], [4, 2], 'white'));
    expect(getStack(next.board, sq(4, 2))).toEqual([W('general')]);
    expect(next.result).toEqual({ winner: 'white', reason: 'marshalCaptured' });
  });

  it('createPosition and stateError reject such a position', () => {
    expect(stateError(opening('marshal'))).toBe('OPPONENT_IN_CHECK');
  });
});

/**
 * Black marshal in the corner. The lieutenant covers (1, 0), a tier-3 cannon
 * jumps onto (1, 1) and the general slides onto file 0 to give check.
 */
const MATE_NET = [
  at(0, 0, B('marshal')),
  at(7, 6, W('lieutenant')),
  at(1, 6, W('pawn'), W('pawn'), W('cannon')),
  rook(5, 5, 'white'),
  at(8, 8, W('marshal')),
];
const MATING_MOVE = mv('move', [5, 5], [0, 5], 'white');

describe('§11.2 checkmate', () => {
  it('detects mate after the mating move', () => {
    const s = createPosition({ stacks: MATE_NET, turn: 'white' });
    expect(inCheck({ ...s, turn: 'black' })).toBe(false);
    const next = play(s, MATING_MOVE);
    expect(next.result).toEqual({ winner: 'white', reason: 'checkmate' });
    expect(legalMoves(next)).toEqual([]);
  });

  it('§8.2 a hand piece cannot block beyond the front line', () => {
    const s = createPosition({ stacks: MATE_NET, hands: { black: { pawn: 1 } }, turn: 'white' });
    const next = play(s, MATING_MOVE);
    expect(next.result).toEqual({ winner: 'white', reason: 'checkmate' });
  });

  it('§8.2 a hand piece dropped up to the front line can block, preventing mate', () => {
    const s = createPosition({
      stacks: [...MATE_NET, at(3, 3, B('pawn'))],
      hands: { black: { pawn: 1 } },
      turn: 'white',
    });
    const next = play(s, MATING_MOVE);
    expect(next.result).toBeNull();
    const drop = (rank: number): Move => ({
      type: 'drop',
      player: 'black',
      kind: 'pawn',
      to: sq(0, rank),
    });
    // (0, 4) is beyond the front line and (0, 5) holds the checking general.
    expect(legalMoves(next)).toEqual([drop(1), drop(2), drop(3)]);
  });

  it('§8.3 a drop may deliver mate', () => {
    // White's pawn on (3, 1) puts its front line on rank 1.
    const s = createPosition({
      stacks: [
        at(0, 0, B('marshal')),
        at(7, 6, W('lieutenant')),
        at(1, 6, W('pawn'), W('pawn'), W('cannon')),
        at(3, 1, W('pawn')),
        at(8, 8, W('marshal')),
      ],
      hands: { white: { lancer: 1 } },
      turn: 'white',
    });
    expect(inCheck({ ...s, turn: 'black' })).toBe(false);
    const next = play(s, { type: 'drop', player: 'white', kind: 'lancer', to: sq(0, 2) });
    expect(next.result).toEqual({ winner: 'white', reason: 'checkmate' });
  });
});

describe('§11.3 stalemate', () => {
  /** (0, 1) and (1, 1) on the general's rank, (1, 0) on the lieutenant's diagonal. */
  const STUCK = [
    at(0, 0, B('marshal')),
    rook(5, 1, 'white'),
    at(7, 6, W('lieutenant')),
    at(5, 5, W('pawn')),
    at(8, 8, W('marshal')),
  ];

  it('a side with no legal move and not in check draws', () => {
    const s = createPosition({ stacks: STUCK, turn: 'white' });
    const next = play(s, mv('move', [8, 8], [8, 7], 'white'));
    expect(inCheck(next)).toBe(false);
    expect(next.result).toEqual({ winner: null, reason: 'stalemate' });
  });

  it('a hand piece that can be dropped avoids stalemate', () => {
    const s = createPosition({ stacks: STUCK, hands: { black: { general: 1 } }, turn: 'white' });
    expect(play(s, mv('move', [8, 8], [8, 7], 'white')).result).toBeNull();
  });
});

describe('§11.4 fourfold repetition', () => {
  const KINGS_ONLY = [at(0, 0, B('marshal')), at(8, 8, W('marshal'))];
  /** Four plies that bring the kings back to where they started. */
  const shuffle: Move[] = [
    mv('move', [0, 0], [0, 1]),
    mv('move', [8, 8], [8, 7], 'white'),
    mv('move', [0, 1], [0, 0]),
    mv('move', [8, 7], [8, 8], 'white'),
  ];

  it('the starting position counts as the first occurrence', () => {
    const s = createPosition({ stacks: KINGS_ONLY });
    expect(s.positionCounts).toEqual({ [positionKey(s)]: 1 });
  });

  it('the fourth occurrence of a position ends the game without a winner', () => {
    let s = createPosition({ stacks: KINGS_ONLY });
    const start = positionKey(s);
    s = play(s, ...shuffle, ...shuffle);
    expect(s.positionCounts[start]).toBe(3);
    s = play(s, ...shuffle.slice(0, 3));
    expect(s.result).toBeNull();
    s = play(s, shuffle[3]!);
    expect(s.positionCounts[start]).toBe(REPETITION_LIMIT);
    expect(s.result).toEqual({ winner: null, reason: 'fourfoldRepetition' });
    expect(s.ply).toBe(12);
    expect(isGameOver(s)).toBe(true);
    expect(stateError(JSON.parse(JSON.stringify(s)))).toBeNull();
  });

  it('counts every position, not only the starting one', () => {
    let s = createPosition({ stacks: KINGS_ONLY });
    s = play(s, shuffle[0]!, shuffle[1]!, shuffle[2]!, shuffle[3]!, shuffle[0]!);
    const afterFirst = positionKey(s);
    expect(s.positionCounts[afterFirst]).toBe(2);
    expect(Object.values(s.positionCounts).sort()).toEqual([1, 1, 2, 2]);
  });

  it('the same board with the other side to move is a different position', () => {
    const s = createPosition({ stacks: KINGS_ONLY });
    expect(positionKey({ ...s, turn: 'white' })).not.toBe(positionKey(s));
  });

  it('a drop restarts the count', () => {
    const s = createPosition({ stacks: KINGS_ONLY, hands: { black: { general: 1 } } });
    const looped = play(s, ...shuffle, ...shuffle);
    const next = play(looped, { type: 'drop', player: 'black', kind: 'general', to: sq(3, 0) });
    expect(next.positionCounts).toEqual({ [positionKey(next)]: 1 });
    expect(next.result).toBeNull();
  });

  it('a capture restarts the count', () => {
    const s = createPosition({
      stacks: [...KINGS_ONLY, at(4, 4, B('pawn')), at(4, 5, W('pawn'))],
    });
    const next = play(s, mv('capture', [4, 4], [4, 5]));
    expect(next.positionCounts).toEqual({ [positionKey(next)]: 1 });
  });

  it('move and stack keep counting', () => {
    const s = createPosition({
      stacks: [...KINGS_ONLY, at(4, 4, B('pawn')), at(4, 5, W('pawn'))],
    });
    const next = play(s, mv('stack', [4, 4], [4, 5]));
    expect(Object.keys(next.positionCounts)).toHaveLength(2);
  });

  it('positions repeat across a full game from placement', () => {
    let s = play(
      createInitialState(),
      { type: 'place', player: 'black', kind: 'marshal', to: sq(0, 0) },
      { type: 'place', player: 'white', kind: 'marshal', to: sq(8, 8) },
      { type: 'finishPlacement', player: 'black' },
      { type: 'finishPlacement', player: 'white' },
    );
    for (let i = 0; i < 2; i++) s = play(s, ...shuffle);
    expect(s.result).toBeNull();
    s = play(s, ...shuffle);
    expect(s.result).toEqual({ winner: null, reason: 'fourfoldRepetition' });
  });
});

describe('§12.1 state data', () => {
  it('positionKey identifies board, hands and turn', () => {
    const a = createPosition({ stacks: [at(0, 0, B('marshal')), at(8, 8, W('marshal'))] });
    const b = createPosition({
      stacks: [at(0, 0, B('marshal')), at(8, 8, W('marshal'))],
      firstPlayer: 'white',
    });
    expect(positionKey(a)).toBe(positionKey(b));
    expect(positionKey({ ...a, turn: 'white' })).not.toBe(positionKey(a));
    const withHand = createPosition({
      stacks: [at(0, 0, B('marshal')), at(8, 8, W('marshal'))],
      hands: { white: { pawn: 1 } },
    });
    expect(positionKey(withHand)).not.toBe(positionKey(a));
  });

  it('createPosition builds a play-phase state', () => {
    const s = createPosition({ stacks: [at(0, 0, B('marshal')), at(8, 8, W('marshal'))] });
    expect(s.phase).toBe('play');
    expect(s.turn).toBe('black');
    expect(s.firstPlayer).toBe('black');
    expect(s.positionCounts).toEqual({ [positionKey(s)]: 1 });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('§11.5–§11.7 resignation, timeout, agreement', () => {
  const s = createPosition({ stacks: [at(0, 0, B('marshal')), at(8, 8, W('marshal'))] });

  it('either side may resign regardless of turn', () => {
    expect(play(s, { type: 'resign', player: 'white' }).result).toEqual({
      winner: 'black',
      reason: 'resignation',
    });
    expect(play(s, { type: 'resign', player: 'black' }).result?.winner).toBe('white');
  });

  it('resignation is possible during placement', () => {
    expect(play(createInitialState(), { type: 'resign', player: 'black' }).phase).toBe('finished');
  });

  it('timeout makes the given side lose', () => {
    expect(play(s, { type: 'timeout', player: 'black' }).result).toEqual({
      winner: 'white',
      reason: 'timeout',
    });
  });

  it('agreed draw has no winner', () => {
    expect(play(s, { type: 'agreeDraw' }).result).toEqual({ winner: null, reason: 'agreement' });
  });
});

describe('§11.8 finished games', () => {
  it('rejects every move after the end', () => {
    const done = play(
      createPosition({ stacks: [at(0, 0, B('marshal')), at(8, 8, W('marshal'))] }),
      { type: 'resign', player: 'black' },
    );
    expect(validateMove(done, mv('move', [0, 0], [0, 1]))).toBe(MoveError.GAME_FINISHED);
    expect(validateMove(done, { type: 'agreeDraw' })).toBe(MoveError.GAME_FINISHED);
    expect(legalMoves(done)).toEqual([]);
  });
});

describe('§12.2 malformed input', () => {
  const s = createPosition({ stacks: [at(0, 0, B('marshal')), at(8, 8, W('marshal'))] });
  it.each([
    null,
    42,
    {},
    { type: 'teleport', player: 'black' },
    { type: 'resign', player: 'red' },
    { type: 42, player: 'black' },
    { type: 'agreeDraw ', player: 'black' },
  ])('rejects %j', (bad) => {
    expect(validateMove(s, bad as unknown as Move)).toBe(MoveError.INVALID_MOVE);
  });

  it('rejects a board move missing squares', () => {
    expect(validateMove(s, { type: 'move', player: 'black' } as unknown as Move)).toBe(
      MoveError.INVALID_SQUARE,
    );
  });

  const ok = sq(0, 0);
  const badSquares: unknown[] = [
    undefined,
    null,
    '0,0',
    [0, 0],
    { file: 0 },
    { file: '0', rank: '0' },
    { file: 0.5, rank: 0 },
    { file: Number.NaN, rank: 0 },
    { file: 9, rank: 0 },
    { file: 0, rank: -1 },
  ];

  it.each(['move', 'capture', 'stack'] as const)('%s rejects a bad `from` or `to`', (type) => {
    for (const bad of badSquares) {
      for (const move of [
        { type, player: 'black', from: bad, to: ok },
        { type, player: 'black', from: ok, to: bad },
      ]) {
        expect(validateMove(s, move as unknown as Move)).toBe(MoveError.INVALID_SQUARE);
      }
    }
  });

  const badKinds: unknown[] = [undefined, null, 42, 'spear', 'Pawn', 'toString', '__proto__', {}];

  it('drop rejects a bad kind or square', () => {
    const t = createPosition({
      stacks: [at(0, 0, B('marshal')), at(8, 8, W('marshal'))],
      hands: { black: { pawn: 1 } },
    });
    for (const kind of badKinds) {
      const move = { type: 'drop', player: 'black', kind, to: sq(4, 4) };
      expect(validateMove(t, move as unknown as Move)).toBe(MoveError.INVALID_MOVE);
    }
    for (const to of badSquares) {
      const move = { type: 'drop', player: 'black', kind: 'pawn', to };
      expect(validateMove(t, move as unknown as Move)).toBe(MoveError.INVALID_SQUARE);
    }
  });

  it('place rejects a bad kind or square', () => {
    const t = createInitialState();
    for (const kind of badKinds) {
      const move = { type: 'place', player: 'black', kind, to: sq(4, 0) };
      expect(validateMove(t, move as unknown as Move)).toBe(MoveError.INVALID_MOVE);
    }
    for (const to of badSquares) {
      const move = { type: 'place', player: 'black', kind: 'marshal', to };
      expect(validateMove(t, move as unknown as Move)).toBe(MoveError.INVALID_SQUARE);
    }
  });

  it('every move type rejects a bad player', () => {
    const types = ['place', 'finishPlacement', 'move', 'capture', 'stack', 'drop', 'resign'];
    for (const type of [...types, 'timeout']) {
      for (const player of [undefined, null, 0, 'Black', 'red', {}]) {
        const move = { type, player, kind: 'pawn', from: ok, to: ok };
        expect(validateMove(s, move as unknown as Move)).toBe(MoveError.INVALID_MOVE);
      }
    }
  });

  it('never throws on arbitrary payloads, in either phase', () => {
    const rand = rng(99);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    const types = ['place', 'finishPlacement', 'move', 'capture', 'stack', 'drop', 'resign', 'x'];
    const squares = [...badSquares, ok, sq(4, 4), sq(8, 8)];
    const kinds = [...badKinds, 'pawn', 'marshal', 'fortress'];
    for (const state of [s, createInitialState()]) {
      for (let i = 0; i < 2000; i++) {
        const move = {
          type: pick(types),
          player: pick(['black', 'white', 'red', undefined]),
          kind: pick(kinds),
          from: pick(squares),
          to: pick(squares),
          betray: pick([undefined, undefined, true, false, 1, 'true', null]),
        };
        const error = validateMove(state, move as unknown as Move);
        expect(error === null || Object.values(MoveError).includes(error)).toBe(true);
      }
    }
  });
});

describe('§9 → §11 lifecycle', () => {
  it('placement transitions to play with the first player to move', () => {
    const s = play(
      createInitialState(),
      { type: 'place', player: 'black', kind: 'marshal', to: sq(4, 0) },
      { type: 'place', player: 'white', kind: 'marshal', to: sq(4, 8) },
      { type: 'place', player: 'black', kind: 'pawn', to: sq(4, 2) },
      { type: 'finishPlacement', player: 'white' },
    );
    expect(s.phase).toBe('play');
    expect(s.turn).toBe('black');
    expect(legalMoves(s).length).toBeGreaterThan(0);
    expect(legalMoves(s).every((m) => 'player' in m && m.player === 'black')).toBe(true);
  });

  it('a white-first game starts play with white to move', () => {
    const s = play(
      createInitialState({ firstPlayer: 'white' }),
      { type: 'place', player: 'white', kind: 'marshal', to: sq(4, 8) },
      { type: 'place', player: 'black', kind: 'marshal', to: sq(4, 0) },
      { type: 'finishPlacement', player: 'white' },
      { type: 'finishPlacement', player: 'black' },
    );
    expect(s).toMatchObject({ phase: 'play', turn: 'white', firstPlayer: 'white' });
    expect(legalMoves(s).every((m) => 'player' in m && m.player === 'white')).toBe(true);
  });
});

const place = (player: PlayerSide, kind: PieceKind, file: number, rank: number): Move => ({
  type: 'place',
  player,
  kind,
  to: sq(file, rank),
});

/** Marshals placed, white puts its general on file 4 (rank 6) aiming at black. */
function cannonTowerAgainst(blackMarshalRank: number, blackFiller: Move[]): GameState {
  return play(
    createInitialState(),
    place('black', 'marshal', 4, blackMarshalRank),
    place('white', 'marshal', 0, 8),
    blackFiller[0]!,
    place('white', 'pawn', 8, 8),
    blackFiller[1]!,
    place('white', 'general', 4, 6),
  );
}

describe('§9.5 check during placement', () => {
  const filler = [place('black', 'pawn', 0, 0), place('black', 'pawn', 1, 0)];

  it('a placement may give check; the checked side must block and cannot finish', () => {
    const s = cannonTowerAgainst(0, filler);
    expect(s.phase).toBe('placement');
    expect(s.turn).toBe('black');
    expect(inCheck(s)).toBe(true);
    expect(validateMove(s, { type: 'finishPlacement', player: 'black' })).toBe(
      MoveError.SELF_CHECK,
    );
    expect(validateMove(s, place('black', 'general', 8, 0))).toBe(MoveError.SELF_CHECK);
    const moves = legalMoves(s);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(m.type).toBe('place');
      if (m.type === 'place') expect([sq(4, 1), sq(4, 2)]).toContainEqual(m.to);
    }
    const blocked = play(s, place('black', 'general', 4, 1));
    expect(inCheck({ ...blocked, turn: 'black' })).toBe(false);
  });

  it('a check that cannot be blocked inside the territory is checkmate', () => {
    const s = cannonTowerAgainst(2, filler);
    expect(s.result).toEqual({ winner: 'white', reason: 'checkmate' });
    expect(s.phase).toBe('finished');
  });

  it('a first player that has finished cannot answer checks given by later placements', () => {
    const s = play(
      createInitialState(),
      place('black', 'marshal', 4, 0),
      place('white', 'marshal', 0, 8),
      { type: 'finishPlacement', player: 'black' },
      place('white', 'general', 4, 6),
    );
    expect(s).toMatchObject({ phase: 'placement', turn: 'white' });
    expect(inCheck({ ...s, turn: 'black' })).toBe(true);
    expect(stateError(JSON.parse(JSON.stringify(s)))).toBeNull();
    // Play starts with black to move, in check; here it can still step aside.
    const started = play(s, { type: 'finishPlacement', player: 'white' });
    expect(started).toMatchObject({ phase: 'play', turn: 'black', result: null });
    expect(inCheck(started)).toBe(true);
    expect(legalMoves(started)).toContainEqual(mv('move', [4, 0], [3, 0]));
  });
});

/**
 * §9.6 即死筋: a first player that finishes placing early lets the second
 * player keep placing and build a mating net, so play starts with the first
 * player already mated. This is intended (official play), not a defect.
 */
describe('§9.6 sudden death after an early finish (即死筋)', () => {
  it('black finishes with only its marshal; white builds a battery and mates at the start of play', () => {
    const s = play(
      createInitialState(),
      place('black', 'marshal', 0, 0),
      place('white', 'marshal', 8, 8),
      { type: 'finishPlacement', player: 'black' },
      place('white', 'pawn', 1, 6),
      place('white', 'pawn', 1, 6),
      place('white', 'cannon', 1, 6),
      place('white', 'lieutenant', 7, 6),
      place('white', 'general', 0, 6),
    );
    expect(s.phase).toBe('placement');
    expect(inCheck({ ...s, turn: 'black' })).toBe(true);
    const mated = play(s, { type: 'finishPlacement', player: 'white' });
    expect(mated.phase).toBe('finished');
    expect(mated.turn).toBe('black');
    expect(mated.result).toEqual({ winner: 'white', reason: 'checkmate' });
    // Black still holds 24 pieces, but the front line keeps drops on rank 0 (§8.2).
    expect(handTotal(mated.hands.black)).toBe(24);
  });

  it('the same line works against a white first player', () => {
    const s = play(
      createInitialState({ firstPlayer: 'white' }),
      place('white', 'marshal', 8, 8),
      place('black', 'marshal', 0, 0),
      { type: 'finishPlacement', player: 'white' },
      place('black', 'pawn', 7, 2),
      place('black', 'pawn', 7, 2),
      place('black', 'cannon', 7, 2),
      place('black', 'lieutenant', 1, 2),
      place('black', 'general', 8, 2),
      { type: 'finishPlacement', player: 'black' },
    );
    expect(s).toMatchObject({ phase: 'finished', turn: 'white' });
    expect(s.result).toEqual({ winner: 'black', reason: 'checkmate' });
  });

  it('a first player that keeps placing can block the check instead', () => {
    const s = play(
      createInitialState(),
      place('black', 'marshal', 0, 0),
      place('white', 'marshal', 8, 8),
      place('black', 'pawn', 0, 1),
      place('white', 'general', 0, 6),
    );
    // The pawn already blocks the general's file, so black is not in check.
    expect(inCheck(s)).toBe(false);
    expect(validateMove(s, { type: 'finishPlacement', player: 'black' })).toBeNull();
  });
});

function piecesOf(state: GameState, side: PlayerSide): number {
  return allSquares().reduce(
    (n, s) => n + getStack(state.board, s).filter((p) => p.owner === side).length,
    0,
  );
}

function checkInvariants(state: GameState): void {
  // JSON round-trip safe, and accepted by the restore gate (§12.1).
  expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  expect(stateError(JSON.parse(JSON.stringify(state)))).toBeNull();
  for (const side of ['black', 'white'] as const) {
    // §3.1 piece conservation: board + hand + removed by opponent = 25.
    expect(
      piecesOf(state, side) + handTotal(state.hands[side]) + state.captured[opponent(side)].length,
    ).toBe(25);
  }
  for (const s of allSquares()) {
    const stack = getStack(state.board, s);
    // §4.1 no stack exceeds 3.
    expect(stack.length).toBeLessThanOrEqual(3);
    // §4.4 nothing sits on a marshal (§6.4 capture-advance included).
    stack.slice(0, -1).forEach((p) => expect(p.kind).not.toBe('marshal'));
  }
  // §11.4 a position appears at most 3 times, unless the 4th just ended the game.
  const counts = Object.values(state.positionCounts);
  const repeated = state.result?.reason === 'fourfoldRepetition';
  expect(Math.max(0, ...counts)).toBeLessThanOrEqual(repeated ? REPETITION_LIMIT : 3);
  if (state.phase === 'play') expect(state.positionCounts[positionKey(state)]).toBeGreaterThan(0);
  if (state.phase === 'placement') expect(counts).toEqual([]);
  if (state.phase !== 'finished') {
    // §10.1 the side that just moved is never left in check, except a first
    // player that has finished placing (§9.5). There is no exception in play.
    const waiting =
      state.phase === 'placement' &&
      state.placementDone[state.firstPlayer] &&
      state.turn !== state.firstPlayer;
    if (!waiting) expect(inCheck({ ...state, turn: opponent(state.turn) })).toBe(false);
  }
}

/** Picks a move type uniformly first, so rare kinds (betrayal, capture) get played. */
function pickMove(moves: Move[], rand: () => number): Move {
  const group = (m: Move) => (m.type === 'stack' && m.betray ? 'betray' : m.type);
  const groups = [...new Set(moves.map(group))];
  // Prefer finishing placement sometimes so the play phase is reached.
  const chosen =
    groups.includes('finishPlacement') && rand() < 0.15
      ? 'finishPlacement'
      : groups[Math.floor(rand() * groups.length)]!;
  const pool = moves.filter((m) => group(m) === chosen);
  return pool[Math.floor(rand() * pool.length)]!;
}

/** Self-play from the initial state, calling `visit` with every state reached. */
function selfPlay(seed: number, plies: number, visit: (s: GameState, m: Move) => void): GameState {
  const rand = rng(seed);
  // Odd seeds play black first, even seeds white first (§9.1).
  let state = createInitialState({ firstPlayer: seed % 2 === 1 ? 'black' : 'white' });
  for (let i = 0; i < plies && !isGameOver(state); i++) {
    const moves = legalMoves(state);
    expect(moves.length).toBeGreaterThan(0);
    // A few other generated moves must validate as well.
    for (let k = 0; k < 2; k++) {
      expect(validateMove(state, moves[Math.floor(rand() * moves.length)]!)).toBeNull();
    }
    const move = pickMove(moves, rand);
    const result = applyMove(state, move);
    expect(result.ok).toBe(true);
    if (!result.ok) break;
    state = result.state;
    visit(state, move);
  }
  return state;
}

describe('random self-play invariants', () => {
  const seen = new Set<string>();

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'seed %i: every legal move applies and invariants hold',
    (seed) => {
      const end = selfPlay(seed, 400, (state, move) => {
        checkInvariants(state);
        seen.add(move.type === 'stack' && move.betray ? 'betray' : move.type);
        if (state.phase === 'play') seen.add('play');
        if (state.result) seen.add(state.result.reason);
      });
      if (isGameOver(end)) expect(legalMoves(end)).toEqual([]);
    },
    30_000,
  );

  it('the seeds above exercise every kind of move', () => {
    for (const kind of ['place', 'finishPlacement', 'move', 'capture', 'stack', 'drop', 'betray']) {
      expect(seen).toContain(kind);
    }
    expect(seen).toContain('play');
  });
});

/** A canonical string for a move, so generated and hand-built moves compare equal. */
function moveId(m: Move): string {
  const r = m as Partial<Record<string, unknown>> & Move;
  const sqId = (v: unknown) => (v ? `${(v as Square).file},${(v as Square).rank}` : '');
  return [r.type, r.player ?? '', r.kind ?? '', sqId(r.from), sqId(r.to), r.betray ? 'b' : ''].join(
    '|',
  );
}

/** Every move of the side to move that could possibly be legal in `state`. */
function candidateMoves(state: GameState): Move[] {
  const player = state.turn;
  const squares = allSquares();
  if (state.phase === 'placement') {
    return [
      { type: 'finishPlacement', player },
      ...squares.flatMap((to) =>
        PIECE_KINDS.map((kind): Move => ({ type: 'place', player, kind, to })),
      ),
    ];
  }
  const board = squares.flatMap((from) =>
    squares.flatMap((to) =>
      (['move', 'capture', 'stack'] as const).flatMap((type): Move[] => [
        { type, player, from, to },
        { type, player, from, to, betray: true },
      ]),
    ),
  );
  const drops = squares.flatMap((to) =>
    PIECE_KINDS.map((kind): Move => ({ type: 'drop', player, kind, to })),
  );
  return [...board, ...drops];
}

describe('§12 legalMoves is exactly the set of moves validateMove accepts', () => {
  it.each([11, 12])(
    'seed %i: sampled placement and play states',
    (seed) => {
      const samples: GameState[] = [];
      let n = 0;
      selfPlay(seed, 160, (state) => {
        if (!isGameOver(state) && n++ % 20 === 5) samples.push(state);
      });
      expect(samples.some((s) => s.phase === 'play')).toBe(true);
      for (const state of samples) {
        const legal = new Set(legalMoves(state).map(moveId));
        const accepted = new Set(
          candidateMoves(state)
            .filter((m) => validateMove(state, m) === null)
            .map(moveId),
        );
        expect([...accepted].sort()).toEqual([...legal].sort());
      }
    },
    60_000,
  );
});
