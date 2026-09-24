import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AttemptRecord, Question } from '@exameow/shared'
import { usePracticeStore } from './practice'
import { deleteDraftImage, getDraftImage, prepareDraftImage, saveDraftImage } from '@/utils/attemptAttachments'
import { useDailyTasksStore } from './dailyTasks'

const KEY = 'exameow-attempts-v1'
const SYNC_KEY = 'exameow-attempt-sync-v1'
const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

function validString(value: unknown): value is string { return typeof value === 'string' }

function load(): AttemptRecord[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(data)) return []
    return data.filter((item): item is AttemptRecord =>
      item && typeof item === 'object' && validString(item.id) && validString(item.bankId)
      && validString(item.questionId) && typeof item.startedAt === 'number'
    ).map(item => ({
      ...item,
      sessionQuestionId: validString(item.sessionQuestionId) ? item.sessionQuestionId : item.questionId,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : item.submittedAt ?? item.startedAt,
      answerChanges: Array.isArray(item.answerChanges) ? item.answerChanges.filter(change =>
        change && typeof change.at === 'number' && (change.from === null || validString(change.from))
        && (change.to === null || validString(change.to))) : [],
      notes: Array.isArray(item.notes) ? item.notes.filter(note => note && validString(note.id) && validString(note.text)
        && (note.type === 'text' || note.type === 'speech') && typeof note.createdAt === 'number') : [],
      tags: Array.isArray(item.tags) ? item.tags.filter(validString) : [],
      attachments: Array.isArray(item.attachments) ? item.attachments.filter(a => a && validString(a.id)
        && validString(a.storageKey) && a.type === 'draft_image' && typeof a.createdAt === 'number') : [],
    }))
  } catch { return [] }
}

