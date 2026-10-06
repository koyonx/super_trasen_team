import { describe, expect, it } from 'vitest';
import { allSquares, getStack, setStack } from './board';
import {
  QUIET_PLY_LIMIT,
  applyMove,
  inCheck,
  isGameOver,
  legalMoves,
  validateMove,
} from './engine';
import { handTotal, opponent } from './pieces';
import { createPosition, positionKey, stateError } from './position';
import { isInCheck } from './rules';
import { createInitialState } from './setup';
import { B, W, at, rng, sq } from './test-helpers';
import type { BoardMove, GameState, Move, PieceKind, PlayerSide } from './types';
import { MoveError } from './types';

const mv = (
  type: BoardMove['type'],
  from: [number, number],
  to: [number, number],
  player: PlayerSide = 'black',
): BoardMove => ({ type, player, from: sq(...from), to: sq(...to) });

/** A tier-3 cannon tower: slides orthogonally to the board edge (§5.3.10). */
const rook = (file: number, rank: number, side: PlayerSide) => {
  const P = side === 'black' ? B : W;
  return at(file, rank, P('general'), P('general'), P('cannon'));
};

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
        at(4, 1, B('general')),
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
 * R-8: legality is judged on the board the capture really produces, where the
 * capturer always lands on the remaining stack (§6.4). gungi.js 1.0.20
 * `moves()` judges these on a board where the capturer stays put while the
 * square is not emptied; the verdict of each case below differs from it.
 */
describe('R-8 §10.1 self-check under §6.4 capture-advance', () => {
  it('a pinned piece may not capture onto a remaining stack off the line', () => {
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 1, B('general')),
        at(5, 2, W('pawn'), W('samurai')),
        rook(4, 8, 'white'),
        at(0, 8, W('marshal')),
      ],
    });
    const capture = mv('capture', [4, 1], [5, 2]);
    expect(validateMove(s, capture)).toBe(MoveError.SELF_CHECK);
    expect(legalMoves(s)).not.toContainEqual(capture);
    expect(validateMove(s, mv('move', [4, 1], [4, 2]))).toBeNull();
  });

  it('a marshal may not capture onto a remaining stack that is attacked', () => {
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 1, B('pawn'), W('samurai')),
        rook(8, 1, 'white'),
        at(8, 8, W('marshal')),
      ],
    });
    expect(inCheck(s)).toBe(false);
    const capture = mv('capture', [4, 0], [4, 1]);
    expect(validateMove(s, capture)).toBe(MoveError.SELF_CHECK);
    expect(legalMoves(s)).not.toContainEqual(capture);
  });

  it('a marshal may escape check by capturing onto a remaining stack', () => {
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(4, 1, W('pawn'), W('samurai')),
        rook(8, 0, 'white'),
        at(8, 8, W('marshal')),
      ],
    });
    expect(inCheck(s)).toBe(true);
    const capture = mv('capture', [4, 0], [4, 1]);
    expect(legalMoves(s)).toContainEqual(capture);
    const next = play(s, capture);
    expect(getStack(next.board, sq(4, 1))).toEqual([W('pawn'), B('marshal')]);
    expect(next.phase).toBe('play');
  });

  it('a capturer that covers a remaining enemy piece removes its attack', () => {
    // Taking the tier-2 samurai uncovers a white general next to the marshal.
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        at(3, 0, B('general')),
        at(4, 1, W('general'), W('samurai')),
        at(8, 8, W('marshal')),
      ],
    });
    expect(inCheck(s)).toBe(false);
    const capture = mv('capture', [3, 0], [4, 1]);
    // gungi.js moves(): the capturer stays on (3, 0), the general attacks (4, 0).
    const stayPut = setStack(s.board, sq(4, 1), [W('general')]);
    expect(isInCheck(stayPut, 'black')).toBe(true);
    // Here the capturer lands on the general, which then has no reach (§4.2).
    expect(validateMove(s, capture)).toBeNull();
    expect(legalMoves(s)).toContainEqual(capture);
    const next = play(s, capture);
    expect(getStack(next.board, sq(4, 1))).toEqual([W('general'), B('general')]);
    expect(inCheck({ ...next, turn: 'black' })).toBe(false);
  });
});

