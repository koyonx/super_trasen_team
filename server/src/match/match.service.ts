import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { applyMove, createInitialState } from '@gungi/engine';
import type { GameState, Move, PlayerSide } from '@gungi/engine';
import { MatchErrorCode } from '@gungi/shared';
import type {
  ClientMove,
  CreateMatchRequest,
  MatchSnapshot,
  SeatView,
  SeatedPayload,
  SideChoice,
} from '@gungi/shared';
import { KeyedMutex } from './keyed-mutex';
import { MATCH_REPOSITORY } from './match.repository';
import type { MatchRepository } from './match.repository';
import { MatchError } from './match.types';
import type { MatchRecord, PlayerIdentity, SeatRecord } from './match.types';

export type MatchView = MatchSnapshot<GameState, Move>;
export type SeatedView = SeatedPayload<GameState, Move>;

/** Server-only terminal actions (§11.6 timeout, §11.7 agreed draw). */
export type ServerTerminalMove = Extract<Move, { type: 'timeout' } | { type: 'agreeDraw' }>;

export interface RejoinResult extends SeatedView {
  /** The connection that held the seat before, if it was still bound. */
  readonly replacedConnectionId: string | null;
}

export interface DetachResult {
  /** `null` when the match was discarded. */
  readonly match: MatchView | null;
  readonly side: PlayerSide;
  readonly playerId: string;
}

const SIDES: readonly PlayerSide[] = ['black', 'white'];

/**
 * Match lifecycle over the engine: `waiting` (one seat) -> `active` (two
 * seats, engine state) -> `finished` (engine result).
 *
 * Every mutation of a match runs under a per-match lock, so concurrent
 * requests are applied one at a time against the latest state. Seat actions
 * are authorized by the transport connection bound to the seat; a
 * disconnected player keeps the seat and binds a new connection with the
 * seat's rejoin token while the match exists.
 *
 * Rejoining rebinds a guest-held seat to the presenting identity; a seat held
 * by an authenticated user is rebound only to that same user.
 *
 * Matches are discarded when nobody can come back to them: a waiting match
 * left by its creator, or a finished match with no connected seat. There is
 * no time-based cleanup yet (no clocks in scope); a waiting match whose
 * creator disconnected stays until the process restarts.
 */
@Injectable()
export class MatchService {
  private readonly lock = new KeyedMutex();

  constructor(@Inject(MATCH_REPOSITORY) private readonly repository: MatchRepository) {}

