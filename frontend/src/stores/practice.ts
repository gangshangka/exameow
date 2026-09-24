import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { QuestionBank, PracticeSession, PracticeMode, MockExamConfig, Question, PracticeFilter } from '@exameow/shared'
import { analyzeCSV, analyzeExcel, parseWithMapping } from '@/utils/importParser'
import type { ColumnMapping, ImportAnalysis } from '@/utils/importParser'
import { usePracticeHistoryStore } from '@/stores/practiceHistory'
import { useAttemptStore } from '@/stores/attempts'
import { matchPracticeFilter, reconcileMockConfig } from '@/utils/practiceFilter'

const STORAGE_KEY = 'exameow-banks'
const SESSION_KEY = 'exameow-practice-session'

function loadBanks(): QuestionBank[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const data: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(data)) return []
    return data.filter((bank): bank is QuestionBank =>
      bank && typeof bank.id === 'string' && typeof bank.name === 'string' && Array.isArray(bank.questions)
    ).map(bank => ({
      ...bank,
      questions: bank.questions.filter(question => question && typeof question.id === 'string'
        && typeof question.type === 'string' && typeof question.stem === 'string'
        && typeof question.answer === 'string' && Array.isArray(question.options))
        .map(question => ({ ...question, analysis: typeof question.analysis === 'string' ? question.analysis : '' })),
    }))
  } catch {
    return []
  }
}

function saveBanks(banks: QuestionBank[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(banks))
  } catch {}
}

function loadSession(): PracticeSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    const data: unknown = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return null
    const session = data as Partial<PracticeSession>
    if (typeof session.bankId !== 'string' || !Array.isArray(session.questions)
      || typeof session.currentIndex !== 'number' || !Number.isInteger(session.currentIndex)
      || session.currentIndex < 0 || session.currentIndex >= session.questions.length
      || typeof session.startedAt !== 'number') return null
    if (!session.questions.every(item => item && item.question && typeof item.question.id === 'string'
      && typeof item.question.type === 'string' && typeof item.question.stem === 'string'
      && typeof item.question.answer === 'string'
      && Array.isArray(item.question.options))) return null
    return {
      ...session,
      mode: session.mode ?? 'sequential',
      finishedAt: session.finishedAt ?? null,
      questions: session.questions.map(item => ({
        ...item,
        question: { ...item.question, analysis: typeof item.question.analysis === 'string' ? item.question.analysis : '' },
        userAnswer: typeof item.userAnswer === 'string' ? item.userAnswer : null,
        isCorrect: typeof item.isCorrect === 'boolean' ? item.isCorrect : null,
        submitted: item.submitted === true,
        attemptId: typeof item.attemptId === 'string' ? item.attemptId : undefined,
      })),
    } as PracticeSession
  } catch {
    return null
  }
}

function saveSession(session: PracticeSession | null) {
  try {
    if (session && session.mode === 'wrong') return
    if (session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    } else {
      localStorage.removeItem(SESSION_KEY)
    }
  } catch {}
}

function generateId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i]!, a[j]!] = [a[j]!, a[i]!]
  }
  return a
}

function shuffleOptions(questions: Question[]): Question[] {
  return questions.map(q => {
    if (q.type === 'single_choice' || q.type === 'multi_choice') {
      const indices = q.options.map((_, i) => i)
      const shuffled = shuffleArray(indices)
      const newOptions = shuffled.map(i => q.options[i] ?? '')
      const answerMap: Record<string, number> = {}
      q.options.forEach((opt, i) => { answerMap[String.fromCharCode(65 + i)] = i })
      const newAnswer = q.answer
        .toUpperCase()
        .split('')
        .filter(ch => /[A-H]/.test(ch))
        .map(ch => {
          const oldIdx = answerMap[ch]
          if (oldIdx !== undefined) {
            const newIdx = shuffled.indexOf(oldIdx)
            return newIdx >= 0 ? String.fromCharCode(65 + newIdx) : ch
          }
          return ch
        })
        .sort()
        .join('')
      return { ...q, options: newOptions, answer: newAnswer }
    }
    return q
  })
}

function applyPracticeFilter(questions: Question[], filter?: PracticeFilter): Question[] {
  if (!filter) return questions
  const subjects = filter.subjects?.filter(Boolean)
  const chapters = filter.chapters?.filter(Boolean)
  const difficulties = filter.difficulties?.filter(Boolean)
  const types = filter.types?.filter(Boolean)
  if ((filter.difficulties !== undefined && difficulties?.length === 0)
    || (filter.types !== undefined && types?.length === 0)) return []
  if (!subjects?.length && !chapters?.length && !filter.includeUnchaptered && !difficulties?.length && !types?.length) return questions
  return questions.filter(q => matchPracticeFilter(q, filter))
}

