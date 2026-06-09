#!/usr/bin/env node
/**
 * PreToolUse hook.
 * Reads cached session cap (written by UserPromptSubmit hook) and counts
 * session tokens. Blocks the tool call if session is over the HALT threshold.
 * No /usage call — runs fast enough for every tool invocation.
 */

const fs   = require('fs');
const path = require('path');
const { fmt, countSessionFile } = require('./lib');

const CACHE_PATH = path.join(__dirname, '.budget-cache.json');

function isBudgetRecoveryCommand(toolName, toolInput) {
  if (toolName !== 'Bash') return false;
  const cmd = (toolInput?.command || '').trim();
  return cmd.includes('budget-cli.js') || cmd.includes('budget-prefs.json') || cmd.includes('.budget-cache.json');
}

function main(sessionFile, toolName, toolInput) {
  let cache;
  try { cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); }
  catch { process.exit(0); }

  const { sessionCap, fhStartMs } = cache;
  if (!sessionCap || !fhStartMs) process.exit(0);

  const sessionTokens = countSessionFile(fhStartMs, sessionFile);
  const sPct = sessionCap > 0 ? Math.round(sessionTokens / sessionCap * 100) : 0;

  if (sPct < 95 || isBudgetRecoveryCommand(toolName, toolInput)) process.exit(0);

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `TOKEN BUDGET HALT: session ${sPct}% of ${fmt(sessionCap)}. Budget exhausted mid-loop — stopping. Run /budget set 5h <pct> to continue.`,
  }));
}

let stdinBuf = '';
process.stdin.on('data', chunk => { stdinBuf += chunk; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(stdinBuf); } catch {}
  main(data.transcript_path ?? null, data.tool_name ?? null, data.tool_input ?? null);
});
