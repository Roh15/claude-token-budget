#!/usr/bin/env node
/**
 * UserPromptSubmit hook.
 * Reads transcript_path from stdin JSON, calls `claude /usage` for live quota,
 * counts session tokens from the JSONL, outputs block decision on HALT or
 * advisory context on WARN/NOTICE.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execSync } = require('child_process');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PREFS_PATH = path.join(__dirname, 'budget-prefs.json');
const CACHE_PATH = path.join(__dirname, '.budget-cache.json');

function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8')); } catch { return {}; }
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

// "Jun 8 at 10:40pm (America/New_York)" → UTC ms
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

function countTokens(sinceMs, sessionFile) {
  let period = 0, session = 0;
  for (const file of findJsonl(path.join(CLAUDE_DIR, 'projects'))) {
    try {
      if (fs.statSync(file).mtimeMs < sinceMs) continue;
      const isCurrent = sessionFile && path.resolve(file) === path.resolve(sessionFile);
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type !== 'assistant' || !e.message?.usage || !e.timestamp) continue;
        if (e.timestamp < sinceMs) continue;
        const u = e.message.usage;
        const t = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
                + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
        period += t;
        if (isCurrent) session += t;
      }
    } catch {}
  }
  return { period, session };
}

function fmt(n) {
  return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n);
}

function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }

function main(sessionFile) {
  const prefs = loadPrefs();
  const fhBudgetPct = prefs.five_hour_budget_pct ?? 75;
  const sdBudgetPct = prefs.seven_day_budget_pct ?? 25;

  let raw;
  try { raw = execSync('echo "/usage" | claude --print', { encoding: 'utf8', timeout: 10000 }); }
  catch { process.exit(0); }

  const usage = parseUsage(raw);
  if (!usage) process.exit(0);

  const { five_hour: fh, seven_day: sd } = usage;
  if (fh.pct < 1 || sd.pct < 1) process.exit(0);

  const fhResetsMs = parseResetMs(fh.resetsStr);
  const sdResetsMs = parseResetMs(sd.resetsStr);
  if (!fhResetsMs || !sdResetsMs) process.exit(0);

  const fhStartMs = fhResetsMs - 5 * 3600000;
  const sdStartMs = sdResetsMs - 7 * 24 * 3600000;

  const { period: sdTokens, session: sessionTokens } = countTokens(sdStartMs, sessionFile);
  const { period: fhTokens } = countTokens(fhStartMs, sessionFile);

  const fhQuota = Math.round(fhTokens / (fh.pct / 100));
  const sdQuota = Math.round(sdTokens / (sd.pct / 100));

  const fhCap      = Math.round((fhBudgetPct / 100) * fhQuota);
  const sdCap      = Math.round((sdBudgetPct / 100) * sdQuota);
  const sessionCap = Math.min(fhCap, sdCap);

  // Write cache for PreToolUse hot-path checks
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ sessionCap, fhStartMs, sdStartMs, updatedAt: Date.now() }));
  } catch {}

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

// Read stdin JSON to get transcript_path, then run
let stdinBuf = '';
process.stdin.on('data', chunk => { stdinBuf += chunk; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(stdinBuf); } catch {}
  main(data.transcript_path ?? null);
});
