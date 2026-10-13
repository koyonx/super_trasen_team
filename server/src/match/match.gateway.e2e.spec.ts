import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { GameState, Move } from '@gungi/engine';
import {
  ClientEvent,
  ServerEvent,
  WS_NAMESPACE,
  WS_PATH,
  WS_PROTOCOL_VERSION,
  matchRoom,
} from '@gungi/shared';
import type {
  MatchErrorPayload,
  MatchSnapshot,
  PlayerConnectionPayload,
  SeatedPayload,
  WsAck,
} from '@gungi/shared';
import type { Namespace } from 'socket.io';
import { MatchGateway } from './match.gateway';
import { MatchModule } from './match.module';
import { InMemoryMatchRepository, MATCH_REPOSITORY } from './match.repository';
import { MatchService } from './match.service';
import type { MatchRecord } from './match.types';

type Snapshot = MatchSnapshot<GameState, Move>;
type Seated = SeatedPayload<GameState, Move>;

const ORIGIN = 'https://localhost:8443';
const TIMEOUT = 2000;

/** In-memory repository whose next `insert` can be held open (simulated slow I/O). */
class GatedMatchRepository extends InMemoryMatchRepository {
  private gate: { entered: () => void; opened: Promise<void> } | null = null;
  readonly inserted: string[] = [];

  /** Holds the next insert; resolves `entered` once it is in flight. */
  holdNextInsert(): { entered: Promise<void>; release: () => void } {
    let release!: () => void;
    let entered!: () => void;
    const opened = new Promise<void>((resolve) => (release = resolve));
    const enteredPromise = new Promise<void>((resolve) => (entered = resolve));
    this.gate = { entered, opened };
    return { entered: enteredPromise, release };
  }

  override async insert(match: MatchRecord): Promise<void> {
    const gate = this.gate;
    this.gate = null;
    if (gate) {
      gate.entered();
      await gate.opened;
    }
    this.inserted.push(match.id);
    await super.insert(match);
  }
}

async function startApp(repository?: InMemoryMatchRepository): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), MatchModule],
  });
  if (repository) builder = builder.overrideProvider(MATCH_REPOSITORY).useValue(repository);
  const app = (await builder.compile()).createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  return app;
}

async function namespaceUrl(app: INestApplication): Promise<string> {
  return `${await app.getUrl()}${WS_NAMESPACE}`.replace('[::1]', '127.0.0.1');
}

