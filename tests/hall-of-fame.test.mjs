/*
 * The Hall of Fame: one all-time board per mode.
 *
 * It used to be one board per TIME WINDOW with the mode left to guess — "All
 * Time" and "Weekly" were both Stakes, and the only tab that named a mode was
 * the one called Daily. Every board here is all-time, so the window was the
 * one thing that never needed saying; the windows that do vary are on the home
 * board, which has its own All Time / Weekly / Today row.
 *
 * Two things here are worth pinning rather than eyeballing:
 *
 *   SPRINT IS A STREAK, NOT A SCORE. A Sprint tops out at 500 and a
 *   first-guess solve pays it, so a score board would be a hundred-way tie at
 *   500 ordered by nothing at all.
 *
 *   THE TRIFECTA BOARD HAD TO BE EMPTIED. It held best single scores from
 *   when the mode was ten words and then seven; three words pay 1,500 against
 *   ten words' 5,000, so the top was unreachable for good.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(DIR, '..', f), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const fn = read('functions/index.js');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// Slices FORWARD, and throws rather than returning "".
//
// A plain slice(indexOf(a), indexOf(b)) is only a slice when b happens to sit
// after a in the file. `function renderYourRank` is defined ABOVE the loader
// that calls it, so that pair yields the empty string — and every negative
// check against "" then passes for the wrong reason. Three checks in this file
// were green on an empty slice before this helper existed.
const between = (src, from, to) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`no start anchor: ${from}`);
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`end anchor is not after the start: ${to}`);
  return src.slice(a, b);
};

const modal = between(html, '<div id="leaderboard-modal"', 'id="leaderboard-list"');
const loader = between(html, 'window.loadLeaderboardData = async function',
                       'GAME LOGIC (STANDARD & VERSUS)');
ck(modal.length > 400 && loader.length > 2000, 'the modal and its loader are both found',
   `${modal.length}/${loader.length}`);

// ---- the tab that ships active is the one that loads ----------------------
// Two separate declarations of the same fact: the `active` class in the
// markup and currentLbTime in the script. Disagree and the modal opens with
// one tab highlighted while a different board loads under it.
{
  const activeTab = (modal.match(/class="tab-btn active" id="tab-(\w+)"/) || [])[1];
  const dflt = (html.match(/let currentLbTime = '(\w+)'/) || [])[1];
  eq('the markup ships exactly one tab active',
     (modal.match(/tab-btn active/g) || []).length, 1);
  eq('and the script opens on that same board', dflt, activeTab);
  eq('which is Sprint', activeTab, 'sprint');
}

// ---- the tabs name modes, not windows -------------------------------------
{
  const tabs = [...modal.matchAll(/id="tab-(\w+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2].trim()]);
  eq('every tab is a mode, Sprint leading', tabs.map(([, label]) => label),
     ['Sprint', 'Stakes', 'Marathon', 'Trifecta', 'Clash', 'FFA']);
  ck(!tabs.some(([, l]) => /all time|weekly|daily/i.test(l)),
     'and none of them is a time window', tabs.map(([, l]) => l).join(','));
  // FFA is a closed mode; applyHiddenModeUi takes its tab down by the
  // tab-<mode> convention, which is also what would take Sprint's down.
  ck(tabs.some(([id]) => id === 'ffa'), 'the closed mode keeps its tab for when it reopens');
  ck(/function applyHiddenModeUi\(\)[\s\S]{0,400}"tab-" \+ m/.test(html),
     'and the hide is by convention, so a new mode tab is covered without being named');
  // ...for the tabs whose id IS the mode's name. This used to be the tripwire
  // for two that were not: `all` for the endless mode and `daily` for
  // gauntlet, a vocabulary older than the mode table. applyHiddenModeUi
  // cannot reach a tab it cannot name, so closing either mode would have left
  // its tab standing over a board nobody can play.
  //
  // Closing the Trifecta is the day that stopped being hypothetical, and
  // `daily` was renamed to `gauntlet` rather than special-cased. `all` is the
  // last one, and Stakes is the one mode that will not be closed.
  const table = between(html, 'const MODES = {', '};');
  const modeKeys = [...table.matchAll(/^\s+(\w+):\s+\{ label:/gm)].map((m) => m[1]);
  const hidden = new Set([...table.matchAll(/^\s+(\w+):\s+\{ label:[^\n]*hidden: true/gm)].map((m) => m[1]));
  ck(modeKeys.length >= 4 && hidden.size > 0, 'the mode table reads, flags and all',
     `${modeKeys.join(',')} | hidden: ${[...hidden].join(',')}`);
  const LEGACY = { all: 'endless' };
  const offConvention = tabs.map(([id]) => id).filter((id) => !modeKeys.includes(id));
  eq('one tab is left outside the convention, and it is Stakes', offConvention, ['all']);
  for (const id of offConvention) {
    ck(!hidden.has(LEGACY[id]), `${LEGACY[id]} is open, so nothing has to take the ${id} tab down`,
       [...hidden].join(','));
  }
  // Every CLOSED mode's tab really is reachable by the convention, which is
  // the claim the rename was for. Derived, so the next mode to close is
  // covered without this being edited again.
  for (const m of hidden) {
    ck(tabs.some(([id]) => id === m), `the closed ${m} tab is named after the mode, so it comes down`,
       tabs.map(([id]) => id).join(','));
  }
  // The modal has called itself this all along; the menu called it something
  // else, which is how one thing came to have two names.
  ck(/<h2 class="modal-title">Hall of Fame<\/h2>/.test(modal), 'the modal is the Hall of Fame');
  ck(/onclick="window\.showLeaderboard\(\)">Hall of Fame</.test(html),
     'and so is the menu item that opens it',
     (html.match(/showLeaderboard\(\)">[^<]*/) || [''])[0]);
}

