/*
 * Leaderboard wins: the counter that says how many days (Sprint) or weeks
 * (Marathon) you finished first.
 *
 * Three things here are easy to get wrong and silent when they are.
 *
 *   - WHEN. A win cannot be known when a run ends, because somebody playing
 *     later the same day takes it off you. It is settled by the morning
 *     digest, which is the one place that already holds a finished field.
 *   - TWICE. A scheduled function can be retried. A counter that climbs on
 *     its own is worse than no counter, so the claim and the increments move
 *     in ONE transaction rather than next to each other.
 *   - TIES. Marathon scores come off a fixed table and two players can
 *     finish a week dead level. Handing it to whichever row the index
 *     returned first is a coin toss nobody can see.
 *
 * Pure; no emulator.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8');
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const rules = fs.readFileSync(REPO('firestore.rules'), 'utf8').replace(/\r\n/g, '\n');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(got === want, name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const deq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const func = (name) => {
  const m = fn.match(new RegExp(`^(?:async )?function ${name}\\(.*?\\) \\{\\n[\\s\\S]*?\\n\\}`, 'm'));
  if (!m) throw new Error('could not extract ' + name);
  return m[0];
};

// ---- the ties -------------------------------------------------------------
{
  const topTied = new Function(`${func('topTied')}\nreturn topTied;`)();
  const by = (r) => r.s;
  deq('one clear leader is one winner', topTied([{ s: 9 }, { s: 8 }, { s: 7 }], by).map((r) => r.s), [9]);
  deq('two level at the top are both winners', topTied([{ s: 9 }, { s: 9 }, { s: 7 }], by).map((r) => r.s), [9, 9]);
  deq('and a board where everyone tied is all of them',
      topTied([{ s: 5 }, { s: 5 }], by).map((r) => r.s), [5, 5]);
  deq('an empty board has no winner', topTied([], by), []);
  // The rows arrive already sorted by the query, so a lower score appearing
  // first would mean the ORDER is wrong, not that it ties.
  //
  // Comparing against rows[0] or against the last row kept are the same
  // test, because the only rows kept are ones equal to rows[0] - swapping
  // one for the other survives mutation and is meant to. rows[0] is written
  // because it says what the rule IS rather than leaving it to be deduced.
  deq('it stops at the first row that differs, rather than scanning for matches',
      topTied([{ s: 9 }, { s: 7 }, { s: 9 }], by).map((r) => r.s), [9]);
  // Sprint ranks on two fields and ties on both at once.
  const rank = (r) => [r.score, r.ms];
  deq('a Sprint tie needs the same score AND the same millisecond',
      topTied([{ score: 500, ms: 41200 }, { score: 500, ms: 41201 }], rank).length, 1);
  deq('...and is a tie when it has both',
      topTied([{ score: 500, ms: 41200 }, { score: 500, ms: 41200 }], rank).length, 2);
}

// ---- the award, lifted and run --------------------------------------------
const award = async ({ mode, key, uids, already = false }) => {
  const log = [];
  let txs = 0;
  const docs = new Set(already ? [`boardAwards/${mode}_${key}`] : []);
  const ref = (p) => ({ path: p });
  const db = {
    collection: (c) => ({ doc: (id) => ref(`${c}/${id}`) }),
    runTransaction: async (f) => {
      txs++;
      return f({
        get: async (r) => { log.push(`get ${r.path}`); return { exists: docs.has(r.path) }; },
        set: (r, v, opts) => { log.push(`set ${r.path}${opts && opts.merge ? ' (merge)' : ''} ${JSON.stringify(v)}`); },
      });
    },
  };
  const body = new Function('db', 'FieldValue', 'console', 'OPTS', `
    ${func('awardBoardWin')}
    return awardBoardWin(OPTS.mode, OPTS.key, OPTS.uids);`);
  await body(db, { increment: (n) => `+${n}`, serverTimestamp: () => 'TS' },
    { log: () => {} }, { mode, key, uids });
  return { log, txs };
};

{
  const r = await award({ mode: 'sprint', key: '2026-11-07', uids: ['u1'] });
  ck(r.log.some((l) => l.startsWith('set users/u1') && /sprintWins/.test(l)),
     'a Sprint win writes sprintWins on the winner', r.log.join(' | '));
  ck(r.log.some((l) => /"sprintWins":"\+1"/.test(l)),
     '...as an INCREMENT, not an assignment - a second win has to make it two',
     (r.log.find((l) => /sprintWins/.test(l)) || ''));
  ck(r.log.some((l) => /set users\/u1 \(merge\)/.test(l)),
     'set+merge, because a deleted account can leave a run behind and update() would fail',
     r.log.join(' | '));
  ck(r.log.some((l) => l.startsWith('set boardAwards/sprint_2026-11-07')),
     'and the day is written down as awarded', r.log.join(' | '));
  // THE ONE THAT MATTERS: both in a single transaction. A claim written
  // beside an increment rather than with it leaves a window where a retry
  // pays twice.
  eq('claim and counter move in exactly one transaction', r.txs, 1);
  const claimAt = r.log.findIndex((l) => l.startsWith('get boardAwards/'));
  const payAt = r.log.findIndex((l) => l.startsWith('set users/'));
  ck(claimAt >= 0 && claimAt < payAt, 'and the claim is READ before anything is paid', r.log.join(' | '));
}
{
  const r = await award({ mode: 'marathon', key: '2026-11-02', uids: ['u1'] });
  ck(r.log.some((l) => /set users\/u1.*marathonWins/.test(l)),
     'a Marathon win increments marathonWins instead', r.log.join(' | '));
  ck(!r.log.some((l) => /sprintWins/.test(l)), 'and never the Sprint counter');
}
{
  const r = await award({ mode: 'sprint', key: '2026-11-07', uids: ['u1'], already: true });
  ck(!r.log.some((l) => l.startsWith('set ')),
     'a day already awarded pays nothing on a retry', r.log.join(' | '));
}
{
  const r = await award({ mode: 'marathon', key: '2026-11-02', uids: ['u1', 'u2', 'u3'] });
  const paid = r.log.filter((l) => l.startsWith('set users/'));
  eq('three tied winners are all paid', paid.length, 3);
  eq('still in one transaction', r.txs, 1);
}
{
  const r = await award({ mode: 'sprint', key: '2026-11-07', uids: ['u1', 'u1', null, undefined] });
  eq('the same uid twice is paid once', r.log.filter((l) => l.startsWith('set users/')).length, 1);
}
{
  const r = await award({ mode: 'sprint', key: '2026-11-07', uids: [] });
  eq('nobody to pay opens no transaction at all', r.txs, 0);
  deq('and writes nothing', r.log, []);
}

// ---- the schedules settle it ----------------------------------------------
{
  const daily = fn.slice(fn.indexOf('exports.postDailyDigest'), fn.indexOf('exports.postWeeklyDigest'));
  ck(/await awardBoardWin\(job\.mode, dateStr,/.test(daily),
     'the daily schedule settles the Sprint win', (daily.match(/[^\n]*awardBoardWin[^\n]*/) || [''])[0].trim());
  ck(/topTied\(snap\.docs\.map\(\(d\) => d\.data\(\)\), job\.rank\)/.test(daily),
     'off the board it just read, through the board’s own ordering', daily.slice(0, 40));
  ck(/\.map\(\(r\) => r\.uid\)/.test(daily), 'taking the uid off the run document');
  // Before the posting, so a Discord or X failure cannot cost somebody a win.
  ck(daily.indexOf('awardBoardWin') < daily.indexOf('deliverDigest'),
     'settled BEFORE anything is posted, so a failed post cannot lose a win');
  // The rank function is the query's own two fields, not a second opinion.
  const job = (daily.match(/rank: \(r\) => \[[^\]]*\]/) || [''])[0];
  ck(/score/.test(job) && /elapsedMs/.test(job),
     'and Sprint ranks on score then clock, the two the query orders by', job);

  const weekly = fn.slice(fn.indexOf('exports.postWeeklyDigest'), fn.indexOf('function marathonRow'));
  ck(/await awardBoardWin\("marathon", week,/.test(weekly),
     'the weekly schedule settles the Marathon win', (weekly.match(/[^\n]*awardBoardWin[^\n]*/) || [''])[0].trim());
  ck(/marathonScore/.test(weekly.slice(weekly.indexOf('awardBoardWin'), weekly.indexOf('awardBoardWin') + 200)),
     'ranked on the week’s score');
  // /users documents: the uid IS the document id, not a field on it.
  ck(/\.map\(\(d\) => d\.id\)/.test(weekly),
     'taking the uid from the document id, which is where a /users uid lives',
     (weekly.match(/[^\n]*d\.id[^\n]*/) || [''])[0].trim());
  ck(weekly.indexOf('awardBoardWin') < weekly.indexOf('deliverDigest'),
     'and settled before posting too');
}

