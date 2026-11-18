/*
 * Dark mode, measured rather than looked at.
 *
 * The palette note at the top of :root says every light value was measured
 * against the page it sits on. A second palette that was picked by eye would
 * quietly undo that for half the players, and nothing on the page would say
 * so - a dark theme always LOOKS plausible, which is the whole problem. So
 * the dark values are held to the light ones' own numbers here.
 *
 * Five things, and the last three are the ones that actually broke:
 *
 *   1. Every token in :root has a counterpart in :root.dark. A token added
 *      to one and forgotten in the other is a colour that silently keeps its
 *      light value on a dark page.
 *   2. The six ink levels and the nine accents hold their light contrast
 *      ratio against the page, within a tenth of a point.
 *   3. --c-on-accent. Light is white because every accent is mid-tone; dark
 *      cannot be, because its accents are LIGHT - white on them reads
 *      2.6-4.1:1. The dark ink has to beat what white manages on paper, for
 *      every accent, or the fills are worse off than they were.
 *   4. THE LIGHT-BANNER ISLAND. Six shop banners paint a literal background
 *      in both themes while the name, rank, date and score on them read
 *      tokens. A plain token swap puts light ink on a light banner and the
 *      name measures 1.10:1 - invisible, on a cosmetic people paid for.
 *   5. COLORBLIND MODE. Same fault, same cause: the Okabe-Ito pair is two
 *      literal fills, and the ink on them used to be tokens. The orange
 *      tile's letter went 6.80:1 -> 1.74:1 the moment a dark palette existed.
 *
 * Then the behaviour: light is the default, "system" follows the device, and
 * the pre-paint script in <head> agrees with the Settings module about all of
 * it - they are two entry points to one decision and a disagreement between
 * them is a flash of the wrong theme on every load.
 *
 * Pure arithmetic and lifted source. No browser: whether the CASCADE delivers
 * these values is board-contrast's and button-contrast's job, and both now
 * run their sweeps in dark as well.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

// ---- colour arithmetic, the same instrument the other contrast tests use --
const hex = (h) => {
  const s = h.replace('#', '');
  const n = s.length === 3 ? [...s].map((c) => c + c) : s.match(/../g);
  return n.slice(0, 3).map((x) => parseInt(x, 16));
};
const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const x = lum(hex(a)), y = lum(hex(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// ---- the two palettes, read out of the stylesheet ------------------------
// Sliced by brace rather than by regexing each name, so a token that exists
// in neither block cannot be invented by a lenient pattern.
const block = (selector) => {
  const at = css.indexOf(selector + ' {');
  if (at < 0) throw new Error(`no ${selector} block in the stylesheet`);
  const body = css.slice(at, css.indexOf('}', at));
  const out = {};
  for (const m of body.matchAll(/--c-([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]] = m[2];
  return out;
};
const LIGHT = block(':root');
const DARK = block(':root.dark');

ck(Object.keys(LIGHT).length >= 20, `read the light palette (${Object.keys(LIGHT).length} colours)`);
ck(Object.keys(DARK).length >= 20, `read the dark palette (${Object.keys(DARK).length} colours)`);

// 1. no token may exist in one palette and not the other
const missing = Object.keys(LIGHT).filter((k) => !DARK[k]);
const extra = Object.keys(DARK).filter((k) => !LIGHT[k]);
ck(missing.length === 0, 'every :root colour has a :root.dark counterpart', missing.join(', '));
ck(extra.length === 0, 'and :root.dark invents none of its own', extra.join(', '));

// 2. parity against the page
const INKS = ['ink', 'ink-2', 'ink-3', 'ink-4', 'ink-5', 'ink-6'];
const ACCENTS = ['correct', 'present', 'loss', 'endless', 'gauntlet', 'clash', 'ffa', 'sprint', 'marathon'];
const SLACK = 0.10;
for (const k of [...INKS, ...ACCENTS]) {
  // A token absent from one palette is already reported above. Measuring it
  // anyway throws, and a throw takes the whole file down with a stack trace
  // instead of a list of which checks failed - which is the opposite of what
  // a test is for.
  if (!LIGHT[k] || !DARK[k]) { ck(false, `--c-${k} exists in both palettes`, 'missing from ' + (LIGHT[k] ? 'dark' : 'light')); continue; }
  const l = ratio(LIGHT[k], LIGHT.page), d = ratio(DARK[k], DARK.page);
  ck(d >= l - SLACK, `--c-${k} is no fainter on a dark page than on paper`,
     `${l.toFixed(2)}:1 light vs ${d.toFixed(2)}:1 dark`);
}
// The absent tile is the one cell whose ink is its own token rather than the ramp.
for (const [name, pal] of [['light', LIGHT], ['dark', DARK]]) {
  ck(ratio(pal['absent-ink'], pal.absent) >= 3.0, `${name}: the letter on an absent tile clears 3:1`,
     ratio(pal['absent-ink'], pal.absent).toFixed(2) + ':1');
}

// 3. --c-on-accent must beat, for every accent, what white manages on paper
for (const k of ACCENTS) {
  const paper = ratio(LIGHT['on-accent'], LIGHT[k]);
  const dark = ratio(DARK['on-accent'], DARK[k]);
  ck(dark >= paper - 0.01, `ink on a filled --c-${k} is no worse in dark than on paper`,
     `${paper.toFixed(2)}:1 light vs ${dark.toFixed(2)}:1 dark`);
}
// Named, because flipping this token is the single change the whole dark
// palette depends on and a "tidy-up" back to #fff would pass everything else.
ck(lum(hex(DARK['on-accent'])) < lum(hex(DARK.page)),
   '--c-on-accent is darker than the dark page, not white', DARK['on-accent']);

// 4. the light-banner island
// The banners are read out of the stylesheet, not listed here, so a seventh
// light banner cannot be added without this test asking about it.
const ISLAND_SEL = css.match(/:root\.dark :is\(([^)]*)\) \{/);
ck(!!ISLAND_SEL, 'found the light-banner island rule');
const islandBanners = ISLAND_SEL ? [...ISLAND_SEL[1].matchAll(/\.(banner_[a-z_]+)/g)].map((m) => m[1]) : [];
// The same list the stylesheet carves out of the black-plate rule above it.
const plateExempt = (css.match(/\[class\*="banner_"\]:not\(([^)]*)\)/) || ['', ''])[1];
const lightBanners = [...plateExempt.matchAll(/\.(banner_[a-z_]+)/g)].map((m) => m[1])
  .filter((b) => b !== 'banner_default');
ck(lightBanners.length === 6, `found the six light banners (${lightBanners.length})`, lightBanners.join(' '));
ck(lightBanners.every((b) => islandBanners.includes(b)),
   'every light banner is inside the island rule',
   lightBanners.filter((b) => !islandBanners.includes(b)).join(', '));

const island = (() => {
  if (!ISLAND_SEL) return {};
  const at = css.indexOf(ISLAND_SEL[0]);
  const body = css.slice(at, css.indexOf('}', at));
  const out = {};
  for (const m of body.matchAll(/--c-([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]] = m[2];
  return out;
})();
// Everything a board row can draw with. ink = the name, ink-4 = the rank,
// ink-5 = the date, endless = the score, correct = your own row's tint.
const ROW_TOKENS = ['ink', 'ink-4', 'ink-5', 'endless', 'correct'];
for (const k of ROW_TOKENS) {
  ck(island[k] === LIGHT[k], `the island hands a light banner the paper --c-${k}`,
     `${island[k] || '(absent)'} vs ${LIGHT[k]}`);
}
// The point of all of it: with the island, what the reader gets on a light
// banner is the paper number; without it, the name is gone.
for (const b of lightBanners) {
  const fill = (css.match(new RegExp('\\.' + b + '\\s*\\{\\s*background-color:\\s*(#[0-9a-fA-F]{3,8})')) || [])[1];
  ck(!!fill, `${b} paints a flat colour we can measure`, fill || '(gradient only)');
  if (!fill) continue;
  ck(ratio(island.ink, fill) >= 4.5, `${b}: a name on it still reads in dark`,
     ratio(island.ink, fill).toFixed(2) + ':1');
  // And the regression itself, stated as the number it would be.
  ck(ratio(DARK.ink, fill) < 2, `${b}: (for the record, the dark ink on it would be unreadable)`,
     ratio(DARK.ink, fill).toFixed(2) + ':1');
}

// 5. colorblind mode: two literal fills, so two literal inks
for (const [cls, fill] of [['correct', '#0072B2'], ['present', '#E69F00']]) {
  const rule = css.match(new RegExp('body\\.colorblind \\.' + cls + ' \\{([^}]*)\\}'));
  ck(!!rule, `found the colorblind .${cls} rule`);
  if (!rule) continue;
  // Anchored on a declaration boundary: "background-color:" ENDS in
  // "color:", so a loose pattern reads the fill and reports a cheerful
  // 1.00:1 against itself. Which is what the first run of this did.
  const ink = (rule[1].match(/(?:^|[;{])\s*color:\s*(#[0-9a-fA-F]{3,8})\s*;/) || [])[1];
  ck(!!ink, `colorblind .${cls} paints its ink with a literal, not a token`,
     ink || rule[1].trim());
  if (!ink) continue;
  ck(rule[1].includes(fill), `colorblind .${cls} still uses its Okabe-Ito fill`, fill);
  ck(ratio(ink, fill) >= 3.0, `colorblind .${cls} is readable in BOTH themes`,
     ratio(ink, fill).toFixed(2) + ':1');
}

// ---- an accent is read on more than the page -----------------------------
// --c-line is .btn-quiet's fill and --c-line-2 is its hover, and that button
// carries accent-coloured text (Share Invite is Clash orange and FFA gold).
// So those two are SURFACES, not just edges, and solving the accents against
// the page alone is not enough: the first dark --c-line put four of the nine
// accents under 3:1 and shipped two buttons at 2.7:1. Both themes, because
// this is a property of the pairing rather than of one palette.
for (const [name, pal] of [['light', LIGHT], ['dark', DARK]]) {
  for (const surf of ['line', 'line-2']) {
    const worst = ACCENTS.map((k) => [k, ratio(pal[k], pal[surf])]).sort((a, b) => a[1] - b[1])[0];
    ck(worst[1] >= 3.0, `${name}: every accent reads on --c-${surf}, which .btn-quiet is filled with`,
       `worst is --c-${worst[0]} at ${worst[1].toFixed(2)}:1`);
  }
}

// ---- the eight seasons, on a dark page -----------------------------------
// A season repaints surfaces and leaves the ink ramp alone, which inverts
// badly: with dark on, each season was putting its LIGHT page back under
// dark ink and measuring 1.20:1 on an unused key. Found by sweeping both
// themes in board-contrast; pinned here so a ninth season cannot ship with
// only half a palette.
const darkSeasons = [...css.matchAll(/:root\.dark body\.season-([a-z]+) \{/g)].map((m) => m[1]);
// The light rule is the one NOT prefixed by the dark selector, so the lookbehind
// earns its keep - without it every dark block counts as a light one too and a
// theme with no light palette at all would read as complete.
const lightSeasons = [...css.matchAll(/(?<!dark )body\.season-([a-z]+) \{/g)].map((m) => m[1]);
ck(lightSeasons.length === 8, `found the eight seasons (${lightSeasons.length})`, lightSeasons.join(' '));
for (const n of lightSeasons) {
  ck(darkSeasons.includes(n), `season-${n} has a dark palette too`);
  if (!darkSeasons.includes(n)) continue;
  const L = block('body.season-' + n), D = block(':root.dark body.season-' + n);
  for (const k of Object.keys(L)) {
    ck(!!D[k], `season-${n}: --c-${k} is set in dark as well as light`, D[k] || '(absent)');
  }
  if (!D.page) continue;
  // The claim the dark seasons are built on: tinting at constant Lab L
  // leaves every contrast ratio where the plain dark theme put it. 0.1 is
  // generous for what is really 8-bit rounding - measured drift is 0.04.
  for (const k of INKS) {
    const got = ratio(DARK[k], D.page), base = ratio(DARK[k], DARK.page);
    ck(Math.abs(got - base) <= 0.1, `season-${n}: --c-${k} reads on it exactly as on the plain dark page`,
       `${got.toFixed(2)}:1 vs ${base.toFixed(2)}:1`);
  }
  // The accent is read AS text, on the wordmark.
  ck(ratio(D.season, D.page) >= 4.5, `season-${n}: the wordmark reads on its dark page`,
     ratio(D.season, D.page).toFixed(2) + ':1');
  ck(ratio(L.season, L.page) >= 4.5, `season-${n}: and still on its light one`,
     ratio(L.season, L.page).toFixed(2) + ':1');
  // A season may not touch a signal. The note at the top of :root makes this
  // rule; a dark palette is a second chance to break it.
  for (const sig of ['correct', 'present', 'loss', 'absent']) {
    ck(!L[sig] && !D[sig], `season-${n} leaves --c-${sig} alone, in both themes`);
  }
}

// ---- the pre-paint script ------------------------------------------------
// Lifted and run, because reading it is how the first attempt at this test
// "passed" while the preference was being dropped on an opaque origin.
const headScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1]).find((s) => s.includes('__applyTheme'));
ck(!!headScript, 'found the pre-paint theme script in <head>');

const runHead = (storedJson, deviceDark, { throws = false } = {}) => {
  const classes = new Set();
  let metaContent = null;
  const win = { matchMedia: (q) => ({ matches: /prefers-color-scheme:\s*dark/.test(q) && deviceDark }) };
  const doc = {
    documentElement: { classList: { toggle: (n, on) => (on ? classes.add(n) : classes.delete(n)) } },
    querySelector: (s) => (/theme-color/.test(s) ? { setAttribute: (k, v) => { metaContent = v; } } : null),
  };
  const store = { getItem: () => { if (throws) throw new Error('storage blocked'); return storedJson; } };
  // The script is the thing that runs before anything else on the page, so
  // "it threw" is a result worth reporting rather than a reason to stop.
  try { new Function('window', 'document', 'localStorage', headScript)(win, doc, store); }
  catch (e) { return { threw: String(e).slice(0, 90), dark: false, meta: null }; }
  return { dark: classes.has('dark'), meta: metaContent, apply: win.__applyTheme };
};

if (headScript) {
  const cases = [
    ['nothing stored, device light', null, false, false],
    ['nothing stored, DEVICE DARK',  null, true,  false],   // the default is a decision
    ['light stored, device dark',    '{"theme":"light"}',  true,  false],
    ['dark stored, device light',    '{"theme":"dark"}',   false, true],
    ['system stored, device dark',   '{"theme":"system"}', true,  true],
    ['system stored, device light',  '{"theme":"system"}', false, false],
    ['garbage stored',               'not json at all',    true,  false],
    ['other settings, no theme',     '{"sound":false}',    true,  false],
  ];
  for (const [label, stored, deviceDark, wantDark] of cases) {
    const r = runHead(stored, deviceDark);
    ck(!r.threw, `first paint: ${label} -> the script survives it`, r.threw || '');
    ck(r.dark === wantDark, `first paint: ${label} -> ${wantDark ? 'dark' : 'light'}`,
       r.dark ? 'dark' : 'light');
    ck(r.meta === (wantDark ? DARK.page : LIGHT.page),
       `first paint: ${label} -> the address bar matches the page`, String(r.meta));
  }
  const blocked = runHead(null, true, { throws: true });
  ck(!blocked.threw && blocked.dark === false,
     'first paint: storage blocked entirely -> paper, not a crash', blocked.threw || '');
}

// ---- the Settings module -------------------------------------------------
// Also lifted and run. The head script and this module are two entry points
// to one decision; proving each separately is the only way to know they agree.
const settingsSrc = html.match(/const Settings = \(\(\) => \{[\s\S]*?\n        \}\)\(\);/);
ck(!!settingsSrc, 'found the Settings module');

if (settingsSrc && headScript) {
  const makeSettings = (storedJson, deviceDark) => {
    const saved = { json: storedJson };
    const bodyClasses = new Set();
    const applied = [];
    let listener = null;
    const win = {
      matchMedia: (q) => ({
        matches: /prefers-color-scheme:\s*dark/.test(q) && deviceDark,
        addEventListener: (ev, fn) => { listener = fn; },
      }),
      __applyTheme: (pref) => { applied.push(pref); return pref; },
    };
    const doc = { body: { classList: { toggle: (n, on) => (on ? bodyClasses.add(n) : bodyClasses.delete(n)) } } };
    const store = {
      getItem: () => saved.json,
      setItem: (k, v) => { saved.json = v; },
    };
    const Seasons = { current: () => null, TABLE: [] };
    const S = new Function('window', 'document', 'localStorage', 'Seasons',
      settingsSrc[0] + '\nreturn Settings;')(win, doc, store, Seasons);
    return { S, applied, saved, fireDeviceChange: () => listener && listener() };
  };

  const fresh = makeSettings('{}', true);
  ck(fresh.S.get().theme === 'light', 'a brand-new player is on light, whatever the device says',
     fresh.S.get().theme);

  const saved = makeSettings('{"theme":"dark"}', false);
  ck(saved.S.get().theme === 'dark', 'a stored preference survives a reload', saved.S.get().theme);
  saved.S.apply();
  ck(saved.applied.at(-1) === 'dark', 'Settings.apply hands the theme to the pre-paint resolver',
     String(saved.applied.at(-1)));

  const set = makeSettings('{}', false);
  set.S.set('theme', 'dark');
  ck(set.applied.at(-1) === 'dark', 'changing the theme applies it at once', String(set.applied.at(-1)));
  ck(JSON.parse(set.saved.json).theme === 'dark', 'and writes it to storage', set.saved.json);

  // The device listener must be live for "system" and inert for the other two,
  // or a player who chose LIGHT gets dragged dark at sunset.
  const sys = makeSettings('{"theme":"system"}', false);
  const before = sys.applied.length;
  sys.fireDeviceChange();
  ck(sys.applied.length > before, 'on AUTO the page follows the device live');
  const fixed = makeSettings('{"theme":"dark"}', false);
  const n = fixed.applied.length;
  fixed.fireDeviceChange();
  ck(fixed.applied.length === n, 'on a chosen theme the device is ignored');
}

// ---- the control ---------------------------------------------------------
const cycleSrc = html.match(/window\.cycleTheme = function\(\) \{[\s\S]*?\n        \};/);
ck(!!cycleSrc, 'found the appearance control');
if (cycleSrc) {
  const run = (start) => {
    let theme = start, rendered = 0;
    const Settings = { get: () => ({ theme }), set: (k, v) => { theme = v; } };
    new Function('window', 'Settings', 'renderSettingsUI',
      cycleSrc[0] + '\nreturn window.cycleTheme;')({}, Settings, () => { rendered++; })();
    return { theme, rendered };
  };
  ck(run('light').theme === 'dark', 'light taps to dark', run('light').theme);
  ck(run('dark').theme === 'system', 'dark taps to auto', run('dark').theme);
  ck(run('system').theme === 'light', 'auto taps back to light', run('system').theme);
  ck(run('nonsense').theme === 'light', 'a corrupted setting taps to light', run('nonsense').theme);
  ck(run('light').rendered === 1, 'and the button redraws itself');
}

// ---- the installed app ---------------------------------------------------
// A manifest is read once at install and cannot follow a preference, so it
// stays paper on purpose - and the <meta> the script moves is what actually
// paints the address bar.
const manifest = JSON.parse(fs.readFileSync(REPO('site.webmanifest'), 'utf8'));
ck(manifest.theme_color.toLowerCase() === LIGHT.page.toLowerCase(),
   'the manifest stays on the light page colour', manifest.theme_color);
ck(/<meta name="theme-color" content="[^"]+">/.test(html),
   'and the page carries a <meta theme-color> the script can move');

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
