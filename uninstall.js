#!/usr/bin/env node
/**
 * Removes claude-token-budget hooks and files from ~/.claude/
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const INSTALL_DIR   = path.join(os.homedir(), '.claude', 'token-budget');
const COMMANDS_DIR  = path.join(os.homedir(), '.claude', 'commands');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

console.log('Uninstalling claude-token-budget...\n');

// 1. Remove hooks from settings.json
const HOOK_SCRIPTS = ['check-budget.js', 'check-budget-tool.js'];
if (fs.existsSync(SETTINGS_PATH)) {
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  let changed = false;
  for (const event of ['UserPromptSubmit', 'PreToolUse']) {
    if (!settings.hooks?.[event]) continue;
    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter(group =>
      !(group.hooks || []).some(h =>
        h.type === 'command' && HOOK_SCRIPTS.some(s => h.command.includes(s))
      )
    );
    if (settings.hooks[event].length < before) {
      console.log(`  Removed ${event} hook`);
      changed = true;
    }
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (changed) fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// 2. Remove slash command
const cmdPath = path.join(COMMANDS_DIR, 'budget.md');
if (fs.existsSync(cmdPath)) {
  fs.rmSync(cmdPath);
  console.log('  Removed ~/.claude/commands/budget.md');
}

// 3. Remove install dir
if (fs.existsSync(INSTALL_DIR)) {
  fs.rmSync(INSTALL_DIR, { recursive: true });
  console.log(`  Removed ${INSTALL_DIR}`);
}

console.log('\nDone. claude-token-budget has been uninstalled.');
