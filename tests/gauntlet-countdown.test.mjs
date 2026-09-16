/*
 * "Next in 6h 12m" on the Gauntlet headline card.
 *
 * The trap here is DST. A Gauntlet day runs midnight-to-midnight in
 * America/New_York, and on the two transition days an ET day is 23 or 25 hours
 * long — so counting the seconds left on the ET wall clock puts the countdown
 * a full hour out twice a year. These cases pin the real elapsed time to the
 * next ET midnight across both transitions and both standard offsets.
 *
 * "Now" is injected, so this asserts on fixed instants rather than on whenever
 * the suite happens to run. Pure; no emulator needed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };
const src = [
  grab(/        function shiftDateStr\(dateStr, days\) \{\n[\s\S]*?\n        \}/),
  grab(/          function getTodayDateStr\(\)[^\n]*/),
  grab(/        function etOffsetMs\(instant\) \{\n[\s\S]*?\n        \}/),
  grab(/        function nextGauntletInstant\(todayEtDate\) \{\n[\s\S]*?\n        \}/),
  grab(/        function msUntilNextGauntlet\(\) \{\n[\s\S]*?\n        \}/),
  grab(/        function formatCountdown\(ms\) \{\n[\s\S]*?\n        \}/),
].join('\n\n');
console.log('extracted from index.html:', src.length, 'chars');

// Inject "now" by shadowing Date.now() and the no-arg Date constructor. The
// real Intl is left alone: the zone data doing the DST work is the platform's,
// which is exactly what production relies on.
// RealDate comes in as a parameter: declaring `const Date` below shadows the
// binding for the whole function scope, so referring to the outer one inside
// would hit its temporal dead zone.
const build = new Function('NOW_MS', 'RealDate', `
  const Date = new Proxy(RealDate, {
    construct: (t, a) => a.length === 0 ? new t(NOW_MS) : new t(...a),
    get: (t, k) => k === 'now' ? () => NOW_MS : t[k],
  });
  ${src}
  return { msUntilNextGauntlet, formatCountdown, getTodayDateStr, etOffsetMs };
`);
const at = (iso) => build(global.Date.parse(iso), global.Date);

const H = 3600000, M = 60000;
const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);
const expect = (iso, wantMs, name) => {
  const got = at(iso).msUntilNextGauntlet();
  ck(got === wantMs, name, `got ${(got / H).toFixed(2)}h want ${(wantMs / H).toFixed(2)}h`);
};

// --- ordinary days, both standard offsets --------------------------------
// EDT (UTC-4): 04:30Z is 00:30 ET, so 23h30m to the next ET midnight.
expect('2026-09-16T04:30:00Z', 23 * H + 30 * M, 'summer (EDT): 00:30 ET leaves 23h30m');
// EST (UTC-5): 05:30Z is 00:30 ET.
expect('2026-12-15T05:30:00Z', 23 * H + 30 * M, 'winter (EST): 00:30 ET leaves 23h30m');
expect('2026-12-15T04:59:00Z', 1 * M, 'one minute before an EST midnight');
expect('2026-09-16T03:59:00Z', 1 * M, 'one minute before an EDT midnight');

// --- the two DST days ----------------------------------------------------
// Spring forward: Mar 8 2026, 02:00 EST -> 03:00 EDT. At 01:30 ET the day has
// only 22h30m of wall clock left but 21h30m of REAL time, because an hour is
// about to vanish. Wall-clock subtraction would say 22h30m.
expect('2026-03-08T06:30:00Z', 21 * H + 30 * M, 'spring forward: a 23-hour ET day is counted as 23 hours');
// Fall back: Nov 1 2026, 02:00 EDT -> 01:00 EST. An hour is repeated, so
// 01:30 EDT is 23h30m of real time from the next ET midnight, not 22h30m.
expect('2026-11-01T05:30:00Z', 23 * H + 30 * M, 'fall back: a 25-hour ET day is counted as 25 hours');
// Immediately after each transition, still correct.
expect('2026-03-08T07:30:00Z', 20 * H + 30 * M, 'just after springing forward');
expect('2026-11-01T07:30:00Z', 21 * H + 30 * M, 'just after falling back');

// --- the offset helper it rests on ---------------------------------------
// Signed as "what to add to a naive UTC timestamp to reach that ET wall-clock
// time", which is the direction nextGauntletInstant consumes it in.
const off = (iso) => at(iso).etOffsetMs(global.Date.parse(iso));
ck(off('2026-09-16T12:00:00Z') === 4 * H, 'EDT (September) is +4h to apply', 'got ' + off('2026-09-16T12:00:00Z') / H);
ck(off('2026-12-15T12:00:00Z') === 5 * H, 'EST (December) is +5h to apply', 'got ' + off('2026-12-15T12:00:00Z') / H);

// The single-offset-lookup shortcut in nextGauntletInstant rests on the naive
// timestamp and the answer sharing a UTC offset. That holds for ET because the
// switch is at 02:00 local (06:00/07:00 UTC), later than both — but it is an
// assumption, so pin it on both transition days rather than leave it implied.
for (const day of ['2026-03-08', '2026-11-01']) {
  const naive = global.Date.parse(day + 'T00:00:00Z');
  const api = at(day + 'T12:00:00Z');
  const resolved = naive + api.etOffsetMs(naive);
  ck(api.etOffsetMs(naive) === api.etOffsetMs(resolved),
     `offset is stable between the naive timestamp and the answer (${day})`,
     `${api.etOffsetMs(naive) / H}h vs ${api.etOffsetMs(resolved) / H}h`);
}

// --- the ET calendar date the whole thing keys off -----------------------
ck(at('2026-09-16T03:59:00Z').getTodayDateStr() === '2026-09-15', 'just before ET midnight it is still yesterday');
ck(at('2026-09-16T04:01:00Z').getTodayDateStr() === '2026-09-16', 'just after ET midnight it is today');

// --- display -------------------------------------------------------------
const f = at('2026-09-16T04:30:00Z').formatCountdown;
ck(f(6 * H + 12 * M) === '6h 12m', 'hours and minutes', 'got ' + f(6 * H + 12 * M));
ck(f(59 * M) === '59m', 'under an hour drops the hours part', 'got ' + f(59 * M));
ck(f(60 * M) === '1h 0m', 'exactly an hour', 'got ' + f(60 * M));
ck(f(30000) === 'under a minute', 'sub-minute has its own wording', 'got ' + f(30000));
ck(f(-5000) === 'under a minute', 'a negative remainder never renders as a number', 'got ' + f(-5000));
ck(f(23 * H + 59 * M) === '23h 59m', 'a nearly full day', 'got ' + f(23 * H + 59 * M));

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
