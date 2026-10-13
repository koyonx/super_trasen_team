import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import {
  ClientEvent,
  MatchErrorCode,
  ServerEvent,
  WS_NAMESPACE,
  WS_PATH,
  WS_PROTOCOL_VERSION,
  clientEventSchemas,
  handshakeAuthSchema,
  matchRoom,
} from '@gungi/shared';
import type {
  ClientEventAcks,
  ClientEventName,
  ClientEventRequests,
  LeftPayload,
  MatchErrorPayload,
  PlayerConnectionPayload,
  WsAck,
  WsErrorCode,
} from '@gungi/shared';
import type { GameState, Move } from '@gungi/engine';
import type { Namespace, Socket } from 'socket.io';
import { MatchService } from './match.service';
import type { MatchView, SeatedView } from './match.service';
import { MatchError } from './match.types';
import { WS_AUTH_ADAPTER } from './ws-auth.adapter';
import type { WsAuthAdapter, WsIdentity } from './ws-auth.adapter';
import { isOriginAllowed, parseAllowedOrigins } from './ws-origin';

/** Per-connection state kept on `socket.data`. */
interface ConnectionData {
  identity?: WsIdentity;
  /** The match whose room this connection is in. */
  matchId?: string;
}

type Acks = ClientEventAcks<GameState, Move>;

/** Minimal parser shape shared by the Zod schemas of the contract. */
interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/** Handshake rejection: the client receives `connect_error` with `message`/`data.code`. */
function handshakeError(code: WsErrorCode): Error & { data: { code: WsErrorCode } } {
  return Object.assign(new Error(code), { data: { code } });
}

function data(socket: Socket): ConnectionData {
  return socket.data as ConnectionData;
}

/**
 * Socket.IO entry point of realtime matches (namespace `/match`).
 *
 * Every payload is parsed with the shared Zod contract before it reaches
 * `MatchService`; malformed input and unexpected failures become error codes,
 * never crashes. Each request is answered through its ack and, on failure,
 * with `match:error`. Changes are broadcast to the match room.
 *
 * Served same-origin behind nginx (`/socket.io/`), so no CORS headers are
 * sent; the handshake `Origin` is checked against `APP_ORIGIN` instead.
 */
