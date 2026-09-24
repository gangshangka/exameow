<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AttemptRecord } from '@exameow/shared'
import { useAttemptStore } from '@/stores/attempts'
import { usePracticeStore } from '@/stores/practice'
import { getDraftImage } from '@/utils/attemptAttachments'

const attempts = useAttemptStore()
const practice = usePracticeStore()
const items = computed(() => attempts.getRecentAttempts(50))
const selected = ref<AttemptRecord | null>(null)
const images = ref<{ id: string; url: string }[]>([])
const largeImage = ref<string | null>(null)

function questionText(item: AttemptRecord): string {
  return item.questionSnapshot?.stem ?? practice.getBank(item.bankId)?.questions.find(question => question.id === item.questionId)?.stem ?? `题目 ${item.questionId}`
}

function duration(item: AttemptRecord): string {
  if (!item.submittedAt) return '未提交'
  const seconds = Math.max(0, Math.round((item.submittedAt - item.startedAt) / 1000))
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

watch(() => selected.value?.id, async () => {
  images.value.forEach(image => URL.revokeObjectURL(image.url))
  images.value = []
  if (!selected.value) return
  const id = selected.value.id
  for (const attachment of selected.value.attachments) {
    try {
      const blob = await getDraftImage(attachment.storageKey)
      if (blob && selected.value?.id === id) images.value.push({ id: attachment.id, url: URL.createObjectURL(blob) })
    } catch { /* Missing local image should not hide the attempt. */ }
  }
})
onBeforeUnmount(() => images.value.forEach(image => URL.revokeObjectURL(image.url)))
</script>

<template>
  <section class="card-outlined p-4 sm:p-5 mt-4">
    <h2 class="text-lg font-semibold mb-3">作答记录</h2>
    <p v-if="items.length === 0" class="text-sm opacity-70">还没有过程记录。开始做题后会显示在这里。</p>
    <div v-for="item in items" :key="item.id" class="border-t py-3" style="border-color: rgb(var(--md-outline-variant))">
      <button type="button" class="w-full text-left" @click="selected = selected?.id === item.id ? null : item">
        <div class="font-medium line-clamp-2">{{ questionText(item) }}</div>
        <div class="text-xs opacity-70 mt-1 flex flex-wrap gap-x-3 gap-y-1">
          <span>{{ new Date(item.startedAt).toLocaleString() }}</span>
          <span>{{ duration(item) }}</span>
          <span>答案：{{ item.finalAnswer ?? '—' }}</span>
          <span>{{ item.isCorrect === true ? '正确' : item.isCorrect === false ? '错误' : '未判定' }}</span>
          <span v-if="item.notes.some(note => note.text.trim())">有备注</span>
          <span v-if="item.attachments.length">{{ item.attachments.length }} 张草稿</span>
        </div>
        <div v-if="item.tags.length" class="text-xs mt-1">{{ item.tags.join(' · ') }}</div>
      </button>
      <div v-if="selected?.id === item.id" class="mt-3 p-3 rounded-xl text-sm space-y-2" style="background-color: rgb(var(--md-surface-container-low))">
        <div>开始：{{ new Date(item.startedAt).toLocaleString() }}</div>
        <div v-if="item.submittedAt">提交：{{ new Date(item.submittedAt).toLocaleString() }}</div>
        <div>最终答案：{{ item.finalAnswer ?? '未提交' }} · {{ item.isCorrect === true ? '正确' : item.isCorrect === false ? '错误' : '未判定' }}</div>
        <div v-if="item.questionSnapshot">参考答案：{{ item.questionSnapshot.answer }}</div>
        <div v-if="item.questionSnapshot?.analysis" class="whitespace-pre-wrap">解析：{{ item.questionSnapshot.analysis }}</div>
        <div v-for="(change, index) in item.answerChanges" :key="index">答案修改：{{ change.from ?? '空' }} → {{ change.to ?? '空' }} · {{ new Date(change.at).toLocaleTimeString() }}</div>
        <div v-for="note in item.notes.filter(note => note.text.trim())" :key="note.id" class="whitespace-pre-wrap">{{ note.type === 'speech' ? '🎙️ 语音' : '📝 备注' }}：{{ note.text }}</div>
        <div v-if="item.tags.length">卡点：{{ item.tags.join(' · ') }}</div>
        <div v-if="images.length" class="flex flex-wrap gap-2">
          <button v-for="image in images" :key="image.id" type="button" @click="largeImage = image.url"><img :src="image.url" alt="草稿缩略图" class="w-20 h-20 object-cover rounded-lg" /></button>
        </div>
      </div>
    </div>
    <p v-if="items.length === 50" class="text-xs opacity-70 mt-2">显示最近 50 次作答。</p>
    <div v-if="largeImage" class="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" @click="largeImage = null">
      <button type="button" class="absolute top-4 right-4 text-white text-3xl" aria-label="关闭大图">×</button>
      <img :src="largeImage" alt="草稿大图" class="max-w-full max-h-full object-contain" />
    </div>
  </section>
</template>
