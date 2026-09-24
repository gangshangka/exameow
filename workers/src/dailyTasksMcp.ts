import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { z } from 'zod'
import { createFlashcard, deleteFlashcard, listFlashcards, updateFlashcard } from './flashcards'
import { getAttempt, imageContent, listAttempts } from './attemptRecords'

const tokenPattern = /^[0-9a-f]{64}$/
const assignmentSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Local calendar date YYYY-MM-DD'),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(2000).optional(),
  externalId: z.string().trim().min(1).max(100).optional().describe('Stable ID to update this assignment without resetting its timer'),
  plannedMinutes: z.number().int().min(1).max(1440).optional(),
})

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function createDevice(db: D1Database): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  await db.prepare('INSERT INTO daily_task_devices (token_hash, created_at) VALUES (?, ?)')
    .bind(await hashToken(token), Date.now()).run()
  return token
}

export async function deviceHash(db: D1Database, token: string): Promise<string | null> {
  if (!tokenPattern.test(token)) return null
  const hash = await hashToken(token)
  const device = await db.prepare('SELECT token_hash FROM daily_task_devices WHERE token_hash = ?').bind(hash).first()
  return device ? hash : null
}

export async function listAssignments(db: D1Database, hash: string) {
  const result = await db.prepare('SELECT id, external_id AS externalId, day AS date, title, description, planned_minutes AS plannedMinutes, created_at AS createdAt, updated_at AS updatedAt FROM daily_task_assignments WHERE token_hash = ? ORDER BY day DESC, created_at ASC LIMIT 500')
    .bind(hash).all()
  return result.results
}

export async function handleDailyTasksMcp(request: Request, db: D1Database, images: R2Bucket | undefined, hash: string): Promise<Response> {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'exameow-daily-tasks', version: '1.0.0' }, {
      instructions: 'Use assign_daily_tasks when the user asks to plan or update Exameow daily tasks. Dates use YYYY-MM-DD in the user’s local timezone. Give each task a stable externalId to avoid duplicates. The user starts, pauses, and completes timers in Exameow.',
    })
    server.registerTool('assign_daily_tasks', {
      description: 'Assign one to thirty dated study tasks to this Exameow device. Updates with the same externalId keep timer progress.',
      inputSchema: z.object({ tasks: z.array(assignmentSchema).min(1).max(30) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ tasks }) => {
      const now = Date.now()
      const ids: string[] = []
      for (const task of tasks) {
        const existing = task.externalId
          ? await db.prepare('SELECT id FROM daily_task_assignments WHERE token_hash = ? AND external_id = ?')
            .bind(hash, task.externalId).first<{ id: string }>()
          : null
        const id = existing?.id ?? crypto.randomUUID()
        if (existing) {
          await db.prepare('UPDATE daily_task_assignments SET day = ?, title = ?, description = ?, planned_minutes = ?, updated_at = ? WHERE id = ? AND token_hash = ?')
            .bind(task.date, task.title, task.description ?? '', task.plannedMinutes ?? null, now, id, hash).run()
        } else {
          await db.prepare('INSERT INTO daily_task_assignments (id, token_hash, external_id, day, title, description, planned_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(id, hash, task.externalId ?? null, task.date, task.title, task.description ?? '', task.plannedMinutes ?? null, now, now).run()
        }
        ids.push(id)
      }
      return { content: [{ type: 'text', text: `已派发 ${ids.length} 项 Exameow 每日任务。打开应用的“每日任务”页面即可同步并计时。任务 ID：${ids.join(', ')}` }] }
    })
    server.registerTool('list_flashcards', {
      description: 'List this device’s flashcards, including front, back, and IDs for editing.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async () => {
      const cards = (await listFlashcards(db, hash)).filter(card => !card.deletedAt)
      return { content: [{ type: 'text', text: JSON.stringify(cards) }] }
    })
    server.registerTool('create_flashcard', {
      description: 'Create a flashcard on this Exameow device.',
      inputSchema: z.object({ front: z.string().trim().min(1).max(4000), back: z.string().max(8000).default(''), sourceQuestionId: z.string().max(200).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ front, back, sourceQuestionId }) => {
      const card = await createFlashcard(db, hash, front, back, sourceQuestionId)
      return { content: [{ type: 'text', text: JSON.stringify(card) }] }
    })
    server.registerTool('update_flashcard', {
      description: 'Edit the front or back of a flashcard by ID.',
      inputSchema: z.object({ id: z.string(), front: z.string().trim().min(1).max(4000).optional(), back: z.string().max(8000).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ id, front, back }) => ({
      content: [{ type: 'text', text: (await updateFlashcard(db, hash, id, front, back)) ? '闪卡已更新' : '未找到闪卡' }],
    }))
    server.registerTool('delete_flashcard', {
      description: 'Delete a flashcard by ID.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    }, async ({ id }) => ({
      content: [{ type: 'text', text: (await deleteFlashcard(db, hash, id)) ? '闪卡已删除' : '未找到闪卡' }],
    }))
    server.registerTool('list_attempts', {
      description: 'List this device’s practice attempts with date, answer, correctness, tags and counts. Paginate to inspect all records.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ limit, offset }) => ({
      content: [{ type: 'text', text: JSON.stringify(await listAttempts(db, hash, limit, offset)) }],
    }))
    server.registerTool('get_attempt', {
      description: 'Read one attempt. Choose whether to include detailed notes, answer changes and draft image metadata. Use get_attempt_image only when image pixels are needed.',
      inputSchema: z.object({ id: z.string(), includeNotes: z.boolean().default(false), includeAnswerChanges: z.boolean().default(false), includeDraftImages: z.boolean().default(false) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ id, includeNotes, includeAnswerChanges, includeDraftImages }) => {
      const attempt = await getAttempt(db, hash, id)
      if (!attempt) return { content: [{ type: 'text', text: '未找到作答记录' }], isError: true }
      return { content: [{ type: 'text', text: JSON.stringify({
        ...attempt,
        notes: includeNotes ? attempt.notes : undefined,
        answerChanges: includeAnswerChanges ? attempt.answerChanges : undefined,
        attachments: includeDraftImages ? attempt.attachments : undefined,
      }) }] }
    })
    if (images) server.registerTool('get_attempt_image', {
      description: 'Read a draft image from an attempt, only when visual inspection is needed.',
      inputSchema: z.object({ attemptId: z.string(), attachmentId: z.string() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ attemptId, attachmentId }) => {
      const attempt = await getAttempt(db, hash, attemptId)
      const attachment = attempt?.attachments.find(item => item.id === attachmentId)
      if (!attachment) return { content: [{ type: 'text', text: '未找到草稿图片' }], isError: true }
      const image = await imageContent(images, hash, attachment.storageKey)
      return image ? { content: [image] } : { content: [{ type: 'text', text: '图片尚未同步到服务器' }], isError: true }
    })
    return server
  })
  return handler.fetch(request)
}
