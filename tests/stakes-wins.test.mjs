/*
 * Stakes' three board stats: daily wins, weekly wins, all-time standing.
 *
 * Stakes is the odd mode out here, and the reason is one missing field. A
 * Sprint or Marathon run carries the key of the period it belongs to, so a
 * Cloud Function can ask Firestore for "that day's runs" directly. A Stakes
 * run carries neither - only a server timestamp - so its periods have to be
 * cut out of a timestamp range, which is work the daily maintenance job
 * already does to build the day's board. That is why these two counters are
 * settled by a Node tool in CI rather than by the morning digest, and why
 * the award helper is written twice in two runtimes.
 *
 * What is easy to get wrong, and silent when it is:
 *
 *   - THE SOURCE. periodBestScore holds ONE week and the next week's first
 *     run overwrites it, so by the time a week is safe to settle the players
 *     most likely to have won are the ones whose record went first. Only
 *     /runs is a durable account of a finished week.
 *   - TWICE. A workflow step can be retried, and these tools are deliberately
 *     re-run over ranges to backfill. The claim and the increments move in
 *     ONE transaction or a counter climbs on its own.
 *   - THE WEEK BOUNDARY. weekKeyET here and periodKeyFor in the functions
 *     bundle must name the same Monday, or a week is settled for a window
 *     nobody was playing for.
 *   - NO RANK IS NOT RANK ONE. A player with no best run is absent from the
 *     board, which is not the same as topping it.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8');
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const rules = fs.readFileSync(REPO('firestore.rules'), 'utf8').replace(/\r\n/g, '\n');
const flow = fs.readFileSync(REPO('.github/workflows/gauntlet-archive.yml'), 'utf8');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(got === want, name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const deq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const B = await import('../tools/daily-board.mjs');
const { awardWin } = await import('../tools/award-win.mjs');

// ---- who won ---------------------------------------------------------------
// Runs are shaped the way saveRunToCloud writes them: a uid, a score, a
// server timestamp, and NO mode on a Stakes run (only Trifecta sets one).
const run = (uid, score, at, extra = {}) => ({ uid, username: uid.toUpperCase(), score, timestamp: at, ...extra });
{
  deq('the highest score wins', B.topWinners([run('a', 100, 1), run('b', 900, 2), run('c', 400, 3)]), ['b']);
  deq('a player is judged on their BEST run, not their last',
      B.topWinners([run('a', 900, 1), run('a', 10, 9), run('b', 500, 2)]), ['a']);
  // The board sorts equal scores earliest-first, so the counter has to agree
  // with the board a player is looking at.
  deq('an equal score goes to whoever got there first',
      B.topWinners([run('a', 900, 50), run('b', 900, 10)]), ['b']);
  deq('a dead-level tie - same score, same instant - is shared',
      B.topWinners([run('a', 900, 10), run('b', 900, 10)]).sort(), ['a', 'b']);
  deq('nobody played is nobody won, not an error', B.topWinners([]), []);
  deq('and neither is nothing at all', B.topWinners(null), []);
  // Matches buildDayBoard, which drops both: a wipeout scores 0 and
  // onRunCreated never counts one, so a zero does not move the live board.
  deq('a wipeout does not win a day nobody else played',
      B.topWinners([run('a', 0, 1), run('b', 0, 2)]), []);
  deq('a Trifecta run cannot win the Stakes board',
      B.topWinners([run('a', 9999, 1, { mode: 'daily' }), run('b', 50, 2)]), ['b']);
  deq('a run with no uid is not a player', B.topWinners([{ score: 900, timestamp: 1 }]), []);

  // A run whose timestamp has not been written yet sorts last among equals
  // rather than first, so a pending write cannot steal a tie.
  deq('a missing timestamp loses a tie rather than winning it',
      B.topWinners([run('a', 900, null), run('b', 900, 5)]), ['b']);

  // The day board and the counter are drawn from one reduction, so they
  // cannot disagree about who is on top.
  const runs = [run('a', 100, 1), run('b', 900, 2), run('c', 400, 3)];
  eq('the winner is the player the board puts at place 1',
     B.buildDayBoard('2026-11-02', runs).top[0].uid, B.topWinners(runs)[0]);
}

// ---- which week ------------------------------------------------------------
{
  eq('a week is named by its Monday', B.weekKeyET('2026-11-13'), '2026-11-09');
  eq('a Monday names its own week', B.weekKeyET('2026-11-09'), '2026-11-09');
  eq('a Sunday belongs to the week that started six days earlier',
     B.weekKeyET('2026-11-08'), '2026-11-02');

  // The claim the comment in daily-board.mjs makes, checked rather than
  // trusted: this must name the same Monday as the functions bundle, which
  // is what keys periodBestScore.
  const grab = (name) => {
    const i = fn.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('no ' + name);
    let d = 0;
    for (let k = fn.indexOf('{', i); k < fn.length; k++) {
      if (fn[k] === '{') d++;
      else if (fn[k] === '}') { d--; if (!d) return fn.slice(i, k + 1); }
    }
    throw new Error('unbalanced ' + name);
  };
  const periodKeyFor = new Function('etParts', 'LEADERBOARD_PERIOD',
    `${grab('periodKeyFor')}\nreturn periodKeyFor;`)(
    (when) => ({ y: when.getUTCFullYear(), m: when.getUTCMonth() + 1, d: when.getUTCDate() }), 'weekly');
  let disagree = 0;
  for (let i = 0; i < 800; i++) {
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000);
    if (B.weekKeyET(d.toISOString().slice(0, 10)) !== periodKeyFor(d, 'weekly')) disagree++;
  }
  eq('and agrees with periodKeyFor on every day of two years', disagree, 0);

  // The week being played is never settled: somebody in it can still be
  // overtaken, and nothing later corrects a crown handed out early.
  const weeks = B.finishedWeeks('2026-11-13', 3);
  deq('finished weeks are the ones before this one', weeks, ['2026-11-02', '2026-10-26', '2026-10-19']);
  ck(!weeks.includes('2026-11-09'), 'the week in progress is not among them', weeks.join(', '));
  eq('and asking from a Monday still excludes that Monday',
     B.finishedWeeks('2026-11-09', 1)[0], '2026-11-02');
}

// ---- paying it out, once ---------------------------------------------------
const award = async ({ claim, field, uids, existing = false }) => {
  const log = [];
  let txs = 0;
  const ref = (p) => ({ path: p });
  const db = {
    collection: (c) => ({ doc: (d) => ref(`${c}/${d}`) }),
    runTransaction: async (f) => {
      txs++;
      return f({
        get: async (r) => { log.push(`get ${r.path}`); return { exists: existing }; },
        set: (r, v, o) => { log.push(`set ${r.path}${o && o.merge ? ' (merge)' : ''} ${JSON.stringify(v)}`); },
      });
    },
  };
  const out = await awardWin(db, { increment: (n) => `+${n}`, serverTimestamp: () => 'TS' },
    { claim, field, uids });
  return { log, txs, out };
};
{
  const r = await award({ claim: 'standardDay_2026-11-02', field: 'dayWins', uids: ['u1'] });
  ck(r.out.awarded, 'an unsettled day pays out', JSON.stringify(r.out));
  ck(r.log.some((l) => /^set users\/u1 \(merge\) .*"dayWins":"\+1"/.test(l)),
     'the winner gets dayWins as an INCREMENT - a second win has to make it two',
     r.log.join(' | '));
  ck(r.log.some((l) => l.startsWith('set boardAwards/standardDay_2026-11-02')),
     'and the day is claimed so it cannot pay again', r.log.join(' | '));
  eq('claim and increments move in ONE transaction', r.txs, 1);
  // The read has to happen inside that transaction, or two runs racing both
  // see "unclaimed" and both pay.
  ck(r.log[0] === 'get boardAwards/standardDay_2026-11-02',
     'the claim is READ first, inside the transaction', r.log.join(' | '));

  const again = await award({ claim: 'standardDay_2026-11-02', field: 'dayWins', uids: ['u1'], existing: true });
  ck(!again.out.awarded, 'a day already settled pays nobody', JSON.stringify(again.out));
  ck(!again.log.some((l) => l.startsWith('set')), '...and writes nothing at all', again.log.join(' | '));

  const tie = await award({ claim: 'standardWeek_2026-11-02', field: 'weekWins', uids: ['u1', 'u2'] });
  eq('a shared week pays both', tie.log.filter((l) => /^set users\//.test(l)).length, 2);
  eq('...still in one transaction', tie.txs, 1);

  const dupes = await award({ claim: 'standardWeek_2026-10-26', field: 'weekWins', uids: ['u1', 'u1', null, ''] });
  eq('a uid listed twice is paid once', dupes.log.filter((l) => /^set users\//.test(l)).length, 1);

  const none = await award({ claim: 'standardWeek_2026-10-19', field: 'weekWins', uids: [] });
  ck(!none.out.awarded, 'a week nobody played pays nobody', JSON.stringify(none.out));
  eq('...and opens no transaction', none.txs, 0);
}

// ---- where you stand -------------------------------------------------------
{
  const i = html.indexOf('async function renderStakesStanding(data) {');
  ck(i > 0, 'the standing is computed by a function, not inline', String(i));
  let d = 0, src = '';
  for (let k = html.indexOf('{', i); k < html.length; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}') { d--; if (!d) { src = html.slice(i, k + 1); break; } }
  }
  const call = async (data, { count = 0, fail = false } = {}) => {
    const el = { innerText: 'UNSET' };
    const errs = [];
    const f = new Function('document', 'getCountFromServer', 'query', 'collection', 'where', 'db', 'console',
      `${src}\nreturn renderStakesStanding;`)(
      { getElementById: (id) => (id === 'stat-standing' ? el : null) },
      async () => { if (fail) throw new Error('offline'); return { data: () => ({ count }) }; },
      (...a) => a, () => 'users', (field, op, v) => ({ field, op, v }), {},
      { error: (...a) => errs.push(a.join(' ')) });
    await f(data);
    return { text: el.innerText, errs };
  };

  eq('three players ahead of you is fourth', (await call({ bestRunScore: 9100 }, { count: 3 })).text, '#4 all-time');
  eq('nobody ahead is first', (await call({ bestRunScore: 9100 }, { count: 0 })).text, '#1 all-time');
  eq('a big standing is grouped', (await call({ bestRunScore: 10 }, { count: 1234 })).text, '#1,235 all-time');

  // Absent from the board is not top of it. A new account has no best run,
  // and #1 is the single most wrong thing to tell them.
  for (const noRun of [{}, { bestRunScore: 0 }, { bestRunScore: -5 }, { bestRunScore: 'x' }, null, undefined]) {
    eq(`no best run (${JSON.stringify(noRun)}) reads Unranked, not #1`,
       (await call(noRun, { count: 7 })).text, 'Unranked');
  }

  // The count is the only network call the profile makes that can fail, and
  // the panel is already on screen when it does.
  const broke = await call({ bestRunScore: 9100 }, { fail: true });
  // Three states, said three ways: a position, no position, and position
  // not known. A failure is the third, and must not borrow either other word.
  eq('a failed count leaves the line blank rather than inventing a rank',
     broke.text.trim(), '');
  ck(broke.text !== 'Unranked',
     '...and does not claim you are unranked, which it never learned', broke.text);
  eq('...and is logged once', broke.errs.length, 1);

  // Counted, not ranked: the whole point is one aggregation read instead of
  // fetching a board and searching it.
  ck(/getCountFromServer/.test(src), 'the standing is counted server-side', src.slice(0, 80));
  ck(/bestRunScore/.test(src) && /">"/.test(src),
     '...as how many players are ahead of your best run', src.slice(0, 80));
}

// ---- wired into the panel --------------------------------------------------
{
  const panel = html.slice(html.indexOf('<div id="profile-standard"'),
                           html.indexOf('<!-- CLASH STATS -->'));
  ck(panel.length > 100, 'found the Stakes panel', String(panel.length));
  for (const id of ['stat-day-wins', 'stat-week-wins', 'stat-standing']) {
    ck(panel.includes(`id="${id}"`), `the panel has a slot for ${id}`, panel.slice(0, 60));
  }
  // The standing is a POSITION on the career bank, not a tally beside the
  // win counts, so it is placed with the number it is a position on.
  const bank = panel.indexOf('id="stat-career-bank"');
  const standing = panel.indexOf('id="stat-standing"');
  const wins = panel.indexOf('id="stat-day-wins"');
  ck(bank > 0 && standing > bank && standing < wins,
     'the standing sits under the career bank, above the win counts',
     `bank ${bank}, standing ${standing}, wins ${wins}`);
  // Two-up, not three: at 340px a third column wrapped "Weekly Wins" onto a
  // second line and dropped its number out of line with its neighbour.
  const winRow = panel.slice(Math.max(0, wins - 500), wins + 500);
  eq('the win counters are a pair', (winRow.match(/flex: 1 1 0/g) || []).length, 2);
  // Written as entities because the first attempt shipped the literal text
  // "\\U0001F3C6 Weekly Wins", which is nine junk characters wide and wrapped.
  ck(!/\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8}/.test(winRow),
     'and carry no unrendered escape in their labels', winRow.slice(0, 160));
  // Read off the doc openProfileMenu already fetched, not a second read.
  ck(/stat-day-wins"\)\.innerText = \(data\.dayWins \|\| 0\)/.test(html),
     'daily wins are read off the profile document', '');
  ck(/stat-week-wins"\)\.innerText = \(data\.weekWins \|\| 0\)/.test(html),
     'weekly wins too', '');
  ck(/renderStakesStanding\(data\)/.test(html), 'and the standing is kicked off with it', '');
}

// ---- nobody can award themselves -------------------------------------------
{
  const block = rules.slice(rules.indexOf("!('sprintWins' in request.resource.data)"),
                            rules.indexOf("!('sprintWins' in request.resource.data)") + 1200);
  for (const f of ['dayWins', 'weekWins']) {
    ck(block.includes(`!('${f}' in request.resource.data)`),
       `a client cannot write ${f} on itself`, block.slice(0, 120));
  }
}

// ---- and it actually runs --------------------------------------------------
{
  ck(/node tools\/build-week-wins\.mjs/.test(flow),
     'the maintenance workflow settles the week', '');
  ck(/node tools\/build-daily-boards\.mjs/.test(flow),
     'and still builds the day', '');
  // Both steps carry if: always(), so one failing does not silently cost the
  // other its day - they share nothing but a service-account key.
  const weekStep = flow.slice(flow.indexOf("Settle last week's Stakes win"),
                              flow.indexOf("Settle last week's Stakes win") + 420);
  ck(/if: always\(\)/.test(weekStep), 'even when an earlier step failed', weekStep.slice(0, 160));
  // The one checkbox has to reach both counters, or a backfill silently does
  // half the job.
  ck(/build-daily-boards\.mjs \$\{\{ inputs\.all && '--days=/.test(flow),
     'the backfill checkbox replays past days', '');
  ck(/build-week-wins\.mjs \$\{\{ inputs\.all && '--weeks=/.test(flow),
     '...and past weeks', '');
}

for (const [ok, name, detail] of t) console.log((ok ? 'PASS ' : 'FAIL ') + ' ' + name + (ok ? '' : '  -> ' + detail));
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
