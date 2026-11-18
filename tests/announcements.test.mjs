/*
 * What's New: the card that tells people something shipped.
 *
 * It exists because shipping a feature and saying nothing is how the feature
 * goes unused - dark mode went in and the only way to find out was to open
 * Settings and read every row. The risk with a thing like this is not that it
 * breaks loudly; it is that it quietly stops showing, or starts showing the
 * wrong card, or shows one that was dismissed last week, and nobody notices
 * for a month because an announcement nobody sees looks exactly like an
 * announcement nobody needed.
 *
 * So the decision - which card, if any, is this player owed - is a pure
 * function, lifted out of the page and run here against dates and seen-lists
 * rather than eyeballed in a browser. The four ways it can be wrong:
 *
 *   1. SHOWING A DISMISSED ONE. The seen list is keyed by id. A single
 *      "seen announcements" flag would mean the second card never shows to
 *      anybody who dismissed the first, which is the failure that makes this
 *      kind of system rot in place.
 *   2. SHOWING AN EXPIRED ONE, or missing a live one by an off-by-one at
 *      either end of the window. The window is authored and inclusive, so
 *      both edges are walked day by day here.
 *   3. SHOWING THE WRONG ONE when two are live: the newest wins, because a
 *      backlog must not make somebody read last month's news first.
 *   4. SHOWING NOTHING because storage came back as rubbish. A corrupted or
 *      blocked localStorage must degrade to "show it", not to a crash on
 *      the line that decides whether the player sees anything at all.
 *
 * The shipped table is checked as data too - dates well-formed, ids unique,
 * windows the right way round, and every call to action naming a function
 * that actually exists on window. A card whose button does nothing is worse
 * than no card.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

// ---- the real block, lifted ----------------------------------------------
const start = html.indexOf('const ANNOUNCEMENTS = [');
const end = html.indexOf('const modeIntroKey =');
ck(start > 0 && end > start, 'found the announcement block in index.html');
const block = html.slice(start, end);

const makeEnv = ({ stored = '[]', today = '2026-11-18', muted = false, openModal = false,
                   consentBar = false, join = false, storageThrows = false } = {}) => {
  const saved = { json: stored, settings: { announcements: !muted } };
  const el = {};
  const node = (id) => (el[id] = el[id] || { id, innerText: '', className: '', style: {} });
  const win = {};
  const doc = {
    getElementById: (id) => (id === 'consent-bar' ? (consentBar ? node(id) : null) : node(id)),
    querySelectorAll: () => (openModal ? [{ _open: true }] : []),
  };
  const env = {
    window: win,
    document: doc,
    localStorage: {
      getItem: () => { if (storageThrows) throw new Error('blocked'); return saved.json; },
      setItem: (k, v) => { if (storageThrows) throw new Error('blocked'); saved.json = v; },
    },
    getComputedStyle: (m) => ({ display: m._open ? 'flex' : 'none' }),
    getTodayDateStr: () => today,
    Settings: { get: () => saved.settings, set: (k, v) => { saved.settings[k] = v; } },
    location: { search: join ? '?join=ABCDE' : '' },
    URLSearchParams,
  };
  const names = Object.keys(env);
  const api = new Function(...names, block +
    '\nreturn { ANNOUNCEMENTS, pendingAnnouncement, announcementsSeen, maybeShowAnnouncement,' +
    ' dismiss: window.dismissAnnouncement, act: window.announcementAct, el: null };')
    (...names.map((n) => env[n]));
  return { api, saved, el, win, node };
};

const { api: A, saved: S0 } = makeEnv();
ck(Array.isArray(A.ANNOUNCEMENTS) && A.ANNOUNCEMENTS.length >= 1,
   `the announcement table loads (${A.ANNOUNCEMENTS.length} entr${A.ANNOUNCEMENTS.length === 1 ? 'y' : 'ies'})`);

// ---- the shipped table, as data ------------------------------------------
const ids = new Set();
for (const a of A.ANNOUNCEMENTS) {
  const where = a.id || '(no id)';
  ck(!!a.id && !ids.has(a.id), `${where}: has a unique id`);
  ids.add(a.id);
  for (const f of ['from', 'until', 'icon', 'title', 'text']) {
    ck(!!a[f], `${where}: has ${f}`, String(a[f]));
  }
  ck(/^\d{4}-\d{2}-\d{2}$/.test(a.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(a.until || ''),
     `${where}: the window is two day keys`, `${a.from} .. ${a.until}`);
  ck((a.from || '') <= (a.until || ''), `${where}: the window is the right way round`);
  // A date typo is the one error here that silently does nothing: 2026-11-18
  // mistyped as 2062 shows the card to nobody, ever, with no symptom.
  const days = Math.round((Date.parse(a.until) - Date.parse(a.from)) / 86400000);
  ck(days >= 0 && days <= 60, `${where}: the window is a sane length (${days} days)`);
  ck(a.title.length <= 32, `${where}: the title fits a 360px card`, `${a.title.length} chars`);
  if (a.cta) {
    ck(!!a.cta.label && !!a.cta.run, `${where}: the call to action is complete`);
    // The button has to DO something. `run` is a name, so nothing but a
    // string match can tell us the function is there.
    ck(new RegExp('window\\.' + a.cta.run + '\\s*=\\s*(async\\s*)?function').test(html),
       `${where}: window.${a.cta.run}() exists to be called`);
  }
}
ck(A.ANNOUNCEMENTS.some((a) => a.id === 'dark-mode'), 'the dark mode announcement is in the table');

// ---- 1 + 2: the window, walked ------------------------------------------
const LIST = [
  { id: 'older', from: '2026-11-01', until: '2026-11-20', title: 'Older', icon: 'o', text: 'x' },
  { id: 'newer', from: '2026-11-18', until: '2026-11-25', title: 'Newer', icon: 'n', text: 'x' },
];
const pick = (today, seen = [], muted = false) => {
  const r = A.pendingAnnouncement(today, seen, muted, LIST);
  return r ? r.id : null;
};
ck(pick('2026-10-31') === null, 'the day before it opens: nothing');
ck(pick('2026-11-01') === 'older', 'the first day of the window: shown');
ck(pick('2026-11-20') === 'newer', 'the last day of the older one, with a newer live: the newer');
ck(pick('2026-11-25') === 'newer', 'the last day of the window: still shown');
ck(pick('2026-11-26') === null, 'the day after it closes: nothing');
// Both edges, every day, rather than trusting two spot checks.
let openDays = 0;
for (let d = 1; d <= 30; d++) {
  const day = `2026-11-${String(d).padStart(2, '0')}`;
  if (pick(day)) openDays++;
}
ck(openDays === 25, 'the two windows are open on exactly the days they say', `${openDays} of 30`);

// ---- 3: newest first -----------------------------------------------------
ck(pick('2026-11-19') === 'newer', 'with two live, the newer one wins');
ck(pick('2026-11-19', ['newer']) === 'older',
   'and the older one is still waiting underneath it');
ck(pick('2026-11-19', ['newer', 'older']) === null, 'both dismissed: nothing');
// The regression that makes this rot: dismissing one must not bury the rest.
ck(pick('2026-11-19', ['older']) === 'newer',
   'dismissing one announcement does not suppress the others');
ck(pick('2026-11-19', [], true) === null, 'muted: nothing, even with two live');

// ---- 4: storage that lies ------------------------------------------------
for (const [what, stored] of [['valid JSON that is not a list', '{"seen":1}'],
                              ['not JSON at all', 'wat'],
                              ['a list with junk in it', '[1,null,"dark-mode"]'],
                              ['empty', '']]) {
  const { api } = makeEnv({ stored });
  let got, threw = null;
  try { got = api.announcementsSeen(); } catch (e) { threw = String(e); }
  ck(!threw && Array.isArray(got), `storage holding ${what}: reads as a list, does not throw`,
     threw || JSON.stringify(got));
}
{
  const { api } = makeEnv({ stored: '[1,null,"dark-mode"]' });
  ck(JSON.stringify(api.announcementsSeen()) === '["dark-mode"]',
     'and the junk inside it is dropped rather than compared against', JSON.stringify(api.announcementsSeen()));
}
{
  const { api } = makeEnv({ storageThrows: true });
  let threw = null;
  try { api.announcementsSeen(); } catch (e) { threw = String(e); }
  ck(!threw, 'storage blocked entirely: still no throw', threw || '');
}

// ---- showing it, and not showing it --------------------------------------
// A card that never opened leaves no element behind in the fake DOM, so
// reaching straight into it turns "it did not show" into a TypeError and a
// stack trace - which takes the whole file down instead of naming the one
// check that failed. Found by mutating the window to exclude its first day.
const boxOf = (el) => el['announce-modal'] || { style: {} };
const shown = (opts) => {
  const { api, el } = makeEnv(opts);
  api.maybeShowAnnouncement(opts.brandNew || false);
  return (el['announce-modal'] && el['announce-modal'].style.display) === 'flex';
};
ck(shown({}), 'a returning player inside the window sees it');
ck(!shown({ brandNew: true }), 'a brand-new account does not - everything is new to them');
ck(!shown({ join: true }), 'and nor does somebody following a tap-to-join link');
ck(!shown({ openModal: true }), 'it never stacks on an open modal');
ck(!shown({ consentBar: true }), 'nor on the consent bar, which is not one');
ck(!shown({ muted: true }), 'muted: not shown');
ck(!shown({ today: '2026-11-26' }), 'outside the window: not shown');
ck(!shown({ stored: '["dark-mode"]' }), 'already dismissed: not shown');
{
  // The refire guard. onAuthStateChanged runs again when a guest links a
  // Google account, and a card that comes back after it was dismissed is
  // worse than one that never showed.
  const { api, el } = makeEnv({});
  api.maybeShowAnnouncement(false);
  ck(boxOf(el).style.display === 'flex', 'the first call opens it', String(boxOf(el).style.display));
  boxOf(el).style.display = 'none';
  api.maybeShowAnnouncement(false);
  ck(boxOf(el).style.display === 'none', 'it is tried once per page load, not once per auth event');
}

// ---- dismissing it -------------------------------------------------------
{
  const { api, saved, el } = makeEnv({});
  api.maybeShowAnnouncement(false);
  api.dismiss(false);
  ck(boxOf(el).style.display === 'none', 'dismissing closes it');
  ck(JSON.parse(saved.json).includes('dark-mode'), 'and records the id, so it is done for good', saved.json);
  ck(saved.settings.announcements === true, 'without turning the rest of them off');
}
{
  const { api, saved } = makeEnv({});
  api.maybeShowAnnouncement(false);
  api.dismiss(true);
  ck(saved.settings.announcements === false, '"stop showing these" turns future ones off');
  // Or turning them back on replays something already read.
  ck(JSON.parse(saved.json).includes('dark-mode'), 'and still records this one as read', saved.json);
}
{
  const { api, saved, win } = makeEnv({});
  let opened = 0;
  win.openSettingsMenu = () => { opened++; };
  api.maybeShowAnnouncement(false);
  api.act();
  ck(opened === 1, 'the call to action runs the function it names');
  ck(JSON.parse(saved.json).includes('dark-mode'), 'and counts as having read the card', saved.json);
}
{
  // A cta naming something that is not there must not take the page down on
  // a button press - the table is data and data can be wrong.
  const { api } = makeEnv({});
  let threw = null;
  api.maybeShowAnnouncement(false);
  try { api.act(); } catch (e) { threw = String(e); }
  ck(!threw, 'a call to action naming a missing function closes the card quietly', threw || '');
}
{
  const { api } = makeEnv({ storageThrows: true });
  let threw = null;
  api.maybeShowAnnouncement(false);
  try { api.dismiss(false); } catch (e) { threw = String(e); }
  ck(!threw, 'dismissing with storage blocked does not throw', threw || '');
}

// ---- the setting it lands in ---------------------------------------------
ck(/announcements: true/.test(html), 'announcements default to ON in Settings');
ck(/id="settings-toggle-announcements"/.test(html), 'and there is a Settings row to turn them back on');
ck(/\["announcements", s\.announcements\]/.test(html), 'which the settings screen actually renders');
// The card says "Stop showing these" and the row says "Feature Updates".
// Both are fine; what is not fine is the row being absent, because then the
// link on the card is a one-way door.
ck(/>Feature Updates</.test(html), 'the row is labelled for a player, not for the code');

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
