/*
 * The "Past Trifectas" / "Past Sprints" date list.
 *
 * The list of playable dates is DERIVED, not queried: dailyPuzzles and
 * sprintPuzzles hold the answer words and are `read: if false` in
 * firestore.rules, so the archive walks backwards from yesterday using that
 * mode's epoch as the floor. That makes two failure modes worth pinning down —
 * walking back past #1 into dates that never existed, and including today,
 * whose board is still live and not yet final. Both would produce entries that
 * load an empty board.
 *
 * Both archives are ONE screen with a table in front of it (ARCHIVES in
 * index.html), so every case below runs twice, once per mode, off the real
 * config. The two epochs differ — Sprint started two days before the Trifecta —
 * which is the whole reason the floor cannot be a constant in here.
 *
 * Pure; no emulator needed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

// ---- Pull the REAL shipped code out of index.html, don't paraphrase it ----
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };
const src = [
  grab(/        function escapeHtml\(str\) \{\n[\s\S]*?\n        \}/),
  grab(/        function shiftDateStr\(dateStr, days\) \{\n[\s\S]*?\n        \}/),
  grab(/        const TRIFECTA_EPOCH = "[^"]*";/),
  grab(/        function gauntletNumber\(dateStr\) \{\n[\s\S]*?\n        \}/),
  grab(/        const SPRINT_EPOCH = "[^"]*";/),
  grab(/        function sprintNumber\(dateStr\) \{\n[\s\S]*?\n        \}/),
  grab(/        const ARCHIVE_PAGE = \d+;/),
  grab(/        let archiveShown = ARCHIVE_PAGE;/),
  grab(/        let archiveKind = "\w+";/),
  grab(/        function formatPuzzleDate\(dateStr\) \{\n[\s\S]*?\n        \}/),
  // The whole table, verbatim. Nothing in it is evaluated at definition time —
  // every Firestore call sits inside an arrow body — so it lifts without a db.
  grab(/        const ARCHIVES = \{\n[\s\S]*?\n        \};/),
  grab(/        function archiveCfg\(\) \{[^\n]*\}/),
  grab(/        function renderArchiveList\(\) \{\n[\s\S]*?\n        \}/),
].join('\n\n');
console.log('extracted from index.html:', src.length, 'chars');

const els = { 'archive-list': { innerHTML: '' }, 'archive-more': { style: {} } };
// getTodayDateStr is the real thing in the app (Intl, America/New_York); here
// it is pinned so "yesterday" is a known date rather than whenever CI runs.
const build = new Function('document', 'TODAY', 'KIND', `
  function getTodayDateStr() { return TODAY; }
  ${src}
  archiveKind = KIND;
  return { render: renderArchiveList, cfg: archiveCfg(),
           more: () => { archiveShown += ARCHIVE_PAGE; renderArchiveList(); }, page: ARCHIVE_PAGE };
`);

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

function shift(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  const pad = (v) => String(v).padStart(2, '0');
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

// Both epochs come out of the file, so this suite follows a change to either
// rather than having to be edited alongside it.
const EPOCHS = {
  daily: html.match(/const TRIFECTA_EPOCH = "([^"]*)"/)[1],
  sprint: html.match(/const SPRINT_EPOCH = "([^"]*)"/)[1],
};
ck(EPOCHS.daily !== EPOCHS.sprint,
   'the two modes really do start on different days, so a shared floor would be wrong',
   JSON.stringify(EPOCHS));

for (const KIND of ['daily', 'sprint']) {
  const EPOCH = EPOCHS[KIND];
  const run = (today) => {
    els['archive-list'].innerHTML = '';
    els['archive-more'].style = {};
    const api = build({ getElementById: (id) => els[id] }, today, KIND);
    api.render();
    return api;
  };
  const dates = () => [...els['archive-list'].innerHTML.matchAll(/viewPastDay\('([\d-]+)'\)/g)].map((m) => m[1]);
  const nums = () => [...els['archive-list'].innerHTML.matchAll(/#(\d+)</g)].map((m) => +m[1]);
  const moreShown = () => els['archive-more'].style.display !== 'none';
  const M = (s) => `${KIND}: ${s}`;

  // The label is the config's, not a word typed here, so renaming a mode in
  // the table renames it in the list and this still checks the right thing.
  const api0 = build({ getElementById: (id) => els[id] }, '2027-06-01', KIND);
  const NAME = api0.cfg.name(7).replace(/ #7$/, '');
  ck(/^[A-Z][a-z]+$/.test(NAME), M(`the list labels rows "${NAME} #n"`), api0.cfg.name(7));

  // --- a long-running site: a full page, floor nowhere near ----------------
  const api = run('2027-06-01');
  ck(dates().length === api.page, M(`a full page is ${api.page} entries`), 'got ' + dates().length);
  ck(dates()[0] === '2027-05-31', M('the list starts at YESTERDAY, never today'), 'got ' + dates()[0]);
  ck(!dates().includes('2027-06-01'), M('today never appears (its board is still live)'));
  const gaps = dates().slice(1).map((d, i) => (Date.parse(dates()[i] + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')) / 86400000);
  ck(gaps.every((g) => g === 1), M('dates step back exactly one day at a time'), 'got ' + [...new Set(gaps)]);
  ck(nums().every((v, i) => i === 0 || v === nums()[i - 1] - 1), M('puzzle numbers descend by one'));
  ck(moreShown(), M('"Show Older" stays available while older days remain'));

  // --- near the epoch: the floor must hold ---------------------------------
  // Epoch + 5 days: yesterday is epoch+4, so #5 down to #1 and no further.
  const near = run(shift(EPOCH, 5));
  ck(nums().length === 5 && nums()[0] === 5 && nums()[nums().length - 1] === 1, M('stops exactly at #1'), 'got ' + nums());
  ck(dates()[dates().length - 1] === EPOCH, M('the oldest entry is the epoch itself'), 'got ' + dates()[dates().length - 1]);
  ck(!dates().some((d) => d < EPOCH), M('no date before the epoch is ever offered'));
  ck(!moreShown(), M('"Show Older" is hidden once the list reaches #1'));
  near.more();
  ck(nums().length === 5, M('pressing Show Older past the floor adds nothing'), 'got ' + nums().length);

  // --- the day the first puzzle is still being played ----------------------
  const first = run(EPOCH);
  ck(dates().length === 0, M('on #1 itself there is nothing to browse yet'));
  ck(els['archive-list'].innerHTML.includes(first.cfg.none.slice(0, 24)), M('...and it says so'),
     els['archive-list'].innerHTML.slice(0, 90));
  ck(!moreShown(), M('...with no Show Older button'));

  // --- the day after #1 ----------------------------------------------------
  run(shift(EPOCH, 1));
  ck(JSON.stringify(dates()) === JSON.stringify([EPOCH]), M('the day after #1, exactly one entry'), 'got ' + dates());

  // --- paging --------------------------------------------------------------
  const paged = run('2027-06-01');
  paged.more();
  ck(dates().length === paged.page * 2, M('Show Older extends by one more page'), 'got ' + dates().length);
  ck(dates()[0] === '2027-05-31', M('...without disturbing the top of the list'));

  // --- year and leap boundaries are handled by the shared date helper ------
  run('2027-01-02');
  ck(dates()[0] === '2027-01-01' && dates()[1] === '2026-12-31', M('walks back across a year boundary'), 'got ' + dates().slice(0, 2));
  run('2028-03-01');
  ck(dates()[0] === '2028-02-29', M('walks back onto a leap day'), 'got ' + dates()[0]);
}

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
