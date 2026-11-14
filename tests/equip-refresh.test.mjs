/*
 * Equipping something has to repaint the boards that are showing you.
 *
 * The Stakes boards read /users, so cosmetics there were always live. Sprint
 * and Trifecta rank /runs, and a run document carries the copy of `equipped`
 * it was written with — so buying and equipping a banner changed one set of
 * boards and not the other, which is what a player sees as "the Sprint
 * leaderboard is stuck".
 *
 * onEquippedChanged pushes the new set onto today's runs instead. What has to
 * hold: it does nothing at all on the writes that are not equips (which is
 * most of them — onRunCreated touches the same document on every run), it
 * finds the runs by the same ids the client reads back, it never writes
 * outside /runs (a write to /users would retrigger it), and it leaves past
 * days alone.
 *
 * A run carries a frozen copy of the player's NAME for the same reason, and
 * that one had no fix at all: renaming yourself left the Sprint board and the
 * morning digest calling you the old thing, while the Hall of Fame tab one tap
 * away - which reads /users - called you the new one. On a single row a new
 * banner appeared beside an old name, because the trigger above patches
 * `equipped` and only `equipped`.
 *
 * changeUsername patches the same two documents, in the same transaction as
 * the rename, so there is no window where the profile and the board disagree.
 * Deliberately bounded to TODAY: patching a player's whole history is one
 * write per run, and a finished day is a record of who played it under that
 * name. The second half of this file covers that.
 *
 * The real handler is lifted out and run against a fake Firestore.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const read = (f) => fs.readFileSync(REPO(f), 'utf8').replace(/\r\n/g, '\n');
const fn = read('functions/index.js');
const html = read('index.html');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const grab = (src, re, what) => { const m = src.match(re); if (!m) throw new Error('could not extract ' + what); return m[0]; };

// ---- the handler, lifted ---------------------------------------------------
const src = [
  grab(fn, /function wornMap\(value\) \{\n[\s\S]*?\n\}/, 'wornMap'),
  grab(fn, /function sameEquipped\(a, b\) \{\n[\s\S]*?\n\}/, 'sameEquipped'),
  grab(fn, /function getTodayDateStr\(\) \{\n[\s\S]*?\n\}/, 'getTodayDateStr'),
  grab(fn, /function runDocId\(mode, uid, dateStr\) \{[^\n]*\}/, 'runDocId'),
  grab(fn, /const PER_DAY_RUN_MODES = \[[^\]]*\];/, 'PER_DAY_RUN_MODES'),
  grab(fn, /exports\.onEquippedChanged = onDocumentUpdated\("users\/\{userId\}", async \(event\) => \{\n[\s\S]*?\n\}\);/, 'the trigger'),
].join('\n\n');
console.log('lifted from functions/index.js:', src.length, 'chars');

// A fake Firestore that records what it was asked to do. `present` is the set
// of document paths that exist.
const fakeDb = (present) => {
  const reads = [];
  const writes = [];
  const commits = [];
  return {
    reads, writes, commits,
    collection: (name) => ({ doc: (id) => ({ path: `${name}/${id}` }) }),
    getAll: async (...refs) => {
      reads.push(...refs.map((r) => r.path));
      return refs.map((r) => ({ ref: r, exists: present.includes(r.path) }));
    },
    batch: () => ({
      update: (ref, data) => writes.push({ path: ref.path, data }),
      commit: async () => commits.push(writes.length),
    }),
  };
};

const build = (db) => {
  const exported = {};
  // The v2 trigger factory just wraps the handler; the stub hands it straight
  // back so the body can be called with an event of our own making.
  new Function('exports', 'onDocumentUpdated', 'db', src)(exported, (_p, h) => h, db);
  return exported.onEquippedChanged;
};

const fire = async ({ before, after, uid = 'p1', present = [] }) => {
  const db = fakeDb(present);
  await build(db)({
    params: { userId: uid },
    data: {
      before: { data: () => before },
      after: { data: () => after },
    },
  });
  return db;
};

// The handler's own idea of today, so the expected ids are not a second
// implementation of the date rule.
const TODAY = new Function(`${grab(fn, /function getTodayDateStr\(\) \{\n[\s\S]*?\n\}/, 'getTodayDateStr')}\nreturn getTodayDateStr();`)();
const dailyPath = (uid = 'p1') => `runs/daily_${uid}_${TODAY}`;
const sprintPath = (uid = 'p1') => `runs/sprint_${uid}_${TODAY}`;

// ---- the writes that are not equips do nothing -----------------------------
{
  const worn = { title: 'title_wizard', skin: 'skin_default', banner: 'banner_neon', effect: 'effect_pulse' };
  // onRunCreated rewrites a dozen stat fields on this document after every
  // single run. If that cost two reads each time, this trigger would be the
  // most expensive thing in the game.
  const o = await fire({ before: { wallet: 10, equipped: worn }, after: { wallet: 99, equipped: { ...worn } },
                         present: [dailyPath(), sprintPath()] });
  eq('a profile write that leaves the cosmetics alone reads nothing', o.reads, []);
  eq('...and writes nothing', o.writes, []);
  eq('...and does not even open a batch', o.commits, []);
}
{
  const o = await fire({ before: {}, after: { wallet: 5 }, present: [dailyPath()] });
  eq('a profile that has never equipped anything is also a no-op', o.reads, []);
}
{
  const o = await fire({ before: undefined, after: { equipped: { banner: 'banner_neon' } }, present: [dailyPath()] });
  ck(o.reads.length === 2, 'a document with no prior state counts as a change', JSON.stringify(o.reads));
}
{
  const o = await fire({ before: { equipped: { banner: 'banner_neon' } }, after: undefined, present: [dailyPath()] });
  eq('a deleted profile is not chased', o.reads, []);
}

// ---- an equip patches today's runs -----------------------------------------
{
  const after = { username: 'SODA', equipped: { title: 'title_wizard', banner: 'banner_neon', effect: 'effect_none', skin: 'skin_default' } };
  const o = await fire({ before: { username: 'SODA', equipped: { title: 'title_none', banner: 'banner_default', effect: 'effect_none', skin: 'skin_default' } },
                         after, present: [dailyPath(), sprintPath()] });
  eq('both of today\'s runs are read', o.reads, [dailyPath(), sprintPath()]);
  eq('...in one round trip', o.commits, [2]);
  eq('both are patched', o.writes.map((w) => w.path), [dailyPath(), sprintPath()]);
  // The whole map, not a field-by-field merge: the point is for the run to
  // agree with the profile, and a merge would leave a slot just cleared.
  eq('with the profile\'s equipped map exactly as it now stands',
     o.writes.map((w) => w.data), [{ equipped: after.equipped }, { equipped: after.equipped }]);
  ck(o.writes.every((w) => w.path.startsWith('runs/')),
     'and nothing outside /runs is touched, so the trigger cannot retrigger itself',
     JSON.stringify(o.writes.map((w) => w.path)));
  ck(!o.writes.some((w) => 'username' in w.data || 'score' in w.data),
     'the run\'s own record of what happened is left alone', JSON.stringify(o.writes));
}
{
  // Garbage in a profile's equipped slot does not get copied onto a run. The
  // boards reject it either way (safeCosmetic whitelists the class, titleText
  // looks the id up), but a run document's equipped is a map everywhere else
  // in the game and there is no reason for this path to be the exception.
  const o = await fire({ before: { equipped: { banner: 'banner_neon' } }, after: { equipped: ['banner_neon'] },
                         present: [sprintPath()] });
  eq('a malformed equipped map is written as nothing equipped',
     o.writes.map((w) => w.data), [{ equipped: {} }]);
}
{
  // Played Sprint today but not the Trifecta: one row to fix, not two, and no
  // phantom document created for the mode that was not played.
  const o = await fire({ before: { equipped: { banner: 'banner_default' } }, after: { equipped: { banner: 'banner_neon' } },
                         present: [sprintPath()] });
  eq('only the run that exists is patched', o.writes.map((w) => w.path), [sprintPath()]);
  eq('...and the batch still commits once', o.commits, [1]);
}
{
  const o = await fire({ before: { equipped: { banner: 'banner_default' } }, after: { equipped: { banner: 'banner_neon' } }, present: [] });
  eq('a player who has not played today costs two reads and stops', o.reads.length, 2);
  eq('...writing nothing', o.writes, []);
  eq('...and never opening a batch', o.commits, []);
}
{
  // Yesterday's run is not in the id set at all. The archive keeps what the
  // player was wearing that day, deliberately — the alternative is rewriting
  // every run they have ever recorded.
  const o = await fire({ before: { equipped: { banner: 'banner_default' } }, after: { equipped: { banner: 'banner_neon' } },
                         present: [`runs/daily_p1_2026-01-01`, `runs/sprint_p1_2026-01-01`, dailyPath()] });
  eq('a past day is neither read nor rewritten', o.writes.map((w) => w.path), [dailyPath()]);
  ck(!o.reads.some((r) => r.includes('2026-01-01')), 'nor looked at', JSON.stringify(o.reads));
}
{
  const o = await fire({ before: { equipped: { banner: 'banner_default' } }, after: { equipped: { banner: 'banner_neon' } },
                         uid: 'other', present: [dailyPath('other'), dailyPath('p1')] });
  eq('only the player who equipped is patched', o.writes.map((w) => w.path), [dailyPath('other')]);
}

// ---- what counts as a change -----------------------------------------------
const same = new Function(`${grab(fn, /function wornMap\(value\) \{\n[\s\S]*?\n\}/, 'wornMap')}\n${grab(fn, /function sameEquipped\(a, b\) \{\n[\s\S]*?\n\}/, 'sameEquipped')}\nreturn sameEquipped;`)();
{
  ck(same({ banner: 'b' }, { banner: 'b' }), 'the same slot with the same value is no change');
  ck(!same({ banner: 'b' }, { banner: 'c' }), 'a slot swapped is a change');
  ck(!same({ banner: 'b' }, {}), 'a slot cleared is a change');
  ck(!same({}, { banner: 'b' }), 'a slot filled is a change');
  ck(same({}, {}), 'two empty maps are the same');
  ck(same(undefined, {}), 'and so are absent and empty');
  ck(same(undefined, undefined), '...and absent and absent');
  ck(same({ banner: undefined }, {}), 'a slot explicitly set to undefined is not something being worn');
  // Compared over the union of both sides' keys, not against a list of slot
  // names written into the function — so a slot added to DEFAULT_EQUIPPED
  // later is covered the day it exists.
  ck(!same({}, { pet: 'pet_cat' }), 'a slot this function has never heard of still counts');
  ck(!same({ pet: 'pet_cat' }, {}), '...in either direction');
  ck(same(null, undefined), 'null and undefined both mean nothing equipped');
  // A malformed `equipped` is read as nothing equipped rather than as a value,
  // on both sides — so a profile holding one reads as unchanged and no run is
  // rewritten. firestore.rules only accepts a map of the four known slots from
  // a client, so this is the shape nothing is supposed to be able to reach;
  // the point is that it fails closed rather than copying junk onto a run.
  ck(same('banner_neon', {}), 'a value that is not a map at all is not something being worn');
  ck(same(['banner_neon'], {}), '...nor is a list');
  const defaults = grab(fn, /const DEFAULT_EQUIPPED = \{[^\n]*\};/, 'DEFAULT_EQUIPPED');
  const slots = Object.keys(new Function(`${defaults}\nreturn DEFAULT_EQUIPPED;`)());
  for (const slot of slots) {
    ck(!same({}, { [slot]: 'x' }), `equipping a ${slot} is a change`);
  }
  ck(slots.length >= 4, 'every slot the game ships was covered above', JSON.stringify(slots));
}

// ---- the ids are the ones the client reads back ----------------------------
// Two implementations of one id scheme: the server writes these documents and
// looks them up here, the client reads them to tell a player where they
// placed. They have drifted apart before over the date format.
{
  const serverId = new Function(`${grab(fn, /function runDocId\(mode, uid, dateStr\) \{[^\n]*\}/, 'runDocId')}\nreturn runDocId;`)();
  const clientSrc = [
    grab(html, / {8}function dailyRunId\(uid, dateStr\) \{[^\n]*\}/, 'dailyRunId'),
    grab(html, / {8}const ARCHIVES = \{\n[\s\S]*?\n {8}\};/, 'ARCHIVES'),
  ].join('\n');
  const ARCHIVES = new Function(`${clientSrc}\nreturn ARCHIVES;`)();
  const modes = new Function(`${grab(fn, /const PER_DAY_RUN_MODES = \[[^\]]*\];/, 'PER_DAY_RUN_MODES')}\nreturn PER_DAY_RUN_MODES;`)();

  eq('the trigger covers both once-a-day modes', [...modes].sort(), ['daily', 'sprint']);
  for (const mode of modes) {
    ck(ARCHIVES[mode], `the client has an archive for ${mode}`, JSON.stringify(Object.keys(ARCHIVES)));
    eq(`${mode}: server and client spell the run id the same`,
       serverId(mode, 'p1', '2026-11-05'), ARCHIVES[mode].runId('p1', '2026-11-05'));
  }
  // And it is the spelling the write sites actually use, not just a helper
  // sitting beside them.
  for (const mode of modes) {
    ck(new RegExp(`db\\.collection\\("runs"\\)\\.doc\\(runDocId\\("${mode}", uid, today\\)\\)`).test(fn),
       `the ${mode} submit handler writes through runDocId`);
  }
  ck(!/\.doc\(`(daily|sprint)_\$\{uid\}/.test(fn),
     'and no write site still builds the id by hand');
}

// ---- and the player who equipped it does not wait for the round trip ------
// The trigger fixes the board for everyone, but it is a Firestore trigger and
// the person who just equipped something is looking at the screen now. Their
// own row is answered from the profile the client already holds.
{
  const liveEquipped = new Function('currentUser', 'userProfileData', `
    ${grab(html, / {8}function liveEquipped\(run\) \{\n[\s\S]*?\n {8}\}/, 'liveEquipped')}
    return liveEquipped;`);
  const mine = { banner: 'banner_neon' };
  const frozen = { banner: 'banner_default' };
  const signedIn = liveEquipped({ uid: 'me' }, { equipped: mine });

  eq('the viewer\'s own row takes the live profile',
     signedIn({ uid: 'me', equipped: frozen }), mine);
  eq('another player\'s row keeps the copy the run was written with',
     signedIn({ uid: 'them', equipped: frozen }), frozen);
  // Nobody else's can be answered this way: it would cost a users read per
  // player per paint, which is what the stored copy exists to avoid.
  eq('...even when they are wearing nothing', signedIn({ uid: 'them' }), undefined);
  eq('a signed-out viewer gets the stored copy',
     liveEquipped(null, null)({ uid: 'me', equipped: frozen }), frozen);
  eq('...and so does one whose profile has not loaded yet',
     liveEquipped({ uid: 'me' }, null)({ uid: 'me', equipped: frozen }), frozen);
  eq('a profile with nothing equipped falls back rather than blanking the row',
     liveEquipped({ uid: 'me' }, {})({ uid: 'me', equipped: frozen }), frozen);
  eq('a run with no uid is nobody\'s own row', signedIn({ equipped: frozen }), frozen);

  // It is the Sprint board that needs it. The others read /users already.
  const board = html.indexOf('async function loadSprintBoard()');
  const end = html.indexOf('window.leaveSprint = function', board);
  ck(board > 0 && end > board && /liveEquipped\(v\)/.test(html.slice(board, end)),
     'the Sprint board builds its rows through it');
}

// ---- equipping repaints the board behind the menu --------------------------
{
  const src = grab(html, / {8}function refreshModeBoard\(\) \{\n[\s\S]*?\n {8}\}/, 'refreshModeBoard');
  const run = (sprint) => {
    const called = [];
    new Function('isSprintMode', 'loadSprintBoard',
      `${src}\nrefreshModeBoard();`)(sprint, () => called.push('sprint'));
    return called;
  };
  eq('on the Sprint screen the board reloads', run(true), ['sprint']);
  eq('anywhere else nothing is reloaded', run(false), []);
  ck(/applyEquippedCosmetics\(\); refreshModeBoard\(\)/.test(html),
     'and equipping something is what calls it');
}

// ---- the other frozen field: the handle ------------------------------------
{
  const start = fn.indexOf('exports.changeUsername = onCall(');
  const open = fn.indexOf('async (request) => {', start);
  let d = 0, body = '';
  for (let k = fn.indexOf('{', open); k < fn.length; k++) {
    if (fn[k] === '{') d++;
    else if (fn[k] === '}') { d--; if (!d) { body = fn.slice(open, k + 1); break; } }
  }
  ck(body.length > 200, 'lifted the real changeUsername handler', String(body.length));

  const rename = async ({ runsToday = ['sprint'], noProfile = false, name = 'NEWNAME' } = {}) => {
    const writes = [], reads = [], order = [];
    let txs = 0;
    const docs = new Map();
    // A Map key set to undefined still answers has() true, so an absent
    // profile has to be an absent KEY.
    if (!noProfile) docs.set('users/u1', { username: 'OLDNAME', handleChanges: 2 });
    for (const m of runsToday) docs.set(`runs/${m}_u1_2026-11-14`, { username: 'OLDNAME', score: 500 });
    const ref = (path) => ({ path });
    const snapOf = (r) => ({ exists: docs.has(r.path), data: () => docs.get(r.path), ref: r });
    const db = {
      collection: (c) => ({ doc: (id) => ref(`${c}/${id}`) }),
      runTransaction: async (f) => {
        txs++;
        const out = await f({
          get: async (r) => { order.push('read'); reads.push(r.path); return snapOf(r); },
          getAll: async (...rs) => { order.push('read'); rs.forEach((r) => reads.push(r.path)); return rs.map(snapOf); },
          update: (r, v) => { order.push('write'); writes.push({ path: r.path, v }); },
        });
        // Firestore rejects a read issued after a write in the same
        // transaction. The fake enforces it so the ordering is a property of
        // the code rather than of the order it happens to be written in.
        const fw = order.indexOf('write'), lr = order.lastIndexOf('read');
        if (fw >= 0 && lr > fw) throw new Error('READ AFTER WRITE in transaction');
        return out;
      },
    };
    const handler = new Function('requireAuth', 'HANDLE_MAX', 'HttpsError', 'HANDLE', 'handleTaken',
      'db', 'getTodayDateStr', 'runDocId', 'PER_DAY_RUN_MODES', `return (${body});`)(
      () => 'u1', 12, class extends Error { constructor(c, m) { super(m); this.code = c; } },
      { isBlockedHandle: () => false }, async () => false,
      db, () => '2026-11-14', (m, u, dd) => `${m}_${u}_${dd}`, ['daily', 'sprint']);
    const result = await handler({ data: { username: name } });
    return { writes, reads, txs, result };
  };

  const r = await rename({ runsToday: ['sprint'] });
  eq('the rename and the run patch are ONE transaction', r.txs, 1);
  ck(r.writes.some((w) => w.path === 'users/u1' && w.v.username === 'NEWNAME'),
     'the profile is renamed', JSON.stringify(r.writes));
  ck(r.writes.some((w) => w.path === 'runs/sprint_u1_2026-11-14' && w.v.username === 'NEWNAME'),
     "today's Sprint run is renamed with it - which is what the board ranks",
     JSON.stringify(r.writes));
  const runWrite = r.writes.find((w) => w.path.startsWith('runs/')) || { v: {} };
  eq('and only the name is touched, not the score or the cosmetics',
     Object.keys(runWrite.v), ['username']);

  const absent = await rename({ runsToday: [] });
  eq('a player who has not played today writes no run at all',
     absent.writes.filter((w) => w.path.startsWith('runs/')).length, 0);
  ck(absent.writes.some((w) => w.path === 'users/u1'), '...but is still renamed',
     JSON.stringify(absent.writes));

  const both = await rename({ runsToday: ['daily', 'sprint'] });
  eq('both per-day modes are patched',
     both.writes.filter((w) => w.path.startsWith('runs/')).map((w) => w.path).sort(),
     ['runs/daily_u1_2026-11-14', 'runs/sprint_u1_2026-11-14']);
  // Bounded: exact ids, never a query. A rename must not cost a write per run
  // the player has ever recorded.
  eq('three reads - the profile and the two run ids', both.reads.length, 3);
  ck(both.reads.every((pth) => pth === 'users/u1' || /^runs\/(daily|sprint)_u1_2026-11-14$/.test(pth)),
     'reached by exact id, with no query over the player history', both.reads.join(', '));
  ck(!both.writes.some((w) => /_2026-11-13$/.test(w.path)),
     'and yesterday is left alone - a finished day records who played it then',
     both.writes.map((w) => w.path).join(', '));

  let threw = null;
  try { await rename({ noProfile: true }); } catch (e) { threw = e.message; }
  ck(/Profile not found/.test(threw || ''), 'a missing profile still refuses', String(threw));

  // The board behind the menu has to be told, the same way equipping tells it.
  const handler = html.slice(html.indexOf('const result = await callChangeUsername('),
                             html.indexOf('const result = await callChangeUsername(') + 900);
  ck(/refreshModeBoard\(\)/.test(handler),
     'and the client repaints the board it was renamed in front of', handler.slice(0, 200));
}

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
