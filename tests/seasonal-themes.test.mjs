/*
 * Seasonal themes: which holiday is on, and what it does to the page.
 *
 * Two kinds of thing are pinned here, and they fail in different ways.
 *
 * The DATE MATHS is the half that can be silently wrong for a year at a time.
 * Easter is a moving feast (22 March to 25 April) and Thanksgiving is the
 * fourth Thursday of November, so neither is a fixed MM-DD the way the shop's
 * windows are. A wrong Computus gives you an Easter theme in the wrong week and
 * nothing says so until someone notices. So the real functions are extracted
 * from index.html and checked against known dates, and every window is walked
 * day by day across a decade.
 *
 * The THEMING is the half the other suites cannot see: button-contrast and
 * mobile-layout never put a class on <body>, so they only ever measure the
 * default page. A themed body is invisible to them. Here every season is
 * applied for real in a browser and measured.
 *
 * The rule the whole feature rests on: a theme changes chrome, never signal.
 * Cyan still means the right letter in every season.
 *
 * Needs Playwright.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');

const t = [];
const ck = (name, cond, detail = '') => t.push({ name, cond: !!cond, detail });

// ---- the real module, lifted out of the page ------------------------------
const src = (html.match(/        const Seasons = \(\(\) => \{[\s\S]*?\n        \}\)\(\);/) || [''])[0];
ck('extracted the Seasons module from index.html', src.length > 1500, `${src.length} chars`);
const Seasons = new Function(`${src}\nreturn Seasons;`)();
const ymd = (d) => d.toISOString().slice(0, 10);
const at = (s) => new Date(s + 'T12:00:00Z');

// ---- Easter: a moving feast, so the algorithm is the whole risk -----------
const KNOWN_EASTER = {
  2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28',
  2028: '2028-04-16', 2029: '2029-04-01', 2030: '2030-04-21', 2031: '2031-04-13',
  2032: '2032-03-28', 2033: '2033-04-17', 2034: '2034-04-09', 2035: '2035-03-25',
};
for (const [y, want] of Object.entries(KNOWN_EASTER)) {
  ck(`Easter ${y} is ${want}`, ymd(Seasons.easterFor(+y)) === want, ymd(Seasons.easterFor(+y)));
}
// It must always be a Sunday, and always inside the only range it can occupy.
let notSunday = [], outOfRange = [];
for (let y = 2024; y <= 2124; y++) {
  const e = Seasons.easterFor(y);
  if (e.getUTCDay() !== 0) notSunday.push(y);
  const md = ymd(e).slice(5);
  if (md < '03-22' || md > '04-25') outOfRange.push(`${y}:${md}`);
}
ck('Easter is a Sunday in every year 2024-2124', notSunday.length === 0, notSunday.slice(0, 5).join(','));
ck('and always falls between 22 March and 25 April', outOfRange.length === 0, outOfRange.slice(0, 5).join(','));

// ---- Thanksgiving: fourth Thursday of November ----------------------------
const KNOWN_TG = { 2025: '2025-11-27', 2026: '2026-11-26', 2027: '2027-11-25', 2028: '2028-11-23', 2030: '2030-11-28' };
for (const [y, want] of Object.entries(KNOWN_TG)) {
  ck(`Thanksgiving ${y} is ${want}`, ymd(Seasons.thanksgivingFor(+y)) === want, ymd(Seasons.thanksgivingFor(+y)));
}
let tgBad = [];
for (let y = 2024; y <= 2124; y++) {
  const d = Seasons.thanksgivingFor(y);
  // A fourth Thursday is always a Thursday, always in November, always 22-28.
  if (d.getUTCDay() !== 4 || d.getUTCMonth() !== 10 || d.getUTCDate() < 22 || d.getUTCDate() > 28) tgBad.push(`${y}:${ymd(d)}`);
}
ck('Thanksgiving is a November Thursday on the 22nd-28th, every year to 2124', tgBad.length === 0, tgBad.slice(0, 5).join(','));

// ---- the windows the user specified ---------------------------------------
const season = (s) => { const r = Seasons.current(at(s)); return r ? r.id : null; };

// Halloween opens 15 October, NOT 21 - it is pinned to the day effect_haunted
// unlocks, so the shop and the site agree about whether it is Halloween.
ck('Halloween is off on 14 October', season('2026-10-14') === null, String(season('2026-10-14')));
ck('Halloween opens on 15 October', season('2026-10-15') === 'halloween', String(season('2026-10-15')));
ck('...which is the day effect_haunted unlocks',
   /effect_haunted[\s\S]{0,260}?fromMonthDay: "10-15"/.test(html));
ck('Halloween still on, on the 31st', season('2026-10-31') === 'halloween');
ck('Halloween closes the day after, 1 November', season('2026-11-01') === 'halloween');
ck('and is gone on 2 November', season('2026-11-02') === null, String(season('2026-11-02')));

const WINDOWS = [
  ['valentines',   '2026-02-03', '2026-02-04', '2026-02-15', '2026-02-16'],
  ['stpatricks',   '2026-03-06', '2026-03-07', '2026-03-18', '2026-03-19'],
  ['julyfourth',   '2026-06-23', '2026-06-24', '2026-07-05', '2026-07-06'],
  ['thanksgiving', '2026-11-15', '2026-11-16', '2026-11-27', '2026-11-28'],
  ['christmas',    '2026-12-14', '2026-12-15', '2026-12-26', '2026-12-27'],
];
for (const [id, before, open, close, after] of WINDOWS) {
  ck(`${id}: off the day before it opens`, season(before) !== id, `${before} -> ${season(before)}`);
  ck(`${id}: on from ${open}`, season(open) === id, `${open} -> ${season(open)}`);
  ck(`${id}: still on at ${close}`, season(close) === id, `${close} -> ${season(close)}`);
  ck(`${id}: off again by ${after}`, season(after) !== id, `${after} -> ${season(after)}`);
}
// New Year gets 2 days' lead, not 10, and straddles the year boundary - the
// window opens in the PREVIOUS year, which a naive same-year lookup would miss.
ck('New Year is off on 29 December', season('2026-12-29') === null, String(season('2026-12-29')));
ck('New Year opens on 30 December, in the year before', season('2026-12-30') === 'newyear', String(season('2026-12-30')));
ck('...and is still on, on 31 December', season('2026-12-31') === 'newyear');
ck('...and on 1 January', season('2027-01-01') === 'newyear', String(season('2027-01-01')));
ck('...and closes on 2 January', season('2027-01-02') === 'newyear', String(season('2027-01-02')));
ck('and is gone on 3 January', season('2027-01-03') === null, String(season('2027-01-03')));
// Christmas must have closed before New Year opens, or they would fight.
ck('Christmas and New Year do not overlap',
   season('2026-12-26') === 'christmas' && season('2026-12-30') === 'newyear');

// ---- precedence, which is not hypothetical --------------------------------
// An early Easter opens inside St Patrick's window. Easter wins.
for (const y of [2027, 2032, 2035]) {
  const e = Seasons.easterFor(y);
  const lead = new Date(e); lead.setUTCDate(lead.getUTCDate() - 10);
  const overlapDay = ymd(lead) <= `${y}-03-18` ? ymd(lead) : null;
  ck(`${y}: Easter opens ${ymd(lead)}, inside St Patrick's window`, overlapDay !== null, ymd(lead));
  if (overlapDay) ck(`${y}: Easter takes that day, not St Patrick's`, season(overlapDay) === 'easter', `${overlapDay} -> ${season(overlapDay)}`);
}
ck('St Patrick’s still wins its own days in a late-Easter year',
   season('2026-03-17') === 'stpatricks', String(season('2026-03-17')));

// ---- never two at once, across a full decade ------------------------------
// Walked day by day rather than sampled: an off-by-one in one window only
// shows up on its own boundary day.
let doubles = [], totalThemed = 0;
for (let d = new Date(Date.UTC(2026, 0, 1)); d < new Date(Date.UTC(2036, 0, 1)); d.setUTCDate(d.getUTCDate() + 1)) {
  const hit = Seasons.TABLE.filter((s) => {
    for (const yy of [d.getUTCFullYear() - 1, d.getUTCFullYear(), d.getUTCFullYear() + 1]) {
      const on = s.on(yy);
      const a = new Date(on); a.setUTCDate(a.getUTCDate() - s.lead);
      const b = new Date(on); b.setUTCDate(b.getUTCDate() + 1);
      if (ymd(d) >= ymd(a) && ymd(d) <= ymd(b)) return true;
    }
    return false;
  });
  if (hit.length > 1 && hit[0].id !== 'easter') doubles.push(`${ymd(d)}: ${hit.map((x) => x.id).join('+')}`);
  if (Seasons.current(new Date(d))) totalThemed++;
}
ck('the only overlapping pair in 2026-2035 is Easter over St Patrick’s',
   doubles.length === 0, doubles.slice(0, 4).join(' | '));
// Sanity on the shape of the year: eight windows of ~12 days each, so roughly
// a quarter of the year is themed. Far off in either direction means a window
// is inverted or never opens.
ck('a sane share of the year is themed', totalThemed > 800 && totalThemed < 1100, `${totalThemed} days of 3652`);

// ---- the setting ----------------------------------------------------------
ck('seasonal themes default to on', /defaults = \{[^}]*seasonal: true/.test(html));
ck('the setting lives in localStorage, so a guest gets it too',
   /STORAGE_KEY = "wordcade_settings"/.test(html));
ck('apply() puts exactly one season class on the body',
   /for \(const s of Seasons\.TABLE\) document\.body\.classList\.toggle\("season-" \+ s\.id/.test(html));
ck('turning it off removes every season class',
   /const season = current\.seasonal \? Seasons\.current\(\) : null;/.test(html));
ck('there is a toggle row in the settings modal',
   /id="settings-toggle-seasonal"[^>]*onclick="window\.toggleSetting\('seasonal'\)"/.test(html));
ck('and it is wired into renderSettingsUI like the other three',
   /\["seasonal", s\.seasonal\]/.test(html));
// A toggle switched ON in March changes nothing on screen; without a label
// naming the active season that reads as a broken switch.
ck('the row names the active season', /id="settings-season-note"/.test(html));
// "Seasonal Themes" is the longest of the four labels and space-between alone
// lets it grow until it touches its own button - measured at 0px before a gap
// was set. Checked at the narrowest screen, where it bites first.
{
  const page = await (await (async () => {
    let c; try { ({ chromium: c } = await import('playwright')); }
    catch { const { execSync } = await import('node:child_process');
      ({ chromium: c } = await import(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs'))); }
    const l = {}; if (fs.existsSync('/opt/pw-browsers/chromium')) l.executablePath = '/opt/pw-browsers/chromium';
    return c.launch(l);
  })()).newPage({ viewport: { width: 280, height: 800 } });
  await page.setContent(fs.readFileSync(REPO('index.html'), 'utf8').replace(/<script type="module"[\s\S]*?<\/script>/g, ''));
  const m = await page.evaluate(() => {
    document.getElementById('settings-modal').style.display = 'flex';
    document.getElementById('settings-season-note').innerText = 'Thanksgiving';
    const btn = document.getElementById('settings-toggle-seasonal');
    const label = btn.parentElement.querySelector('span');
    return { gap: btn.getBoundingClientRect().left - label.getBoundingClientRect().right,
             overflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  await page.context().browser().close();
  ck('the settings row keeps its label off its button at 280px', m.gap >= 8, m.gap.toFixed(1) + 'px');
  ck('and the modal does not scroll sideways there', !m.overflow);
}

// ---- every season has CSS, and it is chrome only --------------------------
for (const s of Seasons.TABLE) {
  ck(`${s.id}: has a body rule`, new RegExp(`body\\.season-${s.id} \\{`).test(html));
  ck(`${s.id}: retints the title`, new RegExp(`body\\.season-${s.id} \\.arcade-title \\{`).test(html));
}
// The rule the feature rests on. A theme that recoloured these would also break
// colorblind mode, which overrides .correct/.present as a matched pair.
// Brace-matched, not regex-sliced: a lookahead for the next comment ran on
// into unrelated CSS, so these checks were scanning the whole stylesheet and
// "finds .correct" meant nothing.
const block = (() => {
  let out = '', i = 0;
  while ((i = html.indexOf('body.season-', i)) >= 0) {
    const open = html.indexOf('{', i);
    let depth = 0, j = open;
    for (; j < html.length; j++) { if (html[j] === '{') depth++; else if (html[j] === '}') { depth--; if (!depth) break; } }
    out += html.slice(i, j + 1) + '\n';
    i = j + 1;
  }
  return out;
})();
ck('found the seasonal CSS rules', block.length > 2000 && (block.match(/body\.season-/g) || []).length >= 24,
   `${block.length} chars, ${(block.match(/body\.season-/g) || []).length} rules`);
for (const sel of ['.correct', '.present', '.absent', '.mode-clash', '.mode-ffa', '.mode-gauntlet', '.cash-out-btn']) {
  ck(`no season touches ${sel}`, !block.includes(sel), sel);
}
// Nothing here animates, so reduce-motion has nothing to switch off. If that
// ever changes, the selector has to join the opt-out list.
ck('no season animates, so reduce-motion has nothing to miss',
   !/animation/.test(block), (block.match(/animation[^;]*/) || [''])[0]);

