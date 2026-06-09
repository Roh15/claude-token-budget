#!/usr/bin/env node
/**
 * Installs claude-token-budget hooks into ~/.claude/
 *
 * What it does:
 *   1. Copies hook scripts to ~/.claude/token-budget/
 *   2. Copies /budget slash command to ~/.claude/commands/
 *   3. Merges UserPromptSubmit + PreToolUse hooks into ~/.claude/settings.json
 *   4. Creates default budget-prefs.json if not already present
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const INSTALL_DIR   = path.join(os.homedir(), '.claude', 'token-budget');
const COMMANDS_DIR  = path.join(os.homedir(), '.claude', 'commands');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

const FILES = ['check-budget.js', 'check-budget-tool.js', 'budget-cli.js', 'lib.js'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); }
  catch { return {}; }
}

function saveSettings(s) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
}

function hookExists(hooks, command) {
  return (hooks || []).some(group =>
    (group.hooks || []).some(h => h.type === 'command' && h.command === command)
  );
}

function addHook(settings, event, command, timeout, statusMessage) {
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks[event]) settings.hooks[event] = [];
  if (hookExists(settings.hooks[event], command)) {
    console.log(`  ✓ ${event} hook already present — skipping`);
    return;
  }
  settings.hooks[event].push({
    hooks: [{ type: 'command', command, timeout, statusMessage }],
  });
  console.log(`  + Added ${event} hook`);
}

// ── Install ───────────────────────────────────────────────────────────────────

console.log('Installing claude-token-budget...\n');

// 1. Copy scripts
ensureDir(INSTALL_DIR);
for (const file of FILES) {
  const src  = path.join(__dirname, file);
  const dest = path.join(INSTALL_DIR, file);
  if (!fs.existsSync(src)) {
    console.error(`Missing source file: ${file}`);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
  console.log(`  Copied ${file} → ${dest}`);
}

// 2. Create default prefs (don't overwrite existing)
const prefsPath = path.join(INSTALL_DIR, 'budget-prefs.json');
if (!fs.existsSync(prefsPath)) {
  fs.writeFileSync(prefsPath, JSON.stringify({ five_hour_budget_pct: 75, seven_day_budget_pct: 25 }, null, 2));
  console.log('  Created budget-prefs.json (defaults: 5h 75%, 7d 25%)');
} else {
  console.log('  budget-prefs.json already exists — keeping your settings');
}

// 3. Copy slash command
ensureDir(COMMANDS_DIR);
const cmdSrc  = path.join(__dirname, 'budget.md');
const cmdDest = path.join(COMMANDS_DIR, 'budget.md');
if (fs.existsSync(cmdSrc)) {
  fs.copyFileSync(cmdSrc, cmdDest);
  console.log(`  Copied budget.md → ${cmdDest}`);
}

// 4. Merge settings.json hooks
console.log('\nUpdating ~/.claude/settings.json...');
const settings = loadSettings();

addHook(
  settings,
  'UserPromptSubmit',
  `node "${path.join(INSTALL_DIR, 'check-budget.js')}"`,
  10,
  'Checking token budget...'
);

addHook(
  settings,
  'PreToolUse',
  `node "${path.join(INSTALL_DIR, 'check-budget-tool.js')}"`,
  5,
  'Checking token budget...'
);

saveSettings(settings);

console.log('\nDone! claude-token-budget is installed.\n');
console.log('Usage:');
console.log('  /budget status          — show current usage and caps');
console.log('  /budget set 5h 75       — set 5h session budget to 75%');
console.log('  /budget set 7d 25       — set 7d session budget to 25%');
console.log('\nBudget warnings inject into context automatically on every turn.');
console.log('Loops are hard-stopped by the PreToolUse hook when budget is exhausted.');
