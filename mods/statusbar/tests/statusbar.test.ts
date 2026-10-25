import { expect, mock, test } from 'claude-code/testing'

const HINT = {
  plugin: 'statusbar',
  component: 'PromptHint',
  requestId: 'hint',
  surface: 'terminal',
  viewport: { columns: 200, rows: 40 },
  props: { isDraft: false, isWorking: false, hint: '' },
} as const

const inTwoHours = new Date(Date.now() + 2 * 3600_000 + 13 * 60_000 + 30_000).toISOString()

// Stubs what the mod reads from Claude Code, then starts the session
async function start($, on, s: { model: string, cwd: string, usage: object, git?: string, effort?: string }) {
  mock.clock(on)
  mock.env(on, { HOME: '/Users/x' })
  on('session.model', () => ({ value: s.model }))
  on('session.cwd', () => ({ value: s.cwd }))
  on('session.usage', () => ({ value: s.usage }))
  let effort = s.effort
  on('config.list', () => ({ value: effort ? [{ key: 'effortLevel', label: 'Effort', kind: 'enum', value: effort, isLocked: false }] : [] }))
  on('process.run', () => ({ value: s.git === undefined ? { exitCode: 128, stdout: '', stderr: '' } : { exitCode: 0, stdout: s.git, stderr: '' } }))
  on('session.start', () => ({ cwd: s.cwd }))
  on('config.set', ($, e) => { effort = String(e.value); return { value: e.value } })
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: s.cwd })
}

test('draws every item, with the effort of the live request', async ($, on) => {
  await start($, on, {
    model: 'claude-opus-5-5',
    cwd: '/Users/x/agent',
    git: '# branch.oid abc\n# branch.head main\n1 .M N... a.txt\n',
    usage: {
      context: { tokens: 31000, window: 1000000, percent: 3 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 62, resetsAt: inTwoHours }, { kind: 'seven_day', percentUsed: 12.4 }],
      cost: { usd: 1.234 },
    },
  })
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, effort: 'medium' })
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()

  const ui = await $.ui.mount(HINT)
  for (const text of ['Opus 5.5', ' medium', 'agent', ' main', '*', '31k/1M', '3%', '$1.23', '62%', '2h13m', '7d 12%']) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  await ui.unmount()
})

test('outside a git repo and before any usage it still draws model and folder', async ($, on) => {
  await start($, on, { model: 'Sonnet 5.5', cwd: '/tmp', usage: { context: { window: 200000 }, rateLimits: [] } })
  const ui = await $.ui.mount(HINT)
  for (const text of ['Sonnet 5.5', 'tmp', '0/200k']) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: '*' })).toBeUndefined()
  await ui.unmount()
})

test('effort comes from /config before the first request', async ($, on) => {
  await start($, on, { model: 'claude-sonnet-5-5', cwd: '/tmp', effort: 'high', usage: { context: { window: 200000 }, rateLimits: [] } })
  const ui = await $.ui.mount(HINT)
  expect(await ui.find({ type: 'Text', text: 'Sonnet 5.5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' high' })).toBeDefined()
  await ui.unmount()
})

test('a narrow terminal drops whole items from the right to fit after the mode', async ($, on) => {
  await start($, on, {
    model: 'claude-opus-5-5',
    cwd: '/Users/x/agent',
    git: '# branch.head main\n',
    effort: 'medium',
    usage: { context: { tokens: 31000, window: 1000000, percent: 3 }, rateLimits: [], cost: { usd: 1 } },
  })

  // 60 columns - 23 for the mode = 37: "Opus 5.5 medium › agent main › " is 31, the context item doesn't fit
  const ui = await $.ui.mount({ ...HINT, viewport: { columns: 60, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' main' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '31k/1M' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '$1.00' })).toBeUndefined()
  await ui.unmount()

  // Too narrow even for the first item: it is cut to the room left
  const tiny = await $.ui.mount({ ...HINT, viewport: { columns: 29, rows: 40 } })
  expect(await tiny.find({ type: 'Text', text: 'Opus 5' })).toBeDefined()
  expect(await tiny.find({ type: 'Text', text: 'agent' })).toBeUndefined()
  await tiny.unmount()
})

test('a /config effort change draws at once, without waiting for the next request', async ($, on) => {
  await start($, on, { model: 'claude-sonnet-5-5', cwd: '/tmp', effort: 'high', usage: { context: { window: 200000 }, rateLimits: [] } })
  const ui = await $.ui.mount(HINT)
  expect(await ui.find({ type: 'Text', text: ' high' })).toBeDefined()

  await $.config.set({ key: 'effortLevel', value: 'max' })
  expect(await ui.find({ type: 'Text', text: ' max' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' high' })).toBeUndefined()
  await ui.unmount()
})

test('a request from a model without effort drops the effort', async ($, on) => {
  await start($, on, { model: 'claude-sonnet-5-5', cwd: '/tmp', effort: 'high', usage: { context: { window: 200000 }, rateLimits: [] } })
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5-5', messageCount: 1 })
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()

  const ui = await $.ui.mount(HINT)
  expect(await ui.find({ type: 'Text', text: ' high' })).toBeUndefined()
  await ui.unmount()
})
