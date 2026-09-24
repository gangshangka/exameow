<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri, isMacOS, isWindows, isLinux } from '@/utils/platform'
import { useI18nStore } from '@/stores/i18n'
import WindowControls from './WindowControls.vue'

const i18n = useI18nStore()
const isMac = isMacOS()
const showControls = isTauri() && (isWindows() || isLinux())

function onMouseDown(e: MouseEvent) {
  if (!isTauri()) return
  if (e.buttons !== 1) return
  const target = e.target as HTMLElement
  if (target.closest('button, a, input, select')) return
  const win = getCurrentWindow()
  if (e.detail === 2) {
    win.toggleMaximize()
  } else {
    win.startDragging()
  }
}
</script>

<template>
  <div
    class="sticky top-0 z-40 h-[38px] flex items-center select-none shrink-0"
    :class="isMac ? 'pl-[80px]' : 'pl-3'"
    :style="{ backgroundColor: 'rgb(var(--md-surface))' }"
    @mousedown="onMouseDown"
  >
    <router-link to="/practice" class="flex items-center gap-2 no-underline">
      <img src="/logo.svg" alt="Exameow" class="w-5 h-5 rounded-md shrink-0" />
      <span class="text-xs font-medium" :style="{ color: 'rgb(var(--md-on-surface-variant))' }">
        {{ i18n.t('appName') }}
      </span>
    </router-link>
    <div class="flex-1 h-full" />
    <WindowControls v-if="showControls" class="h-full" />
  </div>
</template>