@WebSocketGateway({
  namespace: WS_NAMESPACE,
  path: WS_PATH,
  serveClient: false,
  maxHttpBufferSize: 64 * 1024,
})
export class MatchGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly logger = new Logger(MatchGateway.name);

  @WebSocketServer()
  private readonly namespace!: Namespace;

  constructor(
    @Inject(MatchService) private readonly matches: MatchService,
    @Inject(WS_AUTH_ADAPTER) private readonly auth: WsAuthAdapter,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  afterInit(namespace: Namespace): void {
    const allowedOrigins = parseAllowedOrigins(this.config.get<string>('APP_ORIGIN'));
    namespace.use((socket, next) => {
      this.authorize(socket, allowedOrigins).then(
        () => next(),
        (error: unknown) => {
          const code = error instanceof MatchError ? error.code : MatchErrorCode.INTERNAL_ERROR;
          if (!(error instanceof MatchError)) this.logger.error(error);
          next(handshakeError(code));
        },
      );
    });
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const matchId = data(socket).matchId;
    if (!matchId) return;
    data(socket).matchId = undefined;
    try {
      const result = await this.matches.disconnect(matchId, socket.id);
      if (result.match) {
        this.broadcastConnection(matchId, result.side, result.playerId, false);
      }
    } catch (error) {
      if (!(error instanceof MatchError)) this.logger.error(error);
    }
  }

  @SubscribeMessage(ClientEvent.CREATE)
  create(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<WsAck<Acks['match:create']>> {
    return this.handle(socket, ClientEvent.CREATE, body, async (input) => {
      await this.releaseCurrent(socket);
      const result = await this.matches.create(this.identity(socket), socket.id, input);
      await this.attach(socket, result.match.matchId);
      socket.emit(ServerEvent.CREATED, result);
      return result;
    });
  }

  @SubscribeMessage(ClientEvent.JOIN)
  join(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<WsAck<Acks['match:join']>> {
    return this.handle(socket, ClientEvent.JOIN, body, async ({ matchId }) => {
      await this.releaseCurrent(socket, matchId);
      const result: SeatedView = await this.matches.join(matchId, this.identity(socket), socket.id);
      await this.attach(socket, matchId);
      this.namespace.to(matchRoom(matchId)).emit(ServerEvent.STATE, result.match);
      return result;
    });
  }

  @SubscribeMessage(ClientEvent.REJOIN)
  rejoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<WsAck<Acks['match:rejoin']>> {
    return this.handle(socket, ClientEvent.REJOIN, body, async ({ matchId, rejoinToken }) => {
      await this.releaseCurrent(socket, matchId);
      const { replacedConnectionId, ...result } = await this.matches.rejoin(
        matchId,
        rejoinToken,
        this.identity(socket),
        socket.id,
      );
      if (replacedConnectionId) this.evict(replacedConnectionId, matchId);
      await this.attach(socket, matchId);
      this.broadcastConnection(matchId, result.you.side, result.you.playerId, true, socket);
      socket.emit(ServerEvent.STATE, result.match);
      return result;
    });
  }

  @SubscribeMessage(ClientEvent.MOVE)
  move(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<WsAck<Acks['match:move']>> {
    return this.handle(socket, ClientEvent.MOVE, body, async ({ matchId, move, ply }) => {
      const view: MatchView = await this.matches.applyMove(matchId, socket.id, move, ply);
      this.namespace.to(matchRoom(matchId)).emit(ServerEvent.STATE, view);
      return view;
    });
  }

  @SubscribeMessage(ClientEvent.LEAVE)
  leave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<WsAck<LeftPayload>> {
    return this.handle(socket, ClientEvent.LEAVE, body, async ({ matchId }) => {
      const result = await this.matches.leave(matchId, socket.id);
      await socket.leave(matchRoom(matchId));
      if (data(socket).matchId === matchId) data(socket).matchId = undefined;
      if (result.match) this.broadcastConnection(matchId, result.side, result.playerId, false);
      return { matchId };
    });
  }

  /** Runs a request: parse, execute, ack, and report failures as codes. */
  private async handle<E extends ClientEventName, T>(
    socket: Socket,
    event: E,
    body: unknown,
    execute: (input: ClientEventRequests[E]) => Promise<T>,
  ): Promise<WsAck<T>> {
    const parser = clientEventSchemas[event] as unknown as Parser<ClientEventRequests[E]>;
    const parsed = parser.safeParse(body);
    const matchId = parsed.success ? matchIdOf(parsed.data) : undefined;
    try {
      if (!parsed.success) throw new MatchError(MatchErrorCode.INVALID_PAYLOAD);
      return { ok: true, data: await execute(parsed.data) };
    } catch (error) {
      const code = error instanceof MatchError ? error.code : MatchErrorCode.INTERNAL_ERROR;
      if (!(error instanceof MatchError)) this.logger.error(error);
      const payload: MatchErrorPayload = matchId ? { code, event, matchId } : { code, event };
      socket.emit(ServerEvent.ERROR, payload);
      return { ok: false, code };
    }
  }

  private async authorize(socket: Socket, allowedOrigins: ReadonlySet<string>): Promise<void> {
    const { headers, auth } = socket.handshake;
    if (!isOriginAllowed(headers.origin, allowedOrigins)) {
      throw new MatchError(MatchErrorCode.FORBIDDEN_ORIGIN);
    }
    if (
      (auth as { protocolVersion?: unknown } | undefined)?.protocolVersion !== WS_PROTOCOL_VERSION
    ) {
      throw new MatchError(MatchErrorCode.UNSUPPORTED_PROTOCOL);
    }
    const parsed = handshakeAuthSchema.safeParse(auth);
    if (!parsed.success) throw new MatchError(MatchErrorCode.INVALID_PAYLOAD);
    const identity = await this.auth.authenticate({ headers, auth: parsed.data });
    if (!identity) throw new MatchError(MatchErrorCode.UNAUTHENTICATED);
    data(socket).identity = identity;
  }

  private identity(socket: Socket): WsIdentity {
    const identity = data(socket).identity;
    if (!identity) throw new MatchError(MatchErrorCode.UNAUTHENTICATED);
    return identity;
  }

  /**
   * A connection takes part in one unfinished match at a time. Before it
   * enters another match it is detached from a finished (or vanished) one;
   * requests for the current match itself are left to `MatchService`.
   */
  private async releaseCurrent(socket: Socket, nextMatchId?: string): Promise<void> {
    const current = data(socket).matchId;
    if (!current || current === nextMatchId) return;
    const view = await this.matches.get(current);
    if (view && view.status !== 'finished') {
      throw new MatchError(MatchErrorCode.ALREADY_IN_MATCH);
    }
    if (view) await this.matches.leave(current, socket.id).catch(() => undefined);
    await socket.leave(matchRoom(current));
    data(socket).matchId = undefined;
  }

  private async attach(socket: Socket, matchId: string): Promise<void> {
    await socket.join(matchRoom(matchId));
    data(socket).matchId = matchId;
  }

  /** Detaches a connection whose seat was rejoined from elsewhere. */
  private evict(connectionId: string, matchId: string): void {
    const previous = this.namespace.sockets.get(connectionId);
    if (!previous) return;
    void previous.leave(matchRoom(matchId));
    if (data(previous).matchId === matchId) data(previous).matchId = undefined;
    const payload: MatchErrorPayload = { code: MatchErrorCode.SEAT_TAKEN_OVER, matchId };
    previous.emit(ServerEvent.ERROR, payload);
  }

  private broadcastConnection(
    matchId: string,
    side: PlayerConnectionPayload['side'],
    playerId: string,
    connected: boolean,
    except?: Socket,
  ): void {
    const payload: PlayerConnectionPayload = { matchId, side, playerId, connected };
    const target = except ? except.to(matchRoom(matchId)) : this.namespace.to(matchRoom(matchId));
    target.emit(ServerEvent.PLAYER_CONNECTION, payload);
  }
}

function matchIdOf(input: unknown): string | undefined {
  const value = (input as { matchId?: unknown } | undefined)?.matchId;
  return typeof value === 'string' ? value : undefined;
}
