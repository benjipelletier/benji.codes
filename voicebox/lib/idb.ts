// A small promise wrapper over IndexedDB: the trainer's whole state lives on
// the device so it runs with no connection.

const DB_NAME = 'voicebox';
const VERSION = 1;

export type StoreName = 'voicings' | 'contexts' | 'tunes' | 'srs' | 'attempts' | 'runs' | 'outbox' | 'meta';

let dbp: Promise<IDBDatabase> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function openDb(): Promise<IDBDatabase> {
  dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error("This browser can't store data offline."));
      return;
    }
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const name of ['voicings', 'contexts', 'tunes', 'attempts', 'runs'] as const) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('srs')) db.createObjectStore('srs', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }).catch(err => {
    dbp = null;
    throw err;
  });
  return dbp;
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return req(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

export async function putMany<T>(store: StoreName, rows: T[]): Promise<void> {
  if (!rows.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const r of rows) os.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteMany(store: StoreName, keys: IDBValidKey[]): Promise<void> {
  if (!keys.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const k of keys) os.delete(k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Empty a store and fill it again, in one transaction. */
export async function replaceAll<T>(store: StoreName, rows: T[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    os.clear();
    for (const r of rows) os.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const row = (await req(db.transaction('meta').objectStore('meta').get(key))) as { key: string; value: T } | undefined;
  return row?.value;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await putMany('meta', [{ key, value }]);
}
