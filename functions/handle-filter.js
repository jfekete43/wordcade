/*
 * Arcade Handle screening.
 *
 * A handle is the last piece of free text a stranger can put in front of you.
 * Match chat is a closed set of preset phrases in public matches, but a handle
 * is 3-12 characters of the player's choosing, and changeUsername only ever
 * stripped characters outside [a-zA-Z0-9_\s-] — so any slur spelled in letters
 * went straight through.
 *
 * It is also far more exposed than chat ever was. A handle appears on the
 * leaderboard, in the live feed, on match cards, in FFA standings, and on the
 * STATIC Gauntlet archive pages, which are committed to the repo, served by
 * GitHub Pages and listed in sitemap.xml. Chat reached five people for two
 * minutes; a handle reaches search engines. Worse, `runs` documents store
 * `username` denormalised at save time, and both the leaderboard and the
 * archive read it from there — so renaming an offender does NOT retract what
 * has already been published. Cleaning up after the fact is expensive, which is
 * the whole argument for screening at the door.
 *
 * TWO DOORS, and both are covered:
 *   - changeUsername() rejects outright, so the player is told to pick another.
 *   - onUserProfileCreated() replaces a bad seeded handle with a safe one. The
 *     initial handle is derived from the Google display name and written by the
 *     client, so it never passes through changeUsername at all.
 * firestore.rules lets a client update only `equipped` on its own profile, so
 * those two are the complete set of ways a username is ever set.
 *
 * HOW MATCHING WORKS, and why it is not a plain substring test.
 *
 * A handle is normalised to lowercase, leetspeak is mapped (n1gg3r -> nigger)
 * and everything but a-z is dropped (s.l.u.r -> slur). Each term then becomes a
 * regex whose every letter may repeat — /n+i+g+g+e+r+/ — which catches
 * "niiiggerrr" while still requiring the two g's.
 *
 * The first version of this collapsed repeated letters instead ("niiigger" ->
 * "niger") and matched terms as substrings. Run against the game's own 12,972
 * word dictionary that produced 17 hits, six of them innocent — including
 * "spicy", and including "niger", because collapsing makes the slur and the
 * COUNTRY identical. No exception list can separate those two, which is why
 * collapsing is gone: repeat-tolerant regexes distinguish them by the doubled g.
 *
 * Terms of four letters or more are matched anywhere in the handle, since
 * "xXslurXx" is how one is usually built. Shorter terms are matched only
 * against the whole handle, so three letters cannot ban every handle that
 * happens to contain them. EXCEPTIONS covers the innocent words that still
 * collide: an occurrence is masked out before matching, so "spicy" passes while
 * "spicyspic" does not.
 *
 * WHY THE TERMS ARE ENCODED. They are base64 in handle-terms.json, not
 * plaintext. This is obfuscation, not security, and it is not pretending
 * otherwise: the point is that a public repository should not contain a
 * greppable list of slurs, which is unpleasant in its own right and doubles as
 * a ready-made list of what to work around. tools/hash-handle-terms.mjs adds
 * terms without needing the original list.
 */

// Leetspeak and lookalikes, applied before the letters-only strip so "n0ob"
// and "no0b" normalise alike.
const LEET = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "6": "g", "7": "t", "8": "b", "9": "g",
  "@": "a", "$": "s", "!": "i", "|": "i", "+": "t", "(": "c",
};

/*
 * A handle reduced to comparable letters. Deliberately does NOT collapse
 * repeated letters — see the header: that is what merged "niger" into the slur.
 */
function normalizeHandle(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[0-9@$!|+(]/g, (c) => LEET[c] || "")
    .replace(/[^a-z]/g, "");
}

// Terms this long or longer are matched anywhere in the handle; shorter ones
// only against the whole of it.
const MIN_SUBSTRING_LEN = 4;

/*
 * Innocent words that contain a screened term. Masked out of the handle before
 * matching, so the word passes but the bare term inside a longer handle does
 * not. Plaintext on purpose: these are ordinary words, and being able to read
 * and extend the list is the point. Derived by running the screen across the
 * game's own dictionary (tests/handle-filter pins that it stays at zero).
 */
const EXCEPTIONS = [
  "spice", "spicy", "spicier", "spiciest", "aspic", "spica", "spick",
  // "auspices" and "nazirite" are deliberately absent: the shorter "spice" and
  // "nazir" already cover them, since masking those leaves only a harmless
  // fragment. A nested pair would make the masking order matter, and
  // tests/handle-filter asserts there isn't one.
  "suspicion", "suspicious", "conspicuous", "auspicious",
  "raccoon", "racoon", "cocoon", "tycoon", "coonhound", "lagoon", "harpoon",
  "nazir",
  "vandyke", "dyker",
  "scunthorpe", "penistone", "assassin", "classic", "grape", "shitake",
];

function decodeTerms(encoded) {
  return encoded.map((b64) => Buffer.from(b64, "base64").toString("utf8"));
}

const TERMS = decodeTerms(require("./handle-terms.json"));

// /n+i+g+g+e+r+/ — every letter may repeat, so a stretched spelling matches
// while a word merely one letter short of the term does not.
function termPattern(term, whole) {
  const body = term.split("").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "+").join("");
  return new RegExp(whole ? `^${body}$` : body);
}

const COMPILED = TERMS.map((t) => ({
  len: t.length,
  anywhere: termPattern(t, false),
  whole: termPattern(t, true),
}));

/*
 * Whether a handle should be refused. `extraTerms` and `extraExceptions` are for
 * the tests, which use invented ones rather than depending on the real lists.
 */
function isBlockedHandle(handle, extraTerms, extraExceptions) {
  let n = normalizeHandle(handle);
  if (!n) return false;

  // Mask innocent words first, so what remains is only the text they do not
  // account for. Longest first: masking a shorter exception that sits inside a
  // longer one leaves a fragment behind, and that fragment can spell a term.
  const exceptions = extraExceptions ? EXCEPTIONS.concat(extraExceptions.map(normalizeHandle)) : EXCEPTIONS;
  for (const word of [...exceptions].sort((a, b) => b.length - a.length)) {
    if (!word) continue;
    let i;
    while ((i = n.indexOf(word)) !== -1) n = n.slice(0, i) + " " + n.slice(i + word.length);
  }

  const compiled = extraTerms
    ? COMPILED.concat(extraTerms.map((t) => {
        const nt = normalizeHandle(t);
        return { len: nt.length, anywhere: termPattern(nt, false), whole: termPattern(nt, true) };
      }))
    : COMPILED;

  // Each unmasked run of letters is tested on its own, so a masked exception
  // cannot bridge two halves into a term that was never written.
  for (const part of n.split(" ")) {
    if (!part) continue;
    for (const t of compiled) {
      if (t.len >= MIN_SUBSTRING_LEN ? t.anywhere.test(part) : t.whole.test(part)) return true;
    }
  }
  return false;
}

/*
 * A replacement for a seeded handle that was refused. Must satisfy
 * changeUsername's own rules (3-12 characters, [a-zA-Z0-9_\s-]) so the player
 * can go on to change it normally.
 */
function safeFallbackHandle(rand) {
  const n = Math.floor((typeof rand === "number" ? rand : Math.random()) * 9000) + 1000;
  return "PLAYER" + n;
}

module.exports = {
  normalizeHandle, isBlockedHandle, safeFallbackHandle,
  MIN_SUBSTRING_LEN, EXCEPTIONS, TERMS_COUNT: TERMS.length,
};
