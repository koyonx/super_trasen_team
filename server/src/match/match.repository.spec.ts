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
function record(status: MatchStatus = 'waiting'): MatchRecord {
  counter++;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    status,
    firstPlayer: 'black',
    seats: { black: null, white: null },
    state: null,
    lastMove: null,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function limitCode(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error: unknown) => (error instanceof MatchError ? error.code : 'unexpected'),
  );
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
