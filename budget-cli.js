#!/usr/bin/env node
/**
 * budget-cli.js
 *
 * node budget-cli.js status
 * node budget-cli.js set [5h|7d] <pct>
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { fmt, parseUsage, parseResetMs, countTokensSince, loadPrefs } = require('./lib');

const PREFS_PATH = path.join(__dirname, 'budget-prefs.json');

function savePrefs(prefs) {
  fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
  fs.chmodSync(PREFS_PATH, 0o600);
}

function timeUntil(ms) {
  const d = ms - Date.now();
  if (d <= 0) return 'now';
  const h = Math.floor(d / 3600000), m = Math.floor((d % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function status() {
  const prefs = loadPrefs(PREFS_PATH);
  const fhBudgetPct = prefs.five_hour_budget_pct ?? 75;
  const sdBudgetPct = prefs.seven_day_budget_pct ?? 25;

  let raw;
  try { raw = execSync('echo "/usage" | claude --print', { encoding: 'utf8', timeout: 12000 }); }
  catch (e) { console.error('Failed to fetch /usage:', e.message); process.exit(1); }

  const usage = parseUsage(raw);
  if (!usage) { console.error('Could not parse /usage output:\n' + raw); process.exit(1); }

  const { five_hour: fh, seven_day: sd } = usage;
  const fhResetsMs = parseResetMs(fh.resetsStr);
  const sdResetsMs = parseResetMs(sd.resetsStr);
  if (!fhResetsMs || !sdResetsMs) { console.error('Could not parse reset times'); process.exit(1); }

  const fhStartMs = fhResetsMs - 5 * 3600000;
  const sdStartMs = sdResetsMs - 7 * 24 * 3600000;

  const fhTokens = countTokensSince(fhStartMs);
  const sdTokens = countTokensSince(sdStartMs);

  const fhQuota = fh.pct > 0 ? Math.round(fhTokens / (fh.pct / 100)) : 0;
  const sdQuota = sd.pct > 0 ? Math.round(sdTokens / (sd.pct / 100)) : 0;

  const fhCap = fhQuota > 0 ? Math.round((fhBudgetPct / 100) * fhQuota) : 0;
  const sdCap = sdQuota > 0 ? Math.round((sdBudgetPct / 100) * sdQuota) : 0;
  const sessionCap = fhCap > 0 && sdCap > 0 ? Math.min(fhCap, sdCap) : (fhCap || sdCap);
  const binding = fhCap > 0 && sdCap > 0 ? (fhCap <= sdCap ? '5h' : '7d') : '—';

  const bar = p => '[' + '█'.repeat(Math.round(Math.min(p,100)/5)) + '░'.repeat(20-Math.round(Math.min(p,100)/5)) + `] ${p}%`;

  console.log('\nToken Budget Status');
  console.log('─'.repeat(56));
  console.log(`Session cap:  ${sessionCap > 0 ? fmt(sessionCap) : '(computing)'}  (${binding} binding)`);
  console.log(`Budget:       5h ${fhBudgetPct}%  |  7d ${sdBudgetPct}%`);
  console.log('─'.repeat(56));
  console.log(`5h window:  ${bar(fh.pct)}`);
  console.log(`  ${fmt(fhTokens)} used${fhQuota > 0 ? ' / ~'+fmt(fhQuota)+' est. quota' : ''}  — resets in ${timeUntil(fhResetsMs)}`);
  console.log(`7d window:  ${bar(sd.pct)}`);
  console.log(`  ${fmt(sdTokens)} used${sdQuota > 0 ? ' / ~'+fmt(sdQuota)+' est. quota' : ''}  — resets in ${timeUntil(sdResetsMs)}`);
  if (sessionCap > 0) {
    console.log('─'.repeat(56));
    console.log(`Caps:  5h ${fmt(fhCap)} (${fhBudgetPct}%)  |  7d ${fmt(sdCap)} (${sdBudgetPct}%)`);
  }
  console.log('');
}

function set(args) {
  const prefs = loadPrefs(PREFS_PATH);

  let win = null, rawPct;
  if (args[0] === '5h') { win = '5h'; rawPct = args[1]; }
  else if (args[0] === '7d') { win = '7d'; rawPct = args[1]; }
  else rawPct = args[0];

  const n = parseFloat(rawPct);
  if (isNaN(n) || n <= 0 || n > 100) { console.error('Usage: set [5h|7d] <1-100>'); process.exit(1); }

  if (win === '5h') prefs.five_hour_budget_pct = n;
  else if (win === '7d') prefs.seven_day_budget_pct = n;
  else { prefs.five_hour_budget_pct = n; prefs.seven_day_budget_pct = n; }

  savePrefs(prefs);
  const fh = prefs.five_hour_budget_pct ?? 75;
  const sd = prefs.seven_day_budget_pct ?? 25;
  console.log(`Budget set: 5h ${fh}%  |  7d ${sd}%`);
  console.log('Run "status" to see current caps in tokens.');
}

const [,, cmd, ...rest] = process.argv;
switch (cmd) {
  case 'status': status(); break;
  case 'set':    set(rest); break;
  default:
    console.log('node budget-cli.js <status | set [5h|7d] <pct>>');
    process.exit(1);
}
