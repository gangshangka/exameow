import assert from 'node:assert/strict'
import { nextReview } from '../src/utils/flashcardScheduler.ts'
import { getDayActivity } from '../src/utils/studyHeatmap.ts'

const now = new Date(2026, 8, 25, 12).getTime()
const start = { dueAt: now, intervalDays: 0, easeFactor: 2.5, repetitions: 0, lapseCount: 0 }
const good = nextReview(start, 'good', now)
assert.equal(good.intervalDays, 1)
assert.equal(nextReview(good, 'good', now).intervalDays, 3)
assert.equal(nextReview(start, 'again', now).dueAt, now + 600000)
assert.equal(nextReview(good, 'again', now).lapseCount, 1)
assert.equal(nextReview(start, 'easy', now).intervalDays, 3)

const date = '2026-09-25'
const activity = getDayActivity([
  { date, title: '普物', status: 'done', completedAt: now, elapsedMs: 3600000 },
  { date, title: '英语', status: 'done', completedAt: now, elapsedMs: 1800000 },
], [{ submittedAt: now }], [{ reviewHistory: [{ at: now }] }], 1, undefined, now)[0]
assert.deepEqual(activity, { date, minutes: 90, completedTasks: 2, attemptedQuestions: 1, flashcardReviews: 1 })
assert.equal(getDayActivity([{ date, title: '普物', status: 'done', completedAt: now, elapsedMs: 3600000 }], [], [], 1, '普物', now)[0].minutes, 60)
console.log('Study loop smoke test passed')
