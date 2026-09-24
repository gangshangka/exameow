<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18nStore } from '@/stores/i18n'
import { usePracticeHistoryStore } from '@/stores/practiceHistory'
import AttemptHistory from '@/components/practice/AttemptHistory.vue'
import { ArrowLeftIcon, FireIcon, CheckCircleIcon, CalendarDaysIcon, Squares2X2Icon } from '@heroicons/vue/24/outline'

const router = useRouter()
const i18n = useI18nStore()
const history = usePracticeHistoryStore()

const isDark = ref(document.documentElement.classList.contains('dark'))
let observer: MutationObserver | null = null
onMounted(() => {
  observer = new MutationObserver(() => {
    isDark.value = document.documentElement.classList.contains('dark')
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})
onUnmounted(() => observer?.disconnect())

const LIGHT_LEVELS = ['rgba(var(--md-surface-container-highest))', '#9be9a8', '#40c463', '#30a14e', '#216e39']
const DARK_LEVELS = ['rgba(var(--md-surface-container-highest))', '#0e4429', '#006d32', '#26a641', '#39d353']

function level(count: number): number {
  if (count <= 0) return 0
  if (count < 10) return 1
  if (count < 25) return 2
  if (count < 50) return 3
  return 4
}

function cellColor(count: number): string {
  return (isDark.value ? DARK_LEVELS : LIGHT_LEVELS)[level(count)]!
}

interface DayCell {
  key: string
  count: number
}

const weeks = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(today)
  end.setDate(end.getDate() + (6 - end.getDay()))
  const start = new Date(end)
  start.setDate(start.getDate() - 52 * 7 + 1)
  const cols: DayCell[][] = []
  const cursor = new Date(start)
  while (cursor <= end) {
    const week: DayCell[] = []
    for (let d = 0; d < 7; d++) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      week.push({ key, count: history.days[key]?.total ?? 0 })
      cursor.setDate(cursor.getDate() + 1)
    }
    cols.push(week)
  }
  return cols
})

const monthLabels = computed(() => {
  const labels: { col: number; text: string }[] = []
  let lastMonth = -1
  weeks.value.forEach((week, i) => {
    const m = new Date(week[0]!.key + 'T00:00:00').getMonth()
    if (m !== lastMonth) {
      labels.push({
        col: i,
        text: new Date(week[0]!.key + 'T00:00:00').toLocaleString(i18n.locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'short' }),
      })
      lastMonth = m
    }
  })
  return labels
})

const stats = computed(() => {
  let total = 0
  let correct = 0
  let activeDays = 0
  const byType: Record<string, { total: number; correct: number }> = {}
  for (const day of Object.values(history.days)) {
    total += day.total
    correct += day.correct
    if (day.total > 0) activeDays++
    for (const [t, v] of Object.entries(day.byType)) {
      if (!byType[t]) byType[t] = { total: 0, correct: 0 }
      byType[t]!.total += v.total
      byType[t]!.correct += v.correct
    }
  }
  return { total, correct, activeDays, byType }
})

const todayStats = computed(() => {
  const day = history.days[history.todayKey()]
  const total = day?.total ?? 0
  const correct = day?.correct ?? 0
  return { total, correct, accuracy: total > 0 ? Math.round((correct / total) * 100) : 0 }
})

const streak = computed(() => {
  let n = 0
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const countOf = (d: Date) => history.days[keyOf(d)]?.total ?? 0
  if (countOf(cursor) === 0) cursor.setDate(cursor.getDate() - 1)
  while (countOf(cursor) > 0) {
    n++
    cursor.setDate(cursor.getDate() - 1)
  }
  return n
})

const GAUGE_R = 54
const GAUGE_C = 2 * Math.PI * GAUGE_R
const gaugeOffset = computed(() => GAUGE_C * (1 - todayStats.value.accuracy / 100))
const overallAccuracy = computed(() => (stats.value.total > 0 ? Math.round((stats.value.correct / stats.value.total) * 100) : 0))

const TREND_DAYS = 30
const trendMode = ref<'count' | 'accuracy'>('count')

