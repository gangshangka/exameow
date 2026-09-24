import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useDailyTasksStore } from './dailyTasks'

export interface Flashcard {
  id: string
  front: string
  back: string
  sourceText?: string
  sourceQuestionId?: string
  knowledgePointId?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

const KEY = 'exameow-flashcards-v1'
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

function load(): Flashcard[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(data)) return []
    return data.filter((card): card is Flashcard => card && typeof card.id === 'string'
      && typeof card.front === 'string' && typeof card.back === 'string'
      && typeof card.createdAt === 'number' && typeof card.updatedAt === 'number')
  } catch { return [] }
}

export const useFlashcardsStore = defineStore('flashcards', () => {
  const cards = ref<Flashcard[]>(load())
  const storageError = ref<string | null>(null)
  const syncError = ref<string | null>(null)
  const syncing = ref(false)
  let syncAgain = false

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cards.value)); storageError.value = null }
    catch { storageError.value = '闪卡保存失败：本地存储空间可能已满' }
  }

  function create(front: string, back = '', sourceQuestionId?: string, knowledgePointId?: string): Flashcard | null {
    if (!front.trim()) return null
    const now = Date.now()
    const card: Flashcard = { id: newId(), front: front.trim(), back: back.trim(), sourceText: front.trim(), sourceQuestionId, knowledgePointId, createdAt: now, updatedAt: now }
    cards.value.push(card)
    save()
    void syncRemote()
    return card
  }

  function update(id: string, front: string, back: string) {
    const card = cards.value.find(item => item.id === id && !item.deletedAt)
    if (!card || !front.trim()) return
    card.front = front.trim()
    card.back = back.trim()
    card.updatedAt = Date.now()
    save()
    void syncRemote()
  }

  function setKnowledgePoint(id: string, knowledgePointId?: string) {
    const card = cards.value.find(item => item.id === id && !item.deletedAt)
    if (!card) return
    card.knowledgePointId = knowledgePointId
    card.updatedAt = Math.max(Date.now(), card.updatedAt + 1)
    save()
    void syncRemote()
  }

  function remove(id: string) {
    const card = cards.value.find(item => item.id === id)
    if (!card) return
    card.deletedAt = Date.now()
    card.updatedAt = card.deletedAt
    save()
    void syncRemote()
  }

  function mergeRemote(remote: Flashcard[]) {
    for (const card of remote) {
      if (!card || typeof card.id !== 'string' || typeof card.updatedAt !== 'number') continue
      const index = cards.value.findIndex(item => item.id === card.id)
      if (index < 0) cards.value.push(card)
      else if (card.updatedAt > cards.value[index]!.updatedAt) cards.value[index] = card
    }
    save()
  }

  async function syncRemote(): Promise<void> {
    const token = useDailyTasksStore().deviceToken
    if (!token) return
    if (syncing.value) { syncAgain = true; return }
    syncing.value = true
    syncError.value = null
    try {
      const base = (import.meta.env.VITE_DAILY_TASKS_RELAY as string | undefined) || 'https://exam.superagentparty.com'
      const snapshot = [...cards.value]
      const batches: Flashcard[][] = []
      for (let i = 0; i < snapshot.length; i += 100) batches.push(snapshot.slice(i, i + 100))
      if (!batches.length) batches.push([])
      for (const batch of batches) {
        const response = await fetch(`${base}/api/flashcards/${token}/sync`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cards: batch }),
        })
        if (!response.ok) throw new Error(`闪卡同步失败：${response.status}`)
        const body = await response.json() as { cards?: Flashcard[] }
        if (Array.isArray(body.cards)) mergeRemote(body.cards)
      }
    } catch (error) { syncError.value = error instanceof Error ? error.message : '闪卡同步失败' }
    finally {
      syncing.value = false
      if (syncAgain) { syncAgain = false; void syncRemote() }
    }
  }

  return { cards, storageError, syncError, syncing, create, update, setKnowledgePoint, remove, mergeRemote, syncRemote }
})
