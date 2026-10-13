import { beforeEach, describe, expect, it } from 'vitest';
import { legalMoves } from '@gungi/engine';
import type { GameState } from '@gungi/engine';
import { clientMoveSchema, rejoinTokenSchema } from '@gungi/shared';
import type { ClientMove, WsErrorCode } from '@gungi/shared';
import { InMemoryMatchRepository } from './match.repository';
import { MatchService } from './match.service';
import { MatchError } from './match.types';
import type { PlayerIdentity } from './match.types';

const alice: PlayerIdentity = { playerId: 'guest_alice', displayName: 'Alice' };
const bob: PlayerIdentity = { playerId: 'guest_bob', displayName: null };
const carol: PlayerIdentity = { playerId: 'guest_carol', displayName: 'Carol' };

const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const marshal = (file: number, rank: number): ClientMove => ({
  type: 'place',
  kind: 'marshal',
  to: { file, rank },
});

async function expectCode(promise: Promise<unknown>, code: WsErrorCode): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(MatchError);
  expect((error as MatchError).code).toBe(code);
}

describe('MatchService', () => {
  let repository: InMemoryMatchRepository;
  let service: MatchService;

  beforeEach(() => {
    repository = new InMemoryMatchRepository();
    service = new MatchService(repository);
  });

  /** Alice (black, first) vs Bob (white), active. */
  async function activeMatch() {
    const created = await service.create(alice, 'c-alice', { side: 'black', firstPlayer: 'black' });
    const joined = await service.join(created.match.matchId, bob, 'c-bob');
    return { id: created.match.matchId, created, joined };
  }

  describe('create', () => {
    it('opens a waiting match with the creator on the chosen side', async () => {
      const { match, you } = await service.create(alice, 'c-alice', {
        side: 'white',
        firstPlayer: 'black',
      });

      expect(match.status).toBe('waiting');
      expect(match.state).toBeNull();
      expect(match.firstPlayer).toBe('black');
      expect(match.seats.black).toBeNull();
      expect(match.seats.white).toEqual({
        playerId: 'guest_alice',
        displayName: 'Alice',
        connected: true,
      });
      expect(you.side).toBe('white');
      expect(rejoinTokenSchema.safeParse(you.rejoinToken).success).toBe(true);
      expect(JSON.stringify(match)).not.toContain(you.rejoinToken);
    });

    it('resolves random choices to a side', async () => {
      for (let i = 0; i < 10; i++) {
        const { match, you } = await service.create(alice, `c${i}`, {
          side: 'random',
          firstPlayer: 'random',
        });
        expect(['black', 'white']).toContain(you.side);
        expect(['black', 'white']).toContain(match.firstPlayer);
      }
    });
  });

  describe('join', () => {
    it('seats the second player and starts the engine', async () => {
      const { joined, created } = await activeMatch();

      expect(joined.you.side).toBe('white');
      expect(joined.you.rejoinToken).not.toBe(created.you.rejoinToken);
      expect(joined.match.status).toBe('active');
      expect(joined.match.revision).toBe(created.match.revision + 1);
      expect(joined.match.state?.phase).toBe('placement');
      expect(joined.match.state?.turn).toBe('black');
      expect(joined.match.seats.white?.playerId).toBe('guest_bob');
    });

    it('honours a white first player', async () => {
      const created = await service.create(alice, 'c-alice', {
        side: 'black',
        firstPlayer: 'white',
      });
      const joined = await service.join(created.match.matchId, bob, 'c-bob');
      expect(joined.match.state?.firstPlayer).toBe('white');
      expect(joined.match.state?.turn).toBe('white');
    });

    it('rejects the seat holder, a third player and unknown matches', async () => {
      const created = await service.create(alice, 'c-alice', {
        side: 'black',
        firstPlayer: 'black',
      });
      const id = created.match.matchId;

      await expectCode(service.join(id, alice, 'c-alice'), 'ALREADY_SEATED');
      await expectCode(service.join(id, alice, 'c-other'), 'ALREADY_SEATED');
      await service.join(id, bob, 'c-bob');
      await expectCode(service.join(id, carol, 'c-carol'), 'MATCH_FULL');
      await expectCode(service.join(MISSING_ID, carol, 'c-carol'), 'MATCH_NOT_FOUND');
    });

    it('lets exactly one of two concurrent joiners take the seat', async () => {
      const created = await service.create(alice, 'c-alice', {
        side: 'black',
        firstPlayer: 'black',
      });
      const results = await Promise.allSettled([
        service.join(created.match.matchId, bob, 'c-bob'),
        service.join(created.match.matchId, carol, 'c-carol'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });

  describe('applyMove', () => {
    it('applies a legal move and records it with the seat side', async () => {
      const { id, joined } = await activeMatch();
      const view = await service.applyMove(id, 'c-alice', marshal(4, 0), 0);

      expect(view.revision).toBe(joined.match.revision + 1);
      expect(view.state?.ply).toBe(1);
      expect(view.state?.turn).toBe('white');
      expect(view.lastMove).toEqual({
        type: 'place',
        kind: 'marshal',
        to: { file: 4, rank: 0 },
        player: 'black',
      });
    });

    it('forwards engine rule violations unchanged', async () => {
      const { id } = await activeMatch();
      await expectCode(service.applyMove(id, 'c-bob', marshal(4, 8)), 'NOT_YOUR_TURN');
      await expectCode(
        service.applyMove(id, 'c-alice', { type: 'place', kind: 'pawn', to: { file: 0, rank: 0 } }),
        'MARSHAL_FIRST',
      );
      await expectCode(service.applyMove(id, 'c-alice', marshal(99, 0)), 'INVALID_SQUARE');
      const view = await service.get(id);
      expect(view?.state?.ply).toBe(0);
    });

    it('rejects moves outside an active seat', async () => {
      const created = await service.create(alice, 'c-alice', {
        side: 'black',
        firstPlayer: 'black',
      });
      const id = created.match.matchId;
      await expectCode(service.applyMove(id, 'c-alice', marshal(4, 0)), 'MATCH_NOT_ACTIVE');
      await service.join(id, bob, 'c-bob');
      await expectCode(service.applyMove(id, 'c-carol', marshal(4, 0)), 'NOT_SEATED');
      await expectCode(
        service.applyMove(id, 'c-alice', { ...marshal(4, 0), player: 'white' }),
        'NOT_YOUR_SIDE',
      );
      await expectCode(service.applyMove(MISSING_ID, 'c-alice', marshal(4, 0)), 'MATCH_NOT_FOUND');
    });

    it('rejects a stale ply guard', async () => {
      const { id } = await activeMatch();
      await service.applyMove(id, 'c-alice', marshal(4, 0), 0);
      await expectCode(service.applyMove(id, 'c-bob', marshal(4, 8), 0), 'STALE_PLY');
      await expect(service.applyMove(id, 'c-bob', marshal(4, 8), 1)).resolves.toBeDefined();
    });
  });

  describe('per-match lock', () => {
    it('applies a duplicated move exactly once', async () => {
      const { id } = await activeMatch();
      const results = await Promise.allSettled([
        service.applyMove(id, 'c-alice', marshal(4, 0), 0),
        service.applyMove(id, 'c-alice', marshal(4, 0), 0),
        service.applyMove(id, 'c-alice', marshal(4, 0), 0),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const view = await service.get(id);
      expect(view?.state?.ply).toBe(1);
    });

    it('keeps state and revision consistent under concurrent moves of both players', async () => {
      const { id, joined } = await activeMatch();
      await service.applyMove(id, 'c-alice', marshal(4, 0));
      await service.applyMove(id, 'c-bob', marshal(4, 8));

      const pawn = (file: number, rank: number): ClientMove => ({
        type: 'place',
        kind: 'pawn',
        to: { file, rank },
      });
      const attempts = [0, 1, 2, 3, 5, 6, 7, 8].flatMap((file) => [
        service.applyMove(id, 'c-alice', pawn(file, 2)),
        service.applyMove(id, 'c-bob', pawn(file, 6)),
      ]);
      const results = await Promise.allSettled(attempts);
      const applied = results.filter((r) => r.status === 'fulfilled').length;

      const view = await service.get(id);
      expect(applied).toBeGreaterThan(0);
      expect(view?.state?.ply).toBe(2 + applied);
      expect(view?.revision).toBe(joined.match.revision + 2 + applied);
    });
  });

  describe('disconnect and rejoin', () => {
    it('holds the seat of a disconnected player', async () => {
      const { id } = await activeMatch();
      const detached = await service.disconnect(id, 'c-bob');

      expect(detached.side).toBe('white');
      expect(detached.match?.status).toBe('active');
      expect(detached.match?.seats.white?.connected).toBe(false);
      await expectCode(service.join(id, carol, 'c-carol'), 'MATCH_FULL');
    });

    it('rebinds the seat with a valid token only', async () => {
      const { id, joined } = await activeMatch();
      await service.applyMove(id, 'c-alice', marshal(4, 0));
      await service.disconnect(id, 'c-bob');

      await expectCode(service.rejoin(id, 'x'.repeat(43), carol, 'c-x'), 'INVALID_REJOIN_TOKEN');
      await expectCode(service.applyMove(id, 'c-bob', marshal(4, 8)), 'NOT_SEATED');

      const bob2: PlayerIdentity = { playerId: 'guest_bob2', displayName: null };
      const back = await service.rejoin(id, joined.you.rejoinToken, bob2, 'c-bob2');
      expect(back.replacedConnectionId).toBeNull();
      expect(back.you).toEqual({ ...joined.you, playerId: 'guest_bob2' });
      expect(back.match.seats.white?.connected).toBe(true);
      expect(back.match.state?.ply).toBe(1);

      await expect(service.applyMove(id, 'c-bob2', marshal(4, 8))).resolves.toBeDefined();
    });

    it('reports a connection replaced by a rejoin', async () => {
      const { id, created } = await activeMatch();
      const back = await service.rejoin(id, created.you.rejoinToken, alice, 'c-alice2');

      expect(back.replacedConnectionId).toBe('c-alice');
      await expectCode(service.applyMove(id, 'c-alice', marshal(4, 0)), 'NOT_SEATED');
      await expect(service.applyMove(id, 'c-alice2', marshal(4, 0))).resolves.toBeDefined();
    });

    it('rejects detaching a connection without a seat', async () => {
      const { id } = await activeMatch();
      await expectCode(service.disconnect(id, 'c-carol'), 'NOT_SEATED');
      await expectCode(service.leave(MISSING_ID, 'c-alice'), 'MATCH_NOT_FOUND');
    });
  });

  describe('leave and cleanup', () => {
    it('discards a waiting match left by its creator', async () => {
      const created = await service.create(alice, 'c-alice', {
        side: 'black',
        firstPlayer: 'black',
      });
      const left = await service.leave(created.match.matchId, 'c-alice');
      expect(left.match).toBeNull();
      expect(repository.size).toBe(0);
    });

    it('keeps a waiting match when its creator only disconnects', async () => {
      const created = await service.create(alice, 'c-alice', {
        side: 'black',
        firstPlayer: 'black',
      });
      await service.disconnect(created.match.matchId, 'c-alice');
      expect(repository.size).toBe(1);
    });

    it('keeps the seat of a player leaving an active match', async () => {
      const { id } = await activeMatch();
      const left = await service.leave(id, 'c-alice');
      expect(left.match?.status).toBe('active');
      expect(left.match?.seats.black?.connected).toBe(false);
    });

    it('discards a finished match once nobody is connected', async () => {
      const { id } = await activeMatch();
      await service.applyMove(id, 'c-alice', { type: 'resign' });
      await service.leave(id, 'c-alice');
      expect(repository.size).toBe(1);
      const last = await service.disconnect(id, 'c-bob');
      expect(last.match).toBeNull();
      expect(repository.size).toBe(0);
    });
  });

  describe('game end', () => {
    it('plays engine moves through placement and finishes on resignation', async () => {
      const { id } = await activeMatch();
      const connection = { black: 'c-alice', white: 'c-bob' } as const;
      let state = (await service.get(id))?.state as GameState;

      for (let i = 0; i < 60 && state.phase !== 'finished'; i++) {
        const [move] = legalMoves(state);
        if (!move) break;
        const clientMove = clientMoveSchema.parse(move);
        const view = await service.applyMove(id, connection[state.turn], clientMove, state.ply);
        state = view.state as GameState;
      }
      expect(state.ply).toBeGreaterThan(40);

      const view = await service.applyMove(id, 'c-bob', { type: 'resign' });
      expect(view.status).toBe('finished');
      expect(view.state?.result).toEqual({ winner: 'black', reason: 'resignation' });
      expect(view.lastMove).toEqual({ type: 'resign', player: 'white' });
      await expectCode(service.applyMove(id, 'c-alice', marshal(0, 0)), 'MATCH_NOT_ACTIVE');
    });

    it('resigns during placement regardless of the turn', async () => {
      const { id } = await activeMatch();
      const view = await service.applyMove(id, 'c-bob', { type: 'resign' });
      expect(view.state?.result).toEqual({ winner: 'black', reason: 'resignation' });
    });

    it('plumbs server-decided timeout and agreed draw', async () => {
      const first = await activeMatch();
      const timedOut = await service.finishByServer(first.id, { type: 'timeout', player: 'black' });
      expect(timedOut.state?.result).toEqual({ winner: 'white', reason: 'timeout' });
      await expectCode(service.finishByServer(first.id, { type: 'agreeDraw' }), 'MATCH_NOT_ACTIVE');

      const second = await activeMatch();
      const drawn = await service.finishByServer(second.id, { type: 'agreeDraw' });
      expect(drawn.status).toBe('finished');
      expect(drawn.state?.result).toEqual({ winner: null, reason: 'agreement' });
    });
  });
});
