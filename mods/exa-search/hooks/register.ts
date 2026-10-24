// exa-search — answers Claude's WebSearch with Exa instead of the native search.
// Results keep WebSearch's shape: the links, then the highlighted excerpts as
// text, so Claude reads them like any search. WebFetch stays native.
//
// The key comes from EXA_API_KEY, or from EXA_API_KEY=... in ~/.claude/.env
// (untracked). Without a key, or when Exa fails, the native search runs.
// Request shape per https://exa.ai/docs/reference/search-api-guide-for-coding-agents

const NUM_RESULTS = 10
// Highlight text per result: ten results stay around 2k tokens
const MAX_CHARACTERS = 800

let key = ''

// KEY=value from a .env file; quotes stripped, trailing comments dropped
function fromDotenv(text: string, name: string) {
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m || m[1] !== name) continue
    const v = m[2].trim()
    return /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v.replace(/\s+#.*$/, '')
  }
  return ''
}

async function loadKey($) {
  key = (await $.env.get('EXA_API_KEY')) ?? ''
  if (key) return
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const text = await $.fs.read(`${home}/.claude/.env`).catch(() => '')
  key = fromDotenv(text, 'EXA_API_KEY')
}

// An id shaped like the native search's own server tool ids
function toolUseId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'srvtoolu_01'
  for (let i = 0; i < 22; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

function parseResults(text: string) {
  try {
    return JSON.parse(text)?.results ?? null
  } catch {
    return null
  }
}

function excerpts(query: string, hits: any[]) {
  if (hits.length === 0) return `No results for: ${query}`
  const lines = ['Excerpts below. Answer from them when sufficient; WebFetch a URL only when a concrete detail is missing.', '']
  hits.forEach((h, i) => {
    lines.push(`## ${i + 1}. ${h.title ?? 'Untitled'}`, h.url ?? '')
    if (h.publishedDate) lines.push(`Published: ${h.publishedDate.slice(0, 10)}`)
    lines.push('')
    // Exa treats maxCharacters as a target, so cut here too
    let room = MAX_CHARACTERS
    const hl: string[] = []
    for (const s of (h.highlights ?? []).filter((s) => typeof s === 'string' && s.trim())) {
      if (room <= 0) break
      const t = s.trim()
      hl.push(t.length > room ? t.slice(0, room).trimEnd() + '…' : t)
      room -= t.length
    }
    if (hl.length) for (const s of hl) lines.push(`> ${s}`, '')
    else lines.push('_(no excerpt; WebFetch this URL if it looks relevant)_', '')
  })
  return lines.join('\n')
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await loadKey($)
    return next(e)
  })

  on('tool.call', { tool: 'WebSearch' }, async ($, e, next) => {
    // A key added after the session started is picked up on the next search
    if (!key) await loadKey($)
    if (!key) return next(e)

    const started = Date.now()
    const body: Record<string, unknown> = {
      query: e.query,
      // "extended" asks for a thorough search: Exa's multi-step deep search
      type: e.mode === 'extended' ? 'deep' : 'auto',
      numResults: NUM_RESULTS,
      contents: { highlights: { maxCharacters: MAX_CHARACTERS } },
    }
    if (e.allowed_domains?.length) body.includeDomains = e.allowed_domains
    if (e.blocked_domains?.length) body.excludeDomains = e.blocked_domains

    const res = await $.http.fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)
    const hits = res?.ok ? parseResults(res.text) : null
    // Exa down, rate-limited or a bad key: let the native search answer
    if (!Array.isArray(hits)) return next(e)

    return {
      result: {
        query: e.query,
        results: [
          { tool_use_id: toolUseId(), content: hits.map((h) => ({ title: h.title ?? 'Untitled', url: h.url ?? '' })) },
          excerpts(e.query, hits),
        ],
        durationSeconds: (Date.now() - started) / 1000,
        searchCount: 1,
      },
    }
  })
}
