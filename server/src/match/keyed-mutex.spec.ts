import { describe, expect, it } from 'vitest';
import { KeyedMutex } from './keyed-mutex';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));

describe('KeyedMutex', () => {
  it('runs sections of one key strictly one after another', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const section = (name: string) => async () => {
      log.push(`${name}:start`);
      await tick();
      log.push(`${name}:end`);
      return name;
    };

    const results = await Promise.all([
      mutex.run('m', section('a')),
      mutex.run('m', section('b')),
      mutex.run('m', section('c')),
    ]);

    expect(results).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('runs different keys concurrently', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const section = (name: string) => async () => {
      log.push(`${name}:start`);
      await tick();
      log.push(`${name}:end`);
    };

    await Promise.all([mutex.run('x', section('x')), mutex.run('y', section('y'))]);

    expect(log.slice(0, 2).sort()).toEqual(['x:start', 'y:start']);
  });

  it('keeps the chain alive after a failure', async () => {
    const mutex = new KeyedMutex();
    const failing = mutex.run('m', async () => {
      throw new Error('boom');
    });
    const next = mutex.run('m', async () => 'ok');

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('forgets idle keys', async () => {
    const mutex = new KeyedMutex();
    await mutex.run('m', async () => undefined);
    await tick();
    expect(mutex.size).toBe(0);
  });
});
