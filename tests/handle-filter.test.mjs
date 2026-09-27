/*
 * Arcade Handle screening.
 *
 * A handle was the last free text a stranger could put in front of you:
 * changeUsername only ever stripped characters outside [a-zA-Z0-9_\s-], so any
 * slur spelled in letters went through. It is also the most exposed text in the
 * game — leaderboard, live feed, match cards, FFA standings, and the STATIC
 * Gauntlet archive pages, which are committed to the repo and listed in
 * sitemap.xml. And `runs` store `username` denormalised, so a rename does not
 * retract what has already been published.
 *
 * The mechanism is tested with INVENTED terms, which is what keeps this file
 * readable and stops it depending on the real list. The real list is checked
 * structurally, and against the game's own dictionary.
 *
 * The case that shaped the design is `niger`. The first version collapsed
 * repeated letters ("niiigger" -> "niger") and matched substrings; against the
 * 12,972-word dictionary that gave 17 hits, six innocent, and it made the
 * COUNTRY and the slur normalise identically — which no exception list can
 * separate. Collapsing is gone; terms are repeat-tolerant regexes instead, so
 * the doubled g distinguishes them.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import hf from '../functions/handle-filter.js';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

// Invented terms. "zqrbex" is six letters so it matches anywhere; "zqx" is
// three, so it may only match a whole handle.
const LONG = 'zqrbex';
const SHORT = 'zqx';
const EXTRA = [LONG, SHORT];
const blocked = (h) => hf.isBlockedHandle(h, EXTRA);

// --- normalisation ---------------------------------------------------------
ck(hf.normalizeHandle('SoDa') === 'soda', 'case is folded', hf.normalizeHandle('SoDa'));
ck(hf.normalizeHandle('s.o-d_a') === 'soda', 'punctuation is dropped', hf.normalizeHandle('s.o-d_a'));
ck(hf.normalizeHandle('z0rb') === 'zorb', 'leet digits are mapped', hf.normalizeHandle('z0rb'));
ck(hf.normalizeHandle('$oda') === 'soda', 'and leet symbols too', hf.normalizeHandle('$oda'));
ck(hf.normalizeHandle('') === '' && hf.normalizeHandle(null) === '' && hf.normalizeHandle(undefined) === '',
   'empty, null and undefined all normalise to nothing');
// The heart of it: repeats are PRESERVED, so a doubled letter still
// distinguishes two words. Collapsing is what merged "niger" into the slur.
ck(hf.normalizeHandle('zqrrbex') === 'zqrrbex', 'repeated letters are NOT collapsed', hf.normalizeHandle('zqrrbex'));

// --- a term matches its evasions ------------------------------------------
ck(blocked(LONG), 'the bare term is refused');
ck(blocked(LONG.toUpperCase()), 'in upper case');
ck(blocked('xX' + LONG + 'Xx'), 'padded either side');
ck(blocked(LONG + '420'), 'with digits appended');
ck(blocked('z.q.r.b.e.x'), 'split by punctuation');
ck(blocked('zzqqrrbbeexx'), 'with every letter doubled');
ck(blocked('zqqqqrbex'), 'with one letter stretched');
ck(blocked('zqrb3x'), 'spelled with leet');
ck(blocked('z0rb3x'.replace('0', 'q')), 'and with mixed leet');

// --- and does not match near-misses ---------------------------------------
// One letter short is a different word. This is exactly the niger/nigger case.
ck(!blocked('zqrbe'), 'a handle one letter short of the term passes');
ck(!blocked('qrbex'), 'and one missing the first letter');
ck(!blocked('zqrxbe'), 'and one with the letters reordered');
ck(!blocked('soda'), 'an ordinary handle passes');
ck(!blocked(''), 'an empty handle passes');
ck(!blocked('1234'), 'digits alone pass');
ck(!blocked('___'), 'punctuation alone passes');

// --- short terms only match the whole handle ------------------------------
// Three letters banned as a substring would ban every handle containing them.
ck(blocked(SHORT), 'a three-letter term is refused as the whole handle');
ck(blocked(SHORT.toUpperCase()), 'regardless of case');
ck(blocked('z-q-x'), 'and through punctuation');
ck(blocked('zzqqxx'), 'and stretched, since it is still the whole handle');
ck(!blocked('a' + SHORT), 'but not with a letter in front');
ck(!blocked(SHORT + 'a'), 'nor with one after');
ck(!blocked('xx' + SHORT + 'xx'), 'nor padded');

// --- exceptions ------------------------------------------------------------
// Innocent words that contain a screened term. These are the words the first
// design refused, which is why the mechanism exists.
for (const word of ['niger', 'spicy', 'spice', 'aspic', 'spica', 'nazir',
                    'raccoon', 'tycoon', 'suspicion', 'conspicuous', 'lagoon', 'harpoon']) {
  ck(!hf.isBlockedHandle(word), `"${word}" is not refused`);
  ck(!hf.isBlockedHandle(word.toUpperCase() + '99'), `nor is "${word.toUpperCase()}99"`);
}
// Masking an exception must not launder a bare term sitting beside it, and must
// not bridge two halves into a term nobody wrote.
ck(hf.isBlockedHandle('spicyspic'), 'an exception beside a bare term is still refused');
ck(!hf.isBlockedHandle('spicyspicy'), 'but two exceptions together are fine');
ck(hf.EXCEPTIONS.every((w) => w === hf.normalizeHandle(w)),
   'every exception is stored in normalised form',
   JSON.stringify(hf.EXCEPTIONS.filter((w) => w !== hf.normalizeHandle(w))));
ck(new Set(hf.EXCEPTIONS).size === hf.EXCEPTIONS.length, 'with no duplicates');

// Masking leaves a gap, and the gap has to STAY a gap. Rejoining the halves
// would invent a term nobody wrote: "zqr" + [spicy] + "bex" is not the term.
ck(!hf.isBlockedHandle('zqrspicybex', EXTRA),
   'masking an exception does not bridge its neighbours into a term',
   hf.normalizeHandle('zqrspicybex'));
ck(hf.isBlockedHandle('spicy' + LONG, EXTRA), 'though a whole term beside an exception still is');

// Order matters once one exception sits inside another: masking the shorter one
// first leaves a fragment that can spell a term. Invented lists, so this holds
// regardless of what the real ones contain.
// Given in the adversarial order on purpose: if the sort were dropped, the
// shorter one would be masked first and leave "dexq" behind.
ck(!hf.isBlockedHandle('abcdexq', ['dexq'], ['abc', 'abcde']),
   'nested exceptions are masked longest-first, whatever order they are listed in',
   hf.normalizeHandle('abcdexq'));
ck(hf.isBlockedHandle('abcdexq', ['dexq'], ['abc']),
   'and without the longer one the term is still caught');
// Which is why the real list currently has no nested pair; if one is added, the
// ordering above starts mattering for real and this says so.
const nested = hf.EXCEPTIONS.filter((a) => hf.EXCEPTIONS.some((b) => b !== a && b.includes(a)));
ck(nested.length === 0, 'no exception is a substring of another', JSON.stringify(nested));

// --- the real list, structurally ------------------------------------------
const stored = JSON.parse(fs.readFileSync(REPO('functions/handle-terms.json'), 'utf8'));
ck(Array.isArray(stored) && stored.length > 0, 'the term list is a non-empty array', String(stored.length));
ck(stored.length === hf.TERMS_COUNT, 'and the filter loaded all of it', `${stored.length} vs ${hf.TERMS_COUNT}`);
ck(new Set(stored).size === stored.length, 'with no duplicate entries');
const decoded = stored.map((b) => Buffer.from(b, 'base64').toString('utf8'));
ck(decoded.every((d) => /^[a-z]{3,}$/.test(d)), 'every term decodes to 3+ lowercase letters',
   JSON.stringify(decoded.filter((d) => !/^[a-z]{3,}$/.test(d)).map((d) => d.length)));
ck(decoded.every((d) => d === hf.normalizeHandle(d)), 'and is already normalised, or it would match nothing');
// Stored encoded, deliberately: a public repo should not hold a greppable list.
ck(stored.every((b) => /^[A-Za-z0-9+/]+=*$/.test(b)), 'entries are base64, not plaintext');
ck(!decoded.some((d) => hf.EXCEPTIONS.includes(d)), 'no term is also an exception, which would disable it',
   JSON.stringify(decoded.filter((d) => hf.EXCEPTIONS.includes(d))));
// Every stored term must actually be caught by the matcher — a term stored in a
// form the matcher never computes is a silent no-op.
ck(decoded.every((d) => hf.isBlockedHandle(d)), 'every stored term is actually refused by the matcher',
   JSON.stringify(decoded.filter((d) => !hf.isBlockedHandle(d)).length));

// --- the real list, against the game's own dictionary --------------------
// The regression guard. Adding a term also refuses its inflections, which is
// correct and raises this count — so a failure here means "run
// `node tools/hash-handle-terms.mjs --audit` and check the new hits are
// supposed to be refused", not necessarily that something is broken.
const src = fs.readFileSync(REPO('words.js'), 'utf8');
const words = [...new Set([...src.matchAll(/`([\s\S]*?)`/g)].map((m) => m[1]).join('\n')
  .split(/\s+/).filter((w) => /^[a-z]{3,}$/.test(w)))];
ck(words.length > 10000, 'the dictionary corpus loaded', String(words.length));
const hits = words.filter((w) => hf.isBlockedHandle(w));
ck(hits.length === 10, `exactly 10 dictionary words are refused (was 17 before the redesign)`,
   `${hits.length} now — run tools/hash-handle-terms.mjs --audit`);
// Whatever they are, they must be term inflections and not ordinary words: each
// one has to contain a stored term.
ck(hits.every((w) => decoded.some((d) => w.includes(d))),
   'and each is an inflection of a stored term, not an unrelated word',
   JSON.stringify(hits.filter((w) => !decoded.some((d) => w.includes(d)))));

// --- the replacement handle ----------------------------------------------
const fallbacks = Array.from({ length: 200 }, () => hf.safeFallbackHandle());
ck(fallbacks.every((h) => h.length >= 3 && h.length <= 12), 'the fallback fits the 3-12 handle limit',
   JSON.stringify([...new Set(fallbacks.map((h) => h.length))]));
ck(fallbacks.every((h) => /^[a-zA-Z0-9_\s-]+$/.test(h)), 'and changeUsername\'s own charset');
ck(fallbacks.every((h) => !hf.isBlockedHandle(h)), 'and is never itself refused');
ck(new Set(fallbacks).size > 50, 'and varies, so a bad-handle wave does not all collide',
   String(new Set(fallbacks).size));
ck(hf.safeFallbackHandle(0) === 'PLAYER1000' && hf.safeFallbackHandle(0.99999) === 'PLAYER9999',
   'the number spans the whole 4-digit range', hf.safeFallbackHandle(0) + '/' + hf.safeFallbackHandle(0.99999));

// --- robustness ----------------------------------------------------------
for (const [label, v] of [['null', null], ['undefined', undefined], ['a number', 12345],
                          ['an empty string', ''], ['a 500-char string', 'a'.repeat(500)],
                          ['an emoji', '🕹️🕹️'], ['a newline', 'ab\ncd']]) {
  let threw = false, out = null;
  try { out = hf.isBlockedHandle(v); } catch { threw = true; }
  ck(!threw && typeof out === 'boolean', `${label} returns a boolean rather than throwing`, String(threw));
}

// --- both doors are actually wired --------------------------------------
const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8');
ck(/require\("\.\/handle-filter\.js"\)/.test(fn), 'functions/index.js loads the filter');
const changeUsername = (fn.match(/exports\.changeUsername = onCall\([\s\S]*?\n\}\);/) || [''])[0];
ck(/HANDLE\.isBlockedHandle\(name\)/.test(changeUsername), 'changeUsername screens the handle', '');
ck(/throw new HttpsError/.test(changeUsername.slice(changeUsername.indexOf('isBlockedHandle'))),
   'and rejects rather than mangling it');
// It must see the FINAL name: screening the raw input would miss evasions that
// only appear after stripping, and pass names that the strip would have fixed.
ck(changeUsername.indexOf('.substring(0, 12)') < changeUsername.indexOf('isBlockedHandle'),
   'after the strip and truncate, not before');
// The seeded handle never passes through changeUsername, so the trigger is not
// optional — it is the only thing covering the signup path.
const trigger = (fn.match(/exports\.onUserProfileCreated = onDocumentCreated\([\s\S]*?\n\}\);/) || [''])[0];
ck(trigger.length > 0, 'the profile-created trigger exists');
ck(/users\/\{userId\}/.test(trigger), 'and watches the users collection', '');
ck(/isBlockedHandle/.test(trigger) && /safeFallbackHandle/.test(trigger),
   'screening the seeded handle and replacing it');
ck(/update\(\{ username: replacement \}\)/.test(trigger), 'by writing the replacement back');
// A client can only ever update `equipped`, which is what makes these two doors
// the complete set.
const rules = fs.readFileSync(REPO('firestore.rules'), 'utf8');
ck(/hasOnly\(\['equipped'\]\)/.test(rules),
   'and rules still allow a client to update nothing but equipped on its profile');

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