// ---- the periods live on the home board, not here -------------------------
{
  ck(!/setLbTime\('weekly'\)/.test(html), 'the Hall of Fame has no weekly tab');
  ck(!/periodCaption/.test(html), 'and nothing left that only existed to caption one',
     (html.match(/[^\n]*periodCaption[^\n]*/) || [''])[0].slice(0, 90));
  ck(!/periodBestScore/.test(loader), 'nor a query for a window', loader.slice(0, 0));
  // Still on the home board, which is where the user is sent for them.
  ck(/setHomeBoard\('weekly'\)/.test(html) && /setHomeBoard\('daily'\)/.test(html),
     'because Weekly and Today are on the page itself');
  // The server still maintains the field the home board reads.
  ck(/periodBestScore/.test(fn), 'and the server still keeps the field that board needs');
}

// ---- Sprint is represented, by the thing the mode is about ----------------
{
  const sprintBranch = between(loader, "currentLbTime === 'sprint'", "currentLbTime === 'all'");
  ck(sprintBranch.length > 50, 'the Sprint board has a branch of its own', String(sprintBranch.length));
  ck(/orderBy\("sprintBestStreak", "desc"\)/.test(sprintBranch),
     'it ranks on the best streak', sprintBranch.slice(0, 160).replace(/\s+/g, ' '));
  ck(!/bestRunScore|score: d\.sprintBestScore/.test(sprintBranch),
     'not on a score, which would tie at 500', sprintBranch.slice(0, 160));
  ck(/collection\(db, "users"\)/.test(sprintBranch),
     'off /users like every other board here, so it reads 100 documents flat');
  // The field has to be one the server actually maintains.
  ck(/update\.sprintBestStreak = streak/.test(fn),
     'and onRunCreated maintains that field', (fn.match(/[^\n]*sprintBestStreak[^\n]*/) || [''])[0].trim());
  // A streak is days. Printing a bare number next to Stakes' 4,600 invites
  // reading it as points. Lifted and RUN, rather than matched: the rule is
  // three conditions deep and a regex over it asserts the spelling.
  const fmt = new Function('score', 'mode',
    (html.match(/const lbScoreText = [\s\S]*?;\r?\n/) || [''])[0].replace(/^\s+/, '')
    + 'return lbScoreText(mode, score);');
  eq('one day reads as a day', fmt(1, 'sprint'), '1 day');
  eq('and more than one reads as days', fmt(12, 'sprint'), '12 days');
  eq('a streak of none still says the unit', fmt(0, 'sprint'), '0 days');
  // The flame says the streak is still RUNNING, which the board's own number
  // cannot: it ranks on the best ever, and a record is not a state.
  {
    const live = (html.match(/        function sprintStreakLive\(d\) \{\n[\s\S]*?\n        \}/) || [''])[0];
    ck(live.length > 200, 'the liveness test is findable', String(live.length));
    const shift = (d, n) => {
      const t = new Date(d + 'T00:00:00Z');
      t.setUTCDate(t.getUTCDate() + n);
      return t.toISOString().slice(0, 10);
    };
    const run = new Function('getTodayDateStr', 'shiftDateStr',
      `${live}\nreturn sprintStreakLive;`)(() => '2026-11-11', shift);
    const doc = (o) => Object.assign(
      { sprintBestStreak: 10, sprintStreak: 10, sprintLastDate: '2026-11-11' }, o);
    ck(run(doc({})), 'a best streak that is also current and played today is live');
    ck(run(doc({ sprintLastDate: '2026-11-10' })),
       'and yesterday counts, because a streak breaks on a day MISSED');
    ck(!run(doc({ sprintLastDate: '2026-11-09' })),
       'but two days ago is a lapsed streak, whatever the stored number says');
    ck(!run(doc({ sprintStreak: 3 })),
       'a best of ten with a current of three is not a ten-day streak');
    ck(!run(doc({ sprintBestStreak: 0, sprintStreak: 0 })),
       'and nobody with no streak at all is lit');
    ck(!run({}), 'a document with none of the fields is not an error');
  }
  // Both rows that can carry it get it from the same function.
  ck(/entry\.live \? STREAK_FLAME/.test(loader), 'the board rows can show it', 'entry.live');
  ck(/mode === "sprint" && sprintStreakLive\(live\) \? STREAK_FLAME/.test(html),
     'and so can your own line, off the same test', 'your position');
  ck(/live: sprintStreakLive\(d\)/.test(loader),
     'computed from the document the board already read, so it costs no extra query');
  eq('and no other board gets a unit at all', fmt(4600, 'all'), '4,600');
  eq('which is still grouped', fmt(4600, 'sprint'), '4,600 days');
  // Both places that print a score in that column go through it, so your own
  // line cannot read "3" under a list of "3 days".
  ck(/lb-score">[^<]*lbScoreText\(currentLbTime, entry\.score\)/.test(loader),
     'the board rows print through it', (loader.match(/lb-score">[^<]{0,90}/) || [''])[0]);
  ck(/paint\([\s\S]{0,220}?lbScoreText\(mode, mine\)/.test(html),
     'and so does your own position', (html.match(/paint\(`#\$\{\(ahead[\s\S]{0,160}/) || [''])[0]);
}
// ---- the date stamp belongs to one tab ----------------------------------
// Stakes is the all-time board, and when a best run happened is half of what
// a row on it claims. No other tab here ranks a single dated run - a career
// bank, a rating and a streak are not events - so a date on one of those
// would be labelling the wrong thing. Run rather than matched: the guard is
// one condition and a regex over it asserts its spelling.
{
  const rowSrc = between(html, 'finalData.forEach((entry, index) => {', '\n                        });');
  const row = new Function('entry', 'index', 'currentLbTime', 'escapeHtml', 'safeCosmetic',
    'titleText', 'getRankDetails', 'lbScoreText', 'boardDate', 'marathonWeekLabel',
    `let html = ""; const finalData = [entry];\n${rowSrc}\n});\nreturn html;`);
  // The real one, not a stub: the week label is the thing under test below,
  // and a stub would only prove the test can spell its own return value.
  const weekLabel = new Function(
    between(html, 'function marathonWeekLabel(key) {', '\n        }')
    + '\n}\nreturn marathonWeekLabel;')();
  const call = (mode, ts, title = '') => row(
    { name: 'SODA', score: 4600, equipped: {}, ts }, 0, mode,
    (x) => String(x), (v, f) => f, () => title, () => ({ class: '', name: 'BRONZE' }),
    (m, sc) => String(sc), (x) => (x ? '10/2/2026' : ''), weekLabel);

  ck(call('all', true).includes('10/2/2026'), 'the Stakes tab stamps its rows', call('all', true));
  for (const mode of ['career', 'clash', 'ffa', 'daily', 'sprint']) {
    ck(!call(mode, true).includes('10/2/2026'),
       `the ${mode} tab does not, even handed a timestamp`, call(mode, true));
  }
  // Nothing at all, not an empty stamp: the separator is part of the date, so
  // a player with no stored timestamp must not get a dash with nothing after
  // it where their title would be.
  const sub = (markup) => (markup.match(/class="lb-date"[^>]*>([\s\S]*?)<\/div>/) || [, 'NO SUB-LINE'])[1];
  eq('a player with no stored timestamp is stamped with nothing', sub(call('all', null)), '');
  ck(!/\s-\s/.test(sub(call('all', null))), '...not even the dash in front of it', sub(call('all', null)));

  // The sub-line joins an equipped title and a stamp, and the separator
  // belongs to the TITLE: most players have no title, and a dash with
  // nothing on its left is not a separator, it is a typo. This was wrong on
  // Stakes for as long as Stakes has stamped rows.
  const subText = (markup) => sub(markup).replace(/<[^>]*>/g, '');
  eq('a title and a stamp are joined', subText(call('all', true, 'Final Boss')),
     'Final Boss - 10/2/2026');
  eq('a stamp with no title stands alone', subText(call('all', true)), '10/2/2026');
  eq('a title with no stamp stands alone', subText(call('all', null, 'Final Boss')), 'Final Boss');
  eq('and neither is nothing at all', subText(call('all', null)), '');

  // Marathon ranks a best WEEK, so naming the week is the same half-claim a
  // date makes on Stakes - and it says "Week of", the way the Profile and the
  // share already do, rather than a bare date that could be read as a day.
  const mara = call('marathon', '2026-11-02');
  ck(mara.includes('Week of'), 'the Marathon tab names the week its best came from', sub(mara));
  ck(/Nov\s*2/.test(mara), '...and names the right one', sub(mara));
  ck(!mara.includes('10/2/2026'),
     '...through the week helper, not the run-date formatter', sub(mara));
  // Bests set before the week started being recorded have no key at all.
  for (const missing of [null, undefined, '', 'sometime', '2026-13-99']) {
    eq(`a Marathon best stored without a usable week (${JSON.stringify(missing)}) is stamped with nothing`,
       sub(call('marathon', missing)), '');
  }
}

{
  // Scoped to the ONE entry, by name. A check against the whole object reads
  // true off any entry that happens to have the flag — and `sprint:` unanchored
  // matches `xsprint:` as well, so both of those passed a mutant.
  const board = between(html, 'const USERS_BOARD = {', '};');
  const entryOf = (mode) => (board.match(new RegExp(`\\b${mode}:\\s*\\{([^}]*)\\}`)) || [])[1];
  const sprint = String(entryOf('sprint')).replace(/\s+/g, ' ');
  ck(/field: "sprintBestStreak"/.test(sprint),
     'your own position is counted against the same field', sprint.slice(0, 120));
  ck(!entryOf('weekly'), 'and the weekly entry went with its tab', String(entryOf('weekly')).slice(0, 90));
  ck(/excludesUnset: true/.test(sprint),
     'a player with no streak is off the board rather than bottom of it', sprint.slice(0, 120));
}

// ---- the Trifecta board starts again --------------------------------------
{
  const tool = read('tools/reset-trifecta-best.mjs');
  const M = tool; // the predicate is exercised below through a real import
  ck(/FieldValue\.delete\(\)/.test(M), 'the reset DELETES the field rather than zeroing it');
  ck(!/bestGauntletScore: 0/.test(M), 'so nobody is left tied at nothing on the new board');
  ck(/--dry-run/.test(M), 'with a dry run, like every other tool here that writes');
  ck(/bestGauntletDate/.test(M), 'and it reads the date the best came from');
  // A one-off sweep nobody knows to run leaves the board broken anyway. Both
  // lines, in order: the dry run is the whole safety argument for a tool that
  // deletes a field off every player document.
  const deploy = read('DEPLOY.md');
  const runs = [...deploy.matchAll(/^node tools\/reset-trifecta-best\.mjs( --dry-run)?\s*(?:#.*)?$/gm)].map((m) => !!m[1]);
  eq('DEPLOY.md says how to run it, dry run first', runs, [true, false]);
  // The epoch is now in a fourth place. Checked against the others, because a
  // reset that used a different day from the numbering would either wipe a
  // legitimate score or leave an unbeatable one.
  const epochs = {
    'tools/reset-trifecta-best.mjs': (tool.match(/TRIFECTA_EPOCH = "([^"]*)"/) || [])[1],
    'index.html': (html.match(/const TRIFECTA_EPOCH = "([^"]*)"/) || [])[1],
    'functions/index.js': (fn.match(/const TRIFECTA_EPOCH = "([^"]*)"/) || [])[1],
    'tools/gauntlet-archive-render.mjs': (read('tools/gauntlet-archive-render.mjs').match(/TRIFECTA_EPOCH = "([^"]*)"/) || [])[1],
  };
  ck(Object.values(epochs).every(Boolean), 'every copy of the epoch is readable', JSON.stringify(epochs));
  eq('and they are all the same day', [...new Set(Object.values(epochs))].length, 1);
}

// The predicate itself, run. The risk is deleting a best somebody earned.
{
  const M = await import('../tools/reset-trifecta-best.mjs');
  const E = M.TRIFECTA_EPOCH;
  const day = (d, score = 1000) => ({ bestGauntletScore: score, bestGauntletDate: d });
  const shift = (n) => {
    const [y, m, d] = E.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
  };
  ck(M.isPreTrifectaBest(day(shift(-1))), 'the day before the epoch is cleared');
  ck(!M.isPreTrifectaBest(day(E)), 'the epoch itself is kept — it is a three-word score');
  ck(!M.isPreTrifectaBest(day(shift(1))), 'and so is every day after it');
  ck(M.isPreTrifectaBest(day(shift(-60), 4600)), 'a ten-word era best is cleared');
  // The date field is newer than some of the bests it describes.
  ck(M.isPreTrifectaBest({ bestGauntletScore: 3100 }),
     'a best with no date at all predates the field that records one, so it goes');
  ck(!M.isPreTrifectaBest({}), 'a player with no best is left alone');
  ck(!M.isPreTrifectaBest({ bestGauntletScore: 0 }), 'and so is a stored zero');
  ck(!M.isPreTrifectaBest(null), 'and nothing at all is not an error');
  ck(M.isPreTrifectaBest({ bestGauntletScore: 900, bestGauntletDate: 'sometime' }),
     'a malformed date is treated as no date rather than trusted');
}

// The row above is handed a ts; this is where a ts comes FROM. Run, not
// matched: the branch is lifted whole and driven with a fake snapshot, so
// both halves of its claim - rank by best week, stamp with the week that
// best came from - are exercised rather than spelled.
{
  const src = between(html, "else if (currentLbTime === 'marathon') {", '\n                        }');
  const body = src.slice(src.indexOf('{') + 1);
  const ordered = [];
  const run = async (docs) => {
    const rawData = [];
    const fn = new Function('rawData', 'getDocs', 'query', 'collection', 'orderBy', 'limit', 'db',
      `return (async () => {${body}})();`);
    await fn(rawData,
      async (q) => ({ forEach: (cb) => docs.forEach((d) => cb({ id: d.uid, data: () => d })) }),
      (...a) => a, () => 'users',
      (field, dir) => { ordered.push(field + ' ' + dir); return 'orderBy'; },
      (n) => 'limit' + n, {});
    return rawData;
  };

  const rows = await run([
    { uid: 'u1', username: 'SODA', bestMarathonScore: 7200, bestMarathonWeek: '2026-11-02', equipped: {} },
    { uid: 'u2', username: 'OLD' },
  ]);
  ck(ordered.includes('bestMarathonScore desc'),
     'the Marathon board ranks by best WEEK, all-time, not a career total', ordered.join(' / '));
  eq('and carries that week onto the row', rows[0].ts, '2026-11-02');
  eq('under the score it belongs to', rows[0].score, 7200);
  // A best set before the week started being stored has none, and the row
  // renderer turns that into no stamp (checked above) rather than a guess.
  eq('a best with no stored week carries none', rows[1].ts, undefined);
  eq('and still ranks, at zero', rows[1].score, 0);
}

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
