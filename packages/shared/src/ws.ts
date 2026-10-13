/**
 * WebSocket match protocol (Socket.IO), shared by server and client.
 *
 * This module is the single source of truth for the realtime match contract:
 * event names, the client -> server payload schemas (Zod, parsed at the
 * server boundary and reusable for client-side pre-validation) and the
 * server -> client payload types.
 *
 * Conventions:
 *  - Every client -> server event may carry a Socket.IO acknowledgement
 *    callback. It always receives a `WsAck` (`{ ok: true, data }` or
 *    `{ ok: false, code }`).
 *  - A failed request additionally emits `match:error` to the requesting
 *    socket, so clients that do not use acks still get the code.
 *  - State changes are pushed as events (`match:state`,
 *    `match:playerConnection`) to every socket in the match room.
 *  - The server never sends user-facing text: errors are codes that the
 *    client translates (i18n).
 *
 * Versioning: the client sends `protocolVersion` in the Socket.IO handshake
 * `auth` payload. A breaking change to anything in this file bumps
 * `WS_PROTOCOL_VERSION`; the server refuses other versions at connection time
 * with `UNSUPPORTED_PROTOCOL`.
 *
 * Game types (`GameState`, `Move`) belong to `@gungi/engine`, which depends on
 * this package, so the server -> client types are generic over them. The move
 * schema mirrors the engine's `Move` union structurally; the server checks the
 * two stay assignable at compile time. Legality is always the engine's job.
 */

import { z } from 'zod';
import type { PlayerSide } from './index';

export const WS_PROTOCOL_VERSION = 1;

/** Socket.IO namespace of the match gateway. */
export const WS_NAMESPACE = '/match';

/** Socket.IO HTTP path (proxied by nginx at `/socket.io/`). */
export const WS_PATH = '/socket.io';

export const ClientEvent = {
  CREATE: 'match:create',
  JOIN: 'match:join',
  REJOIN: 'match:rejoin',
  MOVE: 'match:move',
  LEAVE: 'match:leave',
} as const;

export type ClientEventName = (typeof ClientEvent)[keyof typeof ClientEvent];

export const ServerEvent = {
  CREATED: 'match:created',
  STATE: 'match:state',
  ERROR: 'match:error',
  PLAYER_CONNECTION: 'match:playerConnection',
} as const;

export type ServerEventName = (typeof ServerEvent)[keyof typeof ServerEvent];

