/*
 * Being asked to pick a handle, once, at the moment signing up makes it possible.
 *
 * Before this existed, signing up kept the generated guest name: linking a
 * credential upgrades the SAME uid and the SAME profile document, so
 * G_Crane_4821 carried straight onto the leaderboards. Nothing told the player
 * they could change it, and the one line that mentioned a custom handle lived in
 * the guest promo block, which stops being shown the instant you stop being a
 * guest.
 *
 * A guest now gets ONE change of their own, so signing up is no longer the
 * first moment there is anything to ask about — but it is still a moment
 * worth asking at, and the two prompts say different things because they can
 * promise different things. Section D covers the guest offer and the gate
 * behind it.
 *
 * Two things have to hold, and they pull in opposite directions:
 *
 *   - The two LINK paths must ask. Those are the new accounts.
 *   - The two ALREADY-IN-USE paths must not. Those are a returning player
 *     signing in on a new browser, who picked their name long ago; asking them
 *     to "pick your handle" would read as though their account had been lost.
 *
 * So the wiring is checked per branch, not once for the file. The behaviour
 * checks then run the real functions, extracted verbatim from index.html,
 * against the real DOM with only their globals substituted — a stub
 * callChangeUsername and a fake window.location, so a reload can be counted
 * instead of performed.
 *
 * Needs Playwright, not the emulator.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const html = fs.readFileSync(REPO('index.html'), 'utf8');
const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8');

const t = [];
const ck = (name, cond, detail = '') => t.push({ name, cond: !!cond, detail });

/*
 * Brace-counting, because a regex over a function body is how this file's
 * predecessors kept lifting half a function: `[\s\S]*?\}` stops at the first
 * closing brace of an inner block, and an indentation anchor stops wherever the
 * same shape happens to recur at another depth.
 */
function bodyAt(source, declaration) {
  const start = source.indexOf(declaration);
  if (start < 0) return null;
  let i = source.indexOf('{', start + declaration.length - 1);
  if (i < 0) return null;
  let depth = 0;
  for (let j = i; j < source.length; j++) {
    const c = source[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(start, j + 1); }
  }
  return null;
}

// --- A. wiring: which branches ask, and which must not ---

const google = bodyAt(html, 'window.signInWithGoogle = async function()');
const email = bodyAt(html, 'window.submitEmailAuth = async function()');
ck('found signInWithGoogle', google && google.length > 400, String(google && google.length));
ck('found submitEmailAuth', email && email.length > 400, String(email && email.length));

// The link call and the already-in-use recovery live in the same function, so
// split each one at its own catch boundary to check the branches separately.
const splitAt = (src, linkCall, marker) => {
  const a = src.indexOf(linkCall), b = src.indexOf(marker);
  // linkPath starts AT the link call, so the "enter both an email and a
  // password" guard at the top of submitEmailAuth is not mistaken for the
  // success alert this change removed.
  return a < 0 || b < 0 || a > b ? null : { linkPath: src.slice(a, b), recoveryPath: src.slice(b) };
};
const g = splitAt(google || '', 'await linkWithPopup(', 'auth/credential-already-in-use');
const e = splitAt(email || '', 'await linkWithCredential(', 'auth/email-already-in-use');
ck('google splits at its already-in-use branch', !!g);
ck('email splits at its already-in-use branch', !!e);

