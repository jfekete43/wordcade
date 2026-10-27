/*
 * The three boards that share the home screen's one leaderboard slot.
 *
 * Why this exists: the daily board used to be the only one, and on a day
 * nobody had played it rendered an empty list under a confident heading. An
 * empty leaderboard is a worse advertisement for a game than no leaderboard,
 * so all-time leads now and daily is a tab.
 *
 * Three things here are the kind that break silently.
 *
 * The DEFAULT. The markup carries the all-time state so the tabs are right
 * before any script runs — the same trick the mode nav uses — which means the
 * markup and `let homeBoard` can disagree, and the only symptom is a tab
 * highlighted for a board you are not looking at.
 *
 * The ORDER of initialisation. loadHomeBoard() runs at the bottom of the
 * script, BEFORE `const LEADERBOARD_PERIOD` further down is initialised. The
 * weekly board reads it through periodKeyFor(), so weekly as the default would
 * throw a ReferenceError out of the temporal dead zone on every page load.
 * All-time needs nothing but an orderBy. That is load-bearing, not incidental.
 *
 * The FIELDS. Each board reads a different one, and the key that scopes it has
 * to match — periodBestScore with periodBestKey, dayBestScore with dayBestKey.
 * Crossing them queries an index that exists and returns the wrong window.
 *
 * index.html cannot be imported (its module imports Firebase from gstatic), so
 * the functions are lifted out by source and run, the way boot-latency does.
 * That runs the shipped code rather than a copy of it.
 *
 * Pure; no browser, no emulator.
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

function between(src, startAnchor, endAnchor, label) {
  const a = src.indexOf(startAnchor);
  if (a === -1) throw new Error(`${label}: start anchor not found`);
  const b = src.indexOf(endAnchor, a + startAnchor.length);
  if (b === -1) throw new Error(`${label}: end anchor not found`);
  return src.slice(a + startAnchor.length, b);
}

// ---- the table, lifted and evaluated -------------------------------------
const tableSrc = 'const HOME_BOARDS = {' + between(html, 'const HOME_BOARDS = {', '\n        };', 'HOME_BOARDS') + '\n};';
// eslint-disable-next-line no-new-func
const HOME_BOARDS = new Function(`${tableSrc}; return HOME_BOARDS;`)();

eq('three boards share the slot', Object.keys(HOME_BOARDS), ['all', 'weekly', 'daily']);
eq('and all-time is listed first, which is the order the tabs render in',
   Object.keys(HOME_BOARDS)[0], 'all');

// Each board reads its own field. Crossing these is the bug that queries a
// real index and quietly answers about the wrong window.
eq('all-time reads bestRunScore', HOME_BOARDS.all.field, 'bestRunScore');
eq('weekly reads periodBestScore', HOME_BOARDS.weekly.field, 'periodBestScore');
eq('daily reads dayBestScore', HOME_BOARDS.daily.field, 'dayBestScore');

for (const [k, b] of Object.entries(HOME_BOARDS)) {
  ck(typeof b.empty === 'string' && b.empty.length > 10,
     `${k} says something when it is empty, rather than showing a blank list`, String(b.empty));
}
// Expanding opens the Hall of Fame on the board you were already reading.
eq('all-time expands to the Hall of Fame all-time tab', HOME_BOARDS.all.lb, 'all');
eq('weekly expands to its own tab', HOME_BOARDS.weekly.lb, 'weekly');
eq('daily expands to nothing, because the day arrows are its depth', HOME_BOARDS.daily.lb, null);
for (const lb of ['all', 'weekly']) {
  ck(new RegExp(`id="tab-${lb}"`).test(html), `and the Hall of Fame really has a ${lb} tab to open`);
}

// ---- the default, in three places that must agree ------------------------
const declared = (html.match(/let homeBoard = "(\w+)"/) || [])[1];
eq('the script starts on all-time', declared, 'all');
// The temporal dead zone. periodKeyFor() reads a `const` declared ~800 lines
// below the call that boots the board; weekly as the default would throw on
// every load. Pinned because it is invisible until it is not.
ck(declared !== 'weekly',
   'and not on weekly, which would read LEADERBOARD_PERIOD before it exists');
// Matched as the DECLARATION, not the name: the comment beside the default
// explains this hazard in prose, and a check a comment can satisfy is not a
// check. (It found the comment first, which is exactly how this read backwards
// on the first run.)
const periodConstAt = html.indexOf('const LEADERBOARD_PERIOD = "');
const bootCallAt = html.lastIndexOf('loadHomeBoard();');
ck(periodConstAt > bootCallAt,
   'the hazard is real: LEADERBOARD_PERIOD is still declared after the boot call',
   `const@${periodConstAt} boot@${bootCallAt}`);

const tabsMarkup = between(html, '<div class="tabs" id="home-board-tabs">', '</div>', 'tabs markup');
const activeInMarkup = (tabsMarkup.match(/id="hb-tab-(\w+)"[^>]*class="tab-btn active"|class="tab-btn active"[^>]*id="hb-tab-(\w+)"/) || []);
const markedTab = activeInMarkup[1] || activeInMarkup[2];
eq('the markup highlights the same tab the script starts on', markedTab, declared);
for (const k of Object.keys(HOME_BOARDS)) {
  ck(new RegExp(`id="hb-tab-${k}"`).test(tabsMarkup), `there is a tab button for ${k}`);
}
ck((tabsMarkup.match(/class="tab-btn active"/g) || []).length === 1,
   'exactly one tab ships active', String((tabsMarkup.match(/active/g) || []).length));

// ---- the chrome, run for real against a fake DOM -------------------------
const chromeSrc = 'function renderHomeBoardChrome() {'
  + between(html, 'function renderHomeBoardChrome() {', '\n        }', 'renderHomeBoardChrome') + '\n}';

const runChrome = (board, offset) => {
  const els = {};
  const el = (id) => (els[id] = els[id] || {
    id, innerText: '', disabled: false, style: {},
    classList: { set: new Set(), toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); },
                 contains(c) { return this.set.has(c); } },
  });
  const document = { getElementById: el };
  // eslint-disable-next-line no-new-func
  new Function('document', 'homeBoard', 'dailyBoardOffset', 'DAILY_BOARD_MAX_BACK',
               'HOME_BOARDS', 'dailyBoardLabel', `${chromeSrc}; renderHomeBoardChrome();`)(
    document, board, offset, 7, HOME_BOARDS, (o) => (o === 0 ? "Today's Best Runs" : `day-${o}`));
  return els;
};

{
  const e = runChrome('all', 0);
  eq('all-time: the title is the board, not a date', e['daily-board-title'].innerText, 'All-Time Best Runs');
  eq('all-time: the day arrows are hidden', [e['daily-board-prev'].style.display, e['daily-board-next'].style.display], ['none', 'none']);
  ck(e['home-board-more'].style.display !== 'none', 'all-time: the expand button is offered');
  ck(e['hb-tab-all'].classList.contains('active'), 'all-time: its own tab is marked');
  ck(!e['hb-tab-daily'].classList.contains('active'), 'and the others are not');
}
{
  const e = runChrome('weekly', 0);
  eq('weekly: its own title', e['daily-board-title'].innerText, "This Week's Best");
  eq('weekly: no day arrows either', e['daily-board-prev'].style.display, 'none');
  ck(e['home-board-more'].style.display !== 'none', 'weekly: the expand button is offered');
  ck(e['hb-tab-weekly'].classList.contains('active'), 'weekly: its own tab is marked');
}
{
  const e = runChrome('daily', 0);
  eq('daily: the title is the day', e['daily-board-title'].innerText, "Today's Best Runs");
  ck(e['daily-board-prev'].style.display !== 'none', 'daily: the day arrows come back');
  eq('daily: and the expand button goes, because the arrows are the depth',
     e['home-board-more'].style.display, 'none');
  ck(e['daily-board-next'].disabled, 'daily: there is no later day than today');
  ck(!e['daily-board-prev'].disabled, 'but there are earlier ones');
}
{
  const e = runChrome('daily', 7);
  ck(e['daily-board-prev'].disabled, 'daily: the arrows stop at the oldest day kept');
  ck(!e['daily-board-next'].disabled, 'and you can always come forward again');
  eq('daily: a past day is titled by its date', e['daily-board-title'].innerText, 'day-7');
}

// ---- the queries each board actually issues ------------------------------
const usersBoardSrc = between(html, 'async function loadUsersBoard() {', '\n        }\n', 'loadUsersBoard');
ck(/where\("periodBestKey", "==", periodKeyFor\(new Date\(\)\)\)/.test(usersBoardSrc)
   && /orderBy\("periodBestScore", "desc"\)/.test(usersBoardSrc),
   'weekly scopes periodBestScore by periodBestKey, so an older week is not a low score');
ck(/orderBy\("bestRunScore", "desc"\)/.test(usersBoardSrc),
   'all-time just orders by bestRunScore, which needs no composite index');
ck(/filter\(\(r\) => Number\(r\.score\) > 0\)/.test(usersBoardSrc),
   'and a player who has never scored is not a row on the board');
// A live listener on an unfiltered orderBy over /users is the expensive kind.
ck(!/onSnapshot/.test(usersBoardSrc), 'neither board opens a subscription');

const loadSrc = between(html, 'async function loadHomeBoard() {', '\n        }\n', 'loadHomeBoard');
ck(/if \(dailyBoardUnsub\) \{ dailyBoardUnsub\(\); dailyBoardUnsub = null; \}/.test(loadSrc),
   'switching boards drops the daily listener rather than leaving it running');
ck(loadSrc.indexOf('dailyBoardUnsub()') < loadSrc.indexOf('loadUsersBoard'),
   'and drops it BEFORE handing off, or the old board keeps repainting over the new one');

// Every one of the three composite queries this screen can issue must be an
// index that is actually deployed, or the board is empty in production and
// green here.
const idx = JSON.parse(fs.readFileSync(REPO('firestore.indexes.json'), 'utf8'));
const has = (a, b) => (idx.indexes || []).some((i) => i.collectionGroup === 'users'
  && i.fields.length === 2
  && i.fields[0].fieldPath === a && i.fields[1].fieldPath === b
  && i.fields[1].order === 'DESCENDING');
ck(has('periodBestKey', 'periodBestScore'), 'the weekly board has its composite index');
ck(has('dayBestKey', 'dayBestScore'), 'the daily board has its composite index');

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
