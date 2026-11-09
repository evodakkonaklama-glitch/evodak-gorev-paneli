// Küçük IndexedDB yardımcısı: çevrimdışı okuma için veri kopyası ve gönderilmeyi bekleyen değişiklik kuyruğu
const DB_NAME = 'evodak';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB yok')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'seq', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export const kv = {
  get: (key) => tx('kv', 'readonly', (s) => wrap(s.get(key))).catch(() => undefined),
  set: (key, value) => tx('kv', 'readwrite', (s) => { s.put(value, key); }).catch(() => undefined),
  del: (key) => tx('kv', 'readwrite', (s) => { s.delete(key); }).catch(() => undefined),
  clear: () => tx('kv', 'readwrite', (s) => { s.clear(); }).catch(() => undefined),
};

export const queue = {
  add: (item) => tx('queue', 'readwrite', (s) => wrap(s.add(item))),
  all: () => tx('queue', 'readonly', (s) => wrap(s.getAll())).catch(() => []),
  remove: (seq) => tx('queue', 'readwrite', (s) => { s.delete(seq); }),
  clear: () => tx('queue', 'readwrite', (s) => { s.clear(); }).catch(() => undefined),
};
