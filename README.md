# dotclaude

Lean [Claude Code](https://code.claude.com) setup, the sibling of
[dotpi](https://github.com/enzofrasca/dotpi).

The point is a small always-on context, so the window goes to the task instead
of the harness.

| | vs stock Claude Code |
|---|---|
| tools | niche tools denied (Artifact, Workflow, Cron, ScheduleWakeup, …) |
| skills | bundled skills off; `/code-review` and `/simplify` on demand only |
| connectors | claude.ai MCP connectors never load |
| status line | [`statusbar`](mods/statusbar) mod on the permission-mode row |
| web search | [`exa-search`](mods/exa-search) mod answers `WebSearch` with Exa |

## Setup & update

```bash
curl -fsSL https://raw.githubusercontent.com/enzofrasca/dotclaude/main/setup | bash
```

On Windows, run it from Git Bash. It needs only `git`.

[`settings.json`](settings.json) is tracked as is; on a machine that already
has one, `setup` keeps it as `settings.json.bak`. Claude Code writes to it too
(`/model`, `/effort`, `/config`), so those changes show up in `git diff`.
Mods load through `CLAUDE_CODE_PLUGIN_DIRS`, with `~` paths that work on every
OS. Only the files `.gitignore` allows are tracked; sessions, history, caches
and credentials stay local.

## statusbar

```
⏵⏵ auto mode on · Opus 5.5 medium › agent main* › 31k/1M · 3% › $1.23 › 62% · 2h12m · 7d 12% · 3d3h
```

Model and effort, folder and git branch (`*` when dirty), context, session
cost, and the 5-hour and 7-day plan limits with time until reset. Context and
limits turn amber at 50% and red at 80%. On a narrow terminal, items drop from
the right.

Optional, in `env` of `settings.json`:

| Variable | Effect |
|---|---|
| `STATUSBAR_INDICATOR_COLUMNS` | columns the permission mode takes before the bar (default `23`; `29` for bypass permissions) |

```bash
cd ~/.claude/mods/statusbar && claude plugin test && claude plugin validate .
```

## exa-search

Answers `WebSearch` with [Exa](https://exa.ai): ten ranked results with
highlighted excerpts, in `WebSearch`'s own shape, so Claude reads them like any
search. `mode: "extended"` runs Exa's deep search; allowed and blocked domains
carry over. `WebFetch` stays native.

The key comes from `EXA_API_KEY` in the environment, or from
`EXA_API_KEY=...` in `~/.claude/.env`, which is never tracked. Without a key,
or when Exa fails, the native search answers.

```bash
cd ~/.claude/mods/exa-search && claude plugin test && claude plugin validate .
```