// ---- measured in a browser, with the theme actually applied ---------------
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { const { execSync } = await import('node:child_process');
  ({ chromium } = await import(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs'))); }
const launch = {};
if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(launch);
const markup = fs.readFileSync(REPO('index.html'), 'utf8').replace(/<script type="module"[\s\S]*?<\/script>/g, '');

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.setContent(markup);
const measured = await page.evaluate((ids) => {
  const lum = (rgb) => { const v = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map((x) => +x / 255)
    .map((c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // body carries `transition: background-color 0.3s`, so a computed read taken
  // the instant the class lands returns the colour it is transitioning FROM.
  // Killed here rather than waited out, so the measurement cannot be flaky.
  const killer = document.createElement('style');
  killer.textContent = '* { transition: none !important; }';
  document.head.appendChild(killer);
  const out = {};
  for (const id of ['', ...ids]) {
    document.body.className = id ? 'season-' + id : '';
    const bg = getComputedStyle(document.body).backgroundColor;
    const probe = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).color : null; };
    out[id || 'default'] = {
      bg,
      // The signals, read off the live page under this theme.
      score: probe('#score') && ratio(probe('#score'), bg),
      lives: probe('#continues') && ratio(probe('#continues'), bg),
      title: ratio(getComputedStyle(document.querySelector('.arcade-title')).color, bg),
      // Did the theme leave the gameplay colours alone?
      correct: getComputedStyle(document.querySelector('#legend-correct')).backgroundColor,
      present: getComputedStyle(document.querySelector('#legend-present')).backgroundColor,
      clash: getComputedStyle(document.querySelector('.mode-clash')).color,
    };
  }
  document.body.className = '';
  killer.remove();
  return out;
}, Seasons.TABLE.map((s) => s.id));
await page.close();

const base = measured.default;
for (const s of Seasons.TABLE) {
  const m = measured[s.id];
  ck(`${s.id}: the background actually changed`, m.bg !== base.bg, `${m.bg} vs ${base.bg}`);
  ck(`${s.id}: the title stays legible`, m.title >= 4.5, m.title.toFixed(2) + ':1');
  ck(`${s.id}: the score stays legible`, m.score >= 3, m.score && m.score.toFixed(2) + ':1');
  ck(`${s.id}: the continues counter stays legible`, m.lives >= 3, m.lives && m.lives.toFixed(2) + ':1');
  // The whole point: gameplay feedback is identical in every season.
  ck(`${s.id}: a correct letter is still the same colour`, m.correct === base.correct, `${m.correct} vs ${base.correct}`);
  ck(`${s.id}: a wrong-spot letter is still the same colour`, m.present === base.present, `${m.present} vs ${base.present}`);
  ck(`${s.id}: Clash keeps its own colour`, m.clash === base.clash, `${m.clash} vs ${base.clash}`);
}

// No season may introduce a sideways scroll - the motifs are background layers,
// which cannot push layout, but background-attachment and sizing can surprise.
const wide = await browser.newPage({ viewport: { width: 320, height: 800 } });
await wide.setContent(markup);
const overflow = await wide.evaluate((ids) => {
  const bad = [];
  for (const id of ids) {
    document.body.className = 'season-' + id;
    if (document.documentElement.scrollWidth > window.innerWidth) bad.push(id);
  }
  document.body.className = '';
  return bad;
}, Seasons.TABLE.map((s) => s.id));
await wide.close();
ck('no season makes the page scroll sideways at 320px', overflow.length === 0, overflow.join(','));

await browser.close();
for (const c of t) console.log(c.cond ? 'ok  ' : 'FAIL', c.name, c.cond ? '' : '— ' + c.detail);
const bad = t.filter((c) => !c.cond).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