  async create(
    identity: PlayerIdentity,
    connectionId: string,
    options: CreateMatchRequest,
  ): Promise<SeatedView> {
    const side = resolveSide(options.side);
    const seat = newSeat(identity, connectionId);
    const now = new Date().toISOString();
    const match: MatchRecord = {
      id: randomUUID(),
      status: 'waiting',
      firstPlayer: resolveSide(options.firstPlayer),
      seats: { black: null, white: null, [side]: seat },
      state: null,
      lastMove: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.insert(match);
    return seated(match, side);
  }

  join(matchId: string, identity: PlayerIdentity, connectionId: string): Promise<SeatedView> {
    return this.mutate(matchId, async (match) => {
      if (seatOf(match, connectionId) || holdsSeat(match, identity.playerId)) {
        throw new MatchError(MatchErrorCode.ALREADY_SEATED);
      }
      if (match.status === 'finished') throw new MatchError(MatchErrorCode.MATCH_NOT_ACTIVE);
      if (match.status !== 'waiting') throw new MatchError(MatchErrorCode.MATCH_FULL);
      const side = SIDES.find((s) => match.seats[s] === null);
      if (!side) throw new MatchError(MatchErrorCode.MATCH_FULL);

      const next = touch(match, {
        status: 'active',
        seats: { ...match.seats, [side]: newSeat(identity, connectionId) },
        state: createInitialState({ firstPlayer: match.firstPlayer }),
      });
      return { next, value: seated(next, side) };
    });
  }

  rejoin(
    matchId: string,
    rejoinToken: string,
    identity: PlayerIdentity,
    connectionId: string,
  ): Promise<RejoinResult> {
    return this.mutate(matchId, async (match) => {
      const side = SIDES.find((s) => match.seats[s]?.rejoinToken === rejoinToken);
      const seat = side && match.seats[side];
      if (!side || !seat) throw new MatchError(MatchErrorCode.INVALID_REJOIN_TOKEN);

      // A user's seat belongs to that account: a leaked token must not hand
      // it to another account (or to a guest).
      if (
        seat.kind === 'user' &&
        (identity.kind !== 'user' || identity.playerId !== seat.playerId)
      ) {
        throw new MatchError(MatchErrorCode.INVALID_REJOIN_TOKEN);
      }

      const previous = seat.connectionId;
      // For a guest seat the token is the proof of ownership; guest identities
      // change on every connection, so the seat is rebound to the new identity.
      const rebound: SeatRecord = {
        ...seat,
        kind: identity.kind,
        playerId: identity.playerId,
        displayName: identity.displayName ?? seat.displayName,
        connectionId,
      };
      const next = touch(match, { seats: { ...match.seats, [side]: rebound } });
      const replacedConnectionId = previous !== null && previous !== connectionId ? previous : null;
      return { next, value: { ...seated(next, side), replacedConnectionId } };
    });
  }

  /**
   * Applies a client move for the seat bound to `connectionId`. The engine
   * decides legality; its error code is thrown unchanged as a `MatchError`.
   */
  applyMove(
    matchId: string,
    connectionId: string,
    clientMove: ClientMove,
    expectedPly?: number,
  ): Promise<MatchView> {
    return this.mutate(matchId, async (match) => {
      const side = seatOf(match, connectionId);
      if (!side) throw new MatchError(MatchErrorCode.NOT_SEATED);
      if (clientMove.player !== undefined && clientMove.player !== side) {
        throw new MatchError(MatchErrorCode.NOT_YOUR_SIDE);
      }
      if (match.status !== 'active' || !match.state) {
        throw new MatchError(MatchErrorCode.MATCH_NOT_ACTIVE);
      }
      if (expectedPly !== undefined && expectedPly !== match.state.ply) {
        throw new MatchError(MatchErrorCode.STALE_PLY);
      }
      const next = advance(match, { ...clientMove, player: side });
      return { next, value: toView(next) };
    });
  }

  /**
   * Ends an active match with a server-decided terminal action. Plumbing for
   * clocks and draw offers, which are not implemented yet.
   */
  finishByServer(matchId: string, move: ServerTerminalMove): Promise<MatchView> {
    return this.mutate(matchId, async (match) => {
      if (match.status !== 'active' || !match.state) {
        throw new MatchError(MatchErrorCode.MATCH_NOT_ACTIVE);
      }
      const next = advance(match, move);
      return { next, value: toView(next) };
    });
  }

  /**
   * Explicit leave. A waiting match is discarded (its only seat leaves);
   * otherwise the seat is kept, like on a disconnect. Forfeiting is `resign`.
   */
  leave(matchId: string, connectionId: string): Promise<DetachResult> {
    return this.detach(matchId, connectionId, true);
  }

  /** Transport disconnect: the seat stays held for a rejoin. */
  disconnect(matchId: string, connectionId: string): Promise<DetachResult> {
    return this.detach(matchId, connectionId, false);
  }

  async get(matchId: string): Promise<MatchView | null> {
    const match = await this.repository.findById(matchId);
    return match ? toView(match) : null;
  }

  private detach(matchId: string, connectionId: string, leaving: boolean): Promise<DetachResult> {
    return this.lock.run(matchId, async () => {
      const match = await this.repository.findById(matchId);
      if (!match) throw new MatchError(MatchErrorCode.MATCH_NOT_FOUND);
      const side = seatOf(match, connectionId);
      const seat = side && match.seats[side];
      if (!side || !seat) throw new MatchError(MatchErrorCode.NOT_SEATED);

      const next = touch(match, {
        seats: { ...match.seats, [side]: { ...seat, connectionId: null } },
      });
      const abandoned = leaving && match.status === 'waiting';
      const nobodyLeft =
        next.status === 'finished' && SIDES.every((s) => !next.seats[s]?.connectionId);
      if (abandoned || nobodyLeft) {
        await this.repository.delete(matchId);
        return { match: null, side, playerId: seat.playerId };
      }
      await this.repository.update(next);
      return { match: toView(next), side, playerId: seat.playerId };
    });
  }

  private mutate<T>(
    matchId: string,
    change: (match: MatchRecord) => Promise<{ next: MatchRecord; value: T }>,
  ): Promise<T> {
    return this.lock.run(matchId, async () => {
      const match = await this.repository.findById(matchId);
      if (!match) throw new MatchError(MatchErrorCode.MATCH_NOT_FOUND);
      const { next, value } = await change(match);
      await this.repository.update(next);
      return value;
    });
  }
}

function resolveSide(choice: SideChoice): PlayerSide {
  if (choice !== 'random') return choice;
  return randomInt(2) === 0 ? 'black' : 'white';
}

function newSeat(identity: PlayerIdentity, connectionId: string): SeatRecord {
  return {
    kind: identity.kind,
    playerId: identity.playerId,
    displayName: identity.displayName,
    rejoinToken: randomBytes(32).toString('base64url'),
    connectionId,
  };
}

function seatOf(match: MatchRecord, connectionId: string): PlayerSide | undefined {
  return SIDES.find((s) => match.seats[s]?.connectionId === connectionId);
}

function holdsSeat(match: MatchRecord, playerId: string): boolean {
  return SIDES.some((s) => match.seats[s]?.playerId === playerId);
}

function touch(match: MatchRecord, changes: Partial<MatchRecord>): MatchRecord {
  return {
    ...match,
    ...changes,
    revision: match.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Applies an engine move to an active match or throws the engine's code. */
function advance(match: MatchRecord, move: Move): MatchRecord {
  if (!match.state) throw new MatchError(MatchErrorCode.MATCH_NOT_ACTIVE);
  const result = applyMove(match.state, move);
  if (!result.ok) throw new MatchError(result.error);
  return touch(match, {
    state: result.state,
    lastMove: move,
    status: result.state.phase === 'finished' ? 'finished' : 'active',
  });
}

function toSeatView(seat: SeatRecord | null): SeatView | null {
  if (!seat) return null;
  return {
    playerId: seat.playerId,
    displayName: seat.displayName,
    connected: seat.connectionId !== null,
  };
}

export function toView(match: MatchRecord): MatchView {
  return {
    matchId: match.id,
    status: match.status,
    revision: match.revision,
    firstPlayer: match.firstPlayer,
    seats: { black: toSeatView(match.seats.black), white: toSeatView(match.seats.white) },
    state: match.state,
    lastMove: match.lastMove,
  };
}

function seated(match: MatchRecord, side: PlayerSide): SeatedView {
  const seat = match.seats[side];
  if (!seat) throw new Error(`no seat on ${side}`);
  return {
    match: toView(match),
    you: { playerId: seat.playerId, side, rejoinToken: seat.rejoinToken },
  };
}