/** Socket.IO room that holds the connected players of one match. */
export function matchRoom(matchId: string): string {
  return `match:${matchId}`;
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/** Protocol-level error codes (everything that is not a rule violation). */
export const MatchErrorCode = {
  /** The payload failed schema validation. */
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  /** Handshake: missing or unsupported `protocolVersion`. */
  UNSUPPORTED_PROTOCOL: 'UNSUPPORTED_PROTOCOL',
  /** Handshake: the `Origin` header is not an allowed application origin. */
  FORBIDDEN_ORIGIN: 'FORBIDDEN_ORIGIN',
  /** Handshake: the auth adapter rejected the connection. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  MATCH_NOT_FOUND: 'MATCH_NOT_FOUND',
  /** Both seats of an active match are taken (spectating is not supported). */
  MATCH_FULL: 'MATCH_FULL',
  /** The match is waiting for an opponent (move) or already finished (move, join). */
  MATCH_NOT_ACTIVE: 'MATCH_NOT_ACTIVE',
  /** The requester already holds a seat in this match. */
  ALREADY_SEATED: 'ALREADY_SEATED',
  /** The connection is already attached to another unfinished match. */
  ALREADY_IN_MATCH: 'ALREADY_IN_MATCH',
  /** The connection holds no seat in this match. */
  NOT_SEATED: 'NOT_SEATED',
  INVALID_REJOIN_TOKEN: 'INVALID_REJOIN_TOKEN',
  /** The move names the other side as its player. */
  NOT_YOUR_SIDE: 'NOT_YOUR_SIDE',
  /** The move's `ply` guard does not match the current state. */
  STALE_PLY: 'STALE_PLY',
  /** Pushed to a connection whose seat was rejoined from another connection. */
  SEAT_TAKEN_OVER: 'SEAT_TAKEN_OVER',
  /** The server stores the maximum number of (waiting) matches; try again later. */
  MATCH_LIMIT: 'MATCH_LIMIT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type MatchErrorCode = (typeof MatchErrorCode)[keyof typeof MatchErrorCode];

/**
 * Rule-violation codes returned by the engine (docs/GUNGI_RULES.md §12.3),
 * forwarded unchanged. Mirrors `MoveError` of `@gungi/engine`; a server spec
 * checks that the two lists are identical.
 */
export const ENGINE_MOVE_ERROR_CODES = [
  'GAME_FINISHED',
  'WRONG_PHASE',
  'NOT_YOUR_TURN',
  'INVALID_SQUARE',
  'NOT_IN_HAND',
  'MARSHAL_FIRST',
  'OUTSIDE_TERRITORY',
  'OUTSIDE_DROP_ZONE',
  'OCCUPIED_BY_ENEMY',
  'STACK_FULL',
  'CANNOT_STACK_ON_MARSHAL',
  'NO_PIECE',
  'NOT_YOUR_PIECE',
  'UNREACHABLE',
  'TARGET_TOO_HIGH',
  'TARGET_NOT_EMPTY',
  'TARGET_EMPTY',
  'CANNOT_CAPTURE_OWN',
  'INVALID_BETRAYAL',
  'BETRAYAL_HAND_SHORT',
  'SELF_CHECK',
  'INVALID_MOVE',
] as const;

export type EngineMoveErrorCode = (typeof ENGINE_MOVE_ERROR_CODES)[number];

export type WsErrorCode = MatchErrorCode | EngineMoveErrorCode;

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

/**
 * Piece kinds (docs/GUNGI_RULES.md §3.1). Mirrors `PIECE_KINDS` of
 * `@gungi/engine`; a server spec checks that the two lists are identical.
 */
export const WS_PIECE_KINDS = [
  'marshal',
  'general',
  'lieutenant',
  'major',
  'samurai',
  'lancer',
  'knight',
  'shinobi',
  'fortress',
  'pawn',
  'cannon',
  'archer',
  'musket',
  'tactician',
] as const;

export const playerSideSchema = z.enum(['black', 'white']);

/** A side choice that the server may resolve at random. */
export const sideChoiceSchema = z.enum(['black', 'white', 'random']);
export type SideChoice = z.infer<typeof sideChoiceSchema>;

export const pieceKindSchema = z.enum(WS_PIECE_KINDS);

/**
 * Square coordinates. Only the shape is checked here: an out-of-board square
 * reaches the engine, which answers `INVALID_SQUARE`.
 */
export const squareSchema = z.object({
  file: z.number().int(),
  rank: z.number().int(),
});

export const matchIdSchema = z.uuid();

/** 32 random bytes, base64url without padding. */
export const rejoinTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

/**
 * `player` is optional: the server fills it in from the requester's seat. If
 * present it must name the requester's side (`NOT_YOUR_SIDE`).
 */
const player = playerSideSchema.optional();

/**
 * Moves a client may submit: every engine move except the server-only
 * terminal actions `timeout` and `agreeDraw` (§11.6, §11.7). Unknown keys are
 * stripped.
 */
export const clientMoveSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('place'), player, kind: pieceKindSchema, to: squareSchema }),
  z.object({ type: z.literal('finishPlacement'), player }),
  z.object({
    type: z.enum(['move', 'capture', 'stack']),
    player,
    from: squareSchema,
    to: squareSchema,
    betray: z.boolean().optional(),
  }),
  z.object({ type: z.literal('drop'), player, kind: pieceKindSchema, to: squareSchema }),
  z.object({ type: z.literal('resign'), player }),
]);

export type ClientMove = z.infer<typeof clientMoveSchema>;

// ---------------------------------------------------------------------------
// Handshake and client -> server payloads
// ---------------------------------------------------------------------------

/** Socket.IO handshake `auth` payload. */
export const handshakeAuthSchema = z.object({
  protocolVersion: z.literal(WS_PROTOCOL_VERSION),
  /**
   * Suggested display name for guest identities. The server sanitizes it and
   * treats it as data only.
   */
  displayName: z.string().max(200).optional(),
});

export type HandshakeAuth = z.infer<typeof handshakeAuthSchema>;

/**
 * `match:create` payload.
 *
 * Fairness: `side` and `firstPlayer` are client-controlled inputs. They are
 * acceptable only for direct (friend) matches, where both players agree out
 * of band. Matchmaking and rated flows MUST decide the seats and
 * `firstPlayer` on the server (the 帥落とし ritual drawn with server-side
 * RNG) and ignore any values a client sends.
 */
export const createMatchSchema = z
  .object({
    /** The creator's side. Default `random`. Friend matches only (see above). */
    side: sideChoiceSchema.default('random'),
    /**
     * §9.1 the side that places and moves first (先手). Default `random`.
     * Friend matches only (see above): elsewhere the server-side ritual decides.
     */
    firstPlayer: sideChoiceSchema.default('random'),
  })
  .optional()
  .transform((value) => value ?? { side: 'random' as const, firstPlayer: 'random' as const });

export type CreateMatchInput = z.input<typeof createMatchSchema>;
export type CreateMatchRequest = z.output<typeof createMatchSchema>;

