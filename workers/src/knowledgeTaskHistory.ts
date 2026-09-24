import type { D1Database } from '@cloudflare/workers-types'
import { z } from 'zod'

export const knowledgeSchema = z.object({
  id: z.string().min(1).max(100), parentId: z.string().max(100).nullable(),
  name: z.string().trim().min(1).max(120), createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(), archivedAt: z.number().int().nonnegative().optional(),
})
export const taskHistorySchema = z.object({
  id: z.string().min(1).max(100), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  initialDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), title: z.string().max(160),
  description: z.string().max(2000), source: z.enum(['manual', 'mcp']),
  externalId: z.string().max(100).optional(), plannedMinutes: z.number().optional(),
  status: z.enum(['pending', 'running', 'paused', 'done']), elapsedMs: z.number().nonnegative(),
  runningSince: z.number().optional(),
  timeSegments: z.array(z.object({ startedAt: z.number(), endedAt: z.number(), reason: z.enum(['pause', 'complete']) })).max(10000),
  completedAt: z.number().optional(), createdAt: z.number(), updatedAt: z.number(),
  dateChanges: z.array(z.object({ at: z.number(), from: z.string(), to: z.string() })).max(1000),
  completionQuality: z.enum(['not_fluent', 'partial', 'mastered', 'retest_tomorrow']).optional(),
  reviewNotes: z.string().max(20000), mistakeReason: z.string().max(20000),
  forgottenPoint: z.string().max(20000), nextAction: z.string().max(20000),
  knowledgePointId: z.string().max(100).optional(),
  linkedQuestionIds: z.array(z.string().max(200)).max(1000),
  linkedFlashcardIds: z.array(z.string().max(100)).max(1000),
})

export async function listKnowledge(db: D1Database, hash: string) {
  const rows = await db.prepare('SELECT body FROM knowledge_points WHERE token_hash = ? ORDER BY updated_at DESC LIMIT 5000').bind(hash).all<{ body: string }>()
  return rows.results.map(row => JSON.parse(row.body) as z.infer<typeof knowledgeSchema>)
}
export async function upsertKnowledge(db: D1Database, hash: string, nodes: z.infer<typeof knowledgeSchema>[]) {
  if (!nodes.length) return
  await db.batch(nodes.map(node => db.prepare(`INSERT INTO knowledge_points (token_hash,id,body,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(token_hash,id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at
    WHERE excluded.updated_at > knowledge_points.updated_at`).bind(hash, node.id, JSON.stringify(node), node.updatedAt)))
}
export async function listTaskHistory(db: D1Database, hash: string, limit = 2000, offset = 0) {
  const rows = await db.prepare('SELECT body FROM daily_task_history WHERE token_hash = ? ORDER BY day DESC, updated_at DESC LIMIT ? OFFSET ?').bind(hash, limit, offset).all<{ body: string }>()
  return rows.results.map(row => JSON.parse(row.body) as z.infer<typeof taskHistorySchema>)
}
export async function getTaskHistory(db: D1Database, hash: string, id: string) {
  const row = await db.prepare('SELECT body FROM daily_task_history WHERE token_hash = ? AND id = ?').bind(hash, id).first<{ body: string }>()
  return row ? JSON.parse(row.body) as z.infer<typeof taskHistorySchema> : null
}
export async function upsertTaskHistory(db: D1Database, hash: string, tasks: z.infer<typeof taskHistorySchema>[]) {
  if (!tasks.length) return
  await db.batch(tasks.map(task => db.prepare(`INSERT INTO daily_task_history (token_hash,id,body,updated_at,day) VALUES (?,?,?,?,?)
    ON CONFLICT(token_hash,id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at,day=excluded.day
    WHERE excluded.updated_at > daily_task_history.updated_at`).bind(hash, task.id, JSON.stringify(task), task.updatedAt, task.date)))
}
