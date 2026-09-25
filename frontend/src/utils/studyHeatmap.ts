import type { DailyTask } from '@/stores/dailyTasks'
import type { Flashcard } from '@/stores/flashcards'
import type { AttemptRecord } from '@exameow/shared'

export interface DayActivity {
  date: string
  minutes: number
  completedTasks: number
  attemptedQuestions: number
  flashcardReviews: number
}

export function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function getDayActivity(tasks: DailyTask[], attempts: AttemptRecord[], cards: Flashcard[], days = 91, taskTitle?: string, now = Date.now()): DayActivity[] {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const result: DayActivity[] = []
  const byDate = new Map<string, DayActivity>()
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)
    const key = dayKey(date.getTime())
    const entry = { date: key, minutes: 0, completedTasks: 0, attemptedQuestions: 0, flashcardReviews: 0 }
    byDate.set(key, entry)
    result.push(entry)
  }
  for (const task of tasks) {
    if (taskTitle && task.title !== taskTitle) continue
    const activity = byDate.get(task.completedAt ? dayKey(task.completedAt) : task.date)
    if (!activity) continue
    activity.minutes += Math.round(task.elapsedMs / 60000)
    if (task.status === 'done') activity.completedTasks++
  }
  if (!taskTitle) {
    for (const attempt of attempts) if (attempt.submittedAt) {
      const activity = byDate.get(dayKey(attempt.submittedAt))
      if (activity) activity.attemptedQuestions++
    }
    for (const card of cards) if (!card.deletedAt) for (const review of card.reviewHistory) {
      const activity = byDate.get(dayKey(review.at))
      if (activity) activity.flashcardReviews++
    }
  }
  return result
}
