export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

export interface ReviewState {
  dueAt: number
  intervalDays: number
  easeFactor: number
  repetitions: number
  lapseCount: number
}

const DAY = 24 * 60 * 60 * 1000
export function nextReview(state: ReviewState, rating: ReviewRating, now = Date.now()): ReviewState {
  const ease = Number.isFinite(state.easeFactor) ? Math.max(1.3, state.easeFactor) : 2.5
  const previous = Number.isFinite(state.intervalDays) ? Math.max(0, state.intervalDays) : 0
  if (rating === 'again') return {
    dueAt: now + 10 * 60 * 1000, intervalDays: 0, easeFactor: Math.max(1.3, ease - 0.2),
    repetitions: 0, lapseCount: state.lapseCount + 1,
  }
  let days: number
  let nextEase = ease
  if (rating === 'hard') { days = previous ? Math.max(previous + 1, Math.round(previous * 1.2)) : 1; nextEase = Math.max(1.3, ease - 0.15) }
  else if (rating === 'easy') { days = state.repetitions === 0 ? 3 : state.repetitions === 1 ? 7 : Math.max(previous + 1, Math.round(previous * ease * 1.3)); nextEase = ease + 0.15 }
  else { days = state.repetitions === 0 ? 1 : state.repetitions === 1 ? 3 : Math.max(previous + 1, Math.round(previous * ease)) }
  return { dueAt: now + days * DAY, intervalDays: days, easeFactor: nextEase,
    repetitions: state.repetitions + 1, lapseCount: state.lapseCount }
}