// ---- a client cannot seed either of them ----------------------------------
for (const f of ['sprintWins', 'marathonWins']) {
  ck(new RegExp(`!\\('${f}' in request\\.resource\\.data\\)`).test(rules),
     `${f} cannot be seeded at sign-up`, f);
}
{
  const block = rules.slice(rules.indexOf('match /boardAwards/'), rules.indexOf('match /boardAwards/') + 120);
  ck(/allow read, write: if false;/.test(block),
     'boardAwards is server-only: a client that could write it could claim a win, or block one forever',
     block.trim());
}

// ---- and the Profile draws them -------------------------------------------
for (const [id, loader] of [['stat-sprint-wins', 'loadSprintStats'], ['stat-marathon-wins', 'loadMarathonStats']]) {
  ck(html.includes(`id="${id}"`), `the markup has #${id}`);
  const src = (html.match(new RegExp(`        function ${loader}\\(\\) \\{\\n[\\s\\S]*?\\n        \\}`)) || [''])[0];
  ck(new RegExp(`set\\("${id}"`).test(src), `${loader} writes it`,
     (src.match(new RegExp(`[^\\n]*${id}[^\\n]*`)) || [''])[0].trim());
}
{
  // One word, one meaning. The pill that used to say "Win %" is the share of
  // Sprints SOLVED - on a day you came second it still reads 100%.
  const stats = (html.match(/        function renderSprintStats\(todayRow, prefix\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  // Comments stripped first. The comment explaining the rename says the old
  // label out loud, and matching the source text as a whole finds it there.
  const code = stats.replace(/^\s*\/\/[^\n]*$/gm, '');
  const labelled = (txt) => code.split('\n').some((l) => l.includes('pill(') && l.includes(`"${txt}"`));
  ck(labelled('Solve %'), 'the rate pill says Solve %',
     (code.match(/[^\n]*Solve %[^\n]*/) || [''])[0].trim());
  ck(!labelled('Win %'), 'and no pill still calls a solve rate a win',
     (code.match(/[^\n]*Win %[^\n]*/) || [''])[0].trim());
}

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
