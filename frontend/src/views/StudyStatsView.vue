<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeftIcon } from '@heroicons/vue/24/outline'
import { useDailyTasksStore } from '@/stores/dailyTasks'
import { useAttemptStore } from '@/stores/attempts'
import { useFlashcardsStore } from '@/stores/flashcards'
import { dayKey, getDayActivity } from '@/utils/studyHeatmap'
import { getAndroidUsage, hasUsageAccess, openUsageAccessSettings, usageAvailable, type AppUsage } from '@/utils/androidUsage'

const router = useRouter()
const tasks = useDailyTasksStore()
const attempts = useAttemptStore()
const cards = useFlashcardsStore()
const selectedTask = ref('')
const selectedDay = ref('')
const titles = computed(() => [...new Set(tasks.tasks.map(task => task.title))].sort())
const days = computed(() => getDayActivity(tasks.tasks, attempts.records, cards.cards, 91, selectedTask.value || undefined))
const selected = computed(() => days.value.find(day => day.date === selectedDay.value) ?? days.value.at(-1))
const totals = computed(() => days.value.reduce((sum, day) => ({ minutes: sum.minutes + day.minutes,
  tasks: sum.tasks + day.completedTasks, questions: sum.questions + day.attemptedQuestions,
  reviews: sum.reviews + day.flashcardReviews }), { minutes: 0, tasks: 0, questions: 0, reviews: 0 }))
function intensity(day: typeof days.value[number]): number {
  const score = day.completedTasks * 2 + day.minutes / 30 + day.attemptedQuestions / 5 + day.flashcardReviews / 10
  return score <= 0 ? 0 : score < 2 ? 1 : score < 5 ? 2 : score < 10 ? 3 : 4
}
const shades = ['#e5e7eb', '#bbf7d0', '#86efac', '#4ade80', '#16a34a']

const supported = usageAvailable()
const access = ref(false)
const usage = ref<AppUsage[]>([])
const usageDays = ref(7)
const today = ref(dayKey(Date.now()))
const usageError = ref('')
const loading = ref(false)
const byApp = computed(() => {
  const entries = new Map<string, { packageName: string; label: string; minutes: number }>()
  for (const item of usage.value) {
    if (usageDays.value === 1 && item.date !== today.value) continue
    const current = entries.get(item.packageName) ?? { packageName: item.packageName, label: item.label, minutes: 0 }
    current.minutes += item.minutes
    entries.set(item.packageName, current)
  }
  return [...entries.values()].sort((a, b) => b.minutes - a.minutes)
})
async function refreshUsage() {
  if (!supported) return
  today.value = dayKey(Date.now())
  loading.value = true
  usageError.value = ''
  try {
    access.value = await hasUsageAccess()
    usage.value = access.value ? await getAndroidUsage(usageDays.value) : []
  } catch (error) { usageError.value = error instanceof Error ? error.message : '读取使用时长失败' }
  finally { loading.value = false }
}
onMounted(() => { void refreshUsage() })
</script>

<template>
  <div class="max-w-3xl mx-auto pb-8">
    <div class="flex items-center gap-2 mb-5"><button class="btn-icon" aria-label="返回" @click="router.push('/mine')"><ArrowLeftIcon class="w-5 h-5" /></button><h1 class="text-display-sm">学习统计</h1></div>
    <section class="card-outlined p-4 mb-4 space-y-3">
      <h2 class="font-semibold">近 13 周任务热力图</h2>
      <select v-model="selectedTask" class="input-outlined w-full" aria-label="选择任务"><option value="">全部任务和复习活动</option><option v-for="name in titles" :key="name" :value="name">{{ name }}</option></select>
      <div class="grid gap-1" style="grid-template-columns: repeat(7, minmax(16px, 1fr))">
        <button v-for="day in days" :key="day.date" class="aspect-square rounded-sm min-w-4" :style="{ backgroundColor: shades[intensity(day)], outline: selected?.date === day.date ? '2px solid #166534' : 'none' }" :title="`${day.date}：完成 ${day.completedTasks} 项，${day.minutes} 分钟`" :aria-label="`${day.date} 完成 ${day.completedTasks} 项任务`" @click="selectedDay = day.date" />
      </div>
      <p class="text-sm">{{ selected?.date }}：学习 {{ selected?.minutes }} 分钟 · 完成任务 {{ selected?.completedTasks }} 项<span v-if="!selectedTask"> · 做题 {{ selected?.attemptedQuestions }} 道 · 闪卡复习 {{ selected?.flashcardReviews }} 次</span></p>
      <p class="text-xs opacity-70">13 周累计：{{ totals.minutes }} 分钟 · {{ totals.tasks }} 项任务<span v-if="!selectedTask"> · {{ totals.questions }} 道题 · {{ totals.reviews }} 次闪卡复习</span></p>
    </section>
    <section class="card-outlined p-4 space-y-3">
      <h2 class="font-semibold">手机 App 使用时长</h2>
      <p v-if="!supported" class="text-sm opacity-70">此项仅在安卓 App 中可用。任务热力图在网页和电脑端也可查看。</p>
      <template v-else>
        <p class="text-xs opacity-70">需要在安卓设置中授予“使用情况访问权限”。数据仅在本机读取和展示，不同步到 MCP。</p>
        <button v-if="!access" class="btn-tonal !h-9 text-sm" @click="openUsageAccessSettings">打开授权设置</button>
        <div class="flex gap-2 items-center"><select v-model.number="usageDays" class="input-outlined" aria-label="统计天数" :disabled="loading" @change="refreshUsage"><option :value="1">今天</option><option :value="7">近 7 天（含今天）</option><option :value="30">近 30 天（含今天）</option></select><button class="btn-outlined !h-9 text-sm" :disabled="loading" @click="refreshUsage">{{ loading ? '读取中…' : '刷新使用时长' }}</button></div>
        <p v-if="access" class="text-sm">{{ usageDays === 1 ? `${today} 今天` : `近 ${usageDays} 天` }} · 合计 {{ Math.round(byApp.reduce((sum, app) => sum + app.minutes, 0)) }} 分钟</p>
        <p v-if="usageError" class="text-sm text-red-600">{{ usageError }}</p>
        <p v-if="access && !byApp.length" class="text-sm opacity-70">当前时间段没有可读取的 App 使用记录。</p>
        <div v-for="app in byApp" :key="app.packageName" class="flex items-center justify-between gap-3 border-b py-2 text-sm"><div class="min-w-0"><div class="truncate">{{ app.label }}</div><div class="text-xs opacity-60 truncate">{{ app.packageName }}</div></div><span class="shrink-0">{{ Math.round(app.minutes) }} 分钟</span></div>
      </template>
    </section>
  </div>
</template>
