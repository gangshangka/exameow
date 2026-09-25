const base = process.env.MCP_BASE_URL || 'http://127.0.0.1:8787'
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const device = await fetch(`${base}/api/daily-tasks/device`, { method: 'POST' }).then(r => r.json())
assert(device.token?.length === 64, 'device token')
const endpoint = `${base}/mcp/${device.token}`
let nextId = 1
async function mcp(method, params) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  })
  const raw = await response.text()
  assert(response.ok, `${method} HTTP ${response.status}: ${raw}`)
  const data = raw.startsWith('event:') ? raw.split('\n').find(line => line.startsWith('data: '))?.slice(6) : raw
  return JSON.parse(data)
}
const list = await mcp('tools/list', {})
assert(list.result?.tools?.some(tool => tool.name === 'assign_daily_tasks'), 'task tool listed')
const capabilities = await fetch(`${base}/api/attempts/capabilities`).then(r => r.json())
assert(list.result?.tools?.some(tool => tool.name === 'get_attempt_image') === Boolean(capabilities.draftImageSync), 'image tool availability')
const task = await mcp('tools/call', { name: 'assign_daily_tasks', arguments: { tasks: [{ date: '2026-09-24', title: '复习函数', externalId: 'today-functions', plannedMinutes: 20 }] } })
assert(!task.error, `assign task: ${JSON.stringify(task)}`)
const assignments = await fetch(`${base}/api/daily-tasks/${device.token}`).then(r => r.json())
assert(assignments.tasks?.length === 1, 'task persisted')
await mcp('tools/call', { name: 'assign_daily_tasks', arguments: { tasks: [{ date: '2026-09-25', title: '复习函数第二轮', externalId: 'today-functions', plannedMinutes: 15 }] } })
const repeatedAssignments = await fetch(`${base}/api/daily-tasks/${device.token}`).then(r => r.json())
assert(repeatedAssignments.tasks?.length === 2, 'same external ID on another day keeps task history')
const node = { id: 'smoke-knowledge', parentId: null, name: '普通物理', createdAt: Date.now(), updatedAt: Date.now() }
const knowledgeSync = await fetch(`${base}/api/knowledge/${device.token}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes: [node] }) })
assert(knowledgeSync.ok, `knowledge sync ${knowledgeSync.status}`)
const knowledge = await mcp('tools/call', { name: 'list_knowledge_points', arguments: {} })
assert(JSON.parse(knowledge.result.content[0].text).some(item => item.id === node.id), 'knowledge MCP read')
const createdKnowledge = await mcp('tools/call', { name: 'create_knowledge_point', arguments: { name: '电磁学', parentId: node.id } })
assert(JSON.parse(createdKnowledge.result.content[0].text).parentId === node.id, 'knowledge MCP create')
const history = {
  id: 'smoke-history', date: '2026-09-24', initialDate: '2026-09-23', title: '复习函数', description: '', source: 'mcp',
  status: 'paused', elapsedMs: 120000, timeSegments: [{ startedAt: 1000, endedAt: 121000, reason: 'pause' }],
  createdAt: 1000, updatedAt: Date.now(), dateChanges: [{ at: 500, from: '2026-09-23', to: '2026-09-24' }],
  completionQuality: 'not_fluent', reviewNotes: '', mistakeReason: '漏一级标题', forgottenPoint: '儿童世纪', nextAction: '先默写标题',
  knowledgePointId: node.id, linkedQuestionIds: [], linkedFlashcardIds: [],
  feedback: [{ id: 'smoke-feedback', type: 'request_adjust', text: '请缩短到十分钟', createdAt: Date.now() }],
}
const historySync = await fetch(`${base}/api/task-history/${device.token}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: [history] }) })
assert(historySync.ok, `history sync ${historySync.status}`)
const historyResult = await mcp('tools/call', { name: 'get_task_history', arguments: { id: history.id } })
assert(JSON.parse(historyResult.result.content[0].text).mistakeReason === '漏一级标题', 'history MCP read')
const pendingFeedback = await mcp('tools/call', { name: 'list_pending_task_feedback', arguments: {} })
assert(JSON.parse(pendingFeedback.result.content[0].text).some(item => item.feedback.id === 'smoke-feedback'), 'feedback MCP read')
const adjusted = await mcp('tools/call', { name: 'update_daily_task', arguments: { id: history.id, plannedMinutes: 10, feedbackId: 'smoke-feedback', reply: '已缩短' } })
assert(JSON.parse(adjusted.result.content[0].text).plannedMinutes === 10, 'task MCP adjust')
const cancelled = await mcp('tools/call', { name: 'cancel_daily_task', arguments: { id: history.id, reason: '计划重排' } })
assert(JSON.parse(cancelled.result.content[0].text).status === 'cancelled', 'task MCP cancel')
const flashcard = await mcp('tools/call', { name: 'create_flashcard', arguments: { front: '动能公式', back: 'E=mv²/2' } })
assert(!flashcard.error, 'flashcard create')
const cardId = JSON.parse(flashcard.result.content[0].text).id
const updated = await mcp('tools/call', { name: 'update_flashcard', arguments: { id: cardId, back: 'E_k=mv²/2' } })
assert(!updated.error, 'flashcard update')
const cards = await mcp('tools/call', { name: 'list_flashcards', arguments: {} })
assert(JSON.parse(cards.result.content[0].text).some(card => card.id === cardId && card.back === 'E_k=mv²/2'), 'flashcard read')
const deletedCard = await mcp('tools/call', { name: 'delete_flashcard', arguments: { id: cardId } })
assert(!deletedCard.error, 'flashcard delete')
const cardsAfterDelete = await mcp('tools/call', { name: 'list_flashcards', arguments: {} })
assert(!JSON.parse(cardsAfterDelete.result.content[0].text).some(card => card.id === cardId), 'flashcard hidden after delete')
const attempt = {
  id: 'smoke-attempt', bankId: 'bank', questionId: 'q1', sessionQuestionId: 'q1-s0',
  startedAt: Date.now(), updatedAt: Date.now(), finalAnswer: 'B', isCorrect: false,
  answerChanges: [{ at: Date.now(), from: null, to: 'B' }], notes: [{ id: 'note1', type: 'text', text: '卡在公式', createdAt: Date.now() }],
  tags: ['公式忘了'], attachments: [{ id: 'smoke-image', type: 'draft_image', storageKey: 'smoke-image', createdAt: Date.now(), mimeType: 'image/png' }],
  questionSnapshot: { id: 'q1-s0', type: 'single_choice', stem: '1+1?', options: ['1', '2'], answer: 'B', analysis: '加法' },
}
const sync = await fetch(`${base}/api/attempts/${device.token}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attempts: [attempt] }) })
assert(sync.ok, `attempt sync ${sync.status}`)
const attemptResult = await mcp('tools/call', { name: 'get_attempt', arguments: { id: 'smoke-attempt', includeNotes: true, includeAnswerChanges: true, includeDraftImages: true } })
assert(JSON.parse(attemptResult.result.content[0].text).notes[0].text === '卡在公式', 'attempt read')
if (capabilities.draftImageSync) {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a4cAAAAASUVORK5CYII='), char => char.charCodeAt(0))
  const imagePut = await fetch(`${base}/api/attempts/${device.token}/smoke-attempt/images/smoke-image`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png })
  assert(imagePut.ok, `image upload ${imagePut.status}`)
  const imageResult = await mcp('tools/call', { name: 'get_attempt_image', arguments: { attemptId: 'smoke-attempt', attachmentId: 'smoke-image' } })
  assert(imageResult.result?.content?.[0]?.type === 'image', 'MCP image content')
}
const revoke = await fetch(`${base}/api/daily-tasks/${device.token}/device`, { method: 'DELETE' })
assert(revoke.ok, 'device revoked')
const denied = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' }) })
assert(denied.status === 401, 'revoked MCP URL rejected')
console.log(`MCP smoke test passed: task assignment, flashcard CRUD, attempt read, draft image ${capabilities.draftImageSync ? 'read' : 'disabled'}, revocation`)
