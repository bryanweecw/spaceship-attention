export type ModelFileSystem = {
  open(path: string, flags: string): unknown
  write(stream: unknown, bytes: Uint8Array, offset: number, length: number, position: number): void
  close(stream: unknown): void
  unlink(path: string): void
}
type Model = { url: string; bytes: number; sha256: string }
const CHUNK = 4 * 1024 * 1024

/** Persist small chunks rather than one giant Cache API response, which some mobile browsers reject. */
export async function loadModelFile(fs: ModelFileSystem, model: Model, progress: (phase: string, received: number) => void) {
  let db: IDBDatabase | undefined
  try {
    db = await openDatabase()
  } catch {
    /* Private browsing may disable persistent storage. */
  }
  let stream = fs.open("/model.gguf", "w")
  let received = 0
  try {
    if (db) {
      try {
        const record = (await read(db, "models", model.sha256)) as { bytes: number; chunks: number } | undefined
        if (record?.bytes === model.bytes) {
          for (let i = 0; i < record.chunks; i++) {
            const bytes = (await read(db, "chunks", `${model.sha256}/${i}`)) as Uint8Array | undefined
            if (!bytes) throw new Error("Incomplete cached model")
            fs.write(stream, bytes, 0, bytes.length, received)
            received += bytes.length
            progress("Reading cached model", received)
          }
          if (received !== model.bytes) throw new Error("Incomplete cached model")
          return { cached: true, cacheStored: true }
        }
      } catch {
        fs.close(stream)
        stream = fs.open("/model.gguf", "w")
        received = 0
      }
    }
    const response = await fetch(model.url)
    if (!response.ok) throw new Error(`Model download failed (${response.status}).`)
    const reader = response.body!.getReader()
    let block = new Uint8Array(CHUNK),
      used = 0,
      chunks = 0,
      reported = 0
    let storageWorks = Boolean(db)
    const store = async (bytes: Uint8Array) => {
      if (storageWorks) {
        try {
          await write(db!, "chunks", `${model.sha256}/${chunks}`, bytes)
        } catch {
          storageWorks = false
        }
      }
      chunks++
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      fs.write(stream, value, 0, value.length, received)
      received += value.length
      let offset = 0
      while (offset < value.length) {
        const count = Math.min(CHUNK - used, value.length - offset)
        block.set(value.subarray(offset, offset + count), used)
        offset += count
        used += count
        if (used === CHUNK) {
          await store(block)
          block = new Uint8Array(CHUNK)
          used = 0
        }
      }
      if (received - reported > 1048576) {
        progress("Downloading model", received)
        reported = received
      }
    }
    if (received !== model.bytes) throw new Error("The model download was incomplete. Reload to retry.")
    if (used) await store(block.slice(0, used))
    if (storageWorks) {
      try {
        await write(db!, "models", model.sha256, { bytes: received, chunks })
      } catch {
        storageWorks = false
      }
    }
    return { cached: false, cacheStored: storageWorks }
  } finally {
    fs.close(stream)
    db?.close()
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("spaceship-model-v1", 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore("models")
      request.result.createObjectStore("chunks")
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error("Browser model storage is blocked"))
  })
}

function read(db: IDBDatabase, store: string, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store)
    const request = transaction.objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function write(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite")
    transaction.objectStore(store).put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
