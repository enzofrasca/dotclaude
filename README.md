# dotclaude

Minimal [Claude Code](https://code.claude.com) setup.

The point is a small always-on context, so the window goes to the task instead of the harness.

| | vs stock Claude Code |
|---|---|
| tools | niche tools denied |
| skills | bundled skills off; `/code-review` and `/simplify` on demand |
| connectors | claude.ai MCP connectors off |
| status line | [`statusbar`](mods/statusbar) mod on the mode row |
| `WebSearch` | [Exa](https://exa.ai) via the [`exa-search`](mods/exa-search) mod |

## Setup & update

```bash
curl -fsSL https://raw.githubusercontent.com/enzofrasca/dotclaude/main/setup | bash
```

Put `EXA_API_KEY` in `~/.claude/.env`
