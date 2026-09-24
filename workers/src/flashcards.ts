import type { D1Database } from '@cloudflare/workers-types'
import { z } from 'zod'

export const flashcardSchema = z.object({
  id: z.string().min(1).max(100),
  front: z.string().min(1).max(4000),
  back: z.string().max(8000),
  sourceText: z.string().max(4000).optional(),
  sourceQuestionId: z.string().max(200).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  deletedAt: z.number().int().nonnegative().optional(),
})
export type FlashcardInput = z.infer<typeof flashcardSchema>

export async function listFlashcards(db: D1Database, hash: string) {
  const result = await db.prepare('SELECT id, front, back, source_text AS sourceText, source_question_id AS sourceQuestionId, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM flashcards WHERE token_hash = ? ORDER BY updated_at DESC LIMIT 2000')
    .bind(hash).all()
  return result.results
}

export async function upsertFlashcards(db: D1Database, hash: string, cards: FlashcardInput[]) {
  if (!cards.length) return
  await db.batch(cards.map(card => db.prepare(`INSERT INTO flashcards (id, token_hash, front, back, source_text, source_question_id, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(token_hash, id) DO UPDATE SET front = excluded.front, back = excluded.back,
    source_text = excluded.source_text, source_question_id = excluded.source_question_id,
    updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
    WHERE excluded.updated_at > flashcards.updated_at`)
    .bind(card.id, hash, card.front, card.back, card.sourceText ?? null, card.sourceQuestionId ?? null,
      card.createdAt, card.updatedAt, card.deletedAt ?? null)))
}

export async function createFlashcard(db: D1Database, hash: string, front: string, back: string, sourceQuestionId?: string) {
  const now = Date.now()
  const card: FlashcardInput = { id: crypto.randomUUID(), front, back, sourceQuestionId, createdAt: now, updatedAt: now }
  await upsertFlashcards(db, hash, [card])
  return card
}

export async function updateFlashcard(db: D1Database, hash: string, id: string, front?: string, back?: string) {
  const existing = await db.prepare('SELECT id, front, back FROM flashcards WHERE token_hash = ? AND id = ? AND deleted_at IS NULL')
    .bind(hash, id).first<{ id: string; front: string; back: string }>()
  if (!existing) return false
  await db.prepare('UPDATE flashcards SET front = ?, back = ?, updated_at = ? WHERE token_hash = ? AND id = ?')
    .bind(front ?? existing.front, back ?? existing.back, Date.now(), hash, id).run()
  return true
}

export async function deleteFlashcard(db: D1Database, hash: string, id: string) {
  const result = await db.prepare('UPDATE flashcards SET deleted_at = ?, updated_at = ? WHERE token_hash = ? AND id = ? AND deleted_at IS NULL')
    .bind(Date.now(), Date.now(), hash, id).run()
  return result.meta.changes > 0
}