describe('§11.1 marshal capture', () => {
  // Reachable only at the start of play: white's last placements left black
  // in check (a tier-3 cannon on file 4) and white moves first (§9.4).
  const opening = (...black: PieceKind[]) =>
    createPosition({
      stacks: [at(8, 8, W('marshal')), rook(4, 6, 'white'), at(4, 2, ...black.map(B))],
      turn: 'white',
    });

  it('ends the game and records the capture', () => {
    const next = play(opening('marshal'), mv('capture', [4, 6], [4, 2], 'white'));
    expect(isGameOver(next)).toBe(true);
    expect(next.phase).toBe('finished');
    expect(next.result).toEqual({ winner: 'white', reason: 'marshalCaptured' });
    expect(next.captured.white).toContain('marshal');
  });

  it('a marshal on top of a stack is captured and the capturer lands below', () => {
    const next = play(opening('pawn', 'marshal'), mv('capture', [4, 6], [4, 2], 'white'));
    expect(getStack(next.board, sq(4, 2))).toEqual([B('pawn'), W('cannon')]);
    expect(next.result).toEqual({ winner: 'white', reason: 'marshalCaptured' });
  });
});

/**
 * Black marshal in the corner. White stacks a cannon onto a 2-high stack on
 * file 0 (becoming a tier-3 slider) while another tier-3 cannon holds file 1.
 */
const MATE_NET = [
  at(0, 0, B('marshal')),
  at(0, 5, W('general'), W('general')),
  rook(2, 5, 'white'),
  rook(1, 7, 'white'),
  at(8, 8, W('marshal')),
];
const MATING_MOVE = mv('stack', [2, 5], [0, 5], 'white');

describe('§11.2 checkmate', () => {
  it('detects mate after the mating move', () => {
    const s = createPosition({ stacks: MATE_NET, turn: 'white' });
    expect(inCheck({ ...s, turn: 'black' })).toBe(false);
    const next = play(s, MATING_MOVE);
    expect(next.result).toEqual({ winner: 'white', reason: 'checkmate' });
    expect(legalMoves(next)).toEqual([]);
  });

  it('§8.2 a hand piece dropped inside the six-rank zone can block, preventing mate', () => {
    const s = createPosition({ stacks: MATE_NET, hands: { black: { pawn: 1 } }, turn: 'white' });
    const next = play(s, MATING_MOVE);
    expect(next.result).toBeNull();
    const drop = (rank: number): Move => ({
      type: 'drop',
      player: 'black',
      kind: 'pawn',
      to: sq(0, rank),
    });
    expect(legalMoves(next)).toEqual([drop(1), drop(2), drop(3), drop(4)]);
  });

  it('§8.4 an own pawn on the file does not stop a blocking pawn drop', () => {
    const s = createPosition({
      stacks: [...MATE_NET, at(0, 7, B('pawn'))],
      hands: { black: { pawn: 1 } },
      turn: 'white',
    });
    const next = play(s, MATING_MOVE);
    expect(next.result).toBeNull();
  });

  it('§8.4 a pawn drop may deliver mate', () => {
    // Full stacks wall the marshal in; none of their tops reaches (0, 8).
    const s = createPosition({
      stacks: [
        at(0, 7, B('marshal')),
        at(0, 6, B('general'), B('general'), B('pawn')),
        at(1, 6, B('general'), B('general'), B('major')),
        at(1, 7, B('general'), B('general'), B('musket')),
        at(1, 8, B('lieutenant'), B('lieutenant'), B('pawn')),
        at(2, 6, W('general'), W('samurai')),
        at(8, 0, W('marshal')),
      ],
      hands: { white: { pawn: 1 } },
      turn: 'white',
    });
    expect(inCheck({ ...s, turn: 'black' })).toBe(false);
    const next = play(s, { type: 'drop', player: 'white', kind: 'pawn', to: sq(0, 8) });
    expect(next.result).toEqual({ winner: 'white', reason: 'checkmate' });
  });
});

