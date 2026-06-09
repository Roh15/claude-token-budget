# claude-token-budget

Token budget monitor and loop guard for [Claude Code](https://claude.ai/code).

Injects real-time budget warnings into every turn and **hard-stops autonomous loops** before they burn through your quota.

## How it works

Two hooks fire automatically:

| Hook | Fires | Action |
|------|-------|--------|
| `UserPromptSubmit` | Every user turn | Calls `/usage` live, injects NOTICE/WARN/HALT advisory into context |
| `PreToolUse` | Before every tool call | Reads cached cap, counts session tokens, **blocks the tool** on HALT |

**Warning tiers** (based on session token usage vs your cap, and raw window % from `/usage`):

| Level | Threshold | Behavior |
|-------|-----------|----------|
| NOTICE | ≥ 70% | Advisory only |
| WARN | ≥ 85% | Advisory + guidance |
| HALT | ≥ 95% | UserPromptSubmit: advisory. PreToolUse: hard block |

The session cap is derived from your budget % and live quota data — no stored quota, no calibration step. Quota is estimated from `local tokens / utilization%` on every turn.

## Requirements

- [Claude Code](https://claude.ai/code) CLI installed and in PATH
- Node.js ≥ 18

## Install

```bash
git clone https://github.com/Roh15/claude-token-budget.git
cd claude-token-budget
node install.js
```

Then restart Claude Code (or open `/hooks` once to reload config).

## Uninstall

```bash
node uninstall.js
```

## Usage

### Slash command

```
/budget                 — show status
/budget status          — show status
/budget set 5h 75       — set 5-hour budget to 75% of quota
/budget set 7d 25       — set 7-day budget to 25% of quota
/budget set 50          — set both windows to 50%
```

The effective session cap is `min(5h_cap, 7d_cap)`.

### Defaults

- 5h window: **75%** of estimated quota
- 7d window: **25%** of estimated quota

These are stored in `~/.claude/token-budget/budget-prefs.json` and survive reinstalls.

## Recovery

If a loop is hard-stopped and you want to continue:

```
/budget set 5h 85
```

Or from outside Claude Code (bypasses all hooks):

```
! node ~/.claude/token-budget/budget-cli.js set 5h 85
```

## Files installed

```
~/.claude/token-budget/
  check-budget.js        UserPromptSubmit hook
  check-budget-tool.js   PreToolUse hook
  budget-cli.js          CLI (status, set)
  budget-prefs.json      Your preferences
  .budget-cache.json     Per-turn cap cache (auto-generated)

~/.claude/commands/
  budget.md              /budget slash command
```
