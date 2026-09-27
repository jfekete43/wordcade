/*
 * Match chat: the invariants that span index.html and firestore.rules.
 *
 * The P1 design ("presets in public matches, free text only in private") is
 * enforced twice over, and the two copies must agree. The closed phrase list
 * is what replaces a profanity filter, so a phrase added to the UI but not to
 * the rules is a dead button, and one added to the rules but not the UI is an
 * unreachable capability — both are silent until a player hits them.
 *
 * Also pins the shape of the fix itself: chat renders through the DOM, never
 * innerHTML (that was the stored-XSS vector), and every match-creation site
 * sends `chat: []`, which the create rule now requires — miss it at one site
 * and creating that kind of match fails outright.
 *
 * Pure; no emulator needed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const rules = fs.readFileSync(REPO('firestore.rules'), 'utf8').replace(/\r\n/g, '\n');
const grab = (src, re, what) => { const m = src.match(re); if (!m) throw new Error('could not extract ' + what); return m; };

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

// --- the phrase list, in both places --------------------------------------
const clientPresets = JSON.parse(grab(html, /const CHAT_PRESETS = (\[[^\]]*\]);/, 'CHAT_PRESETS')[1]);
const rulesPresets = JSON.parse('[' +
  grab(rules, /function chatPresets\(\) \{\s*return \[([^\]]*)\]/, 'chatPresets()')[1].replace(/'/g, '"') + ']');

ck(JSON.stringify(clientPresets) === JSON.stringify(rulesPresets),
   'the preset list is identical in index.html and firestore.rules',
   `client ${JSON.stringify(clientPresets)} vs rules ${JSON.stringify(rulesPresets)}`);
ck(clientPresets.length > 0, 'and is not empty', String(clientPresets.length));
ck(new Set(clientPresets).size === clientPresets.length, 'with no duplicate phrases', JSON.stringify(clientPresets));
// A phrase with markup in it would be served straight back to every player. The
// render is safe now, but a closed list is no place to keep the question open.
ck(clientPresets.every((p) => !/[<>&]/.test(p)), 'and no markup in any phrase', JSON.stringify(clientPresets));
// Chips sit in one scrolling row; a phrase long enough to need two lines breaks it.
ck(clientPresets.every((p) => p.length <= 12), 'each phrase fits a chip',
   JSON.stringify(clientPresets.filter((p) => p.length > 12)));

// --- the numeric caps, in both places -------------------------------------
const clientTextMax = Number(grab(html, /const CHAT_TEXT_MAX = (\d+);/, 'CHAT_TEXT_MAX')[1]);
const rulesTextMax = Number(grab(rules, /line\.t\.size\(\) <= (\d+)/, 'rules text cap')[1]);
ck(clientTextMax === rulesTextMax, 'the free-text length cap matches the rules', `${clientTextMax} vs ${rulesTextMax}`);

const clientMaxLines = Number(grab(html, /const CHAT_MAX_LINES = (\d+);/, 'CHAT_MAX_LINES')[1]);
const rulesMaxLines = Number(grab(rules, /request\.resource\.data\.chat\.size\(\) <= (\d+)/, 'rules line cap')[1]);
ck(clientMaxLines === rulesMaxLines, 'the per-match line ceiling matches the rules', `${clientMaxLines} vs ${rulesMaxLines}`);

const clientNameMax = Number(grab(html, /String\(userProfileData\.username \|\| "Player"\)\.substring\(0, (\d+)\)/, 'client name cap')[1]);
const rulesNameMax = Number(grab(rules, /line\.n\.size\(\) <= (\d+)/, 'rules name cap')[1]);
ck(clientNameMax === rulesNameMax, 'the display-name cap matches the rules', `${clientNameMax} vs ${rulesNameMax}`);
// changeUsername() caps handles well below this, so no real name is ever
// truncated into a line the rules then accept as someone else's.
const handleCap = Number(grab(fs.readFileSync(REPO('functions/index.js'), 'utf8'),
  /\.substring\(0, (\d+)\);\n  if \(name\.length < 3\)/, 'changeUsername cap')[1]);
ck(handleCap <= clientNameMax, 'and leaves room for any real handle', `handle ${handleCap} <= chat ${clientNameMax}`);

// --- the restrictive default, in both places ------------------------------
// A match doc with no isPublic field must count as PUBLIC on both sides, or the
// client offers a free-text box whose writes the server then rejects.
ck(/function matchIsPublic\(m\) \{ return m\.get\('isPublic', true\) != false; \}/.test(rules),
   'rules treat a missing isPublic as public');
ck(/function chatMatchIsPublic\(data\) \{ return !data \|\| data\.isPublic !== false; \}/.test(html),
   'and so does the client');

// --- the render must never touch innerHTML -------------------------------
const renderChat = grab(html, /        function renderChat\(chat\) \{\n[\s\S]*?chat-chip[\s\S]*?\n        \}/, 'renderChat')[0];
ck(!/innerHTML/.test(renderChat), 'renderChat never assigns innerHTML');
ck(/textContent/.test(renderChat) && /createElement/.test(renderChat), 'it builds nodes and sets textContent instead');
ck(!/escapeHtml/.test(renderChat), 'and does not lean on escapeHtml, which protected nobody here');
// Nowhere in the file may the chat box be filled with markup again.
const chatBoxInnerHtml = html.match(/chat-messages"\)\.innerHTML/g) || [];
ck(chatBoxInnerHtml.length === 0, 'nothing anywhere assigns chat-messages.innerHTML', String(chatBoxInnerHtml.length));
// The old vulnerable send built an HTML string; make sure no send does again.
const sendChatLine = grab(html, /        async function sendChatLine\(text, isPreset\) \{\n[\s\S]*?chatLastSentAt = 0; \}\n        \}/, 'sendChatLine')[0];
ck(!/<span|<div|escapeHtml/.test(sendChatLine), 'sendChatLine stores data, not markup');
ck(/u: currentUser\.uid/.test(sendChatLine), 'and attributes the line to the sender\'s own uid');

// --- both update rules must gate chat ------------------------------------
const updateRules = rules.match(/allow update: if isSignedIn\(\)[\s\S]*?;/g) || [];
const matchUpdates = updateRules.filter((r) => /matchMode\(resource\.data\)/.test(r));
ck(matchUpdates.length === 2, 'there are two match update rules (1v1 and FFA)', String(matchUpdates.length));
ck(matchUpdates.every((r) => /chatOk\(\)/.test(r)), 'and both of them gate chat',
   matchUpdates.map((r) => /chatOk\(\)/.test(r)).join(','));
// Anchored on the hostUid clause: there are three `allow create` rules in the
// file and a lazy match lands on the wrong collection's.
const createRule = (rules.match(/allow create: if isSignedIn\(\) && request\.resource\.data\.hostUid == request\.auth\.uid[\s\S]*?;/) || [''])[0];
ck(/request\.resource\.data\.chat == \[\]/.test(createRule),
   'and a new match must be created silent', createRule);

// --- every creation site must send chat: [] ------------------------------
// The create rule requires it, so a site that omits it cannot create a match at
// all — a failure that only shows up when a player tries that one mode.
const sites = html.split('setDoc(doc(db, "matches"').slice(1);
ck(sites.length >= 4, 'found the match-creation sites', String(sites.length));
sites.forEach((chunk, i) => {
  const payload = chunk.slice(0, 1400);
  ck(/chat: \[\]/.test(payload) || /newFfaMatchDoc\(/.test(payload),
     `creation site ${i + 1} sends chat: []`, payload.split('\n').slice(0, 3).join(' / '));
});
ck(/function newFfaMatchDoc\([\s\S]*?chat: \[\]/.test(html), 'newFfaMatchDoc sends chat: [] too');

// --- and every creation site must stamp createdAt -------------------------
// The create rule requires createdAt == request.time, so a site that omits it
// cannot create a match at all. Same sharp edge as chat: [], same check.
sites.forEach((chunk, i) => {
  const payload = chunk.slice(0, 1600);
  ck(/createdAt: serverTimestamp\(\)/.test(payload) || /newFfaMatchDoc\(/.test(payload),
     `creation site ${i + 1} stamps createdAt`, payload.split('\n').slice(0, 3).join(' / '));
});
ck(/function newFfaMatchDoc\([\s\S]*?createdAt: serverTimestamp\(\)/.test(html), 'newFfaMatchDoc stamps createdAt too');
// It must be the SERVER's clock. Date.now() here would let a skewed or hostile
// client pick its match's age, in both directions.
ck(!/createdAt: Date\.now\(\)/.test(html), 'and never from the client clock');
ck(/&& request\.resource\.data\.createdAt == request\.time;/.test(rules),
   'the rules pin createdAt to request.time');
ck(/function createdAtPinned\(\)/.test(rules) && matchUpdates.every((r) => /createdAtPinned\(\)/.test(r)),
   'and both update rules stop it being moved afterwards');
// The retention window and the field it reads must be the same story.
const cleanup = fs.readFileSync(REPO('tools/match-cleanup.mjs'), 'utf8');
ck(/toMillis\(m\.createdAt\)/.test(cleanup), 'the cleanup ages matches by createdAt', '');
ck(/DEFAULT_RETENTION_HOURS = \d+;/.test(cleanup), 'with a stated retention window');

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
