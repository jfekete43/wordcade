/*
 * The admin surface: who gets in, and what they can do once they are.
 *
 * This is the one place in the project where a client can change a score, so
 * the thing worth testing hardest is not the feature - it is the gate, and
 * the fact that every door goes through it.
 *
 * The gate is the caller's VERIFIED email against the ADMIN_EMAIL secret.
 * Verified matters and is easy to drop: an unverified address on a token is
 * a claim the provider never checked, and sign-in providers exist that will
 * mint one for any address asked for. A check that compares the address and
 * forgets the flag looks identical and is worth nothing.
 *
 * The second thing pinned here is that the free-form edit cannot happen by
 * accident. Constrained is the default: you say how many guesses it should
 * have been and the server derives the score from SCORE_POINTS, so there is
 * no number to typo. Free-form writes exactly what it is given and is
 * reachable only with force: true.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const fns = fs.readFileSync(REPO('functions/index.js'), 'utf8');
const page = fs.readFileSync(REPO('admin.html'), 'utf8');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const between = (src, a, b) => {
  const i = src.indexOf(a); if (i < 0) throw new Error('missing ' + a);
  const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('missing end of ' + a);
  return src.slice(i + a.length, j);
};

// ---- 1. the gate, run rather than read ------------------------------------
{
  const src = 'function requireAdmin(request) {'
    + between(fns, 'function requireAdmin(request) {', '\n}') + '\n}';
  ck(src.length > 120, 'lifted requireAdmin', String(src.length));

  const gate = new Function('ADMIN_EMAIL', 'HttpsError', 'requireAuth', `
    ${src}
    return requireAdmin;
  `);
  const run = (token, secret = 'boss@example.com') => {
    class E extends Error { constructor(code, m) { super(m); this.code = code; } }
    const fn = gate({ value: () => secret }, E, () => {});
    try { fn({ auth: { uid: 'u1', token } }); return 'allowed'; }
    catch (e) { return e.code || 'threw'; }
  };

  eq('the admin gets in', run({ email: 'boss@example.com', email_verified: true }), 'allowed');
  eq('capitalisation does not matter', run({ email: 'BOSS@Example.com', email_verified: true }), 'allowed');
  eq('surrounding space does not matter', run({ email: '  boss@example.com ', email_verified: true }), 'allowed');
  // The four ways in that must not work.
  eq('a different address is refused', run({ email: 'someone@example.com', email_verified: true }), 'permission-denied');
  eq('the RIGHT address UNVERIFIED is refused',
     run({ email: 'boss@example.com', email_verified: false }), 'permission-denied');
  eq('...and a missing verified flag is not a pass',
     run({ email: 'boss@example.com' }), 'permission-denied');
  eq('no email at all is refused', run({ email_verified: true }), 'permission-denied');
  eq('an empty token is refused', run({}), 'permission-denied');
  // An unset secret must fail CLOSED. Empty == empty would otherwise let
  // anyone with no email claim straight through.
  eq('an unconfigured ADMIN_EMAIL lets nobody in',
     run({ email: 'boss@example.com', email_verified: true }, ''), 'permission-denied');
  eq('and not even an empty address against it', run({ email: '', email_verified: true }, ''), 'permission-denied');
}

// ---- 2. every door goes through it ----------------------------------------
{
  // The catastrophic bug in a file like this is not a wrong check, it is a
  // function that forgot to call one. Derived from the exports rather than
  // listed, so a new admin callable is covered the day it is added.
  const names = [...fns.matchAll(/^exports\.(admin\w+)\s*=/gm)].map((m) => m[1]);
  ck(names.length >= 5, 'found the admin callables', names.join(','));
  const ungated = [], unsecreted = [];
  for (const n of names) {
    const body = between(fns, `exports.${n} = `, '\n}));');
    if (!/requireAdmin\(request\)/.test(body)) ungated.push(n);
    // The gate reads a secret, and a callable that does not declare it gets
    // an empty value at runtime - which fails closed, but as a 500 nobody
    // can read rather than a refusal.
    if (!/secrets:\s*\[ADMIN_EMAIL\]/.test(body)) unsecreted.push(n);
  }
  eq('every admin callable calls requireAdmin', ungated, []);
  eq('and every one of them declares the ADMIN_EMAIL secret', unsecreted, []);
  // getDrafts predates these and must keep its own gate, not lose it to a
  // refactor that assumed requireAdmin covered everything.
  const drafts = between(fns, 'exports.getDrafts = ', '\n}));');
  ck(/email_verified !== true|requireAdmin\(request\)/.test(drafts),
     'getDrafts is still gated too');
}

// ---- 3. constrained is the default, free-form is a decision ---------------
{
  const body = between(fns, 'exports.adminSetRun = ', '\n}));');
  ck(/force = false/.test(body), 'force defaults to false', 'the free-form path must be opt-in');
  // The constrained branch derives the score. If it ever read `score` from
  // the request outside the force branch, the tiers would be decoration.
  const constrained = between(body, '} else {', '\n  }');
  ck(/SCORE_POINTS\[g - 1\]/.test(constrained),
     'the constrained branch derives the score from SCORE_POINTS', constrained.slice(0, 120));
  ck(!/\bscore\b\s*[,:]/.test(constrained.replace(/patch\.score|score:\s*solved/g, '')),
     'and never takes a score from the request', constrained.slice(0, 200));
  ck(/Number\.isInteger\(g\)/.test(constrained) && /g > DAILY_GAUNTLET_MAX_GUESSES/.test(constrained),
     'guesses are bounded to the real range');
  // The free-form branch must still refuse nonsense, just not tiers.
  const free = between(body, 'if (force) {', '} else {');
  ck(/Number\.isFinite\(sc\)/.test(free) && /sc < 0/.test(free),
     'free-form still refuses a non-number or a negative score', free.slice(0, 140));
  // Every edit leaves a mark. A corrected row that looks untouched is how a
  // leaderboard argument becomes unanswerable.
  ck(/adminEditedAt: FieldValue\.serverTimestamp\(\)/.test(body), 'every edit is stamped with a time');
  ck(/adminEditedBy: adminUid/.test(body), 'and with who made it');
  ck(/runDocId\("sprint", uid, date\)/.test(body),
     'and it writes through runDocId rather than building the id by hand');
}

// ---- 4. reclaim is separate, and moves the difference ---------------------
{
  const body = between(fns, 'exports.adminSetRun = ', '\n}));');
  ck(/reclaim = false/.test(body), 'reclaiming the payout is opt-in too');
  // The delta, not the whole score: correcting 500 down to 150 should take
  // back 350, and taking back 500 would charge them for a run they did play.
  ck(/const delta = paid - now;/.test(body), 'it reclaims the DIFFERENCE, not the whole payout',
     (body.match(/[^\n]*delta[^\n]*/) || [''])[0].trim());
  ck(/increment\(-delta\)/.test(body), 'and applies that difference to the wallet');
}

