#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

function fmt(n) {
  return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n);
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
  if (utcMs < Date.now() - 60000) {
    const d = new Date(utcMs);
    d.setFullYear(d.getFullYear() + 1);
    return d.getTime();
  }
  return utcMs;
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

function sumUsage(u) {
  return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
       + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
}

// Scans all project JSONL files. Returns { period, session } token counts.
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
        const t = sumUsage(e.message.usage);
        period += t;
        if (isCurrent) session += t;
      }
    } catch {}
  }
  return { period, session };
}

// Fast path: reads only the single session file. Used by the PreToolUse hot-path.
function countSessionFile(sinceMs, sessionFile) {
  if (!sessionFile) return 0;
  let total = 0;
  try {
    for (const line of fs.readFileSync(sessionFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.type !== 'assistant' || !e.message?.usage || !e.timestamp) continue;
      if (e.timestamp < sinceMs) continue;
      total += sumUsage(e.message.usage);
    }
  } catch {}
  return total;
}

// Scans all project JSONL files since sinceMs, returns total tokens.
function countTokensSince(sinceMs) {
  return countTokens(sinceMs, null).period;
}

function loadPrefs(prefsPath) {
  try { return JSON.parse(fs.readFileSync(prefsPath, 'utf8')); } catch { return {}; }
}

module.exports = {
  fmt, parseUsage, parseResetMs,
  findJsonl, countTokens, countSessionFile, countTokensSince,
  loadPrefs, CLAUDE_DIR,
};
