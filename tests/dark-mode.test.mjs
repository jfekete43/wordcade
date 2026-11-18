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
 *   4. THE PALE BANNERS. Five shop banners paint a literal background while
 *      the name, rank, date and score on them read tokens. Leaving the fill
 *      alone put light ink on a light banner and the name measured 1.10:1 -
 *      invisible, on a cosmetic people paid for. They paint a dark fill in
 *      dark mode instead, which puts every token on the row back to its
 *      ordinary job. Blueprint left the set: it is dark in both themes.
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

// 4. the pale banners, and Blueprint
// Read out of the stylesheet rather than listed here, so a seventh pale
// banner cannot be added without this test asking about it.
const carveOut = (css.match(/\[class\*="banner_"\]:not\(([^)]*)\)/) || ['', ''])[1];
const ownFill = [...carveOut.matchAll(/\.(banner_[a-z_]+)/g)].map((m) => m[1])
  .filter((b) => b !== 'banner_default');
ck(ownFill.length === 6, `six banners own their background (${ownFill.length})`, ownFill.join(' '));

// The group that takes the page's ink is what "pale" MEANS here: a banner in
// it is one whose fill is light enough to need dark ink on paper.
const inkGroup = (() => {
  const m = css.match(/:is\(([^)]*)\) :is\(\.lb-name, \.daily-board-name\)\.effect_none/);
  return m ? [...m[1].matchAll(/\.(banner_[a-z_]+)/g)].map((x) => x[1]) : [];
})();
ck(inkGroup.length === 5, `five pale banners take the page's ink (${inkGroup.length})`, inkGroup.join(' '));
ck(!inkGroup.includes('banner_blueprint'),
   'Blueprint is not one of them - it is dark in both themes, so it takes white');
ck(ownFill.includes('banner_blueprint'),
   'and it still owns its background, or the #121213 plate would take it');

// The island is GONE, and must stay gone: it pinned paper ink onto these
// rows, which is right under a pale fill and wrong under a dark one.
// A TOKEN block specifically. There is still a :root.dark :is(.banner_...)
// rule - the one that takes the black plate off a neon name - and matching
// the selector alone would flag it, which is a check that fails for being
// right.
ck(![...css.matchAll(/:root\.dark :is\(\.banner_[^)]*\)\s*\{([^}]*)\}/g)].some((m) => /--c-/.test(m[1])),
   'no rule pins paper ink inside a banner any more - the fill flips instead');

// The light rule is the one NOT prefixed by :root.dark, and ".banner_x {"
// occurs inside ":root.dark .banner_x {" too - so without the lookbehind
// this reads whichever comes first in the file, which is an accident of
// where the dark block was pasted. It read the dark fill as the light one
// until this was anchored.
const fillOf = (sel, dark) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = dark ? ':root\\.dark ' + esc : '(?<!:root\\.dark )' + esc;
  const m = css.match(new RegExp(head + '\\s*\\{\\s*background-color:\\s*(#[0-9a-fA-F]{3,8})'));
  return m ? m[1] : null;
};

// Blueprint: one fill, and it has to be a DARK one or white is sitting on pale.
const bp = fillOf('.banner_blueprint', false);
ck(!!bp, 'Blueprint has a fill we can measure', bp || '(none)');
ck(!/:root\.dark \.banner_blueprint\s*\{/.test(css),
   'and only one of them - no dark override, because it is already dark');
if (bp) {
  ck(ratio('#ffffff', bp) >= 4.5, 'a white name reads on Blueprint', ratio('#ffffff', bp).toFixed(2) + ':1');
  ck(ratio(DARK.ink, bp) >= 4.5, 'and so does the dark theme\'s ink', ratio(DARK.ink, bp).toFixed(2) + ':1');
  // It lives on a light page too, so it has to stand off paper as well.
  ck(ratio(bp, LIGHT.page) >= 3, 'and it stands off the paper page', ratio(bp, LIGHT.page).toFixed(2) + ':1');

  // The one island left, and the only banner that needs one: its fill is the
  // SAME literal in both themes, so the ink on it has to be a literal too.
  // The five pale ones flip their fill instead and need nothing. Pinned to
  // the DARK values, which makes the rule a no-op in dark mode and the whole
  // point in light - without it the rank was 2.27:1 and the score 2.61:1.
  const bpIsland = (() => {
    const m = css.match(/\.banner_blueprint \{\s*(--c-[\s\S]*?)\}/);
    if (!m) return null;
    const o = {};
    for (const x of m[1].matchAll(/--c-([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) o[x[1]] = x[2];
    return o;
  })();
  ck(!!bpIsland, 'Blueprint pins the ink that goes on it');
  for (const [what, tok, min] of [['name', 'ink', 4.5], ['rank', 'ink-4', 3.0],
                                  ['date', 'ink-5', 2.5], ['score', 'endless', 3.0]]) {
    const v = bpIsland && bpIsland[tok];
    ck(v === DARK[tok], `Blueprint pins --c-${tok} to the dark palette's value`,
       `${v || '(absent)'} vs ${DARK[tok]}`);
    if (!v) continue;
    // One measurement, because it is pinned: the number is the same in both
    // themes, which is exactly the property being bought here.
    ck(ratio(v, bp) >= min, `Blueprint: the ${what} reads on it, in BOTH themes`,
       ratio(v, bp).toFixed(2) + ':1');
  }
}

// The five: a light fill with the light tokens, a dark fill with the dark
// ones. Every part of the row, both ways - the rank and the score are what
// the first version of this missed by only checking the name.
const ROW = [['name', 'ink', 4.5], ['rank', 'ink-4', 3.0], ['date', 'ink-5', 2.5], ['score', 'endless', 3.0]];
for (const b of inkGroup) {
  const light = fillOf('.' + b, false);
  const dark = fillOf('.' + b, true);
  ck(!!light, `${b} has a light fill`, light || '(gradient only)');
  ck(!!dark, `${b} has a dark fill for dark mode`, dark || '(MISSING)');
  if (!light || !dark) continue;
  // A copy-paste that left a light value in the dark rule would pass every
  // ratio below, because light ink on light fill is only wrong by theme.
  ck(ratio(dark, DARK.page) < ratio(light, DARK.page),
     `${b}'s dark fill is actually darker than its light one`,
     `${dark} vs ${light}`);
  for (const [what, tok, min] of ROW) {
    ck(ratio(LIGHT[tok], light) >= min, `${b}: the ${what} reads on it in light`,
       ratio(LIGHT[tok], light).toFixed(2) + ':1');
    ck(ratio(DARK[tok], dark) >= min, `${b}: the ${what} reads on it in dark`,
       ratio(DARK[tok], dark).toFixed(2) + ':1');
  }
  // And the fault that started all of this, stated as the number it would be.
  ck(ratio(DARK.ink, light) < 2, `${b}: (for the record, dark ink on the LIGHT fill would be gone)`,
     ratio(DARK.ink, light).toFixed(2) + ':1');
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
