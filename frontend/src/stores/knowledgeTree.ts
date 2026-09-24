import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useDailyTasksStore } from './dailyTasks'

export interface KnowledgePoint {
  id: string
  parentId: string | null
  name: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

const KEY = 'exameow-knowledge-tree-v1'
const RELAY_BASE = (import.meta.env.VITE_DAILY_TASKS_RELAY as string | undefined) || 'https://exam.superagentparty.com'
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

function load(): KnowledgePoint[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(data)) return []
    return data.filter((item): item is KnowledgePoint => item && typeof item.id === 'string'
      && typeof item.name === 'string' && typeof item.createdAt === 'number')
      .map(item => ({
        id: item.id,
        parentId: typeof item.parentId === 'string' ? item.parentId : null,
        name: item.name,
        createdAt: item.createdAt,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : item.createdAt,
        archivedAt: typeof item.archivedAt === 'number' ? item.archivedAt : undefined,
      }))
  } catch { return [] }
}

export const useKnowledgeTreeStore = defineStore('knowledgeTree', () => {
  const nodes = ref<KnowledgePoint[]>(load())
  const storageError = ref<string | null>(null)
  const syncError = ref<string | null>(null)
  const syncing = ref(false)
  let syncTimer: ReturnType<typeof setTimeout> | undefined
  let syncAgain = false

  const activeNodes = computed(() => nodes.value.filter(node => !node.archivedAt))
  const options = computed(() => {
    const active = activeNodes.value
    const ids = new Set(active.map(node => node.id))
    const result: { id: string; label: string; depth: number }[] = []
    const visited = new Set<string>()
    const visit = (parentId: string | null, depth: number) => {
      const children = active.filter(node => (ids.has(node.parentId ?? '') ? node.parentId : null) === parentId)
        .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
      for (const child of children) {
        if (visited.has(child.id)) continue
        visited.add(child.id)
        result.push({ id: child.id, label: `${'　'.repeat(depth)}${child.name}`, depth })
        visit(child.id, depth + 1)
      }
    }
    visit(null, 0)
    for (const node of active) if (!visited.has(node.id)) result.push({ id: node.id, label: node.name, depth: 0 })
    return result
  })

  function getPath(id?: string | null): string {
    if (!id) return ''
    const path: string[] = []
    const seen = new Set<string>()
    let current = nodes.value.find(node => node.id === id)
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      path.unshift(current.name)
      current = current.parentId ? nodes.value.find(node => node.id === current!.parentId) : undefined
    }
    return path.join(' → ')
  }

  function scheduleSync() {
    if (!useDailyTasksStore().deviceToken) return
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => { void syncRemote() }, 1200)
  }

  function save(sync = true) {
    try { localStorage.setItem(KEY, JSON.stringify(nodes.value)); storageError.value = null }
    catch { storageError.value = '知识点保存失败：本地存储空间可能已满' }
    if (sync) scheduleSync()
  }

  function create(name: string, parentId: string | null = null): KnowledgePoint | null {
    const clean = name.trim()
    if (!clean || clean.length > 120 || (parentId && !activeNodes.value.some(node => node.id === parentId))) return null
    const now = Date.now()
    const node: KnowledgePoint = { id: newId(), parentId, name: clean, createdAt: now, updatedAt: now }
    nodes.value.push(node)
    save()
    return node
  }

  function rename(id: string, name: string) {
    const node = nodes.value.find(item => item.id === id && !item.archivedAt)
    const clean = name.trim()
    if (!node || !clean || clean.length > 120) return
    node.name = clean
    node.updatedAt = Math.max(Date.now(), node.updatedAt + 1)
    save()
  }

  function archive(id: string) {
    const descendants = new Set([id])
    let grew = true
    while (grew) {
      grew = false
      for (const node of nodes.value) if (node.parentId && descendants.has(node.parentId) && !descendants.has(node.id)) {
        descendants.add(node.id); grew = true
      }
    }
    const now = Date.now()
    for (const node of nodes.value) if (descendants.has(node.id) && !node.archivedAt) {
      node.archivedAt = now
      node.updatedAt = Math.max(now, node.updatedAt + 1)
    }
    save()
  }

  function mergeRemote(remote: KnowledgePoint[]) {
    for (const node of remote) {
      if (!node || typeof node.id !== 'string' || typeof node.name !== 'string' || typeof node.updatedAt !== 'number') continue
      const index = nodes.value.findIndex(item => item.id === node.id)
      if (index < 0) nodes.value.push(node)
      else if (node.updatedAt > nodes.value[index]!.updatedAt) nodes.value[index] = node
    }
    save(false)
  }

  async function syncRemote() {
    const token = useDailyTasksStore().deviceToken
    if (!token) return
    if (syncing.value) { syncAgain = true; return }
    syncing.value = true
    syncError.value = null
    try {
      const remoteResponse = await fetch(`${RELAY_BASE}/api/knowledge/${token}`)
      if (!remoteResponse.ok) throw new Error(`知识点同步失败：${remoteResponse.status}`)
      const remote = await remoteResponse.json() as { nodes?: KnowledgePoint[] }
      if (Array.isArray(remote.nodes)) mergeRemote(remote.nodes)
      for (let i = 0; i < nodes.value.length; i += 100) {
        const response = await fetch(`${RELAY_BASE}/api/knowledge/${token}/sync`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes: nodes.value.slice(i, i + 100) }),
        })
        if (!response.ok) throw new Error(`知识点同步失败：${response.status}`)
      }
    } catch (error) { syncError.value = error instanceof Error ? error.message : '知识点同步失败' }
    finally {
      syncing.value = false
      if (syncAgain) { syncAgain = false; void syncRemote() }
    }
  }

  return { nodes, activeNodes, options, storageError, syncError, syncing, getPath, create, rename, archive, syncRemote }
})
