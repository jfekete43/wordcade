/*
 * Match chat in a real browser: the render, and the P1 public/private split.
 *
 * The render is the half of the fix that firestore.rules cannot cover. Chat was
 * an array of HTML strings dropped into `chatBox.innerHTML`, so a participant's
 * `<img src=x onerror=...>` executed on the opponent's page at the lexathon.gg
 * origin, where their Firebase ID token lives. This suite feeds that exact
 * payload through the shipped renderer in Chromium and asserts nothing runs —
 * innerHTML does not execute `<script>`, so a test that only checked for script
 * tags would have passed against the vulnerable code. It checks for the
 * handler-based payloads that actually fired.
 *
 * It also drives the P1 rule from the UI side: chips in a public match, free
 * text only in a private one, and the same restrictive default the rules use
 * for a match doc with no isPublic field.
 *
 * Needs a browser, so it runs under `npm run test:browser`, not `npm test`.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  ({ chromium } = await import(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs'))); }
const launch = {};
if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };

// The real markup, and the real module — not a copy.
const markup = grab(/    <div id="clash-chat-container"[\s\S]*?\n    <\/div>/);
const src = [
  grab(/        const CHAT_PRESETS = \[[^\]]*\];/),
  grab(/        const CHAT_TEXT_MAX = \d+;/),
  grab(/        const CHAT_MAX_LINES = \d+;/),
  grab(/        const CHAT_COOLDOWN_MS = \d+;/),
  grab(/        let chatAllowsFreeText = false;\n        let chatLastSentAt = 0;\n        let chatLineCount = 0;/),
  grab(/        function chatMatchIsPublic\(data\) \{[^\n]*\}/),
  grab(/        function setupChatUi\(isPublic\) \{\n[\s\S]*?chat-freetext[^\n]*\n        \}/),
  grab(/        async function sendChatLine\(text, isPreset\) \{\n[\s\S]*?chatLastSentAt = 0; \}\n        \}/),
  grab(/        function renderChat\(chat\) \{\n[\s\S]*?chat-chip[\s\S]*?\n        \}/),
  grab(/        function resetChatState\(\) \{\n[\s\S]*?\n        \}/),
  grab(/        window\.sendChatMessage = function\(\) \{\n[\s\S]*?\n        \}/),
].join('\n\n');
console.log('extracted from index.html:', markup.length, 'chars of markup,', src.length, 'chars of script');
if (src.length < 2500) throw new Error('script extraction looks truncated: ' + src.length);

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

const browser = await chromium.launch(launch);
const page = await browser.newPage();
page.on('pageerror', (e) => ck(false, 'no page errors', String(e)));

await page.setContent(`<!doctype html><html><body>
${markup}
<script>
  window.__pwned = [];
  window.__writes = [];
  // Stubs for the Firestore bits sendChatLine reaches for.
  let currentMatchId = 'match1';
  let currentUser = { uid: 'me' };
  let userProfileData = { username: 'SODA' };
  const db = {}, doc = () => ({}), arrayUnion = (v) => ({ __union: v });
  const updateDoc = async (_ref, data) => { window.__writes.push(data.chat.__union); };
  const showMessage = (m) => { window.__msgs = (window.__msgs || []).concat(m); };
${src}
  window.T = { setupChatUi, renderChat, sendChatLine, resetChatState, chatMatchIsPublic,
               CHAT_PRESETS, CHAT_MAX_LINES, CHAT_COOLDOWN_MS,
               get lineCount() { return chatLineCount; },
               get freeText() { return chatAllowsFreeText; },
               setSender(u, n) { currentUser = { uid: u }; userProfileData = { username: n }; },
               clearMatch() { currentMatchId = null; } };
<\/script></body></html>`);

// --- the attack, through the shipped renderer -----------------------------
// Both handler forms plus a script tag. Only the handlers ever fired through
// innerHTML, which is exactly why the old comment claiming safety was wrong.
const payloads = (tag) => [
  `<img src=x onerror="window.__pwned.push('img ${tag}')">`,
  `<svg><animate onbegin="window.__pwned.push('svg ${tag}')" attributeName=x dur=1s>`,
  `<iframe srcdoc="<script>parent.__pwned.push('iframe ${tag}')<\\/script>">`,
  `<script>window.__pwned.push('script ${tag}')<\\/script>`,
];

// 1. Legacy HTML strings — what is sitting in matches created before the fix.
let res = await page.evaluate(async (list) => {
  window.__pwned = [];
  window.T.renderChat(list);
  await new Promise((r) => setTimeout(r, 400));
  return { pwned: window.__pwned.slice(), text: document.getElementById('chat-messages').innerText.trim() };
}, payloads('legacy'));
ck(res.pwned.length === 0, 'a legacy HTML-string line executes nothing', JSON.stringify(res.pwned));
ck(res.text === 'Match started. GLHF!', 'and is skipped rather than shown as markup', JSON.stringify(res.text));

// 2. The payload inside a well-formed line's text.
res = await page.evaluate(async (list) => {
  window.__pwned = [];
  window.T.renderChat(list.map((p, i) => ({ u: 'them', n: 'RIVAL', t: p, p: false, at: i })));
  await new Promise((r) => setTimeout(r, 400));
  const box = document.getElementById('chat-messages');
  return { pwned: window.__pwned.slice(), text: box.innerText, tags: box.querySelectorAll('img, svg, iframe, script').length };
}, payloads('in t'));
ck(res.pwned.length === 0, 'HTML in a line\'s text executes nothing', JSON.stringify(res.pwned));
ck(res.tags === 0, 'and creates no img/svg/iframe/script node', String(res.tags));
ck(res.text.includes('onerror='), 'it is shown as literal text instead', JSON.stringify(res.text.slice(0, 60)));

// 3. The payload in the display name — the other interpolation point.
res = await page.evaluate(async () => {
  window.__pwned = [];
  window.T.renderChat([{ u: 'them', n: '<img src=x onerror="window.__pwned.push(1)">', t: 'gg', p: true, at: 1 }]);
  await new Promise((r) => setTimeout(r, 400));
  const box = document.getElementById('chat-messages');
  return { pwned: window.__pwned.slice(), imgs: box.querySelectorAll('img').length, text: box.innerText };
});
ck(res.pwned.length === 0 && res.imgs === 0, 'HTML in a display name executes nothing', JSON.stringify(res));
ck(res.text.includes('<img'), 'and is shown as literal text', JSON.stringify(res.text.slice(0, 40)));

// 4. A normal line still renders normally, name styled and text plain.
res = await page.evaluate(() => {
  window.T.renderChat([{ u: 'them', n: 'RIVAL', t: 'gg', p: true, at: 1 },
                       { u: 'me', n: 'SODA', t: 'Nice!', p: true, at: 2 }]);
  const rows = [...document.getElementById('chat-messages').children].map((d) => d.innerText);
  const bold = document.getElementById('chat-messages').querySelectorAll('span[style*="bold"]').length;
  return { rows, bold };
});
ck(res.rows.join('|') === 'Match started. GLHF!|RIVAL: gg|SODA: Nice!', 'ordinary lines render as name: text', JSON.stringify(res.rows));
ck(res.bold === 2, 'with each name in its own styled span', String(res.bold));

// --- P1: public gets chips, private gets the box ---------------------------
const uiState = () => page.evaluate(() => ({
  chips: [...document.querySelectorAll('.chat-chip')].map((c) => c.textContent),
  freeTextShown: getComputedStyle(document.getElementById('chat-freetext')).display !== 'none',
  freeTextAllowed: window.T.freeText,
}));

await page.evaluate(() => window.T.setupChatUi(true));
let ui = await uiState();
ck(JSON.stringify(ui.chips) === JSON.stringify(await page.evaluate(() => window.T.CHAT_PRESETS)),
   'a public match shows one chip per preset, in order', JSON.stringify(ui.chips));
ck(!ui.freeTextShown && !ui.freeTextAllowed, 'and no free-text box', JSON.stringify(ui));

await page.evaluate(() => window.T.setupChatUi(false));
ui = await uiState();
ck(ui.freeTextShown && ui.freeTextAllowed, 'a private match shows the free-text box', JSON.stringify(ui));
ck(ui.chips.length === (await page.evaluate(() => window.T.CHAT_PRESETS.length)), 'and keeps the chips too', String(ui.chips.length));

// Chips are built once, not re-appended every match.
await page.evaluate(() => { window.T.setupChatUi(true); window.T.setupChatUi(false); window.T.setupChatUi(true); });
ck((await uiState()).chips.length === (await page.evaluate(() => window.T.CHAT_PRESETS.length)),
   'switching matches does not duplicate the chips', String((await uiState()).chips.length));

// --- what actually gets written -------------------------------------------
const sendIn = (isPublic, fn) => page.evaluate(async ({ isPublic, fn }) => {
  window.__writes = [];
  window.T.setupChatUi(isPublic);
  window.T.renderChat([]);
  await new Function('return (' + fn + ')')()();
  await new Promise((r) => setTimeout(r, 50));
  return window.__writes.slice();
}, { isPublic, fn: fn.toString() });

let writes = await sendIn(true, async () => { document.querySelectorAll('.chat-chip')[4].click(); });
ck(writes.length === 1 && writes[0].t === 'gg' && writes[0].p === true,
   'a chip click sends that exact phrase, flagged as a preset', JSON.stringify(writes));
ck(writes[0].u === 'me' && writes[0].n === 'SODA' && typeof writes[0].at === 'number',
   'with the sender\'s own uid and name', JSON.stringify(writes[0]));
ck(Object.keys(writes[0]).sort().join(',') === 'at,n,p,t,u',
   'and exactly the five keys the rules allow', Object.keys(writes[0]).join(','));

writes = await sendIn(true, async () => {
  document.getElementById('chat-input').value = 'hello there';
  window.sendChatMessage();
});
ck(writes.length === 0, 'free text in a public match is not even sent', JSON.stringify(writes));

writes = await sendIn(false, async () => {
  document.getElementById('chat-input').value = 'hello there';
  window.sendChatMessage();
});
ck(writes.length === 1 && writes[0].t === 'hello there' && writes[0].p === false,
   'free text in a private match is sent, flagged as free text', JSON.stringify(writes));

writes = await sendIn(false, async () => {
  document.getElementById('chat-input').value = 'x'.repeat(200);
  window.sendChatMessage();
});
ck(writes.length === 1 && writes[0].t.length === 50, 'over-long free text is cut to the rules\' limit', String(writes[0] && writes[0].t.length));

writes = await sendIn(false, async () => {
  document.getElementById('chat-input').value = '   ';
  window.sendChatMessage();
});
ck(writes.length === 0, 'whitespace-only free text sends nothing', JSON.stringify(writes));

// The input is cleared whatever happens, so a double-tap cannot resend the same
// text and a rejected send does not leave a box that still looks full.
res = await page.evaluate(async () => {
  window.T.setupChatUi(false);
  const input = document.getElementById('chat-input');
  input.value = 'hello there';
  window.sendChatMessage();
  const afterSend = input.value;
  input.value = '   ';
  window.sendChatMessage();
  return { afterSend, afterBlank: input.value };
});
ck(res.afterSend === '', 'the input is cleared after a real send', JSON.stringify(res.afterSend));
ck(res.afterBlank === '', 'and after a whitespace-only one too', JSON.stringify(res.afterBlank));

// --- the spam bounds ------------------------------------------------------
writes = await sendIn(true, async () => {
  const chip = document.querySelectorAll('.chat-chip')[0];
  chip.click(); chip.click(); chip.click();
});
ck(writes.length === 1, 'the cooldown drops repeat taps inside the window', String(writes.length));

// At the ceiling the chips go dead and nothing is sent.
writes = await page.evaluate(async (max) => {
  window.__writes = [];
  window.T.setupChatUi(true);
  window.T.renderChat(Array.from({ length: max }, (_, i) => ({ u: 'x', n: 'X', t: 'gg', p: true, at: i })));
  const disabled = [...document.querySelectorAll('.chat-chip')].every((c) => c.disabled);
  document.querySelectorAll('.chat-chip')[0].click();
  await new Promise((r) => setTimeout(r, 50));
  return { disabled, writes: window.__writes.slice() };
}, await page.evaluate(() => window.T.CHAT_MAX_LINES));
ck(writes.disabled, 'at the line ceiling every chip is disabled');
ck(writes.writes.length === 0, 'and a click sends nothing', JSON.stringify(writes.writes));

// A disabled chip cannot be clicked, so the case above proves the DOM stops the
// click, not that the send itself refuses. Call it directly — which is what a
// hand-rolled client does — so the guard inside sendChatLine is really tested.
ck(await page.evaluate(async (max) => {
  window.__writes = [];
  window.T.setupChatUi(true);
  window.T.renderChat(Array.from({ length: max }, (_, i) => ({ u: 'x', n: 'X', t: 'gg', p: true, at: i })));
  await window.T.sendChatLine('gg', true);
  return window.__writes.length === 0;
}, await page.evaluate(() => window.T.CHAT_MAX_LINES)), 'and the send itself refuses past the ceiling');

// Below the ceiling they are live again.
ck(await page.evaluate(async (max) => {
  window.T.renderChat(Array.from({ length: max - 1 }, (_, i) => ({ u: 'x', n: 'X', t: 'gg', p: true, at: i })));
  return [...document.querySelectorAll('.chat-chip')].every((c) => !c.disabled);
}, await page.evaluate(() => window.T.CHAT_MAX_LINES)), 'below the ceiling the chips are live again');

// --- leaving a match ------------------------------------------------------
ck(await page.evaluate(() => {
  window.T.setupChatUi(false);
  window.T.resetChatState();
  return !window.T.freeText
    && getComputedStyle(document.getElementById('chat-freetext')).display === 'none'
    && document.getElementById('chat-input').value === '';
}), 'leaving a private match closes the free-text box behind it');

// --- the restrictive default, matching the rules --------------------------
res = await page.evaluate(() => ({
  missing: window.T.chatMatchIsPublic({}),
  nul: window.T.chatMatchIsPublic({ isPublic: null }),
  yes: window.T.chatMatchIsPublic({ isPublic: true }),
  no: window.T.chatMatchIsPublic({ isPublic: false }),
  undef: window.T.chatMatchIsPublic(undefined),
}));
ck(res.missing && res.nul && res.yes && res.undef && !res.no,
   'only an explicit isPublic:false counts as private, as in the rules', JSON.stringify(res));

// A send with no match in progress must not throw or write.
ck(await page.evaluate(async () => {
  window.__writes = []; window.T.clearMatch();
  await window.T.sendChatLine('gg', true);
  return window.__writes.length === 0;
}), 'a send with no match in progress does nothing');

await browser.close();

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