const trendPoints = computed(() => {
  const out: { label: string; value: number | null }[] = []
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  cursor.setDate(cursor.getDate() - TREND_DAYS + 1)
  for (let i = 0; i < TREND_DAYS; i++) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    const day = history.days[key]
    out.push({
      label: `${cursor.getMonth() + 1}/${cursor.getDate()}`,
      value:
        trendMode.value === 'count'
          ? (day?.total ?? 0)
          : day && day.total > 0
            ? Math.round((day.correct / day.total) * 100)
            : null,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
})

const CHART_W = 600
const CHART_H = 160
const CHART_PAD_X = 8
const CHART_PAD_TOP = 16
const CHART_PAD_BOTTOM = 24

const trendMax = computed(() => {
  if (trendMode.value === 'accuracy') return 100
  const m = Math.max(...trendPoints.value.map((p) => p.value ?? 0), 0)
  return m > 0 ? Math.ceil(m * 1.15) : 10
})

function pointXY(i: number, v: number): [number, number] {
  const x = CHART_PAD_X + (i * (CHART_W - 2 * CHART_PAD_X)) / (TREND_DAYS - 1)
  const y = CHART_PAD_TOP + (1 - v / trendMax.value) * (CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM)
  return [x, y]
}

function smoothSegments(values: (number | null)[]): string[] {
  const pts = values.map((v, i) => (v === null ? null : pointXY(i, v)))
  const segments: string[] = []
  let run: [number, number][] = []
  const flush = () => {
    if (run.length === 1) {
      segments.push(`M ${run[0]![0]} ${run[0]![1]} L ${run[0]![0] + 0.01} ${run[0]![1]}`)
    } else if (run.length > 1) {
      let d = `M ${run[0]![0]} ${run[0]![1]}`
      for (let i = 0; i < run.length - 1; i++) {
        const p0 = run[Math.max(0, i - 1)]!
        const p1 = run[i]!
        const p2 = run[i + 1]!
        const p3 = run[Math.min(run.length - 1, i + 2)]!
        const c1x = p1[0] + (p2[0] - p0[0]) / 6
        const c1y = p1[1] + (p2[1] - p0[1]) / 6
        const c2x = p2[0] - (p3[0] - p1[0]) / 6
        const c2y = p2[1] - (p3[1] - p1[1]) / 6
        d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`
      }
      segments.push(d)
    }
    run = []
  }
  for (const p of pts) {
    if (p === null) flush()
    else run.push(p)
  }
  flush()
  return segments
}

const trendLinePaths = computed(() => smoothSegments(trendPoints.value.map((p) => p.value)))

const trendAreaPath = computed(() => {
  if (trendMode.value !== 'count') return ''
  const lines = trendLinePaths.value
  if (lines.length === 0) return ''
  const base = CHART_H - CHART_PAD_BOTTOM
  return lines
    .map((d) => `${d} L ${CHART_W - CHART_PAD_X} ${base} L ${CHART_PAD_X} ${base} Z`)
    .join(' ')
})

const trendDots = computed(() =>
  trendPoints.value
    .map((p, i) => (p.value === null ? null : { x: pointXY(i, p.value)[0], y: pointXY(i, p.value)[1], label: p.label, value: p.value }))
    .filter((d): d is NonNullable<typeof d> => d !== null),
)

const trendAxisLabels = computed(() => {
  const pts = trendPoints.value
  return [pts[0]!, pts[Math.floor((TREND_DAYS - 1) / 2)]!, pts[TREND_DAYS - 1]!].map((p, i) => ({
    text: p.label,
    x: [CHART_PAD_X, CHART_W / 2, CHART_W - CHART_PAD_X][i]!,
    anchor: (['start', 'middle', 'end'] as const)[i]!,
  }))
})
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-6">
      <button class="btn-icon" @click="router.push('/mine')">
        <ArrowLeftIcon class="w-5 h-5" />
      </button>
      <h1 class="text-display-sm">{{ i18n.t('mineRecords') }}</h1>
    </div>

    <!-- Heatmap -->
    <div class="card-outlined p-4 sm:p-5 mb-4 overflow-x-auto">
      <div class="inline-block min-w-full">
        <div class="relative h-5 mb-1 text-[11px]" style="color: rgb(var(--md-on-surface-variant))">
          <span
            v-for="m in monthLabels"
            :key="m.col"
            class="absolute"
            :style="{ left: `calc(${m.col} * (12px + 3px))` }"
          >{{ m.text }}</span>
        </div>
        <div class="flex gap-[3px]">
          <div v-for="(week, wi) in weeks" :key="wi" class="flex flex-col gap-[3px]">
            <div
              v-for="day in week"
              :key="day.key"
              class="w-3 h-3 rounded-[3px] transition-colors"
              :style="{ backgroundColor: cellColor(day.count) }"
              :title="`${day.key} · ${i18n.t('recordsDayTooltip', { n: day.count })}`"
            />
          </div>
        </div>
        <div class="flex items-center justify-end gap-1 mt-2 text-[11px]" style="color: rgb(var(--md-on-surface-variant))">
          {{ i18n.t('recordsLess') }}
          <div
            v-for="l in 5"
            :key="l"
            class="w-3 h-3 rounded-[3px]"
            :style="{ backgroundColor: cellColor([0, 5, 15, 35, 60][l - 1]!) }"
          />
          {{ i18n.t('recordsMore') }}
        </div>
      </div>
    </div>

    <!-- Stat cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <div class="card-outlined p-4 text-center">
        <Squares2X2Icon class="w-6 h-6 mx-auto mb-1" style="color: rgb(var(--md-primary))" />
        <div class="text-title-md">{{ stats.total }}</div>
        <div class="text-label-sm" style="color: rgb(var(--md-on-surface-variant))">{{ i18n.t('recordsTotal') }}</div>
      </div>
      <div class="card-outlined p-4 text-center">
        <CheckCircleIcon class="w-6 h-6 mx-auto mb-1" style="color: rgb(var(--md-primary))" />
        <div class="text-title-md">{{ overallAccuracy }}%</div>
        <div class="text-label-sm" style="color: rgb(var(--md-on-surface-variant))">{{ i18n.t('recordsAccuracy') }}</div>
      </div>
      <div class="card-outlined p-4 text-center">
        <FireIcon class="w-6 h-6 mx-auto mb-1" style="color: #ff7043" />
        <div class="text-title-md">{{ streak }}</div>
        <div class="text-label-sm" style="color: rgb(var(--md-on-surface-variant))">{{ i18n.t('recordsStreak') }}</div>
      </div>
      <div class="card-outlined p-4 text-center">
        <CalendarDaysIcon class="w-6 h-6 mx-auto mb-1" style="color: rgb(var(--md-primary))" />
        <div class="text-title-md">{{ stats.activeDays }}</div>
        <div class="text-label-sm" style="color: rgb(var(--md-on-surface-variant))">{{ i18n.t('recordsActiveDays') }}</div>
      </div>
    </div>

    <!-- Charts -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="card-outlined p-5 flex flex-col items-center">
        <div class="text-label-sm mb-3 self-start" style="color: rgb(var(--md-on-surface-variant))">{{ i18n.t('recordsTodayAccuracy') }}</div>
        <div class="relative w-32 h-32">
          <svg viewBox="0 0 128 128" class="w-full h-full -rotate-90">
            <circle cx="64" cy="64" :r="GAUGE_R" fill="none" stroke-width="18" style="stroke: rgba(var(--md-primary) / 0.1)" />
            <circle
              cx="64"
              cy="64"
              :r="GAUGE_R"
              fill="none"
              stroke-width="18"
              stroke-linecap="round"
              style="stroke: rgb(var(--md-primary)); transition: stroke-dashoffset 0.8s ease"
              :stroke-dasharray="GAUGE_C"
              :stroke-dashoffset="gaugeOffset"
            />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-xl font-bold" style="color: rgb(var(--md-primary))">{{ todayStats.accuracy }}%</span>
            <span class="text-[11px]" style="color: rgb(var(--md-on-surface-variant))">{{ todayStats.correct }}/{{ todayStats.total }}</span>
          </div>
        </div>
      </div>

      <div class="card-outlined p-5">
        <div class="flex items-center justify-between mb-2">
          <div class="text-label-sm" style="color: rgb(var(--md-on-surface-variant))">{{ i18n.t('recordsTrend') }}</div>
          <div class="flex items-center p-0.5 rounded-full gap-0.5" style="background-color: rgb(var(--md-surface-container-high))">
            <button
              class="px-3 h-6 rounded-full text-[11px] font-medium transition-all"
              :style="trendMode === 'count'
                ? { backgroundColor: 'rgb(var(--md-secondary-container))', color: 'rgb(var(--md-on-secondary-container))' }
                : { color: 'rgb(var(--md-on-surface-variant))' }"
              @click="trendMode = 'count'"
            >{{ i18n.t('recordsTrendCount') }}</button>
            <button
              class="px-3 h-6 rounded-full text-[11px] font-medium transition-all"
              :style="trendMode === 'accuracy'
                ? { backgroundColor: 'rgb(var(--md-secondary-container))', color: 'rgb(var(--md-on-secondary-container))' }
                : { color: 'rgb(var(--md-on-surface-variant))' }"
              @click="trendMode = 'accuracy'"
            >{{ i18n.t('recordsTrendAccuracy') }}</button>
          </div>
        </div>
        <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" class="w-full">
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style="stop-color: rgb(var(--md-primary)); stop-opacity: 0.35" />
              <stop offset="100%" style="stop-color: rgb(var(--md-primary)); stop-opacity: 0.02" />
            </linearGradient>
          </defs>
          <line
            :x1="CHART_PAD_X"
            :x2="CHART_W - CHART_PAD_X"
            :y1="CHART_H - CHART_PAD_BOTTOM"
            :y2="CHART_H - CHART_PAD_BOTTOM"
            style="stroke: rgb(var(--md-outline-variant))"
            stroke-width="1"
            stroke-dasharray="3 4"
          />
          <path v-if="trendAreaPath" :d="trendAreaPath" fill="url(#trendFill)" />
          <path
            v-for="(d, i) in trendLinePaths"
            :key="i"
            :d="d"
            fill="none"
            style="stroke: rgb(var(--md-primary))"
            stroke-width="2.5"
            stroke-linecap="round"
          />
          <circle
            v-for="(dot, i) in trendDots"
            :key="i"
            :cx="dot.x"
            :cy="dot.y"
            r="2.5"
            style="fill: rgb(var(--md-primary))"
          >
            <title>{{ dot.label }} · {{ trendMode === 'accuracy' ? dot.value + '%' : dot.value }}</title>
          </circle>
          <text
            v-for="(label, i) in trendAxisLabels"
            :key="i"
            :x="label.x"
            :y="CHART_H - 6"
            :text-anchor="label.anchor"
            font-size="10"
            style="fill: rgb(var(--md-on-surface-variant))"
          >{{ label.text }}</text>
        </svg>
      </div>
    </div>
    <AttemptHistory />
  </div>
</template>
