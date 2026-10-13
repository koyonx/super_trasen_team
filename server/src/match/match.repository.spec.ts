import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_LIMITS,
  InMemoryMatchRepository,
  matchLimitsFromEnv,
} from './match.repository';
import { MatchError } from './match.types';
import type { MatchRecord } from './match.types';
import type { MatchStatus } from '@gungi/shared';

let counter = 0;
/**
 * A stored match. `connected`: its black seat is bound to a live connection
 * (never evicted); otherwise no seat is (evictable). Every record is newer
 * than the previous one.
 */
function record(status: MatchStatus = 'waiting', connected = true): MatchRecord {
  counter++;
  const at = new Date(Date.UTC(2026, 0, 1, 0, 0, counter)).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    status,
    firstPlayer: 'black',
    seats: {
      black: {
        kind: 'guest',
        playerId: `guest_${counter}`,
        displayName: null,
        rejoinToken: 't'.repeat(43),
        connectionId: connected ? `c-${counter}` : null,
      },
      white: null,
    },
    state: null,
    lastMove: null,
    revision: 1,
    createdAt: at,
    updatedAt: at,
  };
}

/** A match no live connection is bound to. */
const unattended = (status: MatchStatus = 'waiting') => record(status, false);

async function limitCode(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error: unknown) => (error instanceof MatchError ? error.code : 'unexpected'),
  );
}

/** The ids among `records` that are still stored. */
async function stored(repository: InMemoryMatchRepository, records: MatchRecord[]) {
  const found = await Promise.all(records.map((r) => repository.findById(r.id)));
  return records.filter((_, i) => found[i] !== null).map((r) => r.id);
}

describe('InMemoryMatchRepository limits', () => {
  it('refuses a match beyond the waiting cap until a waiting match is gone', async () => {
    const repository = new InMemoryMatchRepository({ total: 10, waiting: 2 });
    const first = record();
    await repository.insert(first);
    await repository.insert(record());
    expect(await limitCode(repository.insert(record()))).toBe('MATCH_LIMIT');

    await repository.update({ ...first, status: 'active', revision: 2 });
    await expect(repository.insert(record())).resolves.toBeUndefined();
    expect(await limitCode(repository.insert(record()))).toBe('MATCH_LIMIT');
  });

  it('refuses a match beyond the total cap until a match is deleted', async () => {
    const repository = new InMemoryMatchRepository({ total: 2, waiting: 10 });
    const first = record('active');
    await repository.insert(first);
    await repository.insert(record());
    expect(await limitCode(repository.insert(record()))).toBe('MATCH_LIMIT');
    expect(repository.size).toBe(2);

    await repository.delete(first.id);
    await expect(repository.insert(record())).resolves.toBeUndefined();
  });

  it('never overshoots under concurrent inserts', async () => {
    const repository = new InMemoryMatchRepository({ total: 100, waiting: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => repository.insert(record())),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(repository.size).toBe(3);
  });
});

describe('InMemoryMatchRepository eviction', () => {
  it('evicts the oldest unattended waiting match to make room under the waiting cap', async () => {
    const repository = new InMemoryMatchRepository({ total: 10, waiting: 2 });
    const oldest = unattended();
    const newer = unattended();
    await repository.insert(oldest);
    await repository.insert(newer);

    const victim = record();
    await expect(repository.insert(victim)).resolves.toBeUndefined();
    expect(await stored(repository, [oldest, newer, victim])).toEqual([newer.id, victim.id]);
    expect(repository.size).toBe(2);
  });

  it('never evicts a match with a connected seat', async () => {
    const repository = new InMemoryMatchRepository({ total: 3, waiting: 2 });
    const attended = [record(), record(), record('active')];
    for (const r of attended) await repository.insert(r);

    expect(await limitCode(repository.insert(unattended()))).toBe('MATCH_LIMIT');
    expect(await limitCode(repository.insert(record('active')))).toBe('MATCH_LIMIT');
    expect(await stored(repository, attended)).toHaveLength(3);
  });

  it('evicts nothing when eviction cannot make room', async () => {
    const repository = new InMemoryMatchRepository({ total: 2, waiting: 1 });
    const evictable = unattended('finished');
    await repository.insert(evictable);
    await repository.insert(record());

    // The waiting cap has no candidate, so the finished match must survive.
    expect(await limitCode(repository.insert(record()))).toBe('MATCH_LIMIT');
    expect(await repository.findById(evictable.id)).not.toBeNull();
    expect(repository.size).toBe(2);
  });

  it('does not evict a waiting match to insert a match of another status', async () => {
    const repository = new InMemoryMatchRepository({ total: 10, waiting: 1 });
    const waiting = unattended();
    await repository.insert(waiting);
    await repository.insert(record('active'));
    expect(await repository.findById(waiting.id)).not.toBeNull();
  });

  it('evicts finished, then waiting, then active matches under the total cap', async () => {
    const repository = new InMemoryMatchRepository({ total: 4, waiting: 10 });
    // Inserted oldest first: the status priority wins over age.
    const active = unattended('active');
    const waiting = unattended('waiting');
    const finished = unattended('finished');
    const attended = record('active');
    for (const r of [active, waiting, finished, attended]) await repository.insert(r);
    const candidates = [active, waiting, finished];

    const created = [record(), record(), record()];
    await repository.insert(created[0]!);
    expect(await stored(repository, candidates)).toEqual([active.id, waiting.id]);
    await repository.insert(created[1]!);
    expect(await stored(repository, candidates)).toEqual([active.id]);
    await repository.insert(created[2]!);
    expect(await stored(repository, candidates)).toEqual([]);

    expect(await limitCode(repository.insert(record()))).toBe('MATCH_LIMIT');
    expect(await stored(repository, [attended, ...created])).toHaveLength(4);
  });

  it('evicts the least recently updated match of a status first', async () => {
    const repository = new InMemoryMatchRepository({ total: 3, waiting: 10 });
    const touched = unattended('active');
    const untouched = unattended('active');
    await repository.insert(touched);
    await repository.insert(untouched);
    await repository.insert(record());
    await repository.update({ ...touched, revision: 2, updatedAt: '2030-01-01T00:00:00.000Z' });

    await repository.insert(record());
    expect(await stored(repository, [touched, untouched])).toEqual([touched.id]);
  });

  it('reports an update of an evicted match as MATCH_NOT_FOUND', async () => {
    const repository = new InMemoryMatchRepository({ total: 1, waiting: 1 });
    const evicted = unattended('active');
    await repository.insert(evicted);
    await repository.insert(record());
    expect(await limitCode(repository.update({ ...evicted, revision: 2 }))).toBe('MATCH_NOT_FOUND');
  });
});

describe('matchLimitsFromEnv', () => {
  it('reads positive integers and falls back to the defaults otherwise', () => {
    const env = (values: Record<string, string>) => (key: string) => values[key];
    expect(matchLimitsFromEnv(env({}))).toEqual(DEFAULT_MATCH_LIMITS);
    expect(DEFAULT_MATCH_LIMITS).toEqual({ total: 1000, waiting: 100 });
    expect(
      matchLimitsFromEnv(env({ MATCH_LIMIT_TOTAL: ' 50 ', MATCH_LIMIT_WAITING: '5' })),
    ).toEqual({ total: 50, waiting: 5 });
    for (const bad of ['0', '-1', '1.5', 'abc', '', '1e3']) {
      expect(matchLimitsFromEnv(env({ MATCH_LIMIT_TOTAL: bad })).total).toBe(1000);
    }
  });
});
