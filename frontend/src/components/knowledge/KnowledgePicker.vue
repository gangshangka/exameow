<script setup lang="ts">
import { useKnowledgeTreeStore } from '@/stores/knowledgeTree'

defineProps<{ modelValue?: string | null; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>()
const tree = useKnowledgeTreeStore()
</script>

<template>
  <label class="block text-sm">
    <span v-if="label" class="block mb-1">{{ label }}</span>
    <select class="input-outlined w-full" :value="modelValue ?? ''" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value || undefined)">
      <option value="">未绑定知识点</option>
      <option v-for="option in tree.options" :key="option.id" :value="option.id">{{ option.label }}</option>
    </select>
  </label>
</template>
