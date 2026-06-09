#!/usr/bin/env node
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fmt, parseUsage, parseResetMs } = require('./lib');

test('fmt: raw numbers', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(999), '999');
});

test('fmt: thousands', () => {
  assert.equal(fmt(1000), '1.0k');
  assert.equal(fmt(1500), '1.5k');
  assert.equal(fmt(999999), '1000.0k');
});

test('fmt: millions', () => {
  assert.equal(fmt(1000000), '1.0M');
  assert.equal(fmt(2500000), '2.5M');
});

test('parseUsage: valid output', () => {
  const text = [
    'Current session: 42% used · resets Jun 8 at 10:40pm (America/New_York)',
    'Current week usage: 15% used · resets Jun 12 at 6:00am (America/New_York)',
  ].join('\n');
  const r = parseUsage(text);
  assert.ok(r, 'should return result');
  assert.equal(r.five_hour.pct, 42);
  assert.equal(r.seven_day.pct, 15);
  assert.ok(r.five_hour.resetsStr.includes('Jun 8'));
  assert.ok(r.seven_day.resetsStr.includes('Jun 12'));
});

test('parseUsage: null on bad input', () => {
  assert.equal(parseUsage(''), null);
  assert.equal(parseUsage('no match'), null);
  assert.equal(parseUsage('Current session: 50% used'), null);
});

test('parseResetMs: returns future timestamp', () => {
  // Use a date that is clearly in the future to avoid rollover logic
  const year = new Date().getFullYear();
  const future = new Date(year, 11, 31, 23, 59); // Dec 31 23:59 local
  const mon = future.toLocaleString('en', { month: 'short' });
  const day = future.getDate();
  const str = `${mon} ${day} at 11:59pm (America/New_York)`;
  const result = parseResetMs(str);
  assert.equal(typeof result, 'number');
  assert.ok(result > 0);
});

test('parseResetMs: null on bad input', () => {
  assert.equal(parseResetMs(''), null);
  assert.equal(parseResetMs('not a date'), null);
  assert.equal(parseResetMs('Jun 8'), null);
});

test('threshold logic', () => {
  function level(sPct, fhPct, sdPct) {
    return sPct >= 95 || fhPct >= 95 || sdPct >= 95 ? 'HALT'   :
           sPct >= 85 || fhPct >= 85 || sdPct >= 85 ? 'WARN'   :
           sPct >= 70 || fhPct >= 70 || sdPct >= 70 ? 'NOTICE' : null;
  }
  assert.equal(level(96, 0, 0),   'HALT');
  assert.equal(level(0, 95, 0),   'HALT');
  assert.equal(level(0, 0, 95),   'HALT');
  assert.equal(level(86, 0, 0),   'WARN');
  assert.equal(level(0, 85, 0),   'WARN');
  assert.equal(level(71, 0, 0),   'NOTICE');
  assert.equal(level(0, 70, 0),   'NOTICE');
  assert.equal(level(69, 69, 69), null);
});
