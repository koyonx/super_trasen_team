/**
 * Serializes async critical sections per key (one promise chain per key).
 *
 * Used to apply every mutation of a match one at a time, so concurrent
 * requests can never interleave between reading and writing a match. A failed
 * section does not break the chain for later callers. Idle keys are removed.
 *
 * The lock is process-local: it is sufficient for a single server instance.
 * Running several instances would additionally need storage-level
 * concurrency control (e.g. a revision check on update).
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, section: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(section);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** Number of keys with pending sections (for tests and diagnostics). */
  get size(): number {
    return this.tails.size;
  }
}
