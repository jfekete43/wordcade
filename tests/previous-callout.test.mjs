/*
 * "You finished 2nd of 7" — yesterday's placement, shown when you come back.
 *
 * Both one-a-day modes have one now. It is the return hook: the run you last
 * played only became a placement after you closed the tab, so this is the one
 * chance the game gets to tell you how it went.
 *
 * Three things are easy to get wrong and all three are silent:
 *
 *   THE DAY. It must be yesterday, not today — today's board is still filling
 *   and a placement from it is a lie by lunchtime.
 *   THE FALLBACK. The placement needs three aggregation queries; the score
 *   needs none. A failed count must still leave a sentence on the screen.
 *   THE MODE. One function serves both, so a Sprint callout that numbered its
 *   day off the Trifecta's epoch, or read the Trifecta's runs, would still
 *   render a confident-looking line.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const grab = (re, what) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + what); return m[0]; };

const src = [
  grab(/        function escapeHtml\(str\) \{\n[\s\S]*?\n        \}/, 'escapeHtml'),
  grab(/        function shiftDateStr\(dateStr, days\) \{\n[\s\S]*?\n        \}/, 'shiftDateStr'),
  grab(/        function ordinal\(v\) \{\n[\s\S]*?\n        \}/, 'ordinal'),
  grab(/        const SPRINT_EPOCH = "[^"]*";/, 'SPRINT_EPOCH'),
  grab(/        function sprintNumber\(dateStr\) \{\n[\s\S]*?\n        \}/, 'sprintNumber'),
  grab(/        const TRIFECTA_EPOCH = "[^"]*";/, 'TRIFECTA_EPOCH'),
  grab(/        function gauntletNumber\(dateStr\) \{\n[\s\S]*?\n        \}/, 'gauntletNumber'),
  grab(/        function runScore\(r\) \{[^\n]*\}/, 'runScore'),
  grab(/        function runClock\(r\) \{\n[\s\S]*?\n        \}/, 'runClock'),
  grab(/        const ARCHIVES = \{\n[\s\S]*?\n        \};/, 'ARCHIVES'),
  grab(/        async function showPreviousCallout\(kind\) \{\n[\s\S]*?\n        \}/, 'showPreviousCallout'),
  grab(/        function hidePreviousCallout\(kind\) \{\n[\s\S]*?\n        \}/, 'hidePreviousCallout'),
].join('\n\n');
console.log('extracted from index.html:', src.length, 'chars');

const TODAY = '2026-12-01';
// The badge is decoration; stubbed so an assertion can say which one was used
// without carrying five SVGs through this file.
const build = (opts) => {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, innerHTML: '', style: {} });
  const api = new Function(
    'document', 'currentUser', 'getTodayDateStr', 'fetchMyArchiveRun', 'fetchArchiveStanding',
    'placeBadge', 'PLACE_BADGES', 'asked',
    `${src}\nreturn { showPreviousCallout, hidePreviousCallout, ARCHIVES };`)(
    { getElementById: el },
    opts.signedIn === false ? null : { uid: 'me' },
    () => TODAY,
    async (cfg, dateStr) => { opts.asked.push(['run', cfg.callout, dateStr]); return opts.run; },
    async (cfg, dateStr) => {
      opts.asked.push(['standing', cfg.callout, dateStr]);
      if (opts.standingThrows) throw new Error('count failed');
      return opts.standing;
    },
    (p) => `[badge${p}]`, { plain: '[plain]' }, opts.asked);
  return { api, els };
};
const show = async (kind, opts = {}) => {
  const o = { asked: [], run: { score: 1250, wordsGuessed: 3, elapsedMs: 20000 }, standing: { place: 2, total: 7 }, ...opts };
  o.asked = [];
  const { api, els } = build(o);
  await api.showPreviousCallout(kind);
  const id = kind === 'sprint' ? 'sprint-callout' : 'gauntlet-callout';
  return { el: els[id] || { style: {}, innerHTML: '' }, asked: o.asked, api, els };
};

// ---- both modes have a strip, and it is their own ------------------------
ck(/<div id="gauntlet-callout" class="mode-callout"/.test(html), 'the Trifecta has a callout element');
ck(/<div id="sprint-callout" class="mode-callout"/.test(html), 'and so does Sprint');
ck(/\.mode-callout \{/.test(html), 'they share one style rule rather than two that drift');
ck(html.indexOf('id="sprint-callout"') < html.indexOf('id="sprint-card"'),
   'Sprint\'s sits above the gate, which is the screen a returning player lands on');
// Shown on the landing, which is where a returning player actually arrives —
// not behind a tap into the mode.
// Sliced FORWARDS from the definition. `window.leaveSprint` appears as an
// onclick in the markup thousands of characters earlier, so the obvious pair
// of indexOf calls runs backwards and yields "" — which passes a positive
// check only by failing it, and would pass a negative one outright.
const after = (from, to) => {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`no forward slice ${from} -> ${to}`);
  return html.slice(a, b);
};
const landing = after('function showSprintLanding()', 'window.leaveSprint = function');
ck(landing.length > 200 && /showPreviousCallout\("sprint"\)/.test(landing),
   'the Sprint landing asks for it', String(landing.length));
const leaving = after('window.leaveSprint = function', '// --- PLACEMENT BADGES ---');
ck(leaving.length > 100 && /hidePreviousCallout\("sprint"\)/.test(leaving),
   'and leaving Sprint takes it down, so it does not follow you to Stakes', String(leaving.length));
ck(/showPreviousCallout\("daily"\)/.test(html) && /hidePreviousCallout\("daily"\)/.test(html),
   'the Trifecta goes through the same two functions');

// ---- it reads YESTERDAY, in that mode's own numbering --------------------
{
  const s = await show('sprint');
  eq('Sprint asks for yesterday, and for its own element',
     s.asked.filter(([k]) => k === 'run'), [['run', 'sprint-callout', '2026-11-30']]);
  ck(!s.asked.some(([, , d]) => d === TODAY), 'never for today, whose board is still filling');
  const g = await show('daily');
  eq('and the Trifecta the same', g.asked.filter(([k]) => k === 'run'),
     [['run', 'gauntlet-callout', '2026-11-30']]);
}
// The label is each mode's own count from its own epoch. Sprint started two
// days before the Trifecta, so the two numbers for one date differ — which is
// exactly what a shared callout would get wrong.
{
  const s = await show('sprint');
  const g = await show('daily');
  const num = (h) => Number((h.match(/#(\d+)/) || [])[1]);
  ck(/Sprint #\d+/.test(s.el.innerHTML), 'the Sprint strip names a Sprint', s.el.innerHTML.slice(0, 80));
  ck(/Trifecta #\d+/.test(g.el.innerHTML), 'and the Trifecta strip a Trifecta', g.el.innerHTML.slice(0, 80));
  ck(num(s.el.innerHTML) !== num(g.el.innerHTML),
     'with different numbers for the same day, because the epochs differ',
     `${num(s.el.innerHTML)} vs ${num(g.el.innerHTML)}`);
}

// ---- what it says --------------------------------------------------------
{
  const s = await show('sprint');
  ck(/you finished/.test(s.el.innerHTML) && /2nd of 7/.test(s.el.innerHTML),
     'a resolved placement is the sentence', s.el.innerHTML.slice(-80));
  ck(s.el.innerHTML.includes('[badge2]'), 'with the badge for that place, not a generic one');
  eq('and the strip is shown', s.el.style.display, 'block');
}
{
  // Three aggregation queries can fail where a score cannot. The run is in
  // hand by then, so the strip still says something.
  const s = await show('sprint', { standingThrows: true });
  ck(/you scored/.test(s.el.innerHTML) && /1,250/.test(s.el.innerHTML),
     'a failed count falls back to the score rather than to nothing', s.el.innerHTML.slice(-70));
  ck(s.el.innerHTML.includes('[plain]'), 'with the neutral badge, since there is no place to show');
  eq('and it is still shown', s.el.style.display, 'block');
}

// ---- when it says nothing ------------------------------------------------
{
  const none = await show('sprint', { run: null });
  eq('a day you did not play reports nothing', none.el.style.display, 'none');
  eq('and asks for no placement either', none.asked.filter(([k]) => k === 'standing'), []);
}
{
  const out = await show('sprint', { signedIn: false });
  eq('signed out, nothing', out.el.style.display, 'none');
  eq('and no reads at all', out.asked, []);
}
{
  const bad = await show('nonsense');
  eq('an unknown mode is not an error', bad.el.style.display, undefined);
}
// Reopening the screen must clear the last one before deciding, or a strip
// from the mode you were just in stays up over this one.
{
  const o = { asked: [], run: null, standing: null };
  const { api, els } = build(o);
  els['sprint-callout'] = { id: 'sprint-callout', innerHTML: 'stale', style: { display: 'block' } };
  await api.showPreviousCallout('sprint');
  eq('a strip left from last time is cleared before anything is read',
     [els['sprint-callout'].innerHTML, els['sprint-callout'].style.display], ['', 'none']);
}

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