function generateMockQuestions(bank: QuestionBank, config: MockExamConfig): Question[] {
  const selected: Question[] = []
  for (const [qtype, count] of Object.entries(config.typeCounts)) {
    if (count <= 0) continue
    const pool = bank.questions.filter(q => q.type === qtype)
    const shuffled = shuffleArray(pool)
    selected.push(...shuffled.slice(0, count))
  }
  return shuffleArray(selected)
}

export const usePracticeStore = defineStore('practice', () => {
  const banks = ref<QuestionBank[]>(loadBanks())
  const session = ref<PracticeSession | null>(loadSession())
  const importing = ref(false)
  const importPreview = ref<Question[] | null>(null)
  const importFileName = ref('')
  const importAnalysis = ref<ImportAnalysis | null>(null)
  const importSource = ref('csv')

  const hasSession = computed(() => session.value !== null)
  const currentQuestion = computed(() => {
    if (!session.value) return null
    return session.value.questions[session.value.currentIndex] ?? null
  })
  const progress = computed(() => {
    if (!session.value) return { current: 0, total: 0 }
    return { current: session.value.currentIndex + 1, total: session.value.questions.length }
  })
  const isLastQuestion = computed(() => {
    if (!session.value) return false
    return session.value.currentIndex >= session.value.questions.length - 1
  })
  const isFirstQuestion = computed(() => {
    if (!session.value) return false
    return session.value.currentIndex === 0
  })
  const answeredCount = computed(() => {
    if (!session.value) return 0
    return session.value.questions.filter(q => q.userAnswer !== null).length
  })
  const hasUnanswered = computed(() => {
    if (!session.value) return false
    return session.value.questions.some(q => q.userAnswer === null)
  })
  const score = computed(() => {
    if (!session.value) return 0
    const autoGraded = session.value.questions.filter(q => q.isCorrect !== null && q.isCorrect)
    return autoGraded.length
  })
  const autoGradedCount = computed(() => {
    if (!session.value) return 0
    return session.value.questions.filter(q => q.isCorrect !== null).length
  })

  function ensureCurrentAttempt(): string | null {
    if (!session.value) return null
    const item = session.value.questions[session.value.currentIndex]
    if (!item) return null
    const attempts = useAttemptStore()
    if (item.attemptId && attempts.getAttempt(item.attemptId)) return item.attemptId
    const bank = getBank(session.value.bankId)
    const original = bank?.questions.find(q => `${q.id}-s${session.value!.currentIndex}` === item.question.id)
    const questionId = original?.id ?? item.question.id.replace(/-s\d+$/, '')
    const attempt = attempts.createAttempt(session.value.bankId, questionId, item.question.id, item.question)
    if (item.userAnswer !== null) attempt.answerChanges.push({ at: Date.now(), from: null, to: item.userAnswer })
    if (item.submitted) attempts.submit(attempt.id, item.userAnswer, item.isCorrect)
    item.attemptId = attempt.id
    saveSession(session.value)
    return attempt.id
  }

  function addBank(bank: QuestionBank) {
    banks.value.push(bank)
    saveBanks(banks.value)
  }

  function removeBank(id: string) {
    banks.value = banks.value.filter(b => b.id !== id)
    saveBanks(banks.value)
  }

  function getBank(id: string): QuestionBank | undefined {
    return banks.value.find(b => b.id === id)
  }

  function saveGeneratedAsBank(questions: Question[], sourceName: string) {
    if (questions.length === 0) return
    const today = new Date()
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const bank: QuestionBank = {
      id: generateId(),
      name: `AI 出题 - ${dateStr} (${sourceName || '题库'})`,
      questions,
      createdAt: today.getTime(),
      source: 'ai-generated',
    }
    addBank(bank)
  }

  function startSession(bankId: string, mode: PracticeMode, mockConfig?: MockExamConfig, customQuestions?: Question[], filter?: PracticeFilter): boolean {
    const bank = getBank(bankId)
    if (!bank) return false

    const baseQuestions = customQuestions ?? applyPracticeFilter(bank.questions, filter)
    const normalizedMockConfig = mockConfig
      ? reconcileMockConfig(mockConfig, baseQuestions)
      : undefined
    let questions: Question[]
    if (customQuestions) {
      questions = customQuestions
    } else if (mode === 'mock' && normalizedMockConfig) {
      questions = generateMockQuestions({ ...bank, questions: baseQuestions }, normalizedMockConfig)
    } else if (mode === 'sequential') {
      questions = [...baseQuestions]
    } else {
      questions = shuffleArray([...baseQuestions])
    }

    if (mode === 'random') {
      questions = shuffleOptions(questions)
    }

    if (questions.length === 0) return false

    const sessionQuestions = questions.map((q, i) => ({
      question: { ...q, id: `${q.id}-s${i}` },
      userAnswer: null as string | null,
      isCorrect: null as boolean | null,
      submitted: false,
    }))

    session.value = {
      bankId,
      mode,
      questions: sessionQuestions,
      currentIndex: 0,
      startedAt: Date.now(),
      finishedAt: null,
      mockConfig: mode === 'mock' ? normalizedMockConfig : undefined,
      filter: mode === 'wrong' ? undefined : filter,
    }
    saveSession(session.value)
    ensureCurrentAttempt()
    return true
  }

  const currentSubmitted = computed(() => {
    if (!session.value) return false
    const item = session.value.questions[session.value.currentIndex]
    return item ? item.submitted === true : false
  })

  function setAnswer(answer: string | null) {
    if (!session.value) return
    const item = session.value.questions[session.value.currentIndex]
    if (!item) return
    const attemptId = ensureCurrentAttempt()
    if (attemptId) useAttemptStore().recordAnswerChange(attemptId, item.userAnswer, answer)
    item.userAnswer = answer
    saveSession(session.value)
  }

  function normalizeTF(ans: string): string {
    const t = ans.trim().toUpperCase()
    if (['A', '√', '对', '正确', 'TRUE', 'T', '是', 'YES', 'Y', '1'].some(v => t === v.toUpperCase() || t.includes(v))) return 'TRUE'
    if (['B', '×', '错', '错误', 'FALSE', 'F', '否', 'NO', 'N', '0'].some(v => t === v.toUpperCase() || t.includes(v))) return 'FALSE'
    if (t === 'TRUE' || t.includes('TRUE') || t.includes('对') || t.includes('正确')) return 'TRUE'
    if (t === 'FALSE' || t.includes('FALSE') || t.includes('错') || t.includes('错误')) return 'FALSE'
    return t
  }

  function submitAnswer(answer: string | null): boolean | null {
    if (!session.value) return null
    const item = session.value.questions[session.value.currentIndex]
    if (!item) return null
    const attemptId = ensureCurrentAttempt()
    if (attemptId) useAttemptStore().recordAnswerChange(attemptId, item.userAnswer, answer)
    item.userAnswer = answer
    item.submitted = true

    const q = item.question
    if (q.type === 'single_choice' || q.type === 'multi_choice') {
      const userAns = (answer ?? '').trim().toUpperCase().replace(/[^A-H]/g, '').split('').sort().join('')
      const correctAns = q.answer.trim().toUpperCase().replace(/[^A-H]/g, '').split('').sort().join('')
      item.isCorrect = userAns === correctAns
    } else if (q.type === 'true_false') {
      const userAns = normalizeTF(answer ?? '')
      const correctAns = normalizeTF(q.answer)
      item.isCorrect = userAns === correctAns
    } else if (q.type === 'fill_blank') {
      const userAns = (answer ?? '').trim().toLowerCase()
      const correctAns = q.answer.trim().toLowerCase()
      item.isCorrect = userAns !== '' && userAns === correctAns
    }

    if (attemptId) useAttemptStore().submit(attemptId, answer, item.isCorrect)
    usePracticeHistoryStore().record(q.type, item.isCorrect)
    saveSession(session.value)
    return item.isCorrect
  }

  function selfCheck(isCorrect: boolean) {
    if (!session.value) return
    const item = session.value.questions[session.value.currentIndex]
    if (!item) return
    const attemptId = ensureCurrentAttempt()
    item.isCorrect = isCorrect
    item.submitted = true
    if (attemptId) useAttemptStore().submit(attemptId, item.userAnswer, isCorrect)
    usePracticeHistoryStore().record(item.question.type, isCorrect)
    saveSession(session.value)
  }

  function saveAiAnalysis(questionId: string, text: string) {
    const originalId = questionId.replace(/-s\d+$/, '')
    const bank = session.value ? getBank(session.value.bankId) : undefined
    const original = bank?.questions.find(q => q.id === originalId)
    if (original) {
      original.aiAnalysis = text
      saveBanks(banks.value)
    }
    if (session.value) {
      for (const item of session.value.questions) {
        if (item.question.id.replace(/-s\d+$/, '') === originalId) {
          item.question.aiAnalysis = text
        }
      }
      saveSession(session.value)
    }
  }

  function setQuestionKnowledgePoint(bankId: string, questionId: string, knowledgePointId?: string) {
    const originalId = questionId.replace(/-s\d+$/, '')
    const original = getBank(bankId)?.questions.find(q => q.id === originalId)
    if (original) { original.knowledgePointId = knowledgePointId; saveBanks(banks.value) }
    if (session.value?.bankId === bankId) {
      for (const item of session.value.questions) if (item.question.id.replace(/-s\d+$/, '') === originalId) item.question.knowledgePointId = knowledgePointId
      saveSession(session.value)
    }
  }

  function nextQuestion() {
    if (!session.value) return
    if (session.value.currentIndex < session.value.questions.length - 1) {
      session.value.currentIndex++
      saveSession(session.value)
      ensureCurrentAttempt()
    }
  }

  function prevQuestion() {
    if (!session.value) return
    if (session.value.currentIndex > 0) {
      session.value.currentIndex--
      saveSession(session.value)
      ensureCurrentAttempt()
    }
  }

  function goToQuestion(index: number) {
    if (!session.value) return
    if (index >= 0 && index < session.value.questions.length) {
      session.value.currentIndex = index
      saveSession(session.value)
      ensureCurrentAttempt()
    }
  }

  function finishSession() {
    if (!session.value) return
    session.value.finishedAt = Date.now()
    saveSession(session.value)
  }

  function removeCurrentQuestion() {
    if (!session.value) return
    const idx = session.value.currentIndex
    session.value.questions.splice(idx, 1)
    if (session.value.questions.length === 0) {
      session.value.finishedAt = Date.now()
      saveSession(session.value)
      return true
    }
    if (idx >= session.value.questions.length) {
      session.value.currentIndex = session.value.questions.length - 1
    }
    saveSession(session.value)
    ensureCurrentAttempt()
    return false
  }

  function clearSession() {
    session.value = null
    saveSession(null)
  }

  function getElapsedTime(): number {
    if (!session.value) return 0
    const end = session.value.finishedAt ?? Date.now()
    return Math.floor((end - session.value.startedAt) / 1000)
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    if (m > 0) {
      return `${m}m ${s}s`
    }
    return `${s}s`
  }

  function handleAnalysis(analysis: ImportAnalysis | null, fileName: string, source: string): number {
    importFileName.value = fileName
    importSource.value = source
    if (!analysis) {
      importAnalysis.value = null
      importPreview.value = []
      return 0
    }
    if (analysis.missing.length > 0) {
      importAnalysis.value = analysis
      importPreview.value = null
      return 0
    }
    importAnalysis.value = null
    const questions = parseWithMapping(analysis, analysis.mapping, source)
    importPreview.value = questions
    return questions.length
  }

  async function importCSV(text: string, fileName: string): Promise<number> {
    importing.value = true
    try {
      return handleAnalysis(analyzeCSV(text), fileName, 'csv')
    } finally {
      importing.value = false
    }
  }

  async function importExcelFile(buffer: ArrayBuffer, fileName: string): Promise<number> {
    importing.value = true
    try {
      const source = fileName.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'excel'
      return handleAnalysis(analyzeExcel(buffer), fileName, source)
    } finally {
      importing.value = false
    }
  }

  function applyImportMapping(mapping: ColumnMapping): number {
    if (!importAnalysis.value) return 0
    const questions = parseWithMapping(importAnalysis.value, mapping, importSource.value)
    importPreview.value = questions
    importAnalysis.value = null
    return questions.length
  }

  function confirmImport(): string {
    if (!importPreview.value || importPreview.value.length === 0) return ''
    const source = importSource.value === 'csv' ? 'csv-import' as const : 'xlsx-import' as const
    const nameBase = importFileName.value.replace(/\.[^/.]+$/, '')
    const bank: QuestionBank = {
      id: generateId(),
      name: nameBase || `Imported bank ${new Date().toLocaleDateString()}`,
      questions: [...importPreview.value],
      createdAt: Date.now(),
      source,
    }
    addBank(bank)
    importPreview.value = null
    importFileName.value = ''
    importAnalysis.value = null
    return bank.id
  }

  function cancelImport() {
    importPreview.value = null
    importFileName.value = ''
    importAnalysis.value = null
  }

  return {
    banks,
    session,
    importing,
    importPreview,
    importFileName,
    hasSession,
    currentQuestion,
    progress,
    isLastQuestion,
    isFirstQuestion,
    answeredCount,
    hasUnanswered,
    currentSubmitted,
    ensureCurrentAttempt,
    score,
    autoGradedCount,
    addBank,
    removeBank,
    getBank,
    saveGeneratedAsBank,
    startSession,
    setAnswer,
    submitAnswer,
    selfCheck,
    saveAiAnalysis,
    setQuestionKnowledgePoint,
    nextQuestion,
    prevQuestion,
    goToQuestion,
    finishSession,
    removeCurrentQuestion,
    clearSession,
    getElapsedTime,
    formatTime,
    importCSV,
    importExcelFile,
    applyImportMapping,
    importAnalysis,
    confirmImport,
    cancelImport,
  }
})
