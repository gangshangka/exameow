<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeftIcon } from '@heroicons/vue/24/outline'
import { localDate, useDailyTasksStore } from '@/stores/dailyTasks'
import { useAttemptStore } from '@/stores/attempts'
import { useKnowledgeTreeStore } from '@/stores/knowledgeTree'
import KnowledgePicker from '@/components/knowledge/KnowledgePicker.vue'

const router = useRouter()
const store = useDailyTasksStore()
const attempts = useAttemptStore()
const tree = useKnowledgeTreeStore()
const date = ref(localDate())
const showHistory = ref(false)
const title = ref('')
const feedbackText = ref<Record<string, string>>({})
const now = ref(Date.now())
let interval: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  interval = setInterval(() => { now.value = Date.now() }, 1000)
  void store.syncAssignments()
  void attempts.syncToMcp()
  void tree.syncRemote()
})
onUnmounted(() => { if (interval) clearInterval(interval) })
const items = computed(() => (showHistory.value ? [...store.tasks] : store.tasks.filter(task => task.date === date.value))
  .sort((a, b) => showHistory.value ? b.date.localeCompare(a.date) || b.createdAt - a.createdAt : a.createdAt - b.createdAt))
const qualityLabels = { not_fluent: '完成但不熟', partial: '部分完成', mastered: '已掌握', retest_tomorrow: '需要明天再测' }
function updateText(id: string, field: 'reviewNotes' | 'mistakeReason' | 'forgottenPoint' | 'nextAction', event: Event) {
  store.updateReview(id, { [field]: (event.target as HTMLTextAreaElement).value })
}
function updateLinks(id: string, field: 'linkedQuestionIds' | 'linkedFlashcardIds', event: Event) {
  store.updateReview(id, { [field]: (event.target as HTMLInputElement).value.split(/[，,\s]+/).map(value => value.trim()).filter(Boolean) })
}

