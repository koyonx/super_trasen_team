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
 *    store is at capacity; callers pass the code through to the client.
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

/**
 * Process-memory store.
 *
 * Guest match creation is unauthenticated, so the store is capped: `insert`
 * fails with `MATCH_LIMIT` once `limits.total` matches or `limits.waiting`
 * waiting matches are stored. The count and the insert run synchronously
 * (no `await` in between), so concurrent creations cannot overshoot. The
 * database implementation replaces these caps with expiry-based cleanup of
 * stale matches (docs/WEBSOCKET.md §8.3).
 */
export class InMemoryMatchRepository implements MatchRepository {
  private readonly matches = new Map<string, MatchRecord>();

  constructor(private readonly limits: MatchLimits = DEFAULT_MATCH_LIMITS) {}

  async insert(match: MatchRecord): Promise<void> {
    if (this.matches.has(match.id)) throw new Error(`duplicate match id ${match.id}`);
    if (this.matches.size >= this.limits.total || this.waitingCount() >= this.limits.waiting) {
      throw new MatchError(MatchErrorCode.MATCH_LIMIT);
    }
    this.matches.set(match.id, structuredClone(match));
  }

  async findById(id: string): Promise<MatchRecord | null> {
    const match = this.matches.get(id);
    return match ? structuredClone(match) : null;
  }

  async update(match: MatchRecord): Promise<void> {
    if (!this.matches.has(match.id)) throw new Error(`unknown match id ${match.id}`);
    this.matches.set(match.id, structuredClone(match));
  }

  async delete(id: string): Promise<void> {
    this.matches.delete(id);
  }

  /** Number of stored matches (for tests and diagnostics). */
  get size(): number {
    return this.matches.size;
  }

  private waitingCount(): number {
    let count = 0;
    for (const match of this.matches.values()) if (match.status === 'waiting') count++;
    return count;
  }
}
