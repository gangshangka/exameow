import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export interface DailyTask {
  id: string
  date: string
  title: string
  description: string
  source: 'manual' | 'mcp'
  externalId?: string
  plannedMinutes?: number
  status: 'pending' | 'running' | 'paused' | 'done'
  elapsedMs: number
  runningSince?: number
  timeSegments: { startedAt: number; endedAt: number; reason: 'pause' | 'complete' }[]
  completedAt?: number
  createdAt: number
}

export interface DailyTaskAssignment {
  date: string
  title: string
  description?: string
  externalId?: string
  plannedMinutes?: number
}

const KEY = 'exameow-daily-tasks-v1'
const TOKEN_KEY = 'exameow-daily-tasks-device-token'
const RELAY_BASE = (import.meta.env.VITE_DAILY_TASKS_RELAY as string | undefined) || 'https://exam.superagentparty.com'
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
export const localDate = (time = Date.now()) => {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function load(): DailyTask[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(data)) return []
    return data.filter((item): item is DailyTask => item && typeof item.id === 'string'
      && typeof item.date === 'string' && typeof item.title === 'string'
    ).map(item => ({
      ...item,
      description: typeof item.description === 'string' ? item.description : '',
      source: item.source === 'mcp' ? 'mcp' : 'manual',
      status: ['pending', 'running', 'paused', 'done'].includes(item.status) ? item.status : 'pending',
      elapsedMs: typeof item.elapsedMs === 'number' && Number.isFinite(item.elapsedMs) ? Math.max(0, item.elapsedMs) : 0,
      runningSince: typeof item.runningSince === 'number' ? item.runningSince : undefined,
      timeSegments: Array.isArray(item.timeSegments) ? item.timeSegments.filter(segment => segment
        && typeof segment.startedAt === 'number' && typeof segment.endedAt === 'number'
        && (segment.reason === 'pause' || segment.reason === 'complete')) : [],
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
    }))
  } catch { return [] }
}

export const useDailyTasksStore = defineStore('dailyTasks', () => {
  const tasks = ref<DailyTask[]>(load())
  const deviceToken = ref<string | null>((() => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } })())
  const syncing = ref(false)
  const syncError = ref<string | null>(null)
  const storageError = ref<string | null>(null)
  const todayTasks = computed(() => tasks.value.filter(task => task.date === localDate()))

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(tasks.value)); storageError.value = null }
    catch { storageError.value = '任务保存失败：本地存储空间可能已满' }
  }

  function assignTasks(assignments: DailyTaskAssignment[], source: 'manual' | 'mcp' = 'mcp'): DailyTask[] {
    const assigned: DailyTask[] = []
    for (const input of assignments) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !input.title?.trim()) continue
      const externalId = input.externalId?.trim()
      const existing = externalId ? tasks.value.find(task => task.source === source && task.externalId === externalId) : undefined
      if (existing) {
        existing.date = input.date
        existing.title = input.title.trim()
        existing.description = input.description?.trim() ?? ''
        existing.plannedMinutes = input.plannedMinutes
        assigned.push(existing)
      } else {
        const task: DailyTask = {
          id: newId(), date: input.date, title: input.title.trim(), description: input.description?.trim() ?? '',
          source, externalId, plannedMinutes: input.plannedMinutes, status: 'pending', elapsedMs: 0,
          timeSegments: [], createdAt: Date.now(),
        }
        tasks.value.push(task)
        assigned.push(task)
      }
    }
    save()
    return assigned
  }

  function elapsed(task: DailyTask, now = Date.now()): number {
    return task.elapsedMs + (task.status === 'running' && task.runningSince ? Math.max(0, now - task.runningSince) : 0)
  }

  function start(id: string) {
    const task = tasks.value.find(item => item.id === id)
    if (!task || task.status === 'running' || task.status === 'done') return
    task.status = 'running'
    task.runningSince = Date.now()
    save()
  }

  function pause(id: string) {
    const task = tasks.value.find(item => item.id === id)
    if (!task || task.status !== 'running') return
    const endedAt = Date.now()
    task.elapsedMs = elapsed(task, endedAt)
    if (task.runningSince) task.timeSegments.push({ startedAt: task.runningSince, endedAt, reason: 'pause' })
    task.runningSince = undefined
    task.status = 'paused'
    save()
  }

  function complete(id: string) {
    const task = tasks.value.find(item => item.id === id)
    if (!task || task.status === 'done') return
    const endedAt = Date.now()
    task.elapsedMs = elapsed(task, endedAt)
    if (task.runningSince) task.timeSegments.push({ startedAt: task.runningSince, endedAt, reason: 'complete' })
    task.runningSince = undefined
    task.status = 'done'
    task.completedAt = endedAt
    save()
  }

  const mcpUrl = computed(() => deviceToken.value ? `${RELAY_BASE}/mcp/${deviceToken.value}` : null)

  async function createConnection() {
    syncError.value = null
    try {
      const response = await fetch(`${RELAY_BASE}/api/daily-tasks/device`, { method: 'POST' })
      if (!response.ok) throw new Error(`服务器返回 ${response.status}`)
      const body = await response.json() as { token?: string }
      if (!body.token || !/^[0-9a-f]{64}$/.test(body.token)) throw new Error('服务器返回无效设备凭证')
      localStorage.setItem(TOKEN_KEY, body.token)
      deviceToken.value = body.token
    } catch (error) { syncError.value = error instanceof Error ? error.message : '连接失败' }
  }

  async function syncAssignments() {
    if (!deviceToken.value || syncing.value) return
    syncing.value = true
    syncError.value = null
    try {
      const response = await fetch(`${RELAY_BASE}/api/daily-tasks/${deviceToken.value}`)
      if (!response.ok) throw new Error(`同步失败：${response.status}`)
      const body = await response.json() as { tasks?: Array<{
        id: string; date: string; title: string; description: string; plannedMinutes?: number
      }> }
      if (!Array.isArray(body.tasks)) throw new Error('服务器返回无效任务数据')
      assignTasks(body.tasks.map(task => ({
        date: task.date, title: task.title, description: task.description,
        plannedMinutes: task.plannedMinutes, externalId: task.id,
      })), 'mcp')
    } catch (error) { syncError.value = error instanceof Error ? error.message : '同步失败' }
    finally { syncing.value = false }
  }

  async function revokeConnection() {
    if (!deviceToken.value) return
    syncError.value = null
    try {
      const response = await fetch(`${RELAY_BASE}/api/daily-tasks/${deviceToken.value}/device`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`撤销失败：${response.status}`)
      localStorage.removeItem(TOKEN_KEY)
      deviceToken.value = null
    } catch (error) { syncError.value = error instanceof Error ? error.message : '撤销失败' }
  }

  return { tasks, todayTasks, storageError, deviceToken, syncing, syncError, mcpUrl, createConnection, revokeConnection, syncAssignments, assignTasks, elapsed, start, pause, complete }
})
