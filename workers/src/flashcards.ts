import type { D1Database } from '@cloudflare/workers-types'
import { z } from 'zod'

export const flashcardSchema = z.object({
  id: z.string().min(1).max(100),
  front: z.string().min(1).max(4000),
  back: z.string().max(8000),
  sourceText: z.string().max(4000).optional(),
  sourceQuestionId: z.string().max(200).optional(),
  knowledgePointId: z.string().max(100).optional(),
  dueAt: z.number().int().nonnegative().optional(),
  intervalDays: z.number().int().nonnegative().optional(),
  easeFactor: z.number().min(1.3).max(5).optional(),
  repetitions: z.number().int().nonnegative().optional(),
  lapseCount: z.number().int().nonnegative().optional(),
  reviewHistory: z.array(z.object({ at: z.number().int().nonnegative(), rating: z.enum(['again', 'hard', 'good', 'easy']),
    previousIntervalDays: z.number().nonnegative(), nextIntervalDays: z.number().nonnegative() })).max(5000).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  deletedAt: z.number().int().nonnegative().optional(),
})
export type FlashcardInput = z.infer<typeof flashcardSchema>

export async function listFlashcards(db: D1Database, hash: string) {
  const result = await db.prepare('SELECT id, front, back, source_text AS sourceText, source_question_id AS sourceQuestionId, knowledge_point_id AS knowledgePointId, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt, COALESCE(due_at, created_at) AS dueAt, interval_days AS intervalDays, ease_factor AS easeFactor, review_count AS repetitions, lapse_count AS lapseCount, review_history AS reviewHistory FROM flashcards WHERE token_hash = ? ORDER BY updated_at DESC LIMIT 2000')
    .bind(hash).all()
  return result.results.map(row => ({ ...row, deletedAt: row.deletedAt as number | null,
    reviewHistory: JSON.parse(String(row.reviewHistory || '[]')) }))
}

export async function upsertFlashcards(db: D1Database, hash: string, cards: FlashcardInput[]) {
  if (!cards.length) return
  await db.batch(cards.map(card => db.prepare(`INSERT INTO flashcards (id, token_hash, front, back, source_text, source_question_id, knowledge_point_id, created_at, updated_at, deleted_at, due_at, interval_days, ease_factor, review_count, lapse_count, review_history)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(token_hash, id) DO UPDATE SET front = excluded.front, back = excluded.back,
    source_text = excluded.source_text, source_question_id = excluded.source_question_id, knowledge_point_id = excluded.knowledge_point_id,
    updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, due_at = excluded.due_at,
    interval_days = excluded.interval_days, ease_factor = excluded.ease_factor, review_count = excluded.review_count,
    lapse_count = excluded.lapse_count, review_history = excluded.review_history
    WHERE excluded.updated_at > flashcards.updated_at`)
    .bind(card.id, hash, card.front, card.back, card.sourceText ?? null, card.sourceQuestionId ?? null, card.knowledgePointId ?? null,
      card.createdAt, card.updatedAt, card.deletedAt ?? null, card.dueAt ?? card.createdAt,
      card.intervalDays ?? 0, card.easeFactor ?? 2.5, card.repetitions ?? 0, card.lapseCount ?? 0, JSON.stringify(card.reviewHistory ?? []))))
}

export async function createFlashcard(db: D1Database, hash: string, front: string, back: string, sourceQuestionId?: string, knowledgePointId?: string) {
  const now = Date.now()
  const card: FlashcardInput = { id: crypto.randomUUID(), front, back, sourceQuestionId, knowledgePointId, createdAt: now, updatedAt: now,
    dueAt: now, intervalDays: 0, easeFactor: 2.5, repetitions: 0, lapseCount: 0, reviewHistory: [] }
  await upsertFlashcards(db, hash, [card])
  return card
}

export async function updateFlashcard(db: D1Database, hash: string, id: string, front?: string, back?: string, knowledgePointId?: string | null, dueAt?: number) {
  const existing = await db.prepare('SELECT id, front, back, knowledge_point_id AS knowledgePointId, due_at AS dueAt FROM flashcards WHERE token_hash = ? AND id = ? AND deleted_at IS NULL')
    .bind(hash, id).first<{ id: string; front: string; back: string; knowledgePointId: string | null; dueAt: number | null }>()
  if (!existing) return false
  await db.prepare('UPDATE flashcards SET front = ?, back = ?, knowledge_point_id = ?, due_at = ?, updated_at = ? WHERE token_hash = ? AND id = ?')
    .bind(front ?? existing.front, back ?? existing.back, knowledgePointId === undefined ? existing.knowledgePointId : knowledgePointId,
      dueAt ?? existing.dueAt, Date.now(), hash, id).run()
  return true
}

export async function deleteFlashcard(db: D1Database, hash: string, id: string) {
  const result = await db.prepare('UPDATE flashcards SET deleted_at = ?, updated_at = ? WHERE token_hash = ? AND id = ? AND deleted_at IS NULL')
    .bind(Date.now(), Date.now(), hash, id).run()
  return result.meta.changes > 0
}