export const joinMatchSchema = z.object({ matchId: matchIdSchema });
export type JoinMatchRequest = z.infer<typeof joinMatchSchema>;

export const rejoinMatchSchema = z.object({
  matchId: matchIdSchema,
  rejoinToken: rejoinTokenSchema,
});
export type RejoinMatchRequest = z.infer<typeof rejoinMatchSchema>;

export const moveRequestSchema = z.object({
  matchId: matchIdSchema,
  move: clientMoveSchema,
  /**
   * Optional idempotency guard: the `ply` of the state the move was chosen
   * on. A resent or stale move fails with `STALE_PLY` instead of being
   * applied to a newer state.
   */
  ply: z.number().int().nonnegative().optional(),
});
export type MoveRequest = z.infer<typeof moveRequestSchema>;

export const leaveMatchSchema = z.object({ matchId: matchIdSchema });
export type LeaveMatchRequest = z.infer<typeof leaveMatchSchema>;

/** Payload schema of each client -> server event. */
export const clientEventSchemas = {
  [ClientEvent.CREATE]: createMatchSchema,
  [ClientEvent.JOIN]: joinMatchSchema,
  [ClientEvent.REJOIN]: rejoinMatchSchema,
  [ClientEvent.MOVE]: moveRequestSchema,
  [ClientEvent.LEAVE]: leaveMatchSchema,
} as const;

/** Parsed (post-default) payload of each client -> server event. */
export type ClientEventRequests = {
  [E in ClientEventName]: z.output<(typeof clientEventSchemas)[E]>;
};

// ---------------------------------------------------------------------------
// Server -> client payloads
// ---------------------------------------------------------------------------

export type MatchStatus = 'waiting' | 'active' | 'finished';

export interface SeatView {
  readonly playerId: string;
  /** Sanitized data, `null` when unknown (the client shows a localized label). */
  readonly displayName: string | null;
  readonly connected: boolean;
}

/** Public view of a match. `TState`/`TMove` are the engine's `GameState`/`Move`. */
export interface MatchSnapshot<TState = unknown, TMove = unknown> {
  readonly matchId: string;
  readonly status: MatchStatus;
  /** Increases on every change; clients drop snapshots older than the last one seen. */
  readonly revision: number;
  readonly firstPlayer: PlayerSide;
  readonly seats: Readonly<Record<PlayerSide, SeatView | null>>;
  /** `null` while waiting for the opponent. */
  readonly state: TState | null;
  readonly lastMove: TMove | null;
}

/** Private seat credentials, sent only to the seat holder. */
export interface SeatCredentials {
  readonly playerId: string;
  readonly side: PlayerSide;
  /** Proof of seat ownership for `match:rejoin`; keep it client-side. */
  readonly rejoinToken: string;
}

/** Ack data of `match:create` / `match:join` / `match:rejoin`, and `match:created`. */
export interface SeatedPayload<TState = unknown, TMove = unknown> {
  readonly match: MatchSnapshot<TState, TMove>;
  readonly you: SeatCredentials;
}

export type MatchCreatedPayload<TState = unknown, TMove = unknown> = SeatedPayload<TState, TMove>;

export type MatchStatePayload<TState = unknown, TMove = unknown> = MatchSnapshot<TState, TMove>;

export interface MatchErrorPayload {
  readonly code: WsErrorCode;
  /** The client event that failed, when the error answers a request. */
  readonly event?: ClientEventName;
  readonly matchId?: string;
}

export interface PlayerConnectionPayload {
  readonly matchId: string;
  readonly side: PlayerSide;
  readonly playerId: string;
  readonly connected: boolean;
}

export interface LeftPayload {
  readonly matchId: string;
}

/** Acknowledgement passed to the callback of every client -> server event. */
export type WsAck<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly code: WsErrorCode };

/** Ack data per client event. */
export interface ClientEventAcks<TState = unknown, TMove = unknown> {
  [ClientEvent.CREATE]: SeatedPayload<TState, TMove>;
  [ClientEvent.JOIN]: SeatedPayload<TState, TMove>;
  [ClientEvent.REJOIN]: SeatedPayload<TState, TMove>;
  [ClientEvent.MOVE]: MatchSnapshot<TState, TMove>;
  [ClientEvent.LEAVE]: LeftPayload;
}

/** Server -> client event payloads (for typed Socket.IO clients). */
export interface ServerEventPayloads<TState = unknown, TMove = unknown> {
  [ServerEvent.CREATED]: MatchCreatedPayload<TState, TMove>;
  [ServerEvent.STATE]: MatchStatePayload<TState, TMove>;
  [ServerEvent.ERROR]: MatchErrorPayload;
  [ServerEvent.PLAYER_CONNECTION]: PlayerConnectionPayload;
}
