/*
 * Wins and top-ten finishes: who a finished day owes a career counter to.
 *
 * These cannot be decided when a run ends. Somebody playing later the same
 * day can take the win, or push you out of the ten — which is exactly why
 * onRunCreated's achievedTop10Daily is documented as a snapshot and backs a
 * one-time challenge rather than a count. The settled numbers come from the
 * nightly archive job, the only thing that ever sees a day's full final field.
 *
 * Two properties carry the whole feature, and both are easy to get wrong:
 *
 * TIES. computeAwards is built on computeStandings instead of its own sort, so
 * "won" means what that day's published page says. The board shows tied
 * players sharing first; so must this, or the page and the Profile disagree
 * about the same day.
 *
 * IDEMPOTENCE. --all walks every past day and the nightly rebuilds yesterday,
 * so the award step runs again over days it has already settled. A counter
 * that incremented on every rebuild would be worse than no counter: it would
 * climb on its own and look like play. The marker document is what stops it.
 *
 * Pure; no browser, no emulator.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as R from '../tools/gauntlet-archive-render.mjs';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const run = (uid, score, solved) => ({ uid, username: uid ? uid.toUpperCase() : 'Player', score, wordsGuessed: solved });

// ---- ties --------------------------------------------------------------
{
  const a = R.computeAwards([run('a', 900, 7), run('b', 900, 7), run('c', 900, 6)]);
  eq('an exact tie on score AND words solved shares the win', a.winners, ['a', 'b']);
  eq('and everyone on the board is a top-ten finish', a.top10, ['a', 'b', 'c']);
}
{
  // The board breaks score ties on words solved, so this is NOT a tie.
  const a = R.computeAwards([run('a', 900, 7), run('b', 900, 6)]);
  eq('equal scores split on words solved, same as the board', a.winners, ['a']);
}
{
  const a = R.computeAwards([run('a', 100, 2), run('b', 900, 7)]);
  eq('the winner is the top of the board, not the first row handed in', a.winners, ['b']);
}

// ---- who is eligible ---------------------------------------------------
{
  // A malformed run - no uid on the document at all. NOT a deleted account:
  // the uid lives on the run, so a departed player's row still carries one.
  //
  // It takes first on the board, and the published page for that day shows it
  // there. So no win is awarded rather than the win sliding to second, which
  // would hand somebody a trophy the page says they did not get.
  const a = R.computeAwards([run(null, 900, 7), run('b', 800, 6)]);
  eq('a uid-less row at the top does not pass the win down to second', a.winners, []);
  eq('and second still gets the top-ten finish the board shows', a.top10, ['b']);
  ck(!a.top10.includes(null) && !a.top10.includes(undefined),
     'with no null row in the ten', JSON.stringify(a.top10));
}
{
  const a = R.computeAwards([run('a', 900, 7), run('a', 800, 6)]);
  eq('one player cannot be counted twice from one day', a.top10, ['a']);
}
{
  const a = R.computeAwards([]);
  eq('a day nobody played owes nothing', a, { winners: [], top10: [] });
}

// ---- the cut -----------------------------------------------------------
{
  const many = Array.from({ length: 15 }, (_, i) => run('p' + i, 1000 - i * 10, 7));
  const a = R.computeAwards(many, 10);
  eq('the top ten is ten deep', a.top10.length, 10);
  eq('and it is the top ten, in order', a.top10[0], 'p0');
  ck(!a.top10.includes('p10'), 'eleventh place gets nothing', JSON.stringify(a.top10));
  eq('with exactly one winner', a.winners, ['p0']);
}
{
  const a = R.computeAwards([run('a', 900, 7), run('b', 800, 6)]);
  ck(a.winners.every((w) => a.top10.includes(w)),
     'a winner is always also a top-ten finish, or the two counters contradict each other');
}

// ---- the decision lives in the renderer, the writing in the builder ----
// That split is this archive's stated contract, and the award step was
// written on the wrong side of it first.
const render = fs.readFileSync(REPO('tools/gauntlet-archive-render.mjs'), 'utf8');
const build = fs.readFileSync(REPO('tools/build-gauntlet-archive.mjs'), 'utf8');
ck(/export function computeAwards/.test(render), 'computeAwards is the renderer\'s');
ck(/R\.computeAwards\(/.test(build), 'and the builder calls it rather than sorting again');
ck(!/place === 1/.test(build), 'the builder does not re-decide who won', 'place === 1 found in the builder');

// A uid on a standings row is for the counters only. These pages are public.
ck(/uid: r\.uid \|\| null/.test(render), 'standings carry a uid for the counters');
for (const f of ['gauntlet/index.html'].concat(
       fs.readdirSync(REPO('gauntlet')).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
         .slice(0, 5).map((d) => `gauntlet/${d}/index.html`))) {
  const page = fs.readFileSync(REPO(f), 'utf8');
  ck(!/"uid"|data-uid|\buid=/.test(page), `${f} publishes no uid`);
}

// ---- idempotence -------------------------------------------------------
const award = build.slice(build.indexOf('async function awardDay'));
ck(/collection\("gauntletAwards"\)\.doc\(day\.date\)/.test(award),
   'a day records that it has been settled');
ck(award.indexOf('.exists') < award.indexOf('batch.commit'),
   'and that record is checked BEFORE anything is incremented, which is the whole point');
ck(/return null;/.test(award.slice(0, award.indexOf('computeAwards'))),
   'an already-settled day returns without touching a counter');
ck(/batch\.set\(ref,/.test(award) && /batch\.commit\(\)/.test(award),
   'the marker and the increments go in ONE batch, so a crash cannot leave counters raised with no record');
// update() on a deleted account's doc would reject the whole batch and strand
// the day, including everyone else on it.
ck(/\{ merge: true \}/.test(award), 'counters are merged rather than updated, so a deleted account cannot strand the day');
ck(/FieldValue\.increment\(1\)/.test(award), 'and they increment rather than being written outright');
ck(/if \(DRY\)/.test(build), 'a dry run awards nothing');

// ---- a client cannot seed its own ---------------------------------------
const rules = fs.readFileSync(REPO('firestore.rules'), 'utf8');
for (const f of ['gauntletWins', 'gauntletTop10s']) {
  ck(new RegExp(`!\\('${f}' in request\\.resource\\.data\\)`).test(rules),
     `a new account cannot arrive with ${f} already set`);
}

// ---- and the Profile reads them ----------------------------------------
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
ck(/userProfileData\.gauntletWins/.test(html), 'the Profile shows the wins counter');
ck(/userProfileData\.gauntletTop10s/.test(html), 'and the top-ten counter');
ck(!/Top 10 Finish/.test(html), 'and no longer shows the one-off "Top 10 Finish" line');
// The challenge flag is a different question and must survive the change.
ck(/achievedTop10Daily/.test(fs.readFileSync(REPO('functions/index.js'), 'utf8')),
   'the one-time career challenge still has its own flag');

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
