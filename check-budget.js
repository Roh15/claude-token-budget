#!/usr/bin/env node
/**
 * UserPromptSubmit hook.
 * Reads transcript_path from stdin JSON, calls `claude /usage` for live quota,
 * counts session tokens from the JSONL, outputs block decision on HALT or
 * advisory context on WARN/NOTICE.
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { fmt, parseUsage, parseResetMs, countTokens, loadPrefs } = require('./lib');

const PREFS_PATH = path.join(__dirname, 'budget-prefs.json');
const CACHE_PATH = path.join(__dirname, '.budget-cache.json');

function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }

function main(sessionFile) {
  const prefs = loadPrefs(PREFS_PATH);
  const fhBudgetPct = prefs.five_hour_budget_pct ?? 75;
  const sdBudgetPct = prefs.seven_day_budget_pct ?? 25;

  let raw;
  try { raw = execSync('echo "/usage" | claude --print', { encoding: 'utf8', timeout: 10000 }); }
  catch (e) { process.stderr.write(`claude-token-budget: /usage failed — ${e.message}\n`); process.exit(0); }

  const usage = parseUsage(raw);
  if (!usage) { process.stderr.write('claude-token-budget: could not parse /usage output\n'); process.exit(0); }

  const { five_hour: fh, seven_day: sd } = usage;
  if (fh.pct < 1 || sd.pct < 1) process.exit(0);

  const fhResetsMs = parseResetMs(fh.resetsStr);
  const sdResetsMs = parseResetMs(sd.resetsStr);
  if (!fhResetsMs || !sdResetsMs) { process.stderr.write('claude-token-budget: could not parse reset times\n'); process.exit(0); }

  const fhStartMs = fhResetsMs - 5 * 3600000;
  const sdStartMs = sdResetsMs - 7 * 24 * 3600000;

  const { period: sdTokens, session: sessionTokens } = countTokens(sdStartMs, sessionFile);
  const { period: fhTokens } = countTokens(fhStartMs, sessionFile);

  const fhQuota = Math.round(fhTokens / (fh.pct / 100));
  const sdQuota = Math.round(sdTokens / (sd.pct / 100));

  const fhCap      = Math.round((fhBudgetPct / 100) * fhQuota);
  const sdCap      = Math.round((sdBudgetPct / 100) * sdQuota);
  const sessionCap = Math.min(fhCap, sdCap);

  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ sessionCap, fhStartMs, sdStartMs, updatedAt: Date.now() }));
  } catch (e) { process.stderr.write(`claude-token-budget: could not write cache — ${e.message}\n`); }

  const sPct  = pct(sessionTokens, sessionCap);
  const fhPct = fh.pct;
  const sdPct = sd.pct;

  const level =
    sPct >= 95 || fhPct >= 95 || sdPct >= 95 ? 'HALT'   :
    sPct >= 85 || fhPct >= 85 || sdPct >= 85 ? 'WARN'   :
    sPct >= 70 || fhPct >= 70 || sdPct >= 70 ? 'NOTICE' : null;

  if (!level) process.exit(0);

  const binding = fhCap <= sdCap ? `5h cap ${fmt(fhCap)}` : `7d cap ${fmt(sdCap)}`;
  const summary = `TOKEN BUDGET ${level}: session ${sPct}% of ${fmt(sessionCap)} (${binding}) | 5h ${fhPct}% | 7d ${sdPct}%`;

  const extra =
    level === 'HALT' ? ' Budget exhausted — complete current task only, then stop. Start no new loops.' :
    level === 'WARN' ? ' Avoid starting new loops or large multi-step tasks.' : '';

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: summary + extra,
    },
  }));
}

let stdinBuf = '';
process.stdin.on('data', chunk => { stdinBuf += chunk; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(stdinBuf); } catch {}
  main(data.transcript_path ?? null);
});
