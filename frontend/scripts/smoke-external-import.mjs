import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'

const values = new Map()
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value) },
  removeItem: key => { values.delete(key) },
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true } })
try {
  const { analyzeExcel, parseWithMapping } = await server.ssrLoadModule('/src/utils/importParser.ts')
  const { usePracticeStore } = await server.ssrLoadModule('/src/stores/practice.ts')
  const { useWrongQuestionsStore } = await server.ssrLoadModule('/src/stores/wrongQuestions.ts')
  setActivePinia(createPinia())
  const rows = [
    ['序号', '题目', '题型', '分数', '答案', '解析', '选项A', '选项B', '选项C', '选项D', '选项E', '选项F'],
    [12, '<span>1 &quot;+&quot; 1 等于？</span>', '单选题', 2, 'B ', '<strong>答案是 &quot;2&quot;</strong>', '1', '<u>2</u>', '', '', '', ''],
    [13, '无答案题', '单选题', 2, ' ', '跳过', '1', '2', '', '', '', ''],
  ]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), '错题')
  const buffer = XLSX.write(book, { bookType: 'xlsx', type: 'array' })
  const analysis = analyzeExcel(buffer)
  assert.equal(analysis?.adapterId, 'external-wrong')
  const questions = parseWithMapping(analysis, analysis.mapping, 'xlsx')
  assert.equal(questions.length, 1)
  assert.equal(questions[0].stem, '1 "+" 1 等于？')
  assert.equal(questions[0].analysis, '答案是 "2"')
  assert.deepEqual(questions[0].options, ['1', '2'])
  assert.equal(questions[0].answer, 'B')
  assert.equal(questions[0].sourceId, '12')

  const practice = usePracticeStore()
  await practice.importExcelFile(buffer, 'wrong.xlsx')
  practice.confirmImport({ subject: '普物', chapter: '基础', sourceName: '外部小程序错题' })
  assert.deepEqual(practice.lastImportResult, { total: 2, added: 1, duplicates: 0, failed: 1 })
  const bank = practice.banks[0]
  assert.equal(bank.source, 'external-wrong-import')
  assert.equal(bank.questions[0].externalWrongCount, 1)
  await practice.importExcelFile(buffer, 'wrong.xlsx')
  practice.confirmImport({ subject: '普物', chapter: '基础', sourceName: '外部小程序错题' })
  assert.deepEqual(practice.lastImportResult, { total: 2, added: 0, duplicates: 1, failed: 1 })
  assert.equal(practice.banks.length, 1)
  assert.equal(bank.questions[0].externalWrongCount, 2)
  assert.equal(useWrongQuestionsStore().getWrongEntry(bank.id, bank.questions[0].id)?.wrongCount, 2)
  console.log('External Excel import smoke test passed')
} finally {
  await server.close()
}