describe('§11.3 stalemate', () => {
  const STUCK = [
    at(0, 0, B('marshal')),
    rook(1, 5, 'white'),
    rook(8, 1, 'white'),
    at(5, 5, W('pawn')),
    at(8, 8, W('marshal')),
  ];

  it('a side with no legal move and not in check draws', () => {
    const s = createPosition({ stacks: STUCK, turn: 'white' });
    const next = play(s, mv('move', [5, 5], [5, 4], 'white'));
    expect(inCheck(next)).toBe(false);
    expect(next.result).toEqual({ winner: null, reason: 'stalemate' });
  });

  it('a hand piece that can be dropped avoids stalemate', () => {
    const s = createPosition({ stacks: STUCK, hands: { black: { general: 1 } }, turn: 'white' });
    expect(play(s, mv('move', [5, 5], [5, 4], 'white')).result).toBeNull();
  });
});

describe('§11.4 fifty-move rule', () => {
  const KINGS_ONLY = [at(0, 0, B('marshal')), at(8, 8, W('marshal'))];
  const shuffle: Move[] = [
    mv('move', [0, 0], [0, 1]),
    mv('move', [8, 8], [8, 7], 'white'),
    mv('move', [0, 1], [0, 0]),
    mv('move', [8, 7], [8, 8], 'white'),
  ];

  it('the 51st consecutive quiet ply draws', () => {
    const s = createPosition({ stacks: KINGS_ONLY, quietPlies: QUIET_PLY_LIMIT - 1 });
    const fiftieth = play(s, shuffle[0]!);
    expect(fiftieth.quietPlies).toBe(QUIET_PLY_LIMIT);
    expect(fiftieth.result).toBeNull();
    const next = play(fiftieth, shuffle[1]!);
    expect(next.result).toEqual({ winner: null, reason: 'fiftyMoveRule' });
  });

  it('counts from the start of play', () => {
    let s = createPosition({ stacks: KINGS_ONLY });
    for (let i = 0; i < 12; i++) s = play(s, ...shuffle);
    expect(s.quietPlies).toBe(48);
    s = play(s, shuffle[0]!, shuffle[1]!);
    expect(s.result).toBeNull();
    s = play(s, shuffle[2]!);
    expect(s.result).toEqual({ winner: null, reason: 'fiftyMoveRule' });
    expect(s.ply).toBe(51);
  });

  it('there is no repetition rule', () => {
    let s = createPosition({ stacks: KINGS_ONLY });
    for (let i = 0; i < 5; i++) s = play(s, ...shuffle);
    expect(s.result).toBeNull();
  });

  it('a drop resets the counter', () => {
    const s = createPosition({
      stacks: KINGS_ONLY,
      hands: { black: { general: 1 } },
      quietPlies: QUIET_PLY_LIMIT,
    });
    const next = play(s, { type: 'drop', player: 'black', kind: 'general', to: sq(3, 3) });
    expect(next.quietPlies).toBe(0);
    expect(next.result).toBeNull();
  });

  it('a capture resets the counter', () => {
    const s = createPosition({
      stacks: [...KINGS_ONLY, at(4, 4, B('pawn')), at(4, 5, W('pawn'))],
      quietPlies: QUIET_PLY_LIMIT,
    });
    expect(play(s, mv('capture', [4, 4], [4, 5])).quietPlies).toBe(0);
  });

  it('takes precedence over a simultaneous checkmate', () => {
    const s = createPosition({ stacks: MATE_NET, turn: 'white', quietPlies: QUIET_PLY_LIMIT });
    expect(play(s, MATING_MOVE).result).toEqual({ winner: null, reason: 'fiftyMoveRule' });
  });
});

describe('§12.1 state data', () => {
  it('positionKey identifies board, hands and turn', () => {
    const a = createPosition({ stacks: [at(0, 0, B('marshal')), at(8, 8, W('marshal'))] });
    const b = createPosition({
      stacks: [at(0, 0, B('marshal')), at(8, 8, W('marshal'))],
      quietPlies: 9,
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
    expect(s.quietPlies).toBe(0);
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

  const badKinds: unknown[] = [undefined, null, 42, 'lancer', 'Pawn', 'toString', '__proto__', {}];

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
        };
        const error = validateMove(state, move as unknown as Move);
        expect(error === null || Object.values(MoveError).includes(error)).toBe(true);
      }
    }
  });
});

