import { describe, expect, it } from 'vitest';
import { allSquares, getStack } from './board';
import { applyMove, inCheck, isGameOver, legalMoves, validateMove } from './engine';
import { handTotal, opponent } from './pieces';
import { createPosition } from './position';
import { createInitialState } from './setup';
import { B, W, at, sq } from './test-helpers';
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

  it('capturing the enemy marshal is allowed even if own marshal is exposed', () => {
    const s = createPosition({
      stacks: [
        at(4, 0, B('marshal')),
        rook(0, 4, 'black'),
        rook(4, 8, 'white'),
        at(0, 8, W('marshal')),
      ],
    });
    const next = play(s, mv('capture', [0, 4], [0, 8]));
    expect(next.result).toEqual({ winner: 'black', reason: 'marshalCaptured' });
  });
});

describe('§11.1 marshal capture', () => {
  it('ends the game and records the capture', () => {
    const s = createPosition({
      stacks: [at(0, 0, B('marshal')), at(4, 4, B('pawn')), at(4, 5, W('marshal'))],
    });
    const next = play(s, mv('capture', [4, 4], [4, 5]));
    expect(isGameOver(next)).toBe(true);
    expect(next.phase).toBe('finished');
    expect(next.result).toEqual({ winner: 'black', reason: 'marshalCaptured' });
    expect(next.captured.black).toContain('marshal');
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

  it('§8.3 the pawn file rule can leave a check unblockable', () => {
    const s = createPosition({
      stacks: [...MATE_NET, at(0, 7, B('pawn'))],
      hands: { black: { pawn: 1 } },
      turn: 'white',
    });
    const next = play(s, MATING_MOVE);
    expect(next.result).toEqual({ winner: 'white', reason: 'checkmate' });
  });

  it('§8.4 a pawn drop may deliver mate', () => {
    const full = (file: number, rank: number) =>
      at(file, rank, B('general'), B('general'), B('musket'));
    const s = createPosition({
      stacks: [
        at(0, 7, B('marshal')),
        full(0, 6),
        full(1, 6),
        full(1, 7),
        full(1, 8),
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
  it('a side with no legal move and not in check loses', () => {
    const s = createPosition({
      stacks: [
        at(0, 0, B('marshal')),
        rook(1, 5, 'white'),
        rook(8, 1, 'white'),
        at(5, 5, W('pawn')),
        at(8, 8, W('marshal')),
      ],
      turn: 'white',
    });
    const next = play(s, mv('move', [5, 5], [5, 4], 'white'));
    expect(next.result).toEqual({ winner: 'white', reason: 'stalemate' });
  });
});

describe('§11.4 repetition', () => {
  it('the 4th occurrence of a position is a draw', () => {
    let s = createPosition({ stacks: [at(0, 0, B('marshal')), at(8, 8, W('marshal'))] });
    const cycle: Move[] = [
      mv('move', [0, 0], [0, 1]),
      mv('move', [8, 8], [8, 7], 'white'),
      mv('move', [0, 1], [0, 0]),
      mv('move', [8, 7], [8, 8], 'white'),
    ];
    s = play(s, ...cycle, ...cycle);
    expect(s.result).toBeNull();
    s = play(s, ...cycle.slice(0, 3));
    expect(s.result).toBeNull();
    s = play(s, cycle[3]!);
    expect(s.result).toEqual({ winner: null, reason: 'repetition' });
    expect(s.ply).toBe(12);
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

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function piecesOf(state: GameState, side: PlayerSide): number {
  return allSquares().reduce(
    (n, s) => n + getStack(state.board, s).filter((p) => p.owner === side).length,
    0,
  );
}

describe('random self-play invariants', () => {
  it.each([1, 2, 3])('seed %i: every legal move applies and invariants hold', (seed) => {
    const rand = rng(seed);
    let state = createInitialState();
    for (let i = 0; i < 160 && !isGameOver(state); i++) {
      const moves = legalMoves(state);
      expect(moves.length).toBeGreaterThan(0);
      // Prefer finishing placement early sometimes so the play phase is reached.
      const finishMove = moves.find((m) => m.type === 'finishPlacement');
      const move =
        finishMove && rand() < 0.15 ? finishMove : moves[Math.floor(rand() * moves.length)]!;
      const result = applyMove(state, move);
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      state = result.state;

      // JSON round-trip safe.
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
      for (const side of ['black', 'white'] as const) {
        // Piece conservation: board + hand + removed by opponent = 38.
        expect(
          piecesOf(state, side) +
            handTotal(state.hands[side]) +
            state.captured[opponent(side)].length,
        ).toBe(38);
      }
      // No stack exceeds 3 and nothing sits on a marshal.
      for (const s of allSquares()) {
        const stack = getStack(state.board, s);
        expect(stack.length).toBeLessThanOrEqual(3);
        stack.slice(0, -1).forEach((p) => expect(p.kind).not.toBe('marshal'));
      }
      // The side that just moved is never left in check (unless the game ended).
      if (state.phase === 'play')
        expect(inCheck({ ...state, turn: opponent(state.turn) })).toBe(false);
    }
  });
});
