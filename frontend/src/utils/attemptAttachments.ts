const DB_NAME = 'exameow-attempt-attachments'
const STORE_NAME = 'images'

export async function prepareDraftImage(file: File): Promise<{ blob: Blob; width?: number; height?: number }> {
  // Keep normal images untouched. Resize only camera files large enough to exceed the remote image limit.
  if (file.size <= 8 * 1024 * 1024) return { blob: file }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const ratio = Math.min(1, 2600 / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.round(image.naturalWidth * ratio)
    const height = Math.round(image.naturalHeight * ratio)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return { blob: file }
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94))
    return blob ? { blob, width, height } : { blob: file }
  } catch { return { blob: file } }
  finally { URL.revokeObjectURL(url) }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('当前设备不支持本地图片存储'))
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const request = action(tx.objectStore(STORE_NAME))
    let result: T
    request.onsuccess = () => { result = request.result }
    request.onerror = () => reject(request.error)
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.oncomplete = () => { db.close(); resolve(result) }
    tx.onabort = () => { db.close(); reject(tx.error) }
  })
}

export function saveDraftImage(key: string, blob: Blob): Promise<IDBValidKey> {
  return transaction('readwrite', store => store.put(blob, key))
}

export function getDraftImage(key: string): Promise<Blob | undefined> {
  return transaction('readonly', store => store.get(key) as IDBRequest<Blob | undefined>)
}

export function deleteDraftImage(key: string): Promise<undefined> {
  return transaction('readwrite', store => store.delete(key) as IDBRequest<undefined>)
}
