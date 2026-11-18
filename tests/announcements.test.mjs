/*
 * What's New: the card that tells returning players something shipped.
 *
 * It exists because shipping a feature and saying nothing is how the feature
 * goes unused - dark mode went in and the only way to find out was to open
 * Settings and read every row. The risk with a thing like this is not that it
 * breaks loudly; it is that it quietly stops showing, or shows one that was
 * dismissed last week, and nobody notices for a month, because an
 * announcement nobody sees looks exactly like an announcement nobody needed.
 *
 * THE RULE IT IMPLEMENTS. One live announcement at a time: the first entry in
 * the table. It stays up for a player until they dismiss it - no expiry,
 * because an announcement that times out is one that some of the people it
 * was written for never read. A new entry replaces whatever came before it
 * and, since the seen list is keyed by id, reaches EVERYBODY, including the
 * people who dismissed the last one. And none of it goes to a newcomer, who
 * has the welcome cards to read and should not have to read both.
 *
 * So the decision - which card, if any, is this player owed - is a pure
 * function, lifted out of the page and run here against seen-lists rather
 * than eyeballed in a browser. The five ways it can be wrong:
 *
 *   1. SHOWING A DISMISSED ONE. The seen list is keyed by id. A single
 *      "seen announcements" flag would mean the second card never shows to
 *      anybody who dismissed the first, which is the failure that makes this
 *      kind of system rot in place.
 *   2. NOT REACHING SOMEBODY WHEN A NEW ONE SHIPS - the same bug from the
 *      other side, and the one the whole design turns on.
 *   3. RESURRECTING AN OLD ONE. Everything below the top of the table has
 *      been said already.
 *   4. GREETING A NEWCOMER with the welcome cards AND this, back to back,
 *      which is how a new player decides the game is a lot of work.
 *   5. SHOWING NOTHING because storage came back as rubbish. A corrupted or
 *      blocked localStorage must degrade to "show it", not to a crash on the
 *      line that decides whether the player sees anything at all.
 *
 * The shipped table is checked as data too - ids unique, dates well-formed
 * and in the same order as the entries themselves, and every call to action
 * naming a function that actually exists on window. A card whose button does
 * nothing is worse than no card.
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

const WELCOME_KEY = 'wordcade_mode_intro_endless';

const makeEnv = ({ stored = null, muted = false, openModal = false, consentBar = false,
                   join = false, storageThrows = false, welcomed = true } = {}) => {
  // A real key-value store, because hasSeenWelcomeCard walks it by index -
  // a stub with only getItem would make that function untestable and it is
  // the one deciding whether newcomers are left alone.
  const map = new Map();
  if (welcomed) map.set(WELCOME_KEY, '1');
  if (stored !== null) map.set('wordcade_announce_seen', stored);
  const guard = () => { if (storageThrows) throw new Error('storage blocked'); };
  const settings = { announcements: !muted };
  const el = {};
  const node = (id) => (el[id] = el[id] || { id, innerText: '', className: '', style: {} });
  const win = {};
  const env = {
    window: win,
    document: {
      getElementById: (id) => (id === 'consent-bar' ? (consentBar ? node(id) : null) : node(id)),
      querySelectorAll: () => (openModal ? [{ _open: true }] : []),
    },
    localStorage: {
      get length() { guard(); return map.size; },
      key: (i) => { guard(); return [...map.keys()][i] ?? null; },
      getItem: (k) => { guard(); return map.has(k) ? map.get(k) : null; },
      setItem: (k, v) => { guard(); map.set(k, v); },
    },
    getComputedStyle: (m) => ({ display: m._open ? 'flex' : 'none' }),
    Settings: { get: () => settings, set: (k, v) => { settings[k] = v; } },
    location: { search: join ? '?join=ABCDE' : '' },
    URLSearchParams,
  };
  const names = Object.keys(env);
  const api = new Function(...names, block +
    '\nreturn { ANNOUNCEMENTS, pendingAnnouncement, announcementsSeen, hasSeenWelcomeCard,' +
    ' maybeShowAnnouncement, dismiss: window.dismissAnnouncement, act: window.announcementAct };')
    (...names.map((n) => env[n]));
  return { api, map, settings, el, win };
};

const { api: A } = makeEnv();
ck(Array.isArray(A.ANNOUNCEMENTS) && A.ANNOUNCEMENTS.length >= 1,
   `the announcement table loads (${A.ANNOUNCEMENTS.length} entr${A.ANNOUNCEMENTS.length === 1 ? 'y' : 'ies'})`);

// ---- the shipped table, as data ------------------------------------------
const ids = new Set();
for (const a of A.ANNOUNCEMENTS) {
  const where = a.id || '(no id)';
  ck(!!a.id && !ids.has(a.id), `${where}: has a unique id`);
  ids.add(a.id);
  for (const f of ['date', 'icon', 'title', 'text']) ck(!!a[f], `${where}: has ${f}`, String(a[f]));
  ck(/^\d{4}-\d{2}-\d{2}$/.test(a.date || ''), `${where}: the date is a day key`, String(a.date));
  ck((a.title || '').length <= 32, `${where}: the title fits a 360px card`, `${(a.title || '').length} chars`);
  if (a.cta) {
    ck(!!a.cta.label && !!a.cta.run, `${where}: the call to action is complete`);
    // The button has to DO something. `run` is a name, so nothing but a
    // string match can tell us the function is there.
    ck(new RegExp('window\\.' + a.cta.run + '\\s*=\\s*(async\\s*)?function').test(html),
       `${where}: window.${a.cta.run}() exists to be called`);
  }
}
// Position decides which one is live; the date is what a human reads. If
// they disagree, an entry added in the wrong place is silently buried and
// nobody ever sees it.
const dates = A.ANNOUNCEMENTS.map((a) => a.date);
ck(JSON.stringify(dates) === JSON.stringify([...dates].sort().reverse()),
   'the table is newest first, so the top entry really is the latest', dates.join(' > '));
ck(A.ANNOUNCEMENTS[0].id === 'dark-mode', 'dark mode is the live announcement', A.ANNOUNCEMENTS[0].id);

// ---- 1-3: which one, if any ----------------------------------------------
const OLD = { id: 'older', date: '2026-10-01', title: 'Older', icon: 'o', text: 'x' };
const NEW = { id: 'newer', date: '2026-11-18', title: 'Newer', icon: 'n', text: 'x' };
// Both of these default rather than reaching straight in. A decision
// function that throws, and a storage slot that was never written, each turn
// a failing check into a stack trace that takes the whole file down - and the
// check it was hiding is the one that says what actually went wrong. Found by
// mutation: emptying the table and dropping the write both crashed this.
const pick = (list, seen = [], muted = false) => {
  try {
    const r = A.pendingAnnouncement(seen, muted, list);
    return r ? r.id : null;
  } catch (e) { return 'THREW: ' + e.message; }
};
const seenList = (map) => {
  try { return JSON.parse(map.get('wordcade_announce_seen') || '[]'); } catch (e) { return []; }
};
ck(pick([NEW, OLD]) === 'newer', 'the live announcement is the one at the top');
ck(pick([NEW, OLD], ['newer']) === null, 'dismissed: nothing, not the one underneath it');
ck(pick([OLD], ['older']) === null, 'and nothing once the only entry is read');
// The behaviour the whole design is for.
ck(pick([OLD], ['older']) === null && pick([NEW, OLD], ['older']) === 'newer',
   'a NEW announcement reaches somebody who dismissed the last one');
ck(pick([NEW, OLD], ['newer', 'older']) === null, 'and does not come back once they read it too');
ck(pick([NEW, OLD], [], true) === null, 'muted: nothing');
ck(pick([], []) === null, 'an empty table shows nothing rather than throwing');

// ---- 5: storage that lies ------------------------------------------------
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
  let threw = null, welcomed = null;
  try { api.announcementsSeen(); welcomed = api.hasSeenWelcomeCard(); } catch (e) { threw = String(e); }
  ck(!threw, 'storage blocked entirely: still no throw', threw || '');
  // And it has to fail CLOSED. With no storage there is no way to know
  // whether this person has been here before, and the cost of guessing wrong
  // is a newcomer reading the welcome cards and this back to back - which is
  // the one thing the gate exists to prevent. Not throwing is not enough.
  ck(welcomed === false, 'and reads as a newcomer rather than guessing otherwise', String(welcomed));
}

// ---- 4: the newcomer gate ------------------------------------------------
{
  const { api } = makeEnv({ welcomed: false });
  ck(api.hasSeenWelcomeCard() === false, 'a browser with no welcome card behind it reads as new');
}
{
  const { api } = makeEnv({ welcomed: true });
  ck(api.hasSeenWelcomeCard() === true, 'and one with a mode intro dismissed reads as returning');
}
{
  // It must key on the PREFIX, not on one named mode: a player who only ever
  // plays Marathon has wordcade_mode_intro_marathon and nothing else.
  const { api, map } = makeEnv({ welcomed: false });
  map.set('wordcade_mode_intro_marathon', '1');
  ck(api.hasSeenWelcomeCard() === true, 'any mode counts, not just the first one in the list');
}
{
  const { api, map } = makeEnv({ welcomed: false });
  map.set('wordcade_save', '{}');
  map.set('wordcade_settings', '{}');
  ck(api.hasSeenWelcomeCard() === false,
     'the game\'s other storage keys do not count as a welcome card');
}

// ---- showing it, and not showing it --------------------------------------
const boxOf = (el) => el['announce-modal'] || { style: {} };
const shown = (opts) => {
  const { api, el } = makeEnv(opts);
  api.maybeShowAnnouncement();
  return boxOf(el).style.display === 'flex';
};
ck(shown({}), 'a returning player with it unread sees it');
ck(!shown({ welcomed: false }), 'a newcomer does not - they have the welcome cards to read');
ck(!shown({ join: true }), 'and nor does somebody following a tap-to-join link');
ck(!shown({ openModal: true }), 'it never stacks on an open modal');
ck(!shown({ consentBar: true }), 'nor on the consent bar, which is not one');
ck(!shown({ muted: true }), 'muted: not shown');
ck(!shown({ stored: '["dark-mode"]' }), 'already dismissed: not shown');
{
  // The refire guard. onAuthStateChanged runs again when a guest links a
  // Google account, and a card that comes back after it was dismissed is
  // worse than one that never showed.
  const { api, el } = makeEnv({});
  api.maybeShowAnnouncement();
  ck(boxOf(el).style.display === 'flex', 'the first call opens it', String(boxOf(el).style.display));
  boxOf(el).style.display = 'none';
  api.maybeShowAnnouncement();
  ck(boxOf(el).style.display === 'none', 'it is tried once per page load, not once per auth event');
}

// ---- dismissing it -------------------------------------------------------
{
  const { api, map, settings, el } = makeEnv({});
  api.maybeShowAnnouncement();
  api.dismiss(false);
  ck(boxOf(el).style.display === 'none', 'dismissing closes it');
  ck(seenList(map).includes('dark-mode'),
     'and records the id, so it is done until a new one ships', String(map.get('wordcade_announce_seen')));
  ck(settings.announcements === true, 'without turning the rest of them off');
}
{
  const { api, map, settings } = makeEnv({});
  api.maybeShowAnnouncement();
  api.dismiss(true);
  ck(settings.announcements === false, '"stop showing these" turns future ones off');
  // Or turning them back on replays something already read.
  ck(seenList(map).includes('dark-mode'),
     'and still records this one as read', String(map.get('wordcade_announce_seen')));
}
{
  const { api, map, win } = makeEnv({});
  let opened = 0;
  win.openSettingsMenu = () => { opened++; };
  api.maybeShowAnnouncement();
  api.act();
  ck(opened === 1, 'the call to action runs the function it names');
  ck(seenList(map).includes('dark-mode'),
     'and counts as having read the card', String(map.get('wordcade_announce_seen')));
}
{
  // A cta naming something that is not there must not take the page down on
  // a button press - the table is data and data can be wrong.
  const { api } = makeEnv({});
  let threw = null;
  api.maybeShowAnnouncement();
  try { api.act(); } catch (e) { threw = String(e); }
  ck(!threw, 'a call to action naming a missing function closes the card quietly', threw || '');
}
{
  const { api } = makeEnv({ storageThrows: true });
  let threw = null;
  api.maybeShowAnnouncement();
  try { api.dismiss(false); } catch (e) { threw = String(e); }
  ck(!threw, 'dismissing with storage blocked does not throw', threw || '');
}

// ---- the welcome cards are still the welcome cards -----------------------
// The announcement defers to these, so they have to still be there, and
// still be once-per-mode rather than once ever.
ck(/function showModeIntro\(mode\)/.test(html), 'the welcome cards are still in the page');
ck(/localStorage\.setItem\(modeIntroKey\(mode\), "1"\)/.test(html),
   'and each one is still remembered per mode, which is what hasSeenWelcomeCard reads');

// ---- the setting it lands in ---------------------------------------------
ck(/announcements: true/.test(html), 'announcements default to ON in Settings');
ck(/id="settings-toggle-announcements"/.test(html), 'and there is a Settings row to turn them back on');
ck(/\["announcements", s\.announcements\]/.test(html), 'which the settings screen actually renders');
ck(/>Feature Updates</.test(html), 'the row is labelled for a player, not for the code');

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