export const useAttemptStore = defineStore('attempts', () => {
  const records = ref<AttemptRecord[]>(load())
  const storageError = ref<string | null>(null)
  const syncError = ref<string | null>(null)
  const syncing = ref(false)
  const syncEnabled = ref((() => { try { return localStorage.getItem('exameow-attempt-sync-enabled') === 'true' } catch { return false } })())
  let syncTimer: ReturnType<typeof setTimeout> | undefined
  const recent = computed(() => [...records.value].sort((a, b) => b.startedAt - a.startedAt))

  function save(): boolean {
    try {
      localStorage.setItem(KEY, JSON.stringify(records.value))
      storageError.value = null
      return true
    } catch {
      storageError.value = '过程记录保存失败：本地存储空间可能已满'
      return false
    }
  }

  function scheduleSync() {
    if (!syncEnabled.value || !useDailyTasksStore().deviceToken) return
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => { void syncToMcp() }, 5000)
  }

  function touch(record: AttemptRecord) {
    record.updatedAt = Math.max(Date.now(), (record.updatedAt ?? 0) + 1)
    save()
    scheduleSync()
  }

  function getAttempt(attemptId: string): AttemptRecord | undefined {
    return records.value.find(record => record.id === attemptId)
  }

  function createAttempt(bankId: string, questionId: string, sessionQuestionId: string, questionSnapshot: Question): AttemptRecord {
    const record: AttemptRecord = {
      id: id(), bankId, questionId, sessionQuestionId, questionSnapshot: { ...questionSnapshot, options: [...questionSnapshot.options] }, startedAt: Date.now(), updatedAt: Date.now(),
      answerChanges: [], notes: [], tags: [], attachments: [],
    }
    records.value.push(record)
    save()
    return record
  }

  function recordAnswerChange(attemptId: string, from: string | null, to: string | null) {
    const record = getAttempt(attemptId)
    if (!record || record.submittedAt || from === to) return
    record.answerChanges.push({ at: Date.now(), from, to })
    touch(record)
  }

  function submit(attemptId: string, answer: string | null, isCorrect: boolean | null) {
    const record = getAttempt(attemptId)
    if (!record) return
    if (!record.submittedAt) record.submittedAt = Date.now()
    record.finalAnswer = answer
    record.isCorrect = isCorrect
    touch(record)
  }

  function setTextNote(attemptId: string, text: string) {
    const record = getAttempt(attemptId)
    if (!record) return
    const existing = record.notes.find(note => note.type === 'text')
    if (existing) existing.text = text
    else record.notes.push({ id: id(), type: 'text', text, createdAt: Date.now() })
    touch(record)
  }

  function addSpeechNote(attemptId: string, text: string) {
    const record = getAttempt(attemptId)
    if (!record || !text.trim()) return
    record.notes.push({ id: id(), type: 'speech', text: text.trim(), createdAt: Date.now() })
    touch(record)
  }

  function toggleTag(attemptId: string, tag: string) {
    const record = getAttempt(attemptId)
    if (!record) return
    record.tags = record.tags.includes(tag) ? record.tags.filter(item => item !== tag) : [...record.tags, tag]
    touch(record)
  }

  async function addAttachment(attemptId: string, file: File) {
    const record = getAttempt(attemptId)
    if (!record || !file.type.startsWith('image/')) throw new Error('请选择图片文件')
    const attachmentId = id()
    const prepared = await prepareDraftImage(file)
    await saveDraftImage(attachmentId, prepared.blob)
    record.attachments.push({ id: attachmentId, type: 'draft_image', createdAt: Date.now(), storageKey: attachmentId,
      mimeType: prepared.blob.type || file.type, width: prepared.width, height: prepared.height })
    record.updatedAt = Date.now()
    if (!save()) {
      record.attachments.pop()
      await deleteDraftImage(attachmentId)
      throw new Error(storageError.value || '草稿保存失败')
    }
    scheduleSync()
  }

  async function removeAttachment(attemptId: string, attachmentId: string) {
    const record = getAttempt(attemptId)
    const attachment = record?.attachments.find(item => item.id === attachmentId)
    if (!record || !attachment) return
    await deleteDraftImage(attachment.storageKey)
    record.attachments = record.attachments.filter(item => item.id !== attachmentId)
    touch(record)
  }

  function getRecentAttempts(limit = 20): AttemptRecord[] {
    return recent.value.slice(0, Math.max(0, limit))
  }

  async function getAttemptAnalysisPayload(attemptId: string): Promise<{
    question: Question | null; correctAnswer: string | null; explanation: string | null;
    attempt: Omit<AttemptRecord, 'attachments'>; draftImages: { id: string; blob: Blob | undefined; mimeType?: string }[]
  } | null> {
    const record = getAttempt(attemptId)
    if (!record) return null
    const bank = usePracticeStore().getBank(record.bankId)
    const question = record.questionSnapshot ?? bank?.questions.find(item => item.id === record.questionId) ?? null
    const { attachments, ...attempt } = record
    const draftImages = await Promise.all(attachments.map(async item => ({
      id: item.id, blob: await getDraftImage(item.storageKey), mimeType: item.mimeType,
    })))
    return { question, correctAnswer: question?.answer ?? null, explanation: question?.analysis ?? null, attempt, draftImages }
  }

  function setSyncEnabled(enabled: boolean) {
    syncEnabled.value = enabled
    try { localStorage.setItem('exameow-attempt-sync-enabled', String(enabled)) } catch { /* Keep current in-memory choice. */ }
    if (enabled) void syncToMcp()
  }

  async function syncToMcp() {
    const token = useDailyTasksStore().deviceToken
    if (!syncEnabled.value || !token || syncing.value) return
    syncing.value = true
    syncError.value = null
    try {
      const base = (import.meta.env.VITE_DAILY_TASKS_RELAY as string | undefined) || 'https://exam.superagentparty.com'
      let syncState: Record<string, number> = {}
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}')
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) syncState = parsed as Record<string, number>
      } catch { /* A corrupt sync cursor means all records should be sent again. */ }
      const prefix = `${token}:`
      const pending = records.value.filter(record => (record.updatedAt ?? record.startedAt) > (syncState[prefix + 'attempt:' + record.id] ?? 0))
      for (let i = 0; i < pending.length; i += 25) {
        const batch = pending.slice(i, i + 25)
        const response = await fetch(`${base}/api/attempts/${token}/sync`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attempts: batch }),
        })
        if (!response.ok) throw new Error(`作答记录同步失败：${response.status}`)
        for (const record of batch) syncState[prefix + 'attempt:' + record.id] = record.updatedAt ?? record.startedAt
        localStorage.setItem(SYNC_KEY, JSON.stringify(syncState))
      }
      const capabilitiesResponse = await fetch(`${base}/api/attempts/capabilities`)
      if (capabilitiesResponse.ok) {
        const capabilities = await capabilitiesResponse.json() as { draftImageSync?: boolean }
        if (!capabilities.draftImageSync) return
      }
      for (const record of records.value) {
        for (const attachment of record.attachments) {
          const key = prefix + 'image:' + attachment.storageKey
          if (syncState[key]) continue
          const blob = await getDraftImage(attachment.storageKey)
          if (!blob) continue
          const response = await fetch(`${base}/api/attempts/${token}/${record.id}/images/${attachment.storageKey}`, {
            method: 'PUT', headers: { 'Content-Type': attachment.mimeType || blob.type || 'image/jpeg' }, body: blob,
          })
          if (!response.ok) throw new Error(`草稿图片同步失败：${response.status}`)
          syncState[key] = Date.now()
          localStorage.setItem(SYNC_KEY, JSON.stringify(syncState))
        }
      }
      const activeImages = new Set(records.value.flatMap(record => record.attachments.map(item => item.storageKey)))
      for (const key of Object.keys(syncState)) {
        if (!key.startsWith(prefix + 'image:')) continue
        const imageId = key.slice((prefix + 'image:').length)
        if (activeImages.has(imageId)) continue
        const response = await fetch(`${base}/api/attempts/${token}/images/${imageId}`, { method: 'DELETE' })
        if (!response.ok) throw new Error(`云端草稿删除失败：${response.status}`)
        delete syncState[key]
        localStorage.setItem(SYNC_KEY, JSON.stringify(syncState))
      }
    } catch (error) { syncError.value = error instanceof Error ? error.message : '作答记录同步失败' }
    finally { syncing.value = false }
  }

  return { records, storageError, syncError, syncing, syncEnabled, setSyncEnabled, syncToMcp, getAttempt, createAttempt, recordAnswerChange, submit, setTextNote, addSpeechNote, toggleTag, addAttachment, removeAttachment, getRecentAttempts, getAttemptAnalysisPayload }
})
