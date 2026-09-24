<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useFlashcardsStore } from '@/stores/flashcards'

const store = useFlashcardsStore()
const text = ref('')
const sourceQuestionId = ref<string | undefined>()
const position = ref({ top: 0, left: 0 })
let timer: ReturnType<typeof setTimeout> | undefined

function updateSelection() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    const selection = window.getSelection()
    const selected = selection?.toString().trim() ?? ''
    const anchor = selection?.anchorNode?.parentElement
    if (!selected || selected.length > 1000 || !selection?.rangeCount
      || anchor?.closest('input,textarea,[contenteditable="true"],button')) { text.value = ''; return }
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (!rect.width && !rect.height) { text.value = ''; return }
    text.value = selected
    sourceQuestionId.value = anchor?.closest('[data-question-id]')?.getAttribute('data-question-id') ?? undefined
    position.value = {
      top: Math.max(8, Math.min(window.innerHeight - 52, rect.bottom + 8)),
      left: Math.max(8, Math.min(window.innerWidth - 130, rect.left)),
    }
  }, 180)
}

function add() {
  store.create(text.value, '', sourceQuestionId.value)
  window.getSelection()?.removeAllRanges()
  text.value = ''
}

onMounted(() => document.addEventListener('selectionchange', updateSelection))
onUnmounted(() => { document.removeEventListener('selectionchange', updateSelection); if (timer) clearTimeout(timer) })
</script>

<template>
  <button v-if="text" type="button" class="fixed z-50 px-3 h-10 rounded-full shadow-lg text-sm font-medium" :style="{ top: `${position.top}px`, left: `${position.left}px`, backgroundColor: 'rgb(var(--md-primary))', color: 'rgb(var(--md-on-primary))' }" @pointerdown.prevent @click="add">添加到闪卡</button>
</template>
