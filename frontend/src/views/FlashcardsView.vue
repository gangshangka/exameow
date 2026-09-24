<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeftIcon } from '@heroicons/vue/24/outline'
import { useFlashcardsStore } from '@/stores/flashcards'
import { useKnowledgeTreeStore } from '@/stores/knowledgeTree'
import KnowledgePicker from '@/components/knowledge/KnowledgePicker.vue'

const router = useRouter()
const store = useFlashcardsStore()
const tree = useKnowledgeTreeStore()
const cards = computed(() => store.cards.filter(card => !card.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt))
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
onMounted(() => { void store.syncRemote(); void tree.syncRemote() })
</script>

<template>
  <div class="max-w-3xl mx-auto pb-8">
    <div class="flex items-center gap-2 mb-5">
      <button class="btn-icon" aria-label="返回" @click="router.push('/mine')"><ArrowLeftIcon class="w-5 h-5" /></button>
      <h1 class="text-display-sm">我的闪卡</h1>
    </div>
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
        <KnowledgePicker :model-value="card.knowledgePointId" label="知识点" @update:model-value="store.setKnowledgePoint(card.id, $event)" />
        <div class="flex gap-2 mt-3"><button class="btn-tonal !h-9 text-sm" @click="beginEdit(card.id)">编辑</button><button class="btn-outlined !h-9 text-sm" @click="store.remove(card.id)">删除</button></div>
      </template>
    </div>
  </div>
</template>
