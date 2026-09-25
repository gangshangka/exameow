<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeftIcon } from '@heroicons/vue/24/outline'
import { useFlashcardsStore } from '@/stores/flashcards'
import { useKnowledgeTreeStore } from '@/stores/knowledgeTree'
import KnowledgePicker from '@/components/knowledge/KnowledgePicker.vue'
import type { ReviewRating } from '@/utils/flashcardScheduler'

const router = useRouter()
const store = useFlashcardsStore()
const tree = useKnowledgeTreeStore()
const cards = computed(() => store.cards.filter(card => !card.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt))
const now = ref(Date.now())
const dueCards = computed(() => cards.value.filter(card => card.dueAt <= now.value).sort((a, b) => a.dueAt - b.dueAt))
const currentReview = computed(() => dueCards.value[0])
const revealed = ref(false)
const reviewedToday = computed(() => cards.value.reduce((sum, card) => sum + card.reviewHistory.filter(item => new Date(item.at).toDateString() === new Date(now.value).toDateString()).length, 0))
let clock: ReturnType<typeof setInterval> | undefined
const newFront = ref('')
const newBack = ref('')
const newKnowledgePointId = ref<string>()
const editing = ref<string | null>(null)
const front = ref('')
const back = ref('')

function add() {
  if (store.create(newFront.value, newBack.value, undefined, newKnowledgePointId.value)) { newFront.value = ''; newBack.value = '' }
}
function beginEdit(id: string) {
  const card = cards.value.find(item => item.id === id)
  if (!card) return
  editing.value = id
  front.value = card.front
  back.value = card.back
}
function saveEdit() {
  if (!editing.value) return
  store.update(editing.value, front.value, back.value)
  editing.value = null
}
function grade(rating: ReviewRating) {
  if (!currentReview.value) return
  store.review(currentReview.value.id, rating)
  revealed.value = false
  now.value = Date.now()
}
onMounted(() => { void store.syncRemote(); void tree.syncRemote(); clock = setInterval(() => { now.value = Date.now() }, 60000) })
onUnmounted(() => { if (clock) clearInterval(clock) })
</script>

<template>
  <div class="max-w-3xl mx-auto pb-8">
    <div class="flex items-center gap-2 mb-5">
      <button class="btn-icon" aria-label="返回" @click="router.push('/mine')"><ArrowLeftIcon class="w-5 h-5" /></button>
      <h1 class="text-display-sm">我的闪卡</h1>
    </div>
    <section class="card-outlined p-4 mb-4 space-y-3">
      <h2 class="font-semibold">今日复习 · 待复习 {{ dueCards.length }} 张 · 已复习 {{ reviewedToday }} 次</h2>
      <template v-if="currentReview">
        <div class="text-lg font-medium whitespace-pre-wrap select-text">{{ currentReview.front }}</div>
        <button v-if="!revealed" class="btn-tonal w-full" @click="revealed = true">显示答案</button>
        <template v-else>
          <div class="border-t pt-3 whitespace-pre-wrap select-text">{{ currentReview.back || '（这张卡尚无背面，可先编辑补充）' }}</div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button class="btn-outlined !h-10 text-sm" @click="grade('again')">忘了 · 10 分钟</button>
            <button class="btn-outlined !h-10 text-sm" @click="grade('hard')">困难 · 稍后</button>
            <button class="btn-tonal !h-10 text-sm" @click="grade('good')">记住了</button>
            <button class="btn-filled !h-10 text-sm" @click="grade('easy')">很熟</button>
          </div>
        </template>
      </template>
      <p v-else class="text-sm opacity-70">今天到期的闪卡已复习完。新卡会立即进入复习；复习间隔随你的反馈调整。</p>
    </section>
    <form class="card-outlined p-4 mb-4 space-y-2" @submit.prevent="add">
      <input v-model="newFront" class="input-outlined w-full" placeholder="闪卡正面" aria-label="闪卡正面" />
      <textarea v-model="newBack" class="input-outlined w-full" placeholder="闪卡背面（可稍后补充）" aria-label="闪卡背面" />
      <KnowledgePicker v-model="newKnowledgePointId" label="知识点" />
      <button type="submit" class="btn-tonal !h-9 text-sm">添加闪卡</button>
      <p v-if="store.storageError" class="text-sm text-red-600">{{ store.storageError }}</p>
      <p v-if="store.syncError" class="text-sm text-red-600">{{ store.syncError }}</p>
    </form>
    <p v-if="!cards.length" class="card-outlined p-5 text-sm">选中文字后点击“添加到闪卡”，或在这里手动创建。</p>
    <div v-for="card in cards" :key="card.id" class="card-outlined p-4 mb-3">
      <template v-if="editing === card.id">
        <input v-model="front" class="input-outlined w-full mb-2" aria-label="编辑闪卡正面" />
        <textarea v-model="back" class="input-outlined w-full mb-2" aria-label="编辑闪卡背面" />
        <div class="flex gap-2"><button class="btn-filled !h-9 text-sm" @click="saveEdit">保存</button><button class="btn-outlined !h-9 text-sm" @click="editing = null">取消</button></div>
      </template>
      <template v-else>
        <div class="font-semibold whitespace-pre-wrap">{{ card.front }}</div>
        <div class="text-sm whitespace-pre-wrap mt-2">{{ card.back || '（尚无背面内容）' }}</div>
        <div class="text-xs opacity-70 mt-2">下次复习：{{ new Date(card.dueAt).toLocaleString() }} · 已复习 {{ card.reviewHistory.length }} 次 · 遗忘 {{ card.lapseCount }} 次</div>
        <KnowledgePicker :model-value="card.knowledgePointId" label="知识点" @update:model-value="store.setKnowledgePoint(card.id, $event)" />
        <div class="flex gap-2 mt-3"><button class="btn-tonal !h-9 text-sm" @click="beginEdit(card.id)">编辑</button><button class="btn-outlined !h-9 text-sm" @click="store.remove(card.id)">删除</button></div>
      </template>
    </div>
  </div>
</template>
