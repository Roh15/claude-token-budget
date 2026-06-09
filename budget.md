Manage token budget. Parse $ARGUMENTS and run the appropriate command.

## status
Show current usage vs budget across both windows (calls /usage live).
Run: `node ~/.claude/token-budget/budget-cli.js status`
Print output verbatim.

## set [5h|7d] <n>
Set session budget %. Defaults: 75% (5h), 25% (7d). Effective cap = min of both.
- `set 20` → both windows to 20%
- `set 5h 50` → 5h window only
- `set 7d 30` → 7d window only
Run: `node ~/.claude/token-budget/budget-cli.js set [5h|7d] <n>`
Report the updated budget percentages.

## No arguments / help
Run status and show current preferences.
Run: `node ~/.claude/token-budget/budget-cli.js status`
