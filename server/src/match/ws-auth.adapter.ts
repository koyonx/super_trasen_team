import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { Injectable } from '@nestjs/common';
import type { HandshakeAuth } from '@gungi/shared';
import type { PlayerIdentity } from './match.types';

/** Injection token for the active `WsAuthAdapter` implementation. */
export const WS_AUTH_ADAPTER = Symbol('WS_AUTH_ADAPTER');

/** Identity of a connection; `kind` tells guests and authenticated users apart. */
export type WsIdentity = PlayerIdentity;

/** What an adapter may inspect when a Socket.IO connection is established. */
export interface WsHandshakeContext {
  /** HTTP headers of the handshake request (cookies included). */
  readonly headers: IncomingHttpHeaders;
  /** The validated handshake `auth` payload. */
  readonly auth: HandshakeAuth;
}

/**
 * Authentication seam for WebSocket connections. Runs once per connection,
 * before any event is accepted; `null` rejects the connection with
 * `UNAUTHENTICATED`.
 *
 * Today: `GuestAuthAdapter` (a fresh guest identity per connection).
 * Later: a JWT adapter that verifies the httpOnly session cookie from
 * `headers.cookie` and returns the account (`kind: 'user'`, stable
 * `playerId` = user id). Requirements for that implementation:
 *  - Team decision: a session never expires in the middle of a match. A
 *    session counts as expired only when 8 hours have elapsed since it was
 *    issued AND the user is not currently seated in an active match. The
 *    adapter therefore needs a way to ask the match layer whether the user is
 *    in an active match (e.g. a repository lookup by player id) instead of
 *    rejecting purely on the token's age.
 *  - Re-validate on reconnect: every new connection passes through
 *    `authenticate` again; rejoining a seat still requires the seat's rejoin
 *    token.
 *  - Return `kind: 'user'` only for a verified account, with the account id
 *    as `playerId`. `MatchService` rebinds a seat held by a user only to that
 *    same user (`INVALID_REJOIN_TOKEN` otherwise, even with a valid token);
 *    only guest-held seats are rebound to whoever presents the token.
 */
export interface WsAuthAdapter {
  authenticate(context: WsHandshakeContext): Promise<WsIdentity | null>;
}

export const DISPLAY_NAME_MAX_LENGTH = 24;

/**
 * Normalizes a client-suggested display name: NFKC, control/format/private
 * characters removed, whitespace collapsed, at most
 * `DISPLAY_NAME_MAX_LENGTH` code points. `null` when nothing is left. The
 * result is data; clients must still render it as text, never as markup.
 */
export function sanitizeDisplayName(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const cleaned = raw.normalize('NFKC').replace(/\p{C}/gu, '').replace(/\s+/gu, ' ').trim();
  const limited = Array.from(cleaned).slice(0, DISPLAY_NAME_MAX_LENGTH).join('').trim();
  return limited.length > 0 ? limited : null;
}

/** Accepts everyone as a guest with a per-connection identity. */
@Injectable()
export class GuestAuthAdapter implements WsAuthAdapter {
  async authenticate(context: WsHandshakeContext): Promise<WsIdentity> {
    return {
      kind: 'guest',
      playerId: `guest_${randomUUID()}`,
      displayName: sanitizeDisplayName(context.auth.displayName),
    };
  }
}
