import { expect, mock, test } from 'claude-code/testing'

const EXA = {
  results: [
    { title: 'Mods reference', url: 'https://code.claude.com/docs/en/plugins/mods/reference', publishedDate: '2026-10-01T00:00:00Z', highlights: ['A mod is a plugin directory.'] },
    { title: 'No excerpt', url: 'https://example.com' },
  ],
}

// Stubs the key source, Exa, and the native search behind the hook
function stubs(on, s: { env?: object, dotenv?: string, exa?: { status: number, text: string } }) {
  const sent: any[] = []
  mock.env(on, { HOME: '/Users/x', ...s.env })
  on('fs.read', () => (s.dotenv === undefined ? { deny: 'no file' } : { value: s.dotenv }))
  on('http.fetch', ($, e) => {
    sent.push({ url: e.url, ...e.init, body: JSON.parse(e.init.body) })
    const r = s.exa ?? { status: 200, text: JSON.stringify(EXA) }
    return { value: { status: r.status, ok: r.status < 300, headers: {}, text: r.text } }
  })
  on('tool.call', () => ({ result: 'native search' }))
  on('session.start', () => ({ cwd: '/tmp' }))
  return sent
}

test('answers WebSearch from Exa with links and excerpts', async ($, on) => {
  const sent = stubs(on, { env: { EXA_API_KEY: 'k1' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/tmp' })
  const out = await $.tool.call({ tool: 'WebSearch', query: 'claude mods', mode: 'standard', allowed_domains: ['code.claude.com'] })

  expect(sent[0].url).toBe('https://api.exa.ai/search')
  expect(sent[0].headers['x-api-key']).toBe('k1')
  expect(sent[0].body).toMatchObject({ query: 'claude mods', type: 'auto', includeDomains: ['code.claude.com'], contents: { highlights: { maxCharacters: 800 } } })
  expect(out.result.results[0].content[0]).toEqual({ title: 'Mods reference', url: 'https://code.claude.com/docs/en/plugins/mods/reference' })
  expect(out.result.results[1]).toContain('> A mod is a plugin directory.')
  // Nothing Claude reads names Exa
  expect(out.result.results[0].tool_use_id).toMatch(/^srvtoolu_01[A-Za-z0-9]{22}$/)
  expect(JSON.stringify(out.result)).not.toMatch(/\bexa\b|exa\.ai/i)
  expect(out.result.results[1]).toContain('Published: 2026-10-01')
  expect(out.result.results[1]).toContain('no excerpt')
})

test('extended mode uses deep search and blocked domains are excluded', async ($, on) => {
  const sent = stubs(on, { env: { EXA_API_KEY: 'k1' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/tmp' })
  await $.tool.call({ tool: 'WebSearch', query: 'q', mode: 'extended', blocked_domains: ['spam.com'] })
  expect(sent[0].body).toMatchObject({ type: 'deep', excludeDomains: ['spam.com'] })
})

test('reads the key from ~/.claude/.env when the environment has none', async ($, on) => {
  const sent = stubs(on, { dotenv: '# keys\nEXA_API_KEY="k2"\n' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/tmp' })
  await $.tool.call({ tool: 'WebSearch', query: 'q', mode: 'standard' })
  expect(sent[0].headers['x-api-key']).toBe('k2')
})

test('falls back to the native search without a key', async ($, on) => {
  const sent = stubs(on, {})
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/tmp' })
  expect(await $.tool.call({ tool: 'WebSearch', query: 'q', mode: 'standard' })).toEqual({ result: 'native search' })
  expect(sent.length).toBe(0)
})

test('falls back to the native search when Exa errors', async ($, on) => {
  stubs(on, { env: { EXA_API_KEY: 'k1' }, exa: { status: 500, text: 'oops' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/tmp' })
  expect(await $.tool.call({ tool: 'WebSearch', query: 'q', mode: 'standard' })).toEqual({ result: 'native search' })
})

test('each result keeps at most 800 characters of excerpt', async ($, on) => {
  stubs(on, { env: { EXA_API_KEY: 'k1' }, exa: { status: 200, text: JSON.stringify({ results: [{ title: 't', url: 'u', highlights: ['a'.repeat(500), 'b'.repeat(500), 'c'.repeat(500)] }] }) } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/tmp' })
  const out = await $.tool.call({ tool: 'WebSearch', query: 'q', mode: 'standard' })
  const text = out.result.results[1]
  expect(text).toContain('a'.repeat(500))
  expect(text).toContain('b'.repeat(300) + '…')
  expect(text).not.toContain('b'.repeat(301))
  expect(text).not.toContain('ccc')
})