function format(ms: number) {
  const seconds = Math.floor(ms / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function add() {
  if (!title.value.trim()) return
  store.assignTasks([{ date: date.value, title: title.value }], 'manual')
  title.value = ''
}
function sendFeedback(id: string, type: 'comment' | 'request_cancel' | 'request_adjust') {
  const text = feedbackText.value[id] ?? ''
  if (!text.trim()) return
  store.addFeedback(id, type, text)
  feedbackText.value[id] = ''
}

const copied = ref(false)
const confirmRevoke = ref(false)
async function copyMcpUrl() {
  if (!store.mcpUrl) return
  try {
    await navigator.clipboard.writeText(store.mcpUrl)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { copied.value = false }
}
async function connect() {
  await store.createConnection()
  if (store.deviceToken) { void store.syncHistory(); void tree.syncRemote() }
}
</script>

<template>
  <div class="max-w-3xl mx-auto pb-8">
    <div class="flex items-center gap-2 mb-5">
      <button class="btn-icon" aria-label="返回" @click="router.push('/mine')"><ArrowLeftIcon class="w-5 h-5" /></button>
      <h1 class="text-display-sm">每日任务</h1>
    </div>
    <div class="card-outlined p-4 mb-4 space-y-2">
      <h2 class="font-semibold">ChatGPT MCP 派发</h2>
      <p class="text-sm">创建此设备的专属 MCP 地址，在 ChatGPT 自定义插件中填写该地址。请将地址当作密码保管；持有它的人可以派发任务、读写闪卡，并读取已同步的作答记录。</p>
      <button v-if="!store.deviceToken" type="button" class="btn-tonal !h-9 text-sm" @click="connect">生成 MCP 地址</button>
      <template v-else>
        <input class="input-outlined w-full text-xs" readonly :value="store.mcpUrl ?? ''" aria-label="MCP 地址" @focus="($event.target as HTMLInputElement).select()" />
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-tonal !h-9 text-sm" @click="copyMcpUrl">{{ copied ? '已复制' : '复制地址' }}</button>
          <button type="button" class="btn-outlined !h-9 text-sm" :disabled="store.syncing" @click="store.syncAssignments">{{ store.syncing ? '同步中…' : '同步 AI 任务' }}</button>
          <button v-if="!confirmRevoke" type="button" class="btn-outlined !h-9 text-sm" @click="confirmRevoke = true">撤销 MCP 地址</button>
          <button v-else type="button" class="btn-outlined !h-9 text-sm" @click="store.revokeConnection(); confirmRevoke = false">确认撤销并删除云端数据</button>
        </div>
      </template>
      <p v-if="store.syncError" class="text-sm text-red-600">{{ store.syncError }}</p>
      <label v-if="store.deviceToken" class="flex gap-2 items-start text-sm">
        <input type="checkbox" class="mt-1" :checked="attempts.syncEnabled" @change="attempts.setSyncEnabled(($event.target as HTMLInputElement).checked)" />
        <span>同步作答记录供 AI 查看（包含备注、答案修改和草稿图片）</span>
      </label>
      <button v-if="store.deviceToken && attempts.syncEnabled" type="button" class="btn-outlined !h-9 text-sm" :disabled="attempts.syncing" @click="attempts.syncToMcp">{{ attempts.syncing ? '作答记录同步中…' : '同步作答记录' }}</button>
      <p v-if="attempts.syncError" class="text-sm text-red-600">{{ attempts.syncError }}</p>
    </div>
    <div class="card-outlined p-4 mb-4 space-y-3">
      <div class="flex gap-2">
        <button type="button" :class="showHistory ? 'btn-outlined' : 'btn-tonal'" @click="showHistory = false">按日期</button>
        <button type="button" :class="showHistory ? 'btn-tonal' : 'btn-outlined'" @click="showHistory = true">完整历史</button>
      </div>
      <label v-if="!showHistory" class="block text-sm" for="task-date">日期</label>
      <input v-if="!showHistory" id="task-date" v-model="date" type="date" class="input-outlined" />
      <form class="flex gap-2" @submit.prevent="add">
        <input v-model="title" class="input-outlined flex-1" placeholder="添加一项任务" aria-label="任务名称" />
        <button class="btn-tonal" type="submit">添加</button>
      </form>
      <p v-if="store.storageError" class="text-sm text-red-600">{{ store.storageError }}</p>
    </div>
    <div v-if="!items.length" class="card-outlined p-5 text-sm opacity-70">暂无任务记录。</div>
    <div v-for="task in items" :key="task.id" class="card-outlined p-4 mb-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="font-semibold break-words">{{ task.title }}</div>
          <div v-if="showHistory" class="text-xs opacity-70 mt-1">{{ task.date }} · {{ task.status === 'done' ? '已完成' : task.status === 'cancelled' ? '已取消' : task.status === 'running' ? '进行中' : '未完成' }}</div>
          <div v-if="task.description" class="text-sm whitespace-pre-wrap mt-1">{{ task.description }}</div>
          <div class="text-xs opacity-70 mt-1">{{ task.source === 'mcp' ? 'AI 派发' : '手动添加' }}<span v-if="task.plannedMinutes"> · 计划 {{ task.plannedMinutes }} 分钟</span><span v-if="task.dateChanges.length"> · 改期 {{ task.dateChanges.length }} 次</span></div>
          <div v-if="task.knowledgePointId" class="text-xs mt-1">{{ tree.getPath(task.knowledgePointId) }}</div>
        </div>
        <div class="font-mono tabular-nums shrink-0">{{ format(store.elapsed(task, now)) }}</div>
      </div>
      <div class="flex gap-2 mt-3">
        <button v-if="task.status === 'pending' || task.status === 'paused'" class="btn-tonal !h-9 text-sm" @click="store.start(task.id)">{{ task.status === 'paused' ? '继续' : '开始计时' }}</button>
        <button v-if="task.status === 'running'" class="btn-outlined !h-9 text-sm" @click="store.pause(task.id)">暂停</button>
        <button v-if="task.status !== 'done' && task.status !== 'cancelled'" class="btn-filled !h-9 text-sm" @click="store.complete(task.id)">完成</button>
        <span v-else class="text-sm">{{ task.status === 'cancelled' ? '已取消' : '已完成' }}</span>
      </div>
      <details v-if="task.timeSegments.length" class="text-xs mt-3">
        <summary class="cursor-pointer">计时与暂停记录（{{ task.timeSegments.length }} 段）</summary>
        <div v-for="(segment, index) in task.timeSegments" :key="index" class="mt-1">
          {{ new Date(segment.startedAt).toLocaleString() }} → {{ new Date(segment.endedAt).toLocaleString() }} · {{ segment.reason === 'pause' ? '暂停' : '完成' }}
        </div>
      </details>
      <details v-if="task.source === 'mcp'" class="mt-3 text-sm">
        <summary class="cursor-pointer">给 AI 留言{{ task.feedback?.some(item => !item.handledAt) ? ' · 待处理' : '' }}</summary>
        <div class="space-y-2 mt-3">
          <textarea v-if="task.status !== 'cancelled'" v-model="feedbackText[task.id]" maxlength="2000" class="input-outlined w-full min-h-20" placeholder="说明为什么想取消或怎样调整任务" />
          <div v-if="task.status !== 'cancelled'" class="flex flex-wrap gap-2">
            <button class="btn-tonal !h-9 text-sm" :disabled="!feedbackText[task.id]?.trim()" @click="sendFeedback(task.id, 'comment')">发送备注</button>
            <button class="btn-outlined !h-9 text-sm" :disabled="!feedbackText[task.id]?.trim()" @click="sendFeedback(task.id, 'request_adjust')">请求调整</button>
            <button class="btn-outlined !h-9 text-sm" :disabled="!feedbackText[task.id]?.trim()" @click="sendFeedback(task.id, 'request_cancel')">请求取消</button>
          </div>
          <p v-if="task.status === 'cancelled'" class="text-xs">AI 已取消：{{ task.cancellationReason || '未填写原因' }}</p>
          <div v-for="item in [...(task.feedback ?? [])].reverse()" :key="item.id" class="p-2 rounded-lg bg-[rgb(var(--md-surface-container-low))] text-xs">
            <div>{{ item.type === 'request_cancel' ? '请求取消' : item.type === 'request_adjust' ? '请求调整' : '备注' }} · {{ new Date(item.createdAt).toLocaleString() }} · {{ item.handledAt ? '已处理' : '待 AI 处理' }}</div>
            <div class="whitespace-pre-wrap mt-1">{{ item.text }}</div>
            <div v-if="item.aiReply" class="mt-1">AI 回复：{{ item.aiReply }}</div>
          </div>
        </div>
      </details>
      <details class="mt-3 text-sm">
        <summary class="cursor-pointer">复盘与知识点{{ task.completionQuality ? ` · ${qualityLabels[task.completionQuality]}` : '' }}</summary>
        <div class="space-y-3 mt-3">
          <KnowledgePicker :model-value="task.knowledgePointId" label="知识点" @update:model-value="store.updateReview(task.id, { knowledgePointId: $event })" />
          <label class="block">完成质量
            <select class="input-outlined w-full mt-1" :value="task.completionQuality ?? ''" @change="store.updateReview(task.id, { completionQuality: (($event.target as HTMLSelectElement).value || undefined) as typeof task.completionQuality })">
              <option value="">未评价</option><option v-for="(label, value) in qualityLabels" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label v-for="field in ([['mistakeReason','错因'],['forgottenPoint','遗忘点'],['nextAction','下次处理方式'],['reviewNotes','其他复盘'] ] as const)" :key="field[0]" class="block">{{ field[1] }}
            <textarea class="input-outlined w-full mt-1 min-h-20" :value="task[field[0]]" placeholder="自动保存" @input="updateText(task.id, field[0], $event)" />
          </label>
          <label class="block">关联题目 ID（逗号分隔）<input class="input-outlined w-full mt-1" :value="task.linkedQuestionIds.join(', ')" @change="updateLinks(task.id, 'linkedQuestionIds', $event)" /></label>
          <label class="block">关联闪卡 ID（逗号分隔）<input class="input-outlined w-full mt-1" :value="task.linkedFlashcardIds.join(', ')" @change="updateLinks(task.id, 'linkedFlashcardIds', $event)" /></label>
          <label v-if="task.status !== 'done'" class="block">改期<input type="date" class="input-outlined w-full mt-1" :value="task.date" @change="store.reschedule(task.id, ($event.target as HTMLInputElement).value)" /></label>
          <div v-if="task.dateChanges.length" class="text-xs opacity-70">原计划 {{ task.initialDate }} · 改期 {{ task.dateChanges.length }} 次</div>
        </div>
      </details>
    </div>
  </div>
</template>
