<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useAttemptStore } from '@/stores/attempts'
import { getDraftImage } from '@/utils/attemptAttachments'

const props = defineProps<{ attemptId: string }>()
const store = useAttemptStore()
const attempt = computed(() => store.getAttempt(props.attemptId))
const tags = ['不会做', '思路不确定', '公式忘了', '建模困难', '方向/符号不确定', '计算乱了', '看不懂题', '时间太长']
const expanded = ref(false)
const recording = ref(false)
const speechMessage = ref('')
const imageError = ref('')
const imageUrls = ref<Record<string, string>>({})
const selectedImage = ref<string | null>(null)
const galleryInput = ref<HTMLInputElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)

interface SpeechResult { results: ArrayLike<ArrayLike<{ transcript: string }>> }
interface SpeechRecognizer {
  lang: string; onresult: ((event: SpeechResult) => void) | null
  onerror: (() => void) | null; onend: (() => void) | null
  start(): void; stop(): void
}
type SpeechConstructor = new () => SpeechRecognizer
const speechWindow = window as Window & { SpeechRecognition?: SpeechConstructor; webkitSpeechRecognition?: SpeechConstructor }
const recognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
let recognizer: SpeechRecognizer | null = null

watch(() => props.attemptId, () => {
  expanded.value = false
  recognizer?.stop()
})

watch(() => attempt.value?.attachments.map(item => item.storageKey).join('|'), async () => {
  const previous = imageUrls.value
  const next: Record<string, string> = {}
  for (const attachment of attempt.value?.attachments ?? []) {
    const existing = previous[attachment.id]
    if (existing) next[attachment.id] = existing
    else {
      try {
        const blob = await getDraftImage(attachment.storageKey)
        if (blob) next[attachment.id] = URL.createObjectURL(blob)
      } catch { imageError.value = '草稿图片暂时无法读取' }
    }
  }
  for (const [id, url] of Object.entries(previous)) if (!next[id]) URL.revokeObjectURL(url)
  imageUrls.value = next
}, { immediate: true })

onBeforeUnmount(() => {
  recognizer?.stop()
  Object.values(imageUrls.value).forEach(url => URL.revokeObjectURL(url))
})

function startSpeech() {
  if (!recognitionCtor || recording.value) return
  speechMessage.value = ''
  try {
    recognizer = new recognitionCtor()
    recognizer.lang = 'zh-CN'
    recognizer.onresult = event => {
      const text = Array.from(event.results).map(result => result[0]?.transcript ?? '').join(' ').trim()
      if (text) store.addSpeechNote(props.attemptId, text)
    }
    recognizer.onerror = () => { speechMessage.value = '语音识别失败，可使用键盘语音输入' }
    recognizer.onend = () => { recording.value = false; recognizer = null }
    recognizer.start()
    recording.value = true
  } catch { speechMessage.value = '无法启动语音识别，可使用键盘语音输入'; recording.value = false }
}

function toggleSpeech() {
  if (recording.value) recognizer?.stop()
  else startSpeech()
}

async function addFiles(event: Event) {
  const input = event.target as HTMLInputElement
  imageError.value = ''
  for (const file of Array.from(input.files ?? [])) {
    try { await store.addAttachment(props.attemptId, file) }
    catch (error) { imageError.value = error instanceof Error ? error.message : '草稿保存失败' }
  }
  input.value = ''
}

async function removeImage(id: string) {
  try { await store.removeAttachment(props.attemptId, id) }
  catch { imageError.value = '草稿删除失败，请重试' }
}
</script>

<template>
  <section v-if="attempt" class="card-outlined p-3 sm:p-4" @touchstart.stop>
    <button type="button" class="w-full flex items-center justify-between text-left min-h-9" :aria-expanded="expanded" @click="expanded = !expanded">
      <span class="font-medium">📝 我的过程</span><span class="text-sm">{{ expanded ? '收起' : '展开' }}</span>
    </button>
    <div v-if="expanded" class="space-y-4 pt-3">
      <div>
        <label class="block text-sm mb-1" :for="`attempt-note-${attemptId}`">过程备注</label>
        <textarea :id="`attempt-note-${attemptId}`" class="input-outlined w-full min-h-24 select-text" :value="attempt.notes.find(note => note.type === 'text')?.text ?? ''" placeholder="想到什么就记下来，可留空" @input="store.setTextNote(attemptId, ($event.target as HTMLTextAreaElement).value)" />
      </div>
      <div>
        <button type="button" class="btn-tonal !h-9 text-sm" :disabled="!recognitionCtor" @click="toggleSpeech">🎙️ {{ recording ? '停止语音' : '语音输入' }}</button>
        <p v-if="!recognitionCtor" class="text-xs mt-1">当前设备暂不支持应用内语音识别，可点击文本框使用系统键盘语音输入。</p>
        <p v-if="speechMessage" class="text-xs mt-1">{{ speechMessage }}</p>
        <div v-for="note in attempt.notes.filter(item => item.type === 'speech')" :key="note.id" class="text-sm mt-2 p-2 rounded-xl bg-[rgb(var(--md-surface-container-low))]">🎙️ {{ note.text }}</div>
      </div>
      <div>
        <input ref="galleryInput" class="hidden" type="file" accept="image/*" multiple @change="addFiles" />
        <input ref="cameraInput" class="hidden" type="file" accept="image/*" capture="environment" @change="addFiles" />
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-tonal !h-9 text-sm" @click="galleryInput?.click()">🖼️ 添加草稿</button>
          <button type="button" class="btn-outlined !h-9 text-sm" @click="cameraInput?.click()">📷 拍照</button>
        </div>
        <p v-if="imageError || store.storageError" class="text-xs mt-1 text-red-600">{{ imageError || store.storageError }}</p>
        <div v-if="attempt.attachments.length" class="flex flex-wrap gap-2 mt-2">
          <div v-for="image in attempt.attachments" :key="image.id" class="relative">
            <button v-if="imageUrls[image.id]" type="button" @click="selectedImage = imageUrls[image.id]!">
              <img :src="imageUrls[image.id]" alt="草稿缩略图，点击查看大图" class="w-20 h-20 object-cover rounded-lg" />
            </button>
            <button type="button" class="absolute -top-1 -right-1 rounded-full bg-[rgb(var(--md-error))] text-white w-6 h-6" aria-label="删除草稿" @click="removeImage(image.id)">×</button>
          </div>
        </div>
      </div>
      <div>
        <div class="text-sm mb-2">卡点标签</div>
        <div class="flex flex-wrap gap-2">
          <button v-for="tag in tags" :key="tag" type="button" class="px-3 py-1.5 rounded-full border text-xs" :aria-pressed="attempt.tags.includes(tag)" :style="attempt.tags.includes(tag) ? { backgroundColor: 'rgb(var(--md-primary-container))', color: 'rgb(var(--md-on-primary-container))' } : {}" @click="store.toggleTag(attemptId, tag)">{{ tag }}</button>
        </div>
      </div>
    </div>
    <div v-if="selectedImage" class="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" @click="selectedImage = null">
      <button type="button" class="absolute top-4 right-4 text-white text-3xl" aria-label="关闭大图">×</button>
      <img :src="selectedImage" alt="草稿大图" class="max-w-full max-h-full object-contain" />
    </div>
  </section>
</template>
