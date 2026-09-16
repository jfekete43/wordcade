/*
 * The renderer for today's Gauntlet board (the scrolling list under the play
 * area, in the slot the Live Arcade Feed uses during a Standard run).
 *
 * Two things here are easy to get quietly wrong:
 *
 *   - Placement numbering. Ties must share a place and the next score must
 *     skip ahead (1, 2, 2, 4), so that what this board shows agrees with the
 *     "you finished 12th of 47" callout, which derives its number a totally
 *     different way — by counting runs above you server-side.
 *   - The absence of a dedup pass. Every other board collapses rows by
 *     display name because a player can hold many runs; this one must not,
 *     because a Gauntlet caps a player at one run per day, so the only thing
 *     a dedup could achieve is collapsing two DIFFERENT players who share a
 *     handle — and if one were the viewer, erasing them from their own board.
 *
 * Needs no emulator: the renderer is pure, so it runs against a stub snapshot
 * and a one-property document stub.
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
  grab(/        function safeCosmetic\(value, fallback\) \{\n[\s\S]*?\n        \}/),
  grab(/        function renderGauntletFeed\(snapshot\) \{\n[\s\S]*?\n        \}/),
].join('\n\n');
console.log('extracted from index.html:', src.length, 'chars');

// The renderer touches exactly one element, and only its innerHTML.
const els = {};
const documentStub = { getElementById: (id) => (els[id] = els[id] || { innerHTML: '' }) };
let user = null;
const render = new Function('document', 'getCurrentUser', `
  ${src}
  return (snapshot, u) => { globalThis.__u = u; renderGauntletFeed(snapshot); };
`.replace(/\bcurrentUser\b/g, 'globalThis.__u'))(documentStub, () => user);

const snap = (rows) => ({ forEach: (f) => rows.forEach((r) => f({ data: () => r })) });
const out = () => els['gauntlet-feed-list'].innerHTML;
// Split into rows before reading one, so a lazy quantifier can't wander into
// the next element (lb-name-col is a prefix of lb-name — easy to mismatch).
const rows = () => out().split('<div class="lb-entry ').slice(1);
const nameOf = (row) => (row.match(/class="lb-name [^"]*">([^<]*)</) || [, ''])[1];

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

render(snap([
  { uid: 'a',  username: 'ALPHA',   score: 5000, wordsGuessed: 10 },
  { uid: 'b',  username: 'BRAVO',   score: 4000, wordsGuessed: 9 },
  { uid: 'c',  username: 'CHARLIE', score: 4000, wordsGuessed: 9 },
  { uid: 'me', username: 'ME',      score: 3000, wordsGuessed: 7 },
  { uid: 'e',  username: 'ECHO',    score: 3000, wordsGuessed: 7 },
  { uid: 'f',  username: 'FOX',     score: 100,  wordsGuessed: 1 },
]), { uid: 'me' });
const places = [...out().matchAll(/lb-rank">#(\d+)</g)].map((m) => +m[1]);
ck(JSON.stringify(places) === '[1,2,2,4,4,6]', 'ties share a place and the next score skips (1,2,2,4,4,6)', 'got ' + places);

let mine = rows().filter((r) => r.includes('gf-me'));
ck(mine.length === 1 && nameOf(mine[0]) === 'ME', 'the viewer\'s own row is highlighted, exactly once', 'got ' + JSON.stringify(mine.map(nameOf)));

render(snap([{ uid: 'a', username: 'ALPHA', score: 10, wordsGuessed: 1 }]), null);
ck(!out().includes('gf-me'), 'a signed-out viewer highlights nobody');

render(snap([
  { uid: 'x',  username: 'TWIN', score: 900, wordsGuessed: 5 },
  { uid: 'me', username: 'TWIN', score: 800, wordsGuessed: 4 },
]), { uid: 'me' });
ck(rows().length === 2 && rows().every((r) => nameOf(r) === 'TWIN'), 'two different players sharing a handle are NOT collapsed');
ck(rows().filter((r) => r.includes('gf-me')).length === 1, '...and the viewer keeps their own row');

// Hostile data. username and equipped both come off a /runs doc the playing
// client wrote, so neither may reach the DOM as markup. Note that asserting on
// the substring "onerror" would prove nothing — correctly escaped text still
// contains those letters; what matters is that no new tag is produced.
render(snap([{
  uid: 'evil', username: '<img src=x onerror=alert(1)>', score: 1,
  wordsGuessed: '<script>alert(1)</script>',
  equipped: { banner: 'banner_default" onload="alert(1)', effect: 'effect_none' },
}]), { uid: 'me' });
const h = out();
ck(h.includes('&lt;img') && !h.includes('<img'), 'markup in a username renders as escaped text, never a tag');
ck(!/<(?!\/?div\b)/.test(h), 'no tag other than the row divs is ever emitted');
ck(!h.includes('onload'), 'a tampered cosmetic id is rejected rather than placed in class=""');
ck(/class="lb-entry banner_default"/.test(h), '...and falls back to the default banner');

render(snap([{ uid: 'a', username: 'A', score: -50, wordsGuessed: -3 }]), null);
ck(out().includes('>0<'), 'a negative score clamps to 0');
render(snap([{ uid: 'a', username: 'A', score: 1234567, wordsGuessed: 10 }]), null);
ck(out().includes('1,234,567'), 'scores are thousands-separated');
render(snap([{ uid: 'a', score: 10 }]), null);
ck(nameOf(rows()[0]) === 'Guest', 'a run with no username falls back to Guest');
render(snap([]), null);
ck(out().includes('No finished runs yet today'), 'an empty board gets its own message');

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