describe('MatchGateway (socket.io e2e)', () => {
  let app: INestApplication;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    app = await startApp();
    url = await namespaceUrl(app);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await app.close();
  });

  function client(
    options: { origin?: string; auth?: Record<string, unknown>; url?: string } = {},
  ): Socket {
    const socket = io(options.url ?? url, {
      path: WS_PATH,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: options.auth ?? { protocolVersion: WS_PROTOCOL_VERSION, displayName: 'tester' },
      extraHeaders: { origin: options.origin ?? ORIGIN },
    });
    sockets.push(socket);
    return socket;
  }

  async function connected(socket: Socket): Promise<Socket> {
    if (socket.connected) return socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  }

  function connectError(socket: Socket): Promise<Error & { data?: { code?: string } }> {
    return new Promise((resolve, reject) => {
      socket.once('connect', () => reject(new Error('unexpectedly connected')));
      socket.once('connect_error', resolve);
    });
  }

  function next<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), TIMEOUT);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  function request<T>(socket: Socket, event: string, payload?: unknown): Promise<WsAck<T>> {
    const timed = socket.timeout(TIMEOUT);
    return (
      payload === undefined ? timed.emitWithAck(event) : timed.emitWithAck(event, payload)
    ) as Promise<WsAck<T>>;
  }

  function expectOk<T>(ack: WsAck<T>): T {
    if (!ack.ok) throw new Error(`request failed with ${ack.code}`);
    return ack.data;
  }

  /** Polls `condition` until it holds (server-side effects of a disconnect are asynchronous). */
  async function until(condition: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + TIMEOUT;
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error('condition not met in time');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  describe('handshake', () => {
    it('rejects a foreign origin', async () => {
      const error = await connectError(client({ origin: 'https://evil.example' }));
      expect(error.message).toBe('FORBIDDEN_ORIGIN');
      expect(error.data?.code).toBe('FORBIDDEN_ORIGIN');
    });

    it('rejects a missing or unsupported protocol version', async () => {
      expect((await connectError(client({ auth: {} }))).data?.code).toBe('UNSUPPORTED_PROTOCOL');
      const old = client({ auth: { protocolVersion: 0 } });
      expect((await connectError(old)).data?.code).toBe('UNSUPPORTED_PROTOCOL');
    });

    it('rejects a malformed handshake payload', async () => {
      const socket = client({
        auth: { protocolVersion: WS_PROTOCOL_VERSION, displayName: 'x'.repeat(500) },
      });
      expect((await connectError(socket)).data?.code).toBe('INVALID_PAYLOAD');
    });
  });

  describe('requests', () => {
    it('answers malformed payloads with INVALID_PAYLOAD and stays up', async () => {
      const socket = await connected(client());
      const error = next<MatchErrorPayload>(socket, ServerEvent.ERROR);

      const ack = await request(socket, ClientEvent.MOVE, { matchId: 42, move: 'e4' });
      expect(ack).toEqual({ ok: false, code: 'INVALID_PAYLOAD' });
      expect(await error).toEqual({ code: 'INVALID_PAYLOAD', event: ClientEvent.MOVE });

      expect(await request(socket, ClientEvent.JOIN, null)).toEqual({
        ok: false,
        code: 'INVALID_PAYLOAD',
      });
      const created = expectOk(await request<Seated>(socket, ClientEvent.CREATE));
      expect(created.match.status).toBe('waiting');
    });

    it('keeps one unfinished match per connection', async () => {
      const socket = await connected(client());
      expectOk(await request<Seated>(socket, ClientEvent.CREATE, {}));
      expect(await request(socket, ClientEvent.CREATE, {})).toEqual({
        ok: false,
        code: 'ALREADY_IN_MATCH',
      });
    });

    it('seats one socket once under parallel seat requests and frees it on disconnect', async () => {
      const service = app.get(MatchService);
      const repository = app.get<InMemoryMatchRepository>(MATCH_REPOSITORY);
      const before = repository.size;
      const socket = await connected(client());

      const acks = await Promise.all(
        Array.from({ length: 5 }, () => request<Seated>(socket, ClientEvent.CREATE, {})),
      );
      const created = acks.filter((ack) => ack.ok);
      expect(created).toHaveLength(1);
      expect(acks.filter((ack) => !ack.ok)).toEqual(
        Array.from({ length: 4 }, () => ({ ok: false, code: 'ALREADY_IN_MATCH' })),
      );
      expect(repository.size).toBe(before + 1);

      const matchIds = created.map((ack) => expectOk(ack).match.matchId);
      socket.disconnect();
      await until(async () => {
        const views = await Promise.all(matchIds.map((id) => service.get(id)));
        return views.every(
          (view) => view?.seats.black?.connected !== true && view?.seats.white?.connected !== true,
        );
      });
    });

    it('seats one socket once under a parallel create and join', async () => {
      const [host, socket] = await Promise.all([connected(client()), connected(client())]);
      const { match } = expectOk(await request<Seated>(host, ClientEvent.CREATE, {}));

      const acks = await Promise.all([
        request<Seated>(socket, ClientEvent.CREATE, {}),
        request<Seated>(socket, ClientEvent.JOIN, { matchId: match.matchId }),
      ]);
      expect(acks.filter((ack) => ack.ok)).toHaveLength(1);
      expect(acks.filter((ack) => !ack.ok)).toEqual([{ ok: false, code: 'ALREADY_IN_MATCH' }]);
    });

    it('discards a waiting match left by its creator', async () => {
      const [a, b] = await Promise.all([connected(client()), connected(client())]);
      const { match } = expectOk(await request<Seated>(a, ClientEvent.CREATE, {}));
      expectOk(await request(a, ClientEvent.LEAVE, { matchId: match.matchId }));
      expect(await request(b, ClientEvent.JOIN, { matchId: match.matchId })).toEqual({
        ok: false,
        code: 'MATCH_NOT_FOUND',
      });
    });
  });

  it('plays a match: create, join, move, illegal move, disconnect, rejoin, resign', async () => {
    const alice = await connected(client({ auth: { protocolVersion: 1, displayName: 'Alice' } }));
    const bob = await connected(client({ auth: { protocolVersion: 1, displayName: 'Bob' } }));

    // create
    const createdEvent = next<Seated>(alice, ServerEvent.CREATED);
    const created = expectOk(
      await request<Seated>(alice, ClientEvent.CREATE, { side: 'black', firstPlayer: 'black' }),
    );
    expect(await createdEvent).toEqual(created);
    expect(created.you.side).toBe('black');
    const matchId = created.match.matchId;

    // join: both players receive the active state
    const aliceActive = next<Snapshot>(alice, ServerEvent.STATE);
    const bobActive = next<Snapshot>(bob, ServerEvent.STATE);
    const joined = expectOk(await request<Seated>(bob, ClientEvent.JOIN, { matchId }));
    expect(joined.you.side).toBe('white');
    for (const state of await Promise.all([aliceActive, bobActive])) {
      expect(state.status).toBe('active');
      expect(state.state?.phase).toBe('placement');
      expect(state.seats.black?.displayName).toBe('Alice');
      expect(state.seats.white?.displayName).toBe('Bob');
      expect(JSON.stringify(state)).not.toContain(joined.you.rejoinToken);
    }

    // a legal placement is broadcast to both
    const aliceMoved = next<Snapshot>(alice, ServerEvent.STATE);
    const bobMoved = next<Snapshot>(bob, ServerEvent.STATE);
    const marshal = { type: 'place', kind: 'marshal', to: { file: 4, rank: 0 } };
    const moved = expectOk(
      await request<Snapshot>(alice, ClientEvent.MOVE, { matchId, move: marshal, ply: 0 }),
    );
    expect(moved.state?.ply).toBe(1);
    expect((await aliceMoved).revision).toBe(moved.revision);
    expect((await bobMoved).lastMove).toEqual({ ...marshal, player: 'black' });

    // an illegal move returns the engine's code
    const bobError = next<MatchErrorPayload>(bob, ServerEvent.ERROR);
    const pawn = { type: 'place', kind: 'pawn', to: { file: 0, rank: 8 } };
    expect(await request(bob, ClientEvent.MOVE, { matchId, move: pawn })).toEqual({
      ok: false,
      code: 'MARSHAL_FIRST',
    });
    expect(await bobError).toEqual({ code: 'MARSHAL_FIRST', event: ClientEvent.MOVE, matchId });

    // disconnect keeps the seat; the opponent is told
    const bobGone = next<PlayerConnectionPayload>(alice, ServerEvent.PLAYER_CONNECTION);
    bob.disconnect();
    expect(await bobGone).toMatchObject({ matchId, side: 'white', connected: false });

    const intruder = await connected(client());
    expect(await request(intruder, ClientEvent.JOIN, { matchId })).toEqual({
      ok: false,
      code: 'MATCH_FULL',
    });

    // rejoin from a new connection with the seat's token
    const bob2 = await connected(client({ auth: { protocolVersion: 1, displayName: 'Bob' } }));
    const bobBack = next<PlayerConnectionPayload>(alice, ServerEvent.PLAYER_CONNECTION);
    const bob2State = next<Snapshot>(bob2, ServerEvent.STATE);
    const rejoined = expectOk(
      await request<Seated>(bob2, ClientEvent.REJOIN, {
        matchId,
        rejoinToken: joined.you.rejoinToken,
      }),
    );
    expect(rejoined.you.side).toBe('white');
    expect(rejoined.match.state?.ply).toBe(1);
    expect((await bob2State).seats.white?.connected).toBe(true);
    expect(await bobBack).toMatchObject({ matchId, side: 'white', connected: true });

    // the rejoined seat can play
    const bobMarshal = { type: 'place', kind: 'marshal', to: { file: 4, rank: 8 } };
    const afterBob = expectOk(
      await request<Snapshot>(bob2, ClientEvent.MOVE, { matchId, move: bobMarshal }),
    );
    expect(afterBob.state?.ply).toBe(2);

    // resignation finishes the match for both
    const aliceFinal = next<Snapshot>(alice, ServerEvent.STATE);
    const bobFinal = next<Snapshot>(bob2, ServerEvent.STATE);
    expectOk(await request(alice, ClientEvent.MOVE, { matchId, move: { type: 'resign' } }));
    for (const final of await Promise.all([aliceFinal, bobFinal])) {
      expect(final.status).toBe('finished');
      expect(final.state?.result).toEqual({ winner: 'white', reason: 'resignation' });
    }
    expect(await request(bob2, ClientEvent.MOVE, { matchId, move: marshal })).toEqual({
      ok: false,
      code: 'MATCH_NOT_ACTIVE',
    });
    expect(await request(intruder, ClientEvent.JOIN, { matchId })).toEqual({
      ok: false,
      code: 'MATCH_NOT_ACTIVE',
    });
  });

  it('evicts the previous connection when a seat is rejoined elsewhere', async () => {
    const [alice, bob] = await Promise.all([connected(client()), connected(client())]);
    const created = expectOk(
      await request<Seated>(alice, ClientEvent.CREATE, { side: 'white', firstPlayer: 'white' }),
    );
    const matchId = created.match.matchId;
    expectOk(await request(bob, ClientEvent.JOIN, { matchId }));

    const evicted = next<MatchErrorPayload>(alice, ServerEvent.ERROR);
    const alice2 = await connected(client());
    expectOk(
      await request(alice2, ClientEvent.REJOIN, { matchId, rejoinToken: created.you.rejoinToken }),
    );
    expect(await evicted).toEqual({ code: 'SEAT_TAKEN_OVER', matchId });

    const marshal = { type: 'place', kind: 'marshal', to: { file: 4, rank: 8 } };
    expect(await request(alice, ClientEvent.MOVE, { matchId, move: marshal })).toEqual({
      ok: false,
      code: 'NOT_SEATED',
    });
    expect(
      expectOk(await request<Snapshot>(alice2, ClientEvent.MOVE, { matchId, move: marshal })).state
        ?.ply,
    ).toBe(1);
    expect(
      await request(alice2, ClientEvent.REJOIN, { matchId, rejoinToken: 'A'.repeat(43) }),
    ).toEqual({ ok: false, code: 'INVALID_REJOIN_TOKEN' });
  });

  describe('disconnect during a seat request', () => {
    let gatedApp: INestApplication;
    let gatedUrl: string;
    const repository = new GatedMatchRepository();

    beforeAll(async () => {
      gatedApp = await startApp(repository);
      gatedUrl = await namespaceUrl(gatedApp);
    });

    afterAll(async () => {
      await gatedApp.close();
    });

    it('does not leave the seat bound to the dead connection', async () => {
      const namespace = (gatedApp.get(MatchGateway) as unknown as { namespace: Namespace })
        .namespace;
      const service = gatedApp.get(MatchService);
      const socket = await connected(client({ url: gatedUrl }));
      const socketId = socket.id as string;

      const held = repository.holdNextInsert();
      socket.emit(ClientEvent.CREATE, {});
      await held.entered;
      socket.disconnect();
      await until(async () => !namespace.sockets.has(socketId));
      held.release();

      await until(async () => repository.inserted.length === 1);
      const matchId = repository.inserted[0] as string;
      await until(async () => {
        const view = await service.get(matchId);
        return view !== null && [view.seats.black, view.seats.white].every((s) => !s?.connected);
      });
      expect(namespace.adapter.rooms.get(matchRoom(matchId))).toBeUndefined();
    });
  });
});
