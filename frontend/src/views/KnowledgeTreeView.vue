<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeftIcon } from '@heroicons/vue/24/outline'
import { useKnowledgeTreeStore } from '@/stores/knowledgeTree'
import KnowledgePicker from '@/components/knowledge/KnowledgePicker.vue'

const router = useRouter()
const tree = useKnowledgeTreeStore()
const name = ref('')
const parentId = ref<string | undefined>()
const editing = ref<string | null>(null)
const editName = ref('')
const confirmingArchive = ref<string | null>(null)

function add() {
  if (tree.create(name.value, parentId.value ?? null)) name.value = ''
}
function beginEdit(id: string) {
  const node = tree.nodes.find(item => item.id === id)
  if (!node) return
  editing.value = id
  editName.value = node.name
}
function saveEdit() {
  if (editing.value) tree.rename(editing.value, editName.value)
  editing.value = null
}
onMounted(() => { void tree.syncRemote() })
</script>

<template>
  <div class="max-w-3xl mx-auto pb-8">
    <div class="flex items-center gap-2 mb-5">
      <button class="btn-icon" aria-label="返回" @click="router.push('/mine')"><ArrowLeftIcon class="w-5 h-5" /></button>
      <h1 class="text-display-sm">知识树</h1>
    </div>
    <p class="text-sm mb-4 opacity-75">从科目开始逐级添加章节、考点和子考点；层级可以继续细分。旧数据可以稍后绑定。</p>
    <form class="card-outlined p-4 mb-4 space-y-3" @submit.prevent="add">
      <KnowledgePicker v-model="parentId" label="上级知识点（留空则创建科目）" />
      <input v-model="name" class="input-outlined w-full" maxlength="120" placeholder="输入知识点名称" aria-label="知识点名称" />
      <button type="submit" class="btn-tonal !h-9 text-sm" :disabled="!name.trim()">添加知识点</button>
      <p v-if="tree.storageError || tree.syncError" class="text-sm text-red-600">{{ tree.storageError || tree.syncError }}</p>
    </form>
    <div class="flex items-center justify-between mb-2">
      <h2 class="font-semibold">已有知识点（{{ tree.activeNodes.length }}）</h2>
      <button class="btn-outlined !h-9 text-sm" :disabled="tree.syncing" @click="tree.syncRemote()">{{ tree.syncing ? '同步中…' : '同步' }}</button>
    </div>
    <p v-if="!tree.activeNodes.length" class="card-outlined p-4 text-sm">还没有知识点。可以先建立“333”或“普通物理”。</p>
    <div v-for="option in tree.options" :key="option.id" class="card-outlined p-3 mb-2" :style="{ marginLeft: `${Math.min(option.depth, 4) * 10}px` }">
      <template v-if="editing === option.id">
        <div class="flex gap-2"><input v-model="editName" class="input-outlined flex-1 min-w-0" maxlength="120" @keyup.enter="saveEdit" /><button class="btn-tonal !h-9 text-sm" @click="saveEdit">保存</button></div>
      </template>
      <template v-else>
        <div class="font-medium">{{ tree.nodes.find(node => node.id === option.id)?.name }}</div>
        <div class="text-xs opacity-70 break-words">{{ tree.getPath(option.id) }}</div>
        <div class="flex gap-2 mt-2">
          <button class="btn-outlined !h-8 text-xs" @click="beginEdit(option.id)">改名</button>
          <button v-if="confirmingArchive !== option.id" class="btn-outlined !h-8 text-xs" @click="confirmingArchive = option.id">归档</button>
          <button v-else class="btn-outlined !h-8 text-xs" @click="tree.archive(option.id); confirmingArchive = null">确认归档此分支</button>
        </div>
      </template>
    </div>
  </div>
</template>
