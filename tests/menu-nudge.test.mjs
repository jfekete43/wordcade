/*
 * The menu's two jobs after the cull: get a guest signed in, and get a player
 * to the reward they have already earned.
 *
 * WHY NEW GAME IS GONE. It banked your Stakes run and started another, and
 * it was the FIRST item and the only one styled primary — in every mode,
 * including the three where it refused to do anything. Everything it could do
 * with a score on the board, the Bank button and the run-end modal's New Run
 * already did, on screen. The one thing it alone could do was abandon a
 * SCORELESS run, which is to say dodge a hard word for free: Stakes has no
 * skip, so that was an escape hatch from the Continue the whole mode is built
 * around. Taking it out tightens the mode rather than costing anything.
 *
 * WHY THE DOT. Nothing on the Menu button said there was anything inside it,
 * so a claimable reward sat unseen behind a button nobody had a reason to
 * press. The signal has to be on the OUTSIDE of the menu to do its job, which
 * is also why the profile is re-read after a run instead of only when the
 * menu opens.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(REPO(), f), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const menu = html.slice(html.indexOf('<div id="main-menu-modal"'), html.indexOf('<!-- AUTH MODAL') + 1 || html.indexOf('Back to Game'));

// ---- New Game is gone, and gone completely --------------------------------
{
  ck(!/confirmNewGame/.test(html), 'nothing calls confirmNewGame any more',
     (html.match(/[^\n]*confirmNewGame[^\n]*/) || [''])[0].slice(0, 110));
  ck(!/>New Game</.test(menu), 'and the menu no longer offers it', menu.slice(0, 0));
  // The capability it shared with the on-screen buttons has to still be there.
  ck(/id="btn-new-run" onclick="window\.startNewRun\(\)"/.test(html),
     'the run-end modal still offers a new run, which is where it belonged');
  ck(/window\.triggerCashOut/.test(html), 'and the Bank button still banks a live run');
}

