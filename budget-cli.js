#!/usr/bin/env node
/**
 * budget-cli.js
 *
 * node budget-cli.js status
 * node budget-cli.js set [5h|7d] <pct>
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execSync } = require('child_process');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PREFS_PATH = path.join(__dirname, 'budget-prefs.json');

function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8')); } catch { return {}; }
}

function savePrefs(prefs) {
  fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
  fs.chmodSync(PREFS_PATH, 0o600);
}

function fmt(n) {
  return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n);
}

function findJsonl(dir) {
  const out = [];
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...findJsonl(p));
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  } catch {}
  return out;
}

function countTokensSince(sinceMs) {
  let total = 0;
  for (const file of findJsonl(path.join(CLAUDE_DIR, 'projects'))) {
    try {
      if (fs.statSync(file).mtimeMs < sinceMs) continue;
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type !== 'assistant' || !e.message?.usage || !e.timestamp) continue;
        if (e.timestamp < sinceMs) continue;
        const u = e.message.usage;
        total += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
               + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
      }
    } catch {}
  }
  return total;
}

function parseUsage(text) {
  const s = text.match(/Current session:\s*(\d+)%\s*used\s*·\s*resets\s*(.+)/i);
  const w = text.match(/Current week[^:]*:\s*(\d+)%\s*used\s*·\s*resets\s*(.+)/i);
  if (!s || !w) return null;
  return {
    five_hour: { pct: parseInt(s[1]), resetsStr: s[2].trim() },
    seven_day: { pct: parseInt(w[1]), resetsStr: w[2].trim() },
  };
}

function parseResetMs(str) {
  const m = str.match(/(\w+)\s+(\d+)\s+at\s+(\d+)(?::(\d+))?(am|pm)\s+\(([^)]+)\)/i);
  if (!m) return null;
  const [, mon, day, hr, min = '0', ampm, tz] = m;
  let h = parseInt(hr) % 12;
  if (ampm.toLowerCase() === 'pm') h += 12;
  const year  = new Date().getFullYear();
  const month = new Date(`${mon} 1`).getMonth();
  const approx = new Date(year, month, parseInt(day), h, parseInt(min));
  const tzName = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(approx).find(p => p.type === 'timeZoneName')?.value ?? 'GMT+0';
  const om = tzName.match(/GMT([+-])(\d+)(?::(\d+))?/);
  const offsetMs = om ? (om[1] === '+' ? 1 : -1) * (parseInt(om[2]) * 60 + parseInt(om[3] ?? 0)) * 60000 : 0;
  const utcMs = Date.UTC(year, month, parseInt(day), h, parseInt(min)) - offsetMs;
  return utcMs < Date.now() - 60000 ? utcMs + 365 * 86400000 : utcMs;
}

function timeUntil(ms) {
  const d = ms - Date.now();
  if (d <= 0) return 'now';
  const h = Math.floor(d / 3600000), m = Math.floor((d % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Commands ──────────────────────────────────────────────────────────────────

function status() {
  const prefs = loadPrefs();
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
  const prefs = loadPrefs();

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

// ── Dispatch ──────────────────────────────────────────────────────────────────

const [,, cmd, ...rest] = process.argv;
switch (cmd) {
  case 'status': status(); break;
  case 'set':    set(rest); break;
  default:
    console.log('node budget-cli.js <status | set [5h|7d] <pct>>');
    process.exit(1);
}
