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
assert(list.result?.tools?.some(tool => tool.name === 'get_attempt_image'), 'image tool listed')
const task = await mcp('tools/call', { name: 'assign_daily_tasks', arguments: { tasks: [{ date: '2026-09-24', title: '复习函数', externalId: 'today-functions', plannedMinutes: 20 }] } })
assert(!task.error, `assign task: ${JSON.stringify(task)}`)
const assignments = await fetch(`${base}/api/daily-tasks/${device.token}`).then(r => r.json())
assert(assignments.tasks?.length === 1, 'task persisted')
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
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a4cAAAAASUVORK5CYII='), char => char.charCodeAt(0))
const imagePut = await fetch(`${base}/api/attempts/${device.token}/smoke-attempt/images/smoke-image`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png })
assert(imagePut.ok, `image upload ${imagePut.status}`)
const imageResult = await mcp('tools/call', { name: 'get_attempt_image', arguments: { attemptId: 'smoke-attempt', attachmentId: 'smoke-image' } })
assert(imageResult.result?.content?.[0]?.type === 'image', 'MCP image content')
const revoke = await fetch(`${base}/api/daily-tasks/${device.token}/device`, { method: 'DELETE' })
assert(revoke.ok, 'device revoked')
const denied = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' }) })
assert(denied.status === 401, 'revoked MCP URL rejected')
console.log('MCP smoke test passed: task assignment, flashcard CRUD, attempt read, draft image, revocation')
