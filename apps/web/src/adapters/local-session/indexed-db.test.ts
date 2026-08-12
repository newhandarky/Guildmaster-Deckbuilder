import { describe, expect, it } from 'vitest';
import { createSerializedSessionPersistence } from './indexed-db.js';

describe('serialized IndexedDB session persistence', () => {
  it('preserves rapid revision order even when writes are delayed', async () => {
    const durable: number[] = [];
    const repository = {
      async write(value: unknown) { await Promise.resolve(); durable.push(value as number); },
      async clear() { durable.length = 0; },
    };
    const persistence = createSerializedSessionPersistence(repository);
    await Promise.all([persistence.write(1), persistence.write(2), persistence.write(3)]);
    expect(durable).toEqual([1, 2, 3]);
  });

  it('invalidates queued old writes and orders clear before a new expedition', async () => {
    const durable: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const repository = {
      async write(value: unknown) { if (value === 'in-flight') await gate; durable.push(value as string); },
      async clear() { durable.length = 0; },
    };
    const persistence = createSerializedSessionPersistence(repository);
    const stale = persistence.write('in-flight');
    await Promise.resolve();
    const clear = persistence.clear();
    const fresh = persistence.write('fresh');
    release();
    await Promise.all([stale, clear, fresh]);
    expect(durable).toEqual(['fresh']);
  });

  it('reports a failed transaction but lets a later durable save proceed', async () => {
    const durable: string[] = [];
    let fail = true;
    const persistence = createSerializedSessionPersistence({
      async write(value: unknown) { if (fail) { fail = false; throw new Error('quota'); } durable.push(value as string); },
      async clear() { durable.length = 0; },
    });
    await expect(persistence.write('failed')).rejects.toThrow('quota');
    await expect(persistence.write('recovered')).resolves.toBeUndefined();
    expect(durable).toEqual(['recovered']);
  });
});