describe('§9 → §11 lifecycle', () => {
  it('placement transitions to play with white to move', () => {
    const s = play(
      createInitialState(),
      { type: 'place', player: 'black', kind: 'marshal', to: sq(4, 0) },
      { type: 'place', player: 'white', kind: 'marshal', to: sq(4, 8) },
      { type: 'place', player: 'black', kind: 'pawn', to: sq(4, 2) },
      { type: 'finishPlacement', player: 'white' },
      { type: 'finishPlacement', player: 'black' },
    );
    expect(s.phase).toBe('play');
    expect(s.turn).toBe('white');
    expect(legalMoves(s).length).toBeGreaterThan(0);
    expect(legalMoves(s).every((m) => 'player' in m && m.player === 'white')).toBe(true);
  });
});

const place = (player: PlayerSide, kind: PieceKind, file: number, rank: number): Move => ({
  type: 'place',
  player,
  kind,
  to: sq(file, rank),
});

/** Marshals placed, white builds a tier-3 cannon on file 4 (rank 6) aiming at black. */
function cannonTowerAgainst(blackMarshalRank: number, blackFiller: Move[]): GameState {
  return play(
    createInitialState(),
    place('black', 'marshal', 4, blackMarshalRank),
    place('white', 'marshal', 0, 8),
    blackFiller[0]!,
    place('white', 'general', 4, 6),
    blackFiller[1]!,
    place('white', 'general', 4, 6),
    blackFiller[2]!,
    place('white', 'cannon', 4, 6),
  );
}

describe('§9.5 check during placement', () => {
  const filler = [
    place('black', 'general', 0, 0),
    place('black', 'general', 1, 0),
    place('black', 'general', 2, 0),
  ];

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

  it('§11.1 a check carried into play lets white capture the marshal', () => {
    const s = play(
      createInitialState(),
      place('black', 'marshal', 4, 0),
      place('white', 'marshal', 0, 8),
      { type: 'finishPlacement', player: 'black' },
      place('white', 'general', 4, 6),
      place('white', 'general', 4, 6),
      place('white', 'cannon', 4, 6),
      { type: 'finishPlacement', player: 'white' },
    );
    expect(s.phase).toBe('play');
    expect(s.turn).toBe('white');
    const next = play(s, mv('capture', [4, 6], [4, 0], 'white'));
    expect(next.result).toEqual({ winner: 'white', reason: 'marshalCaptured' });
    expect(next.captured.white).toEqual(['marshal']);
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
    // §3.1 piece conservation: board + hand + removed by opponent = 38.
    expect(
      piecesOf(state, side) + handTotal(state.hands[side]) + state.captured[opponent(side)].length,
    ).toBe(38);
  }
  for (const s of allSquares()) {
    const stack = getStack(state.board, s);
    // §4.1 no stack exceeds 3.
    expect(stack.length).toBeLessThanOrEqual(3);
    // §4.4 nothing sits on a marshal (§6.4 capture-advance included).
    stack.slice(0, -1).forEach((p) => expect(p.kind).not.toBe('marshal'));
  }
  // §11.4 the game ends as soon as the counter passes the limit.
  expect(state.quietPlies).toBeLessThanOrEqual(QUIET_PLY_LIMIT + 1);
  if (state.phase !== 'finished') {
    expect(state.quietPlies).toBeLessThanOrEqual(QUIET_PLY_LIMIT);
    // §10.1 the side that just moved is never left in check.
    expect(inCheck({ ...state, turn: opponent(state.turn) })).toBe(false);
  }
}

describe('random self-play invariants', () => {
  it.each([1, 2, 3, 4, 5, 6])(
    'seed %i: every legal move applies and invariants hold',
    (seed) => {
      const rand = rng(seed);
      let state = createInitialState();
      for (let i = 0; i < 400 && !isGameOver(state); i++) {
        const moves = legalMoves(state);
        expect(moves.length).toBeGreaterThan(0);
        // A few other generated moves must validate as well.
        for (let k = 0; k < 2; k++) {
          expect(validateMove(state, moves[Math.floor(rand() * moves.length)]!)).toBeNull();
        }
        // Prefer finishing placement early sometimes so the play phase is reached.
        const finishMove = moves.find((m) => m.type === 'finishPlacement');
        const move =
          finishMove && rand() < 0.15 ? finishMove : moves[Math.floor(rand() * moves.length)]!;
        const result = applyMove(state, move);
        expect(result.ok).toBe(true);
        if (!result.ok) break;
        state = result.state;
        checkInvariants(state);
      }
      if (isGameOver(state)) expect(legalMoves(state)).toEqual([]);
    },
    30_000,
  );
});
