const DB_NAME  = 'paint-app'
const STORE    = 'layers'
let _db = null

function openDB() {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE)
    req.onsuccess  = e => { _db = e.target.result; resolve(_db) }
    req.onerror    = e => reject(e.target.error)
  })
}

export async function dbPut(key, value) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = resolve
    tx.onerror    = e => reject(e.target.error)
  })
}

export async function dbGet(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = e => resolve(e.target.result ?? null)
    req.onerror   = e => reject(e.target.error)
  })
}

export async function dbDelMany(keys) {
  if (!keys.length) return
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    keys.forEach(k => store.delete(k))
    tx.oncomplete = resolve
    tx.onerror    = e => reject(e.target.error)
  })
}