// ---- signing in leads, signing out trails ---------------------------------
{
  // Only the list itself. The three social links below it are buttons too,
  // and counting them put Sign Out in the middle of a list it ends.
  const buttons = [...menu.matchAll(/<button[^>]*class="menu-list-btn[^"]*"[^>]*>/g)]
    .map((m) => (m[0].match(/id="([\w-]+)"/) || m[0].match(/window\.(\w+)/) || [, '?'])[1]);
  const inAt = buttons.indexOf('btn-sign-in');
  const outAt = buttons.indexOf('btn-sign-out');
  ck(inAt !== -1 && outAt !== -1, 'the menu has both an in and an out', buttons.join(','));
  ck(inAt === 0, 'signing in is the first thing a guest sees', buttons.join(','));
  // Last of the destinations. "Back to Game" is below it and is the dismiss,
  // not somewhere to go.
  ck(outAt === buttons.length - 2, 'and signing out is the last place the menu sends you',
     buttons.join(','));
  const lastBtn = [...menu.matchAll(/<button[^>]*class="menu-list-btn[^"]*"[^>]*>/g)].pop()[0];
  ck(/main-menu-modal'\)\.style\.display='none'/.test(lastBtn),
     'with only the way out of the menu below it', lastBtn.slice(0, 120));
  ck(/id="btn-sign-in" class="menu-list-btn is-primary"/.test(menu),
     'in is the primary action', (menu.match(/<button[^>]*btn-sign-in[^>]*>/) || [''])[0].slice(0, 90));
  ck(/id="btn-sign-out" class="menu-list-btn is-quiet"/.test(menu),
     'and out is a quiet one', (menu.match(/<button[^>]*btn-sign-out[^>]*>/) || [''])[0].slice(0, 90));
  ck(/id="btn-sign-out"[^>]*style="display:none;"/.test(menu),
     'out ships hidden, so a guest never sees an offer to leave an account they have not got');
  // Both run the same handler; only which one is VISIBLE changes.
  eq('both are the same action', (menu.match(/handleAuthAction\(\)/g) || []).length, 2);
  const swap = html.slice(html.indexOf('document.getElementById("btn-sign-in").style.display'), 0) ||
    (html.match(/[^\n]*btn-sign-in"\)\.style\.display[^\n]*\n[^\n]*btn-sign-out"\)\.style\.display[^\n]*/) || [''])[0];
  ck(/isGuest \? "" : "none"/.test(swap) && /isGuest \? "none" : ""/.test(swap),
     'and the guest flag decides which one is up', swap.replace(/\s+/g, ' ').slice(0, 150));
}

// ---- the dot knows what is actually claimable -----------------------------
{
  const grab = (re, what) => { const m = html.match(re); if (!m) throw new Error('missing ' + what); return m[0]; };
  const src = [
    grab(/        function challengeState\(chal, type, p\) \{\n[\s\S]*?\n        \}/, 'challengeState'),
    grab(/        function challengeAvailable\(chal, p\) \{\n[\s\S]*?\n        \}/, 'challengeAvailable'),
    grab(/        function claimableCount\(p\) \{\n[\s\S]*?\n        \}/, 'claimableCount'),
  ].join('\n');
  const CH = {
    daily_pool: [{ id: 'd1', field: 'played', req: 3 }, { id: 'd2', field: 'guessed', req: 5 },
                 { id: 'd3', field: 'guess1', req: 1 }, { id: 'dX', field: 'played', req: 1 }],
    career: [{ id: 'c1', field: 'wordsPlayed', req: 100 }, { id: 'c2', field: 'kobeCount', req: 1 },
             // A closed mode's challenge: off the list, and so out of the dot's
             // count, unless this player already has progress on it.
             { id: 'c3', mode: 'shut', field: 'ffaWins', req: 1 }],
  };
  const M = { open: {}, shut: { hidden: true } };
  // eslint-disable-next-line no-new-func
  const A = new Function('CHALLENGES', 'MODES',
    `${src}; return { challengeState, challengeAvailable, claimableCount };`)(CH, M);

  const prof = (over = {}) => ({
    wordsPlayed: 0, kobeCount: 0, claimedCareer: [],
    dailyStats: { activeIds: ['d1', 'd2', 'd3'], claimed: [], played: 0, guessed: 0, guess1: 0 },
    ...over,
  });

  eq('a fresh profile has nothing waiting', A.claimableCount(prof()), 0);
  // The closed mode's challenge is finished, and still not counted — the
  // player has no progress on it, so it is not on their list to claim.
  eq('a closed mode\'s reward is not promised to someone who never played it',
     A.claimableCount(prof({ ffaWins: 0 })), 0);
  eq('...but it is to someone who did', A.claimableCount(prof({ ffaWins: 3 })), 1);
  ck(!A.challengeAvailable({ mode: 'shut', field: 'ffaWins', req: 1 }, prof()),
     'a closed mode with no progress is off the list');
  ck(A.challengeAvailable({ mode: 'shut', field: 'ffaWins', req: 1 }, prof({ ffaWins: 1 })),
     'a closed mode with progress stays on it');
  ck(A.challengeAvailable({ mode: 'open', field: 'wordsPlayed', req: 1 }, prof()),
     'an open mode is always on it');
  ck(A.challengeAvailable({ field: 'wordsPlayed', req: 1 }, prof()),
     'and so is a challenge that names no mode at all');
  eq('and no profile at all is not an error', A.claimableCount(null), 0);
  eq('one finished daily is one reward',
     A.claimableCount(prof({ dailyStats: { ...prof().dailyStats, played: 3 } })), 1);
  eq('over-shooting the target still counts once',
     A.claimableCount(prof({ dailyStats: { ...prof().dailyStats, played: 99 } })), 1);
  eq('a claimed one stops counting',
     A.claimableCount(prof({ dailyStats: { ...prof().dailyStats, played: 3, claimed: ['d1'] } })), 0);
  eq('career challenges count too', A.claimableCount(prof({ kobeCount: 1 })), 1);
  eq('and both at once', A.claimableCount(prof({ kobeCount: 1, dailyStats: { ...prof().dailyStats, played: 3 } })), 2);
  // dX is in the pool but was not drawn for today. Counting it would light the
  // dot for a reward that is not on the player's list and cannot be claimed.
  eq('a daily the player was not given does not count, even when its field is met',
     A.claimableCount(prof({ dailyStats: { ...prof().dailyStats, played: 3, activeIds: ['d2', 'd3'] } })), 0);
  // These come off a document; a missing field is zero progress, not a crash.
  eq('a profile with no dailyStats at all is simply nothing waiting',
     A.claimableCount({ claimedCareer: [], wordsPlayed: 0, kobeCount: 0 }), 0);
  eq('and a missing claimed list does not throw',
     A.claimableCount({ dailyStats: { activeIds: ['d1'], played: 3 }, claimedCareer: [] }), 1);
}

// ---- one rule, asked by both the list and the dot -------------------------
{
  const list = html.slice(html.indexOf('window.renderChallenges = function(type)'),
                          html.indexOf('window.claimChallenge = async function'));
  ck(/challengeState\(chal, type, userProfileData\)/.test(list),
     'the challenge list asks challengeState rather than restating the rule', list.slice(0, 0));
  ck(!/dailyStats\.claimed\.includes|claimedCareer\.includes/.test(list),
     'so the two cannot disagree about what is complete',
     (list.match(/[^\n]*includes\(chal\.id\)[^\n]*/) || [''])[0].slice(0, 120));
}

// ---- where the dot goes, and when it is refreshed -------------------------
{
  // Anchored on the DEFINITION. window.renderChallenges also appears as an
  // onclick in the tab markup far earlier, so the obvious anchor sliced
  // backwards and handed this an empty string.
  const fnSrc = html.slice(html.indexOf('function refreshClaimableDot()'),
                           html.indexOf('window.renderChallenges = function'));
  ck(fnSrc.length > 100 && fnSrc.length < 900, 'refreshClaimableDot is findable', String(fnSrc.length));
  ck(/\.menu-btn/.test(fnSrc), 'the dot goes on the Menu button, outside the menu', fnSrc.slice(0, 140));
  ck(/btn-challenges/.test(fnSrc), 'and on Challenges inside it, so the trail continues');
  ck(/classList\.toggle\("has-claim", on\)/.test(fnSrc),
     'and it is removed as well as added', fnSrc.slice(0, 200));

  // The refresh points. Opening the menu alone is not enough: a dot you only
  // see once you have opened the menu has already failed.
  const callers = [...html.matchAll(/refreshClaimableDot\(\)/g)].length;
  ck(callers >= 4, 'the dot is refreshed from several places', String(callers));
  ck(/function applyProfileToLanding\(\)[\s\S]{0,200}refreshClaimableDot\(\)/.test(html),
     'when the profile lands at sign-in');
  ck(/showMainMenu = function\(\) \{[^}]*refreshClaimableDot\(\)/.test(html),
     'when the menu opens, so the one inside is right');
  ck(/claimedCareer\.push\(id\); \}\n\s*refreshClaimableDot\(\)/.test(html),
     'and the moment a reward is claimed, so it goes away');
  // The one that makes it a nudge rather than a report.
  const save = html.slice(html.indexOf('async function saveRunToCloud'), html.indexOf('let lastRunOutcome'));
  ck(/refreshClaimableDot\(\)/.test(save) && /setTimeout/.test(save),
     'and after a run, so a reward earned just now lights the button before it is pressed',
     save.slice(-0));
}

// ---- the pulse is motion, and motion is optional --------------------------
{
  ck(/\.has-claim::after \{[\s\S]{0,260}animation: pulse-dot/.test(html),
     'the dot pulses', (html.match(/\.has-claim::after \{[\s\S]{0,200}/) || [''])[0].slice(0, 130));
  ck(/@keyframes pulse-dot/.test(html), 'with a keyframe of its own');
  // The repo already turns decorative motion off for anyone who asks; a new
  // pulse that ignored that would be the one exception on the page.
  ck(/body\.reduce-motion \.has-claim::after,/.test(html),
     'and reduce-motion turns it off with the rest of the decorative motion');
  ck(/\.has-claim \{ position: relative; \}/.test(html),
     'the dot is positioned against its own button, not the page');
}

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