ck('google link path asks for a handle', g && g.linkPath.includes('showHandleSetup("this Google account")'));
ck('email link path asks for a handle', e && e.linkPath.includes('showHandleSetup("this email")'));
ck('google link path no longer alerts', g && !/alert\(/.test(g.linkPath));
ck('email link path no longer alerts', e && !/alert\(/.test(e.linkPath));
// The reload now belongs to the modal's two exits. Left here it would fire
// underneath the prompt and take the prompt with it.
ck('google link path does not reload behind the prompt', g && !/location\.reload/.test(g.linkPath));
ck('email link path does not reload behind the prompt', e && !/location\.reload/.test(e.linkPath));

ck('returning google player is NOT asked to pick a handle', g && !g.recoveryPath.includes('showHandleSetup'));
ck('returning email player is NOT asked to pick a handle', e && !e.recoveryPath.includes('showHandleSetup'));
// They still need the repaint the link paths hand to the modal instead.
ck('returning google player still gets a reload', g && /location\.reload/.test(g.recoveryPath));
ck('returning email player still gets a reload', e && /location\.reload/.test(e.recoveryPath));

// Three callers and the declaration: the two link paths, and the guest offer.
// Nothing else may open it — every other entry point is an existing account
// that chose its name long ago.
const callSites = (html.match(/showHandleSetup\(/g) || []).length;
ck('the two link paths, the guest offer and the declaration reference it',
   callSites === 4, String(callSites));
ck('and the guest offer is the one that passes null',
   /showHandleSetup\(null\)/.test(html));

// --- B. markup ---

// Positionally, not by regex: [\s\S]*?</div> stops at the first INNER closing
// tag, and bodyAt counts {} so it is meaningless on markup.
const modal = (() => {
  const a = html.indexOf('<div id="handle-setup-modal"');
  if (a < 0) return '';
  const b = html.indexOf('\n    </div>', a);          // the 4-space close = end of a top-level modal
  return b < 0 ? '' : html.slice(a, b + 11);
})();
ck('found the handle-setup modal', modal.length > 400, String(modal.length));
// .modal-overlay is what hides it until asked for, and also what the contrast
// suite forces open, so its buttons are measured with every other button.
ck('it is a .modal-overlay', /id="handle-setup-modal" class="modal-overlay"/.test(modal));
ck('it is hidden until asked for', !/id="handle-setup-modal"[^>]*style="[^"]*display:\s*flex/.test(modal));
ck('has a blurb slot', modal.includes('id="handle-setup-blurb"'));
ck('has an error slot', modal.includes('id="handle-setup-error"'));
ck('has a save button', /id="handle-setup-save"[\s\S]*?onclick="window\.saveHandleSetup\(\)"/.test(modal));
ck('has a skip button', /id="handle-setup-skip"[\s\S]*?onclick="window\.skipHandleSetup\(\)"/.test(modal));
// 12 is the server's truncation in changeUsername; a longer field would let a
// player type a name that comes back silently cut.
ck('input caps at 12 like the server does', /id="handle-setup-input"[^>]*maxlength="12"/.test(modal));
const profileMax = (html.match(/id="username-input"[^>]*maxlength="(\d+)"/) || [])[1];
ck('input cap matches the Profile field', profileMax === '12', String(profileMax));
// An error line that appears from nothing shoves the buttons down under the
// thumb that is reaching for them.
ck('the error line reserves its own height', /id="handle-setup-error"[^>]*min-height/.test(modal));

// --- C. behaviour: the real functions, real DOM, substituted globals ---

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { const { execSync } = await import('node:child_process');
  ({ chromium } = await import(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs'))); }
const launch = {};
if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(launch);

const parts = [
  bodyAt(html, 'function sanitizeUsername(name)'),
  bodyAt(html, 'function showHandleSetup(label)'),
  bodyAt(html, 'window.skipHandleSetup = function()'),
  bodyAt(html, 'window.saveHandleSetup = async function()'),
];
ck('extracted all four functions verbatim', parts.every(p => p && p.length > 60),
   parts.map(p => (p ? p.length : 'MISSING')).join(','));
// The trailing semicolons the two assignments need, one line exposing the
// inner declaration, and the flag the three lifted functions share — declared
// here because bodyAt lifts functions, not the `let` that sits between two of
// them. Nothing in the extracted code itself is altered.
const src = 'let handleSetupIsGuestOffer = false;\n' + parts.join(';\n')
  + ';\nwindow.__showHandleSetup = showHandleSetup;';
ck('the lifted functions really do share that flag, rather than the test inventing it',
   /let handleSetupIsGuestOffer = false;/.test(html));

// The markup only — the page's own module cannot run offline, and running it
// would fetch Firebase and sign in.
const markupOnly = html.replace(/<script type="module"[\s\S]*?<\/script>/g, '');

async function scenario(opts) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(markupOnly);
  return await page.evaluate(async ({ src, opts }) => {
    const out = { reloads: 0, sent: [], repaints: 0, boardRefreshes: 0 };
    const fakeWindow = { location: { reload: () => { out.reloads++; } } };
    const callChangeUsername = async (payload) => {
      out.sent.push(payload);
      if (opts.rejectWith) throw new Error(opts.rejectWith);
      return { data: { username: payload.username, cost: 0 } };
    };
    const profile = opts.username === null ? null : { username: opts.username };
    // eslint-disable-next-line no-new-func
    // The guest exit repaints in place instead of reloading, so those two
    // are counted the same way the reload is.
    new Function('window', 'document', 'userProfileData', 'callChangeUsername',
                 'applyProfileToLanding', 'refreshModeBoard', src)
      (fakeWindow, document, profile, callChangeUsername,
       () => { out.repaints++; }, () => { out.boardRefreshes++; });

    const el = (id) => document.getElementById(id);
    const snap = () => ({
      modalShown: el('handle-setup-modal').style.display,
      authShown: el('auth-modal').style.display,
      blurb: el('handle-setup-blurb').textContent,
      error: el('handle-setup-error').textContent,
      skipLabel: el('handle-setup-skip').textContent,
      saveLabel: el('handle-setup-save').textContent,
      terms: el('handle-setup-terms').textContent,
      saveDisabled: el('handle-setup-save').disabled,
      value: el('handle-setup-input').value,
      selection: el('handle-setup-input').selectionEnd - el('handle-setup-input').selectionStart,
      focused: document.activeElement === el('handle-setup-input'),
    });

    el('auth-modal').style.display = 'flex';       // as it is when the player taps Sign Up
    fakeWindow.__showHandleSetup(opts.guestOffer ? null : (opts.label || 'this email'));
    out.afterPrompt = snap();

    if (opts.type !== undefined) el('handle-setup-input').value = opts.type;
    if (opts.save) {
      const p = fakeWindow.saveHandleSetup();
      out.duringSave = snap();                     // before the callable settles
      await p;
    }
    if (opts.skip) fakeWindow.skipHandleSetup();
    out.after = snap();
    return out;
  }, { src, opts }).finally(() => page.close());
}

// The ordinary case: a guest name is offered back, ready to be typed over.
const fresh = await scenario({ username: 'G_CRANE_4821', label: 'this Google account' });
ck('the prompt opens', fresh.afterPrompt.modalShown === 'flex', fresh.afterPrompt.modalShown);
ck('the sign-up modal closes behind it', fresh.afterPrompt.authShown === 'none', fresh.afterPrompt.authShown);
ck('the blurb names where the account was saved',
   fresh.afterPrompt.blurb === 'Your progress is now saved to this Google account.', fresh.afterPrompt.blurb);
ck('the field is pre-filled with the name they have', fresh.afterPrompt.value === 'G_CRANE_4821', fresh.afterPrompt.value);
// Pre-filled and merely focused would make the player clear 12 characters they
// never chose before they can type.
ck('the pre-filled name is selected, so typing replaces it',
   fresh.afterPrompt.selection === 'G_CRANE_4821'.length, String(fresh.afterPrompt.selection));
ck('the field has focus', fresh.afterPrompt.focused);
ck('skipping is labelled with what it keeps',
   fresh.afterPrompt.skipLabel === 'Keep G_CRANE_4821', fresh.afterPrompt.skipLabel);
ck('nothing is sent just by opening the prompt', fresh.sent.length === 0, String(fresh.sent.length));
ck('opening the prompt does not reload', fresh.reloads === 0, String(fresh.reloads));

const noName = await scenario({ username: null });
ck('with no profile loaded the skip button still says something sensible',
   noName.afterPrompt.skipLabel === 'Skip For Now', noName.afterPrompt.skipLabel);
ck('with no profile loaded the field is empty, not "undefined"',
   noName.afterPrompt.value === '', JSON.stringify(noName.afterPrompt.value));

// Saving a name.
const saved = await scenario({ username: 'G_CRANE_4821', type: 'soda', save: true });
ck('the typed name is sent', saved.sent.length === 1, JSON.stringify(saved.sent));
ck('it is sent uppercased, as the handle format is',
   saved.sent[0] && saved.sent[0].username === 'SODA', JSON.stringify(saved.sent[0]));
ck('a saved handle reloads the page', saved.reloads === 1, String(saved.reloads));
// A second tap while the first is in flight would spend the free change twice.
ck('the save button is disabled while in flight', saved.duringSave.saveDisabled === true);
ck('and says so', /Saving/.test(saved.duringSave.saveLabel), saved.duringSave.saveLabel);

const messy = await scenario({ username: 'G_CRANE_4821', type: '  so!!da<>  ', save: true });
ck('punctuation is stripped before sending',
   messy.sent[0] && messy.sent[0].username === 'SODA', JSON.stringify(messy.sent[0]));
// sanitizeUsername used to HTML-escape before stripping, so the angle brackets
// survived as the letters LT and GT and went into the player's name.
const tags = await scenario({ username: 'G_CRANE_4821', type: '<b>SODA</b>', save: true });
ck('markup does not leave its letters behind in the name',
   tags.sent[0] && tags.sent[0].username === 'BSODAB', JSON.stringify(tags.sent[0]));

const trimmed = await scenario({ username: 'G_CRANE_4821', type: 'ABCDEFGHIJKLMNOP', save: true });
ck('an over-long name is cut to 12 before sending',
   trimmed.sent[0] && trimmed.sent[0].username === 'ABCDEFGHIJKL', JSON.stringify(trimmed.sent[0]));

const short = await scenario({ username: 'G_CRANE_4821', type: 'AB', save: true });
ck('a 2-character name is refused locally', short.sent.length === 0, String(short.sent.length));
ck('and says why', /3 letters or numbers/.test(short.after.error), short.after.error);
ck('a refused name does not reload', short.reloads === 0, String(short.reloads));
ck('a refused name leaves the prompt open', short.after.modalShown === 'flex', short.after.modalShown);
ck('a refused name leaves the button usable', short.after.saveDisabled === false);

const three = await scenario({ username: 'G_CRANE_4821', type: 'ABC', save: true });
ck('three characters is enough, matching the server floor',
   three.sent[0] && three.sent[0].username === 'ABC', JSON.stringify(three.sent[0]));

// It used to fall back to "Guest", which is 5 characters and therefore passed
// the length check: clearing the field renamed you to Guest and spent the free
// change doing it.
const emptied = await scenario({ username: 'G_CRANE_4821', type: '', save: true });
ck('clearing the field and saving sends nothing', emptied.sent.length === 0, String(emptied.sent.length));
const blanked = await scenario({ username: 'G_CRANE_4821', type: '   ', save: true });
ck('whitespace alone sends nothing', blanked.sent.length === 0, String(blanked.sent.length));
const punct = await scenario({ username: 'G_CRANE_4821', type: '!!!', save: true });
ck('punctuation alone sends nothing', punct.sent.length === 0, String(punct.sent.length));

// The server rejects a taken or screened name. Reloading here would throw the
// message away along with the player's attempt.
const taken = await scenario({ username: 'G_CRANE_4821', type: 'SODA', save: true, rejectWith: 'That Arcade Handle is already taken! Please choose another.' });
ck('a rejected handle does not reload', taken.reloads === 0, String(taken.reloads));
ck('a rejected handle keeps the prompt open', taken.after.modalShown === 'flex', taken.after.modalShown);
ck("the server's reason is shown", /already taken/.test(taken.after.error), taken.after.error);
ck('the button goes back to being usable', taken.after.saveDisabled === false);
ck('and back to its own label', taken.after.saveLabel === 'Save Handle', taken.after.saveLabel);

// Skipping.
const skipped = await scenario({ username: 'G_CRANE_4821', skip: true });
ck('skipping sends nothing', skipped.sent.length === 0, String(skipped.sent.length));
ck('skipping closes the prompt', skipped.after.modalShown === 'none', skipped.after.modalShown);
// The page behind was painted for a guest: the auth button still says
// "Sign Up / Log In" and the Profile still hides the handle field.
ck('skipping still reloads, so the page stops looking like a guest’s', skipped.reloads === 1, String(skipped.reloads));

// --- D. it has to fit on a phone ---
{
  const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
  await page.setContent(markupOnly);
  const m = await page.evaluate(() => {
    const modal = document.getElementById('handle-setup-modal');
    modal.style.display = 'flex';
    // The longest label the skip button can ever hold: "Keep " + a 12-char handle.
    document.getElementById('handle-setup-skip').textContent = 'Keep WWWWWWWWWWWW';
    const rect = (id) => document.getElementById(id).getBoundingClientRect();
    const spill = (id) => {
      const el = document.getElementById(id), cs = getComputedStyle(el);
      const inner = el.getBoundingClientRect().width
        - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
        - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
      const r = document.createRange(); r.selectNodeContents(el);
      return r.getBoundingClientRect().width - inner;
    };
    return {
      docWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      skipSpill: spill('handle-setup-skip'),
      saveSpill: spill('handle-setup-save'),
      saveH: rect('handle-setup-save').height,
      skipH: rect('handle-setup-skip').height,
      // A label too wide for its button WRAPS rather than overflowing, which
      // makes it taller and makes `spill` go MORE negative — so spill alone
      // reads a wrapped two-line button as comfortably fitting. Its own text
      // height against one line is what actually says whether it wrapped.
      skipLines: Math.round((() => {
        const el = document.getElementById('handle-setup-skip');
        const r = document.createRange(); r.selectNodeContents(el);
        const h = r.getBoundingClientRect().height;
        const probe = document.createElement('span');
        probe.style.font = getComputedStyle(el).font; probe.textContent = 'W';
        el.appendChild(probe);
        const one = probe.getBoundingClientRect().height;
        probe.remove();
        return h / one;
      })()),
      boxRight: rect('handle-setup-input').right,
      // .modal-stats span is a blanket 24px bold green rule for stat FIGURES.
      // The blurb is the first half of a sentence whose second half is plain
      // text beside it, so inheriting that rule split one sentence into two
      // different-looking ones. Nothing about size, spill or contrast notices
      // that; comparing the halves to each other does.
      blurb: (() => {
        const b = getComputedStyle(document.getElementById('handle-setup-blurb'));
        const p = getComputedStyle(document.getElementById('handle-setup-blurb').parentElement);
        return { size: b.fontSize, parentSize: p.fontSize, color: b.color, parentColor: p.color, weight: b.fontWeight, parentWeight: p.fontWeight };
      })(),
    };
  });
  await page.close();
  ck('the prompt does not make the page scroll sideways at 320px',
     m.docWidth <= m.viewport, `${m.docWidth} > ${m.viewport}`);
  // A 12-character handle is the worst case, and it is reachable.
  ck('the longest possible skip label does not spill out of its button',
     m.skipSpill <= 0, m.skipSpill.toFixed(1) + 'px over');
  ck('nor wrap onto a second line', m.skipLines === 1, m.skipLines + ' lines');
  // Two buttons of different heights in one stack is the visible symptom of
  // that wrap, and the thing a player would actually notice.
  ck('the two buttons stay the same height', Math.abs(m.saveH - m.skipH) <= 1,
     `save ${m.saveH} vs skip ${m.skipH}`);
  ck('the save label fits its button', m.saveSpill <= 0, m.saveSpill.toFixed(1) + 'px over');
  ck('save is a thumb-sized target', m.saveH >= 44, m.saveH + 'px');
  ck('skip is a thumb-sized target', m.skipH >= 44, m.skipH + 'px');
  ck('the field stays inside the viewport', m.boxRight <= m.viewport, `${m.boxRight} > ${m.viewport}`);
  ck('the blurb reads at the size of the sentence it is part of',
     m.blurb.size === m.blurb.parentSize, `${m.blurb.size} vs ${m.blurb.parentSize}`);
  ck('and in the same colour', m.blurb.color === m.blurb.parentColor, `${m.blurb.color} vs ${m.blurb.parentColor}`);
  ck('and at the same weight', m.blurb.weight === m.blurb.parentWeight, `${m.blurb.weight} vs ${m.blurb.parentWeight}`);
}

// --- E. the guest's one change ---
//
// A guest used to be unable to rename at all, and the only thing enforcing
// that was the Profile hiding the field. The callable accepted the call from
// anyone — so the rule lived in the page, which is to say it did not live
// anywhere. Deliberately showing guests the field makes that gap load-bearing,
// so the gate goes where firestore.rules has already made `username` and
// `handleChanges` unwritable by a client: in the function.

const changeFn = bodyAt(fn, 'exports.changeUsername = onCall(async (request)');
ck('found changeUsername', changeFn && changeFn.length > 800, String(changeFn && changeFn.length));
ck('it works out whether the caller is anonymous',
   /sign_in_provider === "anonymous"/.test(changeFn || ''),
   (changeFn || '').slice(0, 0) || 'no sign_in_provider check');
/*
 * The gate's condition is LIFTED AND RUN, not matched.
 *
 * A regex over it passes on `if (false && isAnonymous && ...)` — the text is
 * all still there and the gate is dead. Since this one condition is the whole
 * feature, it gets a truth table instead of a spelling check.
 */
{
  const line = (changeFn || '').split('\n').find((l) => /if \(isAnonymous/.test(l)) || '';
  const cond = (line.match(/if \(([\s\S]*?)\) \{\s*$/) || [])[1] || '';
  ck('found the gate condition', cond.includes('handleChanges'), JSON.stringify(line.trim()));
  let gate = null;
  try { gate = new Function('isAnonymous', 'data', `return (${cond});`); } catch (e) { /* reported below */ }
  ck('the condition parses on its own', typeof gate === 'function', cond);
  if (gate) {
    ck('a guest who has spent their change is refused', gate(true, { handleChanges: 1 }) === true);
    ck('a guest who has spent several is refused', gate(true, { handleChanges: 7 }) === true);
    ck('a guest who still has theirs is let through', gate(true, { handleChanges: 0 }) === false);
    ck('a guest with no counter at all is let through', gate(true, {}) === false);
    ck('a signed-in player is never refused by it', gate(false, { handleChanges: 99 }) === false);
    // The whole point: a gate short-circuited to nothing still reads correctly.
    ck('and it is actually live, not short-circuited off',
       gate(true, { handleChanges: 1 }) !== gate(true, { handleChanges: 0 }), cond);
  }
}
ck('with permission-denied, not invalid-argument — nothing about the name is wrong',
   /new HttpsError\("permission-denied",\s*\n?\s*"Guests get one handle change\. Create an account/.test(changeFn || ''),
   (changeFn || '').slice(((changeFn || '').indexOf('Guests get one')) - 90, ((changeFn || '').indexOf('Guests get one')) + 40));
// Two tabs, both reading zero, both spending the same single change. The read
// that decides has to be the transaction's.
{
  const tx = (changeFn || '').indexOf('db.runTransaction');
  const gate = (changeFn || '').indexOf('isAnonymous &&');
  ck('the gate is inside the transaction, so it cannot be spent twice at once',
     tx > 0 && gate > tx, `transaction at ${tx}, gate at ${gate}`);
}
// A signed-in player renames as often as they like; the number only ever
// gates the anonymous case.
ck('a signed-in player is not gated by the same counter',
   !/handleChanges\) \|\| 0\) >= 1[\s\S]{0,200}isAnonymous/.test(changeFn || ''));
ck('counted off handleChanges, so every guest alive today starts eligible',
   /handleChanges/.test(changeFn || '') && !/guestHandleUsed|guestRenameUsed/.test(fn));

// The client half: what it SHOWS, which must agree with what the server allows.
const freeFn = bodyAt(html, 'function guestHasFreeHandleChange()');
ck('found guestHasFreeHandleChange', freeFn && freeFn.length > 60, String(freeFn && freeFn.length));
{
  const free = new Function(`${freeFn}\nreturn guestHasFreeHandleChange;`)();
  const run = (profile) => new Function('userProfileData', `${freeFn}\nreturn guestHasFreeHandleChange();`)(profile);
  ck('a guest who has never renamed has one', run({ isGuest: true, handleChanges: 0 }) === true);
  ck('a guest with no counter at all has one too — that is every guest today',
     run({ isGuest: true }) === true);
  ck('a guest who has spent it does not', run({ isGuest: true, handleChanges: 1 }) === false);
  ck('a signed-in player is not offered a guest change', run({ isGuest: false, handleChanges: 0 }) === false);
  ck('no profile loaded is not an error', run(null) === false);
  ck('and a string counter is not mistaken for zero',
     run({ isGuest: true, handleChanges: '2' }) === false);
  ck('the function itself is callable with no argument', typeof free === 'function');
}

// The offer, run against a real DOM and a real localStorage.
{
  const offerFn = bodyAt(html, 'function maybeShowHandleOffer()');
  const openFn = bodyAt(html, 'function somethingElseIsOpen()');
  // bodyAt lifts functions, so the two module-level declarations the offer
  // reads come from the file separately. The KEY is taken from index.html
  // rather than retyped here: a copy in the test would let the two drift and
  // the drift would read as a pass.
  const keyDecl = (html.match(/const HANDLE_OFFER_KEY = "[^"]+";/) || [])[0] || '';
  const key = (keyDecl.match(/"([^"]+)"/) || [])[1] || '';
  ck('found the offer-seen key declared in the page', !!key, keyDecl);
  const decls = 'let handleOfferTriedThisLoad = false;\n' + keyDecl + '\n';
  ck('found maybeShowHandleOffer', offerFn && offerFn.length > 200, String(offerFn && offerFn.length));
  ck('found somethingElseIsOpen', openFn && openFn.length > 100, String(openFn && openFn.length));

  /*
   * A real DOM for somethingElseIsOpen, and an injected localStorage the way
   * announcements.test.mjs does it: setContent gives an opaque origin where
   * the real one throws SecurityError, and a fake is the only way to exercise
   * the blocked-storage branch anyway.
   */
  async function offer(opts) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(markupOnly);
    return await page.evaluate(({ opts }) => {
      const out = { shown: [], store: {}, threw: false };
      const storage = {
        getItem: (k) => {
          if (opts.blocked) { out.threw = true; throw new Error('denied'); }
          return Object.prototype.hasOwnProperty.call(out.store, k) ? out.store[k] : null;
        },
        setItem: (k, v) => {
          if (opts.blocked) { out.threw = true; throw new Error('denied'); }
          out.store[k] = String(v);
        },
      };
      if (opts.seen) out.store[opts.key] = '1';
      if (opts.somethingOpen) document.getElementById('profile-modal').style.display = 'flex';
      const showHandleSetup = (label) => out.shown.push(label);
      // eslint-disable-next-line no-new-func
      const run = new Function('userProfileData', 'showHandleSetup', 'location', 'localStorage',
        `${opts.decls}${opts.freeFn}\n${opts.openFn}\n${opts.offerFn}\nreturn maybeShowHandleOffer;`)
        (opts.profile, showHandleSetup, { search: opts.search || '' }, storage);
      run();
      if (opts.twice) run();
      out.key = Object.prototype.hasOwnProperty.call(out.store, opts.key) ? out.store[opts.key] : null;
      return out;
    }, { opts: { ...opts, offerFn, openFn, freeFn, decls, key } }).finally(() => page.close());
  }

  const guest = { isGuest: true, handleChanges: 0 };
  const a = await offer({ profile: guest });
  ck('an eligible guest is offered the card', a.shown.length === 1, JSON.stringify(a.shown));
  ck('as the guest variant, not the just-linked one', a.shown[0] === null, JSON.stringify(a.shown[0]));
  ck('and the browser remembers it was offered', a.key === '1', String(a.key));

  const b = await offer({ profile: guest, twice: true });
  ck('one load cannot show it twice, however often it is called',
     b.shown.length === 1, String(b.shown.length));

  const c = await offer({ profile: guest, seen: true });
  ck('a guest already offered is not asked again', c.shown.length === 0, JSON.stringify(c.shown));

  const d = await offer({ profile: { isGuest: true, handleChanges: 1 } });
  ck('a guest who has spent their change is never offered it',
     d.shown.length === 0, JSON.stringify(d.shown));

  const e = await offer({ profile: { isGuest: false, handleChanges: 0 } });
  ck('a signed-in player is not offered it', e.shown.length === 0, JSON.stringify(e.shown));

  const f = await offer({ profile: guest, somethingOpen: true });
  ck('it stands down for anything already open', f.shown.length === 0, JSON.stringify(f.shown));
  // Standing down must not spend the one chance to ask, or a player who had
  // another card up that morning would never be offered a name at all.
  ck('and standing down does not burn the offer', f.key === null, String(f.key));

  const h = await offer({ profile: guest, blocked: true });
  ck('blocked storage still offers the card rather than throwing',
     h.shown.length === 1 && h.threw, JSON.stringify(h.shown));

  const g = await offer({ profile: guest, search: '?join=ABC123' });
  ck('a tap-to-join is mid-flow and is left alone', g.shown.length === 0, JSON.stringify(g.shown));
}

// The two prompts promise different things, because they can.
const guestPrompt = await scenario({ username: 'G_CRANE_4821', guestOffer: true });
ck('the guest prompt opens', guestPrompt.afterPrompt.modalShown === 'flex');
ck('its blurb names the guest, not an account',
   /playing as a guest/i.test(guestPrompt.afterPrompt.blurb), guestPrompt.afterPrompt.blurb);
ck('and its terms say the change is one-time',
   /needs an account/.test(guestPrompt.afterPrompt.terms), guestPrompt.afterPrompt.terms);
ck('the linked prompt still says the first change is free',
   /first change is free/.test(fresh.afterPrompt.terms), fresh.afterPrompt.terms);
ck('the two prompts do not say the same thing',
   guestPrompt.afterPrompt.terms !== fresh.afterPrompt.terms);
ck('keeping is still labelled with the name it keeps',
   guestPrompt.afterPrompt.skipLabel === 'Keep G_CRANE_4821', guestPrompt.afterPrompt.skipLabel);

// Accepting the preset: the player answered, and nothing was spent.
const kept = await scenario({ username: 'G_CRANE_4821', guestOffer: true, skip: true });
ck('keeping the preset sends nothing', kept.sent.length === 0, JSON.stringify(kept.sent));
ck('and does not reload a page whose shape has not changed',
   kept.reloads === 0, String(kept.reloads));
ck('the card closes', kept.after.modalShown === 'none', kept.after.modalShown);

// Spending it.
const guestSaved = await scenario({ username: 'G_CRANE_4821', guestOffer: true, type: 'soda', save: true });
ck('a guest can save a name', guestSaved.sent.length === 1 && guestSaved.sent[0].username === 'SODA',
   JSON.stringify(guestSaved.sent));
ck('and is not reloaded for it', guestSaved.reloads === 0, String(guestSaved.reloads));
ck('the landing is repainted instead', guestSaved.repaints === 1, String(guestSaved.repaints));
ck('and the board behind the card is refreshed, as the Profile rename does',
   guestSaved.boardRefreshes === 1, String(guestSaved.boardRefreshes));
ck('the card closes on success', guestSaved.after.modalShown === 'none', guestSaved.after.modalShown);
// The linked path keeps its reload: every guest-only affordance on the page
// behind it has just become wrong.
ck('a just-linked player is still reloaded', saved.reloads === 1, String(saved.reloads));
ck('and is not repainted in place instead', saved.repaints === 0, String(saved.repaints));

// The Profile, which is where a skipped change is still sitting.
{
  const prof = bodyAt(html, 'window.openProfileMenu = async function()');
  ck('found openProfileMenu', prof && prof.length > 400, String(prof && prof.length));
  ck('the guest branch asks whether the change is still there',
     /guestHasFreeHandleChange\(\)/.test(prof || ''));
  ck('and shows the field only then',
     /username-section"\)\.style\.display = freeChange \? "block" : "none"/.test(prof || ''));
  ck('with the caveat beside it',
     /username-guest-note"\)\.style\.display = freeChange \? "block" : "none"/.test(prof || ''));
  // The promo offers an account as the way to change a handle. Said to someone
  // who can still change it for free, that is simply untrue.
  ck('the promo only claims a handle change once there is not one left',
     /auth-promo-handle"\)\.style\.display = freeChange \? "none" : "inline"/.test(prof || ''));
  ck('a guest still gets the promo either way',
     /auth-promo-section"\)\.style\.display = "block"/.test(prof || ''));
  ck('and a signed-in player never sees the guest caveat',
     /username-guest-note"\)\.style\.display = "none"/.test(prof || ''));
}
{
  const note = html.indexOf('id="username-guest-note"');
  ck('the caveat exists in the markup', note > 0);
  ck('and is hidden until a guest is shown it',
     /id="username-guest-note" style="display: none;/.test(html));
  ck('the promo clause exists and is inline, so it reads as part of the sentence',
     /<span id="auth-promo-handle">, and change your Arcade Handle again<\/span>/.test(html));
}

await browser.close();
// ---- the generated guest handle --------------------------------------
//
// It used to be "G_" + word + 4 digits, and the prefix looked like a guest
// marker. It was not one: changeUsername takes any signed-in caller and the
// first change is free, so a guest could clear it in one tap at no cost. All
// it marked was a guest who had not got round to renaming - a signal that
// reads as reliable and is not.
//
// It was also spending the entire budget. "G_Stoke_1542" is exactly 12
// characters, which is the ceiling changeUsername enforces, so every
// generated name sat at the cap with no room to be anything else.
// Anchored on randWord, not on the line's current shape: an earlier version
// matched `defaultUsername = (randWord`, so putting the prefix back broke the
// anchor, left genLine empty, and the no-prefix check below passed against an
// empty string. A check that a regression can silence is not a check.
const genLine = (html.match(/defaultUsername = [^\n]*randWord[^\n]*/) || [''])[0];
ck('the guest handle generator is findable', !!genLine, genLine);
ck('it no longer prefixes guests', !/"G_"/.test(genLine), genLine);
ck('but still reads as generated: a word and four digits',
   /randWord/.test(genLine) && /Math\.floor\(1000 \+ Math\.random\(\) \* 9000\)/.test(genLine), genLine);

// The cap the server enforces, read from the server rather than restated.
const fnSrc = fs.readFileSync(REPO('functions/index.js'), 'utf8');
// The constant, not the call: HANDLE_MAX is shared with the Discord digest's
// PLAYER column, so changeUsername applies it rather than carrying a literal.
const cap = Number((fnSrc.match(/const HANDLE_MAX = (\d+);/) || [])[1]);
ck('changeUsername caps a handle somewhere sane', Number.isFinite(cap) && cap >= 8, String(cap));
// Longest word in the pool is 5 (the answers are five-letter words), so the
// worst case is word + "_" + 4 digits.
const worst = 5 + 1 + 4;
ck(`the longest generated handle (${worst}) fits inside the cap (${cap})`, worst <= cap);
ck('and leaves room, rather than sitting exactly at the ceiling the way "G_" did',
   worst < cap, `${worst} of ${cap}`);

for (const c of t) console.log(c.cond ? 'ok  ' : 'FAIL', c.name, c.cond ? '' : '— ' + c.detail);
const bad = t.filter(c => !c.cond).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
