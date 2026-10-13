import { Injectable } from '@nestjs/common';
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

@Injectable()
export class InMemoryMatchRepository implements MatchRepository {
  private readonly matches = new Map<string, MatchRecord>();

  async insert(match: MatchRecord): Promise<void> {
    if (this.matches.has(match.id)) throw new Error(`duplicate match id ${match.id}`);
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
}
