import test from 'node:test'
import assert from 'node:assert/strict'
import { detectCommand, resolveToolPlan } from './index.js'

test('detectCommand accepts supported slash commands', () => {
  assert.equal(detectCommand(' /extract-tasks review the thread'), 'extract-tasks')
  assert.equal(detectCommand('plain prompt'), null)
})

test('extract-tasks plan deduplicates matched action items', async () => {
  const plan = resolveToolPlan('/extract-tasks')
  const result = await plan.execute({
    history: [
      { content: '- [ ] Ship the API contract' },
      { content: 'TODO: Ship the API contract' },
    ],
  })

  assert.equal(result.action, 'extract_tasks')
  assert.equal(result.output.items, 1)
  assert.equal(result.output.matches[0].text, 'Ship the API contract')
})
