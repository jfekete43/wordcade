/*
 * The "Past Gauntlets" date list.
 *
 * The list of playable dates is DERIVED, not queried: /dailyPuzzles holds the
 * answer words and is `read: if false` in firestore.rules, so the archive
 * walks backwards from yesterday using GAUNTLET_EPOCH as the floor. That makes
 * two failure modes worth pinning down — walking back past Gauntlet #1 into
 * dates that never existed, and including today, whose board is still live and
 * not yet final. Both would produce entries that load an empty board.
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
  grab(/        const GAUNTLET_EPOCH = "[^"]*";/),
  grab(/        function gauntletNumber\(dateStr\) \{\n[\s\S]*?\n        \}/),
  grab(/        const ARCHIVE_PAGE = \d+;/),
  grab(/        let archiveShown = ARCHIVE_PAGE;/),
  grab(/        function formatPuzzleDate\(dateStr\) \{\n[\s\S]*?\n        \}/),
  grab(/        function renderGauntletArchiveList\(\) \{\n[\s\S]*?\n        \}/),
].join('\n\n');
const EPOCH = html.match(/const GAUNTLET_EPOCH = "([^"]*)"/)[1];
console.log('extracted from index.html:', src.length, 'chars | epoch', EPOCH);

const els = { 'gauntlet-archive-list': { innerHTML: '' }, 'gauntlet-archive-more': { style: {} } };
// getTodayDateStr is the real thing in the app (Intl, America/New_York); here
// it is pinned so "yesterday" is a known date rather than whenever CI runs.
const build = new Function('document', 'TODAY', `
  function getTodayDateStr() { return TODAY; }
  ${src}
  return { render: renderGauntletArchiveList, more: () => { archiveShown += ARCHIVE_PAGE; renderGauntletArchiveList(); }, page: ARCHIVE_PAGE };
`);

const run = (today) => {
  els['gauntlet-archive-list'].innerHTML = '';
  els['gauntlet-archive-more'].style = {};
  const api = build({ getElementById: (id) => els[id] }, today);
  api.render();
  return api;
};
const dates = () => [...els['gauntlet-archive-list'].innerHTML.matchAll(/viewPastGauntlet\('([\d-]+)'\)/g)].map((m) => m[1]);
const nums = () => [...els['gauntlet-archive-list'].innerHTML.matchAll(/Gauntlet #(\d+)</g)].map((m) => +m[1]);
const moreShown = () => els['gauntlet-archive-more'].style.display !== 'none';

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

// --- a long-running site: a full page, floor nowhere near ------------------
const api = run('2027-06-01');
ck(dates().length === api.page, `a full page is ${api.page} entries`, 'got ' + dates().length);
ck(dates()[0] === '2027-05-31', 'the list starts at YESTERDAY, never today', 'got ' + dates()[0]);
ck(!dates().includes('2027-06-01'), 'today never appears (its board is still live)');
const gaps = dates().slice(1).map((d, i) => (Date.parse(dates()[i] + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')) / 86400000);
ck(gaps.every((g) => g === 1), 'dates step back exactly one day at a time', 'got ' + [...new Set(gaps)]);
ck(nums().every((v, i) => i === 0 || v === nums()[i - 1] - 1), 'Gauntlet numbers descend by one');
ck(moreShown(), '"Show Older" stays available while older Gauntlets remain');

// --- near the epoch: the floor must hold ----------------------------------
// Epoch + 5 days: yesterday is epoch+4, so #5 down to #1 and no further.
const near = run(shift(EPOCH, 5));
ck(nums().length === 5 && nums()[0] === 5 && nums()[nums().length - 1] === 1, 'stops exactly at Gauntlet #1', 'got ' + nums());
ck(dates()[dates().length - 1] === EPOCH, 'the oldest entry is the epoch itself', 'got ' + dates()[dates().length - 1]);
ck(!dates().some((d) => d < EPOCH), 'no date before the epoch is ever offered');
ck(!moreShown(), '"Show Older" is hidden once the list reaches #1');
near.more();
ck(nums().length === 5, 'pressing Show Older past the floor adds nothing', 'got ' + nums().length);

// --- the day the first Gauntlet is still being played ---------------------
run(EPOCH);
ck(dates().length === 0, 'on Gauntlet #1 itself there is nothing to browse yet');
ck(els['gauntlet-archive-list'].innerHTML.includes('No Gauntlets have finished yet'), '...and it says so');
ck(!moreShown(), '...with no Show Older button');

// --- the day after #1 -----------------------------------------------------
run(shift(EPOCH, 1));
ck(JSON.stringify(dates()) === JSON.stringify([EPOCH]), 'the day after #1, exactly one entry', 'got ' + dates());

// --- paging ---------------------------------------------------------------
const paged = run('2027-06-01');
paged.more();
ck(dates().length === paged.page * 2, 'Show Older extends by one more page', 'got ' + dates().length);
ck(dates()[0] === '2027-05-31', '...without disturbing the top of the list');

// --- year and leap boundaries are handled by the shared date helper -------
run('2027-01-02');
ck(dates()[0] === '2027-01-01' && dates()[1] === '2026-12-31', 'walks back across a year boundary', 'got ' + dates().slice(0, 2));
run('2028-03-01');
ck(dates()[0] === '2028-02-29', 'walks back onto a leap day', 'got ' + dates()[0]);

function shift(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  const pad = (v) => String(v).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
