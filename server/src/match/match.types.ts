import type { GameState, Move, PlayerSide } from '@gungi/engine';
import type { MatchStatus, WsErrorCode } from '@gungi/shared';

/** Who is acting, as resolved by the transport's auth adapter. */
export interface PlayerIdentity {
  readonly playerId: string;
  /** Sanitized data, not rendered by the server. */
  readonly displayName: string | null;
}

/** A held seat. `connectionId` is the transport connection currently bound to it. */
export interface SeatRecord {
  readonly playerId: string;
  readonly displayName: string | null;
  /** Secret proof of seat ownership for rejoining; never broadcast. */
  readonly rejoinToken: string;
  /** `null` while the seat holder is disconnected (the seat stays held). */
  readonly connectionId: string | null;
}

/**
 * Persisted shape of a match. Plain JSON (the engine state included) so a
 * database implementation can store it as rows plus JSONB without mapping
 * logic.
 */
export interface MatchRecord {
  readonly id: string;
  readonly status: MatchStatus;
  /** §9.1 resolved at creation; the engine state is created from it on activation. */
  readonly firstPlayer: PlayerSide;
  readonly seats: Readonly<Record<PlayerSide, SeatRecord | null>>;
  /** `null` while waiting for the second player. */
  readonly state: GameState | null;
  readonly lastMove: Move | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Expected, client-facing failure; carries a protocol or engine code only. */
export class MatchError extends Error {
  constructor(readonly code: WsErrorCode) {
    super(code);
    this.name = 'MatchError';
  }
}
