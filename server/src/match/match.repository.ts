import { MatchErrorCode } from '@gungi/shared';
import { MatchError } from './match.types';
import type { MatchRecord } from './match.types';

/** Injection token for the active `MatchRepository` implementation. */
export const MATCH_REPOSITORY = Symbol('MATCH_REPOSITORY');

/**
 * Storage seam for matches.
 *
 * Today: `InMemoryMatchRepository` (process memory, lost on restart).
 * Later: a Prisma implementation over the planned `matches`,
 * `match_players`, `match_states` and `match_events` tables.
 *
 * Contract for implementations:
 *  - Records are values: callers never observe later mutations of a returned
 *    record, and the repository never keeps a reference to a passed one.
 *  - `MatchService` serializes all writes of one match (process-local
 *    `KeyedMutex`), so a single server instance needs no extra locking.
 *    Several instances would need optimistic concurrency on `revision`
 *    (update only where the stored revision is `revision - 1`).
 *  - A database implementation must check every restored `state` with the
 *    engine's `stateError` before returning it (docs/GUNGI_RULES.md §12.1):
 *    the engine may throw on a corrupt state.
 *  - `insert` may refuse a new match with `MatchError(MATCH_LIMIT)` when the
 *    store is at capacity; callers pass the code through to the client. To
 *    make room it may evict matches no live connection is bound to, so
 *    `update` of a match that is gone throws `MatchError(MATCH_NOT_FOUND)`.
 *  - Correctness must not depend on process-local timers. Deadlines (move
 *    clocks, idle or disconnect timeouts) are to be stored with the match and
 *    restored on server boot, so a restart cannot silently drop them; any
 *    in-process timer is only a wake-up hint derived from stored data.
 */
export interface MatchRepository {
  insert(match: MatchRecord): Promise<void>;
  findById(id: string): Promise<MatchRecord | null>;
  update(match: MatchRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Capacity of the in-memory store (`MATCH_LIMIT_TOTAL` / `MATCH_LIMIT_WAITING`). */
export interface MatchLimits {
  /** Maximum number of stored matches, whatever their status. */
  readonly total: number;
  /** Maximum number of stored `waiting` matches. */
  readonly waiting: number;
}

export const DEFAULT_MATCH_LIMITS: MatchLimits = { total: 1000, waiting: 100 };

/** Reads the limits from the environment; a missing or invalid value falls back to the default. */
export function matchLimitsFromEnv(get: (key: string) => string | undefined): MatchLimits {
  return {
    total: positiveInteger(get('MATCH_LIMIT_TOTAL')) ?? DEFAULT_MATCH_LIMITS.total,
    waiting: positiveInteger(get('MATCH_LIMIT_WAITING')) ?? DEFAULT_MATCH_LIMITS.waiting,
  };
}

function positiveInteger(raw: string | undefined): number | undefined {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Eviction order under the total cap: finished first, then waiting, then active. */
const EVICTION_PRIORITY: Readonly<Record<MatchRecord['status'], number>> = {
  finished: 0,
  waiting: 1,
  active: 2,
};

/**
 * Process-memory store.
 *
 * Guest match creation is unauthenticated, so the store is capped at
 * `limits.total` matches and `limits.waiting` waiting matches. When a new
 * match would exceed a cap, `insert` first evicts **unattended** matches (no
 * seat bound to a live connection), oldest `updatedAt` first:
 *  - waiting cap: unattended waiting matches;
 *  - total cap: unattended matches of any status, finished before waiting
 *    before active.
 * A match with a connected seat is never evicted. Only if eviction cannot
 * make room does `insert` fail with `MATCH_LIMIT`, and then nothing is
 * evicted. Planning, evicting and inserting run synchronously (no `await` in
 * between), so concurrent creations cannot overshoot.
 *
 * Trade-off: an unattended match is still reachable by `match:rejoin` (and a
 * waiting one by `match:join`) until it is evicted; afterwards those requests
 * get `MATCH_NOT_FOUND`. This includes a fully disconnected active match.
 * Losing such a match under cap pressure is accepted over a store that stays
 * full until restart. Matches whose connections are held open still occupy
 * their slots; limiting connections per client (nginx `limit_conn`) is the
 * mitigation for that.
 *
 * The database implementation replaces these caps with expiry-based cleanup
 * of stale matches (docs/WEBSOCKET.md §8.3).
 */
export class InMemoryMatchRepository implements MatchRepository {
  private readonly matches = new Map<string, MatchRecord>();

  constructor(private readonly limits: MatchLimits = DEFAULT_MATCH_LIMITS) {}

  async insert(match: MatchRecord): Promise<void> {
    if (this.matches.has(match.id)) throw new Error(`duplicate match id ${match.id}`);
    const evictions = this.planEvictions(match);
    if (!evictions) throw new MatchError(MatchErrorCode.MATCH_LIMIT);
    for (const id of evictions) this.matches.delete(id);
    this.matches.set(match.id, structuredClone(match));
  }

  async findById(id: string): Promise<MatchRecord | null> {
    const match = this.matches.get(id);
    return match ? structuredClone(match) : null;
  }

  /** A match evicted while a caller held its record is reported as `MATCH_NOT_FOUND`. */
  async update(match: MatchRecord): Promise<void> {
    if (!this.matches.has(match.id)) throw new MatchError(MatchErrorCode.MATCH_NOT_FOUND);
    this.matches.set(match.id, structuredClone(match));
  }

  async delete(id: string): Promise<void> {
    this.matches.delete(id);
  }

  /** Number of stored matches (for tests and diagnostics). */
  get size(): number {
    return this.matches.size;
  }

  /**
   * Ids to evict so that `match` fits under both caps, or `null` when
   * evicting every unattended candidate would still not make room.
   */
  private planEvictions(match: MatchRecord): string[] | null {
    const stored = [...this.matches.values()];
    const unattended = stored.filter(isUnattended).sort(byUpdatedAt);
    const evicted = new Set<string>();

    if (match.status === 'waiting') {
      const waiting = stored.filter((m) => m.status === 'waiting').length;
      const excess = waiting + 1 - this.limits.waiting;
      const candidates = unattended.filter((m) => m.status === 'waiting');
      if (excess > candidates.length) return null;
      for (const m of candidates.slice(0, Math.max(excess, 0))) evicted.add(m.id);
    }

    const excess = stored.length - evicted.size + 1 - this.limits.total;
    if (excess > 0) {
      const candidates = unattended
        .filter((m) => !evicted.has(m.id))
        .sort((a, b) => EVICTION_PRIORITY[a.status] - EVICTION_PRIORITY[b.status]);
      if (excess > candidates.length) return null;
      for (const m of candidates.slice(0, excess)) evicted.add(m.id);
    }
    return [...evicted];
  }
}

/** No seat of the match is bound to a live connection. */
function isUnattended(match: MatchRecord): boolean {
  return !match.seats.black?.connectionId && !match.seats.white?.connectionId;
}

function byUpdatedAt(a: MatchRecord, b: MatchRecord): number {
  return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
}
