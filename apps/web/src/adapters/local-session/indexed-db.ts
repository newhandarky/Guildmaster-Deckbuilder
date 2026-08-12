const databaseName = 'guildmaster-offline';
const databaseVersion = 1;
const sessionStore = 'sessions';
const activeSessionKey = 'active';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed.')), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')), { once: true });
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(databaseName, databaseVersion);
  request.addEventListener('upgradeneeded', () => {
    if (!request.result.objectStoreNames.contains(sessionStore)) request.result.createObjectStore(sessionStore);
  }, { once: true });
  return requestResult(request);
}

/** The complete offline session is read and written as one structured-clone value. */
export const indexedDbSessionRepository = {
  async read(): Promise<unknown | undefined> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(sessionStore, 'readonly');
      const result = await requestResult(transaction.objectStore(sessionStore).get(activeSessionKey));
      await transactionDone(transaction);
      return result;
    } finally {
      database.close();
    }
  },

  async write(value: unknown): Promise<void> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(sessionStore, 'readwrite');
      transaction.objectStore(sessionStore).put(value, activeSessionKey);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  },

  async clear(): Promise<void> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(sessionStore, 'readwrite');
      transaction.objectStore(sessionStore).delete(activeSessionKey);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  },
};

export type AsyncSessionRepository = { write(value: unknown): Promise<void>; clear(): Promise<void> };

/** Serializes session mutations and invalidates writes queued before a clear. */
export function createSerializedSessionPersistence(repository: AsyncSessionRepository): { write(value: unknown): Promise<void>; clear(): Promise<void> } {
  let queue: Promise<void> = Promise.resolve();
  let epoch = 0;
  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const completion = queue.then(operation);
    queue = completion.catch(() => undefined);
    return completion;
  };
  return {
    write(value) {
      const writeEpoch = epoch;
      return enqueue(async () => { if (writeEpoch === epoch) await repository.write(value); });
    },
    clear() {
      epoch += 1;
      return enqueue(() => repository.clear());
    },
  };
}

export const serializedIndexedDbSessionPersistence = createSerializedSessionPersistence(indexedDbSessionRepository);
