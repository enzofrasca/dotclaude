// statusbar — status line on the permission-mode row, modeled on the pi footer
// (~/.pi/agent/extensions/ui/footer.ts).
//
//   ⏵⏵ auto mode on · Opus 5.5 medium › agent main* › 31k/1M · 3% › $1.23 › 62% · 2h12m · 7d 12% · 3d3h
//
// Draws at the PromptHint site, right after the permission mode.
// Palette built in OKLCH: one accent hue for identity, neutrals for info,
// warm colors only for warnings.

const C = {
  accent: '#bcabf1', text: '#c1c4cc', muted: '#9598a0', dim: '#666970',
  sep: '#404249', warning: '#e9b452', error: '#f2716a',
}
// one violet→magenta ramp: more effort = more chroma
const EFFORT: Record<string, string> = {
  low: '#7b778b', medium: '#958ab9', high: '#bb99e3', xhigh: '#e38fdb', max: '#f471aa',
}

// Read once per load
let home = ''
// Columns the permission mode takes before the bar ("  ⏵⏵ auto mode on · ");
// STATUSBAR_INDICATOR_COLUMNS overrides it, e.g. 29 for bypass permissions
let indicatorColumns = 23
// Cached between redraws; refreshed by events and a slow timer, never per frame
let model = ''
let effort = ''
let dir = ''
let branch = ''
let dirty = false
let usage: any = null
let refreshing: Promise<void> | null = null
let configChecked = false

// pct used → default color / amber (≥50) / red (≥80)
function level(pct: number, base: string) {
  return pct >= 80 ? C.error : pct >= 50 ? C.warning : base
}

function k(n: number) {
  if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}

// ISO timestamp → time left: 42m / 2h05m / 3d4h
function left(iso: string) {
  const s = Math.max(0, Math.floor((Date.parse(iso) - Date.now()) / 1000))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d${h}h`
  if (h) return `${h}h${String(m).padStart(2, '0')}m`
  return `${m}m`
}

// "claude-opus-5-5[1m]" → "Opus 5.5"; names that are already pretty pass through
function prettyModel(id: string) {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id)
  if (!m) return id
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`
}

// A colored run of text
type Seg = [color: string, text: string]

// Terminal cells; every character the bar draws is one cell wide
function width(segs: Seg[]) {
  return segs.reduce((n, [, text]) => n + [...text].length, 0)
}

// The first `room` cells of segs
function cut(segs: Seg[], room: number): Seg[] {
  const out: Seg[] = []
  for (const [color, text] of segs) {
    if (room <= 0) break
    const chars = [...text].slice(0, room)
    out.push([color, chars.join('')])
    room -= chars.length
  }
  return out
}

async function loadEnv($) {
  const [h, profile, indicator] = await Promise.all([
    $.env.get('HOME'), $.env.get('USERPROFILE'), $.env.get('STATUSBAR_INDICATOR_COLUMNS'),
  ])
  if (indicator && Number.isFinite(Number(indicator))) indicatorColumns = Math.max(0, Math.floor(Number(indicator)))
  home = h ?? profile ?? ''
}

async function load($) {
  const [m, cwd, u, rows] = await Promise.all([
    $.session.model(),
    $.session.cwd(),
    $.session.usage(),
    // Until the first request reports the live effort, take it from /config;
    // once per load, since a model without effort never gets a row
    effort || configChecked ? null : $.config.list().catch(() => null),
  ])
  configChecked = true
  model = prettyModel(m)
  dir = cwd
  usage = u
  const row = rows?.find((r) => /effort/i.test(r.key))
  if (!effort && typeof row?.value === 'string' && row.value in EFFORT) effort = row.value

  // One git call for branch + dirty state
  const git = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], { cwd: dir, timeoutMs: 2000 })
    .catch(() => null)
  const ok = git?.exitCode === 0
  branch = ok ? /^# branch\.head (.+)$/m.exec(git.stdout)?.[1] ?? '' : ''
  dirty = ok && git.stdout.split('\n').some((l) => l && !l.startsWith('#'))
  $.ui.invalidate('ui.render')
}

// Coalesces overlapping refreshes (timer + end of turn) into one; a failed
// refresh keeps the last values on screen
function refresh($) {
  refreshing ??= load($).catch(() => {}).finally(() => { refreshing = null })
  return refreshing
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await loadEnv($)
    // In the background, so a slow git never holds up the session start
    void refresh($)
    // Keeps the reset countdown and the branch current while idle; the
    // countdown has minute resolution, so once a minute is enough
    $.clock.every(60_000, () => refresh($))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.effort !== undefined && String(e.effort) !== effort) {
      effort = String(e.effort)
      $.ui.invalidate('ui.render')
    }
    yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // In the background, so a slow git never holds up the end of a turn
    void refresh($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    usage = { context: e.context, rateLimits: e.rateLimits, cost: e.cost }
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    const dot: Seg = [C.sep, ' · ']
    const parts: Seg[][] = []

    if (model) parts.push([[C.accent, model], ...(effort ? [[EFFORT[effort] ?? C.dim, ' ' + effort] as Seg] : [])])

    if (dir) {
      const name = dir === home ? '~' : dir.split(/[\\/]/).filter(Boolean).pop() ?? dir
      parts.push([
        [C.muted, name],
        ...(branch ? [[C.dim, ' ' + branch] as Seg] : []),
        ...(dirty ? [[C.warning, '*'] as Seg] : []),
      ])
    }

    const ctx = usage?.context
    if (ctx?.window) {
      if (ctx.percent !== undefined) {
        const c = level(ctx.percent, C.text)
        parts.push([[c, `${k(ctx.tokens ?? 0)}/${k(ctx.window)}`], dot, [c, `${ctx.percent}%`]])
      } else {
        parts.push([[C.dim, `0/${k(ctx.window)}`]])
      }
    }

    if (usage?.cost) parts.push([[C.text, `$${usage.cost.usd.toFixed(2)}`]])

    const limits: Seg[] = []
    for (const r of usage?.rateLimits ?? []) {
      if (r.kind !== 'five_hour' && r.kind !== 'seven_day') continue
      const pct = Math.round(r.percentUsed)
      if (limits.length) limits.push(dot)
      limits.push([level(pct, C.muted), `${r.kind === 'seven_day' ? '7d ' : ''}${pct}%`])
      if (r.resetsAt) limits.push(dot, [C.dim, left(r.resetsAt)])
    }
    if (limits.length) parts.push(limits)

    // The permission mode draws first on this row, and the engine neither cuts
    // nor wraps what follows, so fit the bar to the columns left after it:
    // whole items drop from the right, and only a first item too wide is cut
    const room = Math.max(1, (e.viewport?.columns ?? 80) - indicatorColumns)
    const sep: Seg = [C.sep, ' › ']
    const row: Seg[] = []
    let used = 0
    for (const p of parts) {
      const item = row.length ? [sep, ...p] : p
      const w = width(item)
      if (used + w > room) {
        if (!row.length) row.push(...cut(item, room))
        break
      }
      row.push(...item)
      used += w
    }
    return Text({ children: row.map(([color, text]) => Text({ color, children: [text] })) })
  })
}
