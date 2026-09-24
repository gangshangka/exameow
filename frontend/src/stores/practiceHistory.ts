import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface DayRecord {
  total: number
  correct: number
  byType: Record<string, { total: number; correct: number }>
}

const KEY = 'exameow-practice-history'

function load(): Record<string, DayRecord> {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) || '{}')
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    return Object.fromEntries(Object.entries(data).filter(([, day]) =>
      day && typeof day === 'object' && typeof (day as DayRecord).total === 'number'
      && typeof (day as DayRecord).correct === 'number' && (day as DayRecord).byType
      && typeof (day as DayRecord).byType === 'object'
    )) as Record<string, DayRecord>
  } catch {
    return {}
  }
}

function todayKey(ts = Date.now()): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const usePracticeHistoryStore = defineStore('practiceHistory', () => {
  const days = ref<Record<string, DayRecord>>(load())
  watch(days, (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* Storage may be full. */ } }, { deep: true })

  function record(type: string, isCorrect: boolean | null) {
    const key = todayKey()
    if (!days.value[key]) days.value[key] = { total: 0, correct: 0, byType: {} }
    const day = days.value[key]
    day.total++
    if (isCorrect === true) day.correct++
    if (!day.byType[type]) day.byType[type] = { total: 0, correct: 0 }
    day.byType[type]!.total++
    if (isCorrect === true) day.byType[type]!.correct++
  }

  return { days, record, todayKey }
})
