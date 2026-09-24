import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { z } from 'zod'

export const attemptSchema = z.object({
  id: z.string().min(1).max(100),
  bankId: z.string().max(200),
  questionId: z.string().max(200),
  knowledgePointId: z.string().max(100).optional(),
  sessionQuestionId: z.string().max(200),
  startedAt: z.number().int().nonnegative(),
  submittedAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative(),
  finalAnswer: z.string().max(8000).nullable().optional(),
  isCorrect: z.boolean().nullable().optional(),
  answerChanges: z.array(z.object({ at: z.number(), from: z.string().nullable(), to: z.string().nullable() })).max(5000),
  notes: z.array(z.object({ id: z.string(), type: z.enum(['text', 'speech']), text: z.string().max(20000), createdAt: z.number() })).max(200),
  tags: z.array(z.string().max(100)).max(100),
  attachments: z.array(z.object({ id: z.string(), type: z.literal('draft_image'), storageKey: z.string(), createdAt: z.number(), mimeType: z.string().optional() })).max(100),
  questionSnapshot: z.object({
    id: z.string(), type: z.string(), stem: z.string().max(20000), options: z.array(z.string()),
    answer: z.string(), analysis: z.string(), aiAnalysis: z.string().optional(),
  }).passthrough().optional(),
})
export type SyncedAttempt = z.infer<typeof attemptSchema>

export async function upsertAttempts(db: D1Database, hash: string, attempts: SyncedAttempt[]) {
  if (!attempts.length) return
  await db.batch(attempts.map(attempt => db.prepare(`INSERT INTO attempt_records (token_hash, id, body, updated_at, started_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(token_hash, id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at,
    started_at = excluded.started_at WHERE excluded.updated_at > attempt_records.updated_at`)
    .bind(hash, attempt.id, JSON.stringify(attempt), attempt.updatedAt, attempt.startedAt)))
}

export async function listAttempts(db: D1Database, hash: string, limit: number, offset: number) {
  const result = await db.prepare('SELECT body FROM attempt_records WHERE token_hash = ? ORDER BY started_at DESC LIMIT ? OFFSET ?')
    .bind(hash, limit, offset).all<{ body: string }>()
  return result.results.map(row => {
    const record = JSON.parse(row.body) as SyncedAttempt
    return {
      id: record.id, bankId: record.bankId, questionId: record.questionId,
      startedAt: record.startedAt, submittedAt: record.submittedAt,
      finalAnswer: record.finalAnswer, isCorrect: record.isCorrect,
      tags: record.tags, noteCount: record.notes.length, draftCount: record.attachments.length,
      stem: record.questionSnapshot?.stem,
    }
  })
}

export async function getAttempt(db: D1Database, hash: string, id: string): Promise<SyncedAttempt | null> {
  const row = await db.prepare('SELECT body FROM attempt_records WHERE token_hash = ? AND id = ?')
    .bind(hash, id).first<{ body: string }>()
  return row ? JSON.parse(row.body) as SyncedAttempt : null
}

export async function putAttemptImage(bucket: R2Bucket, hash: string, id: string, data: ArrayBuffer, mimeType: string) {
  await bucket.put(`${hash}/${id}`, data, { httpMetadata: { contentType: mimeType } })
}

export async function getAttemptImage(bucket: R2Bucket, hash: string, id: string) {
  return bucket.get(`${hash}/${id}`)
}

export async function imageContent(bucket: R2Bucket, hash: string, id: string) {
  const image = await getAttemptImage(bucket, hash, id)
  if (!image) return null
  const bytes = new Uint8Array(await image.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return { type: 'image' as const, data: btoa(binary), mimeType: image.httpMetadata?.contentType || 'image/jpeg' }
}