// ---- 5. the flag records and nothing enforces -----------------------------
{
  // Said plainly in the comment because a flag that looks like a ban and
  // is not one is worse than no flag.
  const body = between(fns, 'exports.adminFlagUser = ', '\n}));');
  ck(/flagged: !!flagged/.test(body), 'the flag is written');
  const onRun = between(fns, 'exports.onRunCreated', '\n});');
  ck(!/\bflagged\b/.test(onRun),
     'and onRunCreated does NOT read it yet, which the comment says',
     (onRun.match(/[^\n]*flagged[^\n]*/) || [''])[0].trim());
}

// ---- 6. the page ----------------------------------------------------------
{
  ck(/<meta name="robots" content="noindex, nofollow">/.test(page), 'admin.html is noindex, nofollow');
  ck(!/adsbygoogle/.test(page), 'it loads no ad script');
  ck(!/gtag|googletagmanager|cloudflareinsights/.test(page), 'and no analytics');
  const sitemap = fs.readFileSync(REPO('sitemap.xml'), 'utf8');
  ck(!/admin\.html/.test(sitemap), 'and it is not in the sitemap');
  // Nothing in the game should link to it. Not security - the gate is the
  // security - but a link is how a page like this ends up crawled.
  const home = fs.readFileSync(REPO('index.html'), 'utf8');
  ck(!/admin\.html/.test(home), 'and nothing in the game links to it');

  // The page and the backend have to agree on the names, or the first click
  // fails with "not found" at runtime.
  const called = [...page.matchAll(/call\("(\w+)"\)/g)].map((m) => m[1]);
  ck(called.length >= 5, 'the page calls the admin functions', called.join(','));
  const missing = called.filter((n) => !new RegExp(`exports\\.${n}\\s*=`).test(fns));
  eq('every function the page calls exists in functions/index.js', missing, []);

  // The free-form path is behind its own confirm, and that confirm says what
  // makes it different.
  ck(/FREE-FORM EDIT/.test(page), 'the free-form confirm names itself');
  ck(/btn-ff-apply/.test(page) && /force: true/.test(page),
     'and it is the only thing that sends force: true',
     String((page.match(/force: true/g) || []).length));
  eq('exactly one place sends force', (page.match(/force: true/g) || []).length, 1);
  // 16px inputs: anything smaller makes iOS zoom the page on focus, which on
  // a phone is the difference between usable and not.
  ck(/font-size: 16px;.*iOS|iOS zooms/.test(page), 'inputs are 16px so a phone does not zoom on focus');
}

for (const [ok, name, detail] of t) console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : '— ' + detail);
const bad = t.filter((x) => !x[0]).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
