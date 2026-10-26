/*
 * Turns one day of Gauntlet data into a static page, and the set of days
 * into a hub page and sitemap entries.
 *
 * Deliberately pure: no Firestore, no filesystem, no clock beyond what is
 * passed in. build-gauntlet-archive.mjs does the reading and writing and
 * calls into here, so every rule below — which days may be published, how a
 * word's difficulty is reported, how ties share a place — is testable
 * against fixtures without credentials.
 *
 * The one rule that must never break: a page is only ever produced for a
 * date strictly BEFORE today in Eastern time. Publishing today's words kills
 * the puzzle for everyone who hasn't played yet. See publishableDates.
 */

export const GAUNTLET_EPOCH = "2026-09-02"; // date of Gauntlet #1 — matches index.html
export const WORD_COUNT = 10;
// Tier sizes from pickDailyWords in functions/index.js. That function draws
// from the easy/medium/hard thirds of the whole word list and then sorts the
// draw by difficulty ascending. Because the thirds don't overlap, sorting
// cannot move a word across a tier boundary — so position in the published
// list IS the tier it was drawn from, and these counts label it.
//
// Derived from the day's own word count rather than fixed, because the archive
// renders every past day and the Gauntlet has not always been the same length.
// It was ten words (3/4/3) before it became seven (2/3/2); a constant here
// would have relabelled every ten-word page the day the count changed —
// position 8 was Hard on those days and is off the end of a seven-word puzzle.
// The split is the same one the server uses: a third to each end, the
// remainder in the middle.
export function tierSizesFor(wordCount) {
  const n = Math.max(0, Number(wordCount) || 0);
  const outer = Math.floor(n / 3);
  return [outer, n - outer * 2, outer];
}
const TIER_NAMES = ["Easy", "Medium", "Hard"];

const SITE = "https://lexathon.gg";

// ---------------------------------------------------------------- dates ---

// YYYY-MM-DD for an instant, in Eastern. Same Intl approach as
// getTodayDateStr in functions/index.js, which is correct across EST/EDT
// because America/New_York is an IANA zone rather than a fixed offset.
export function etDateStr(instant) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant);
}

// Calendar arithmetic on the date string itself, via UTC midnight. Never
// touches local time, so it cannot drift by an hour on a transition day.
export function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const out = new Date(t);
  return `${out.getUTCFullYear()}-${String(out.getUTCMonth() + 1).padStart(2, "0")}-${String(out.getUTCDate()).padStart(2, "0")}`;
}

export function gauntletNumber(dateStr) {
  const toUTC = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const days = Math.floor((toUTC(dateStr) - toUTC(GAUNTLET_EPOCH)) / 86400000) + 1;
  return days >= 1 ? days : null;
}

// Every date that may be published right now: epoch through YESTERDAY in
// Eastern, inclusive. Today is excluded because its answers are still live.
export function publishableDates(now, epoch = GAUNTLET_EPOCH) {
  const today = etDateStr(now);
  const out = [];
  for (let d = epoch; d < today; d = shiftDate(d, 1)) out.push(d);
  return out;
}

export function isPublishable(dateStr, now, epoch = GAUNTLET_EPOCH) {
  return dateStr >= epoch && dateStr < etDateStr(now);
}

export function shortDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", day: "numeric", month: "short", year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function prettyDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// ----------------------------------------------------------- statistics ---

export function tierOf(index, wordCount) {
  const sizes = tierSizesFor(wordCount);
  let seen = 0;
  for (let t = 0; t < sizes.length; t++) {
    seen += sizes[t];
    if (index < seen) return TIER_NAMES[t];
  }
  return TIER_NAMES[TIER_NAMES.length - 1];
}

/*
 * Per-word difficulty for one day, from the finished attempts.
 *
 * `attempts` is one entry per player who FINISHED, each the `history` array
 * off dailyAttempts/{uid}/days/{date}: one { guesses:[], solved } per word,
 * in play order, with untouched words left empty.
 *
 * The arithmetic here is deliberately unchanged from when a miss ended the
 * run, because it reads the stored history either way and the archive holds
 * both eras. What the numbers MEAN moved:
 *
 *   reached   — then: players still alive at that word. Now: everyone, since
 *               everyone plays every word. Still literally "players who got here".
 *   endedRuns — then: runs that ended on this word. Now: players who missed it.
 *               The same count both times; `missedBy` is the name that is true
 *               of both, which is what the page prints.
 *   solveRate — then: of the survivors who reached it. Now: of the whole field,
 *               which is the number it was always trying to be.
 *
 * So a page rebuilt for an old day still reports exactly what it did before.
 */
export function computeWordStats(words, attempts) {
  return words.map((word, i) => {
    let reached = 0, solved = 0, solvedGuesses = 0, endedRuns = 0;
    for (const history of attempts) {
      const entry = history && history[i];
      if (!entry || !Array.isArray(entry.guesses) || entry.guesses.length === 0) continue;
      reached++;
      if (entry.solved) { solved++; solvedGuesses += entry.guesses.length; }
      else endedRuns++;
    }
    return {
      // `missedBy` is the name used from here on; `endedRuns` stays as an alias
      // so an older caller (or an old test) is not silently reading undefined.
      index: i, word, tier: tierOf(i, words.length), reached, solved, missedBy: endedRuns, endedRuns,
      // Averaged over the players who SOLVED it, not everyone who reached
      // it. A failed word is always five guesses, so including failures
      // would drag this toward 5 in step with the solve rate reported
      // beside it — two columns saying the same thing, and neither of them
      // answering "when people got it, how fast?".
      avgGuesses: solved > 0 ? solvedGuesses / solved : null,
      solveRate: reached > 0 ? solved / reached : null,
    };
  });
}

// Standings with shared places on a tie, which is how the in-app board and
// the payout code both behave.
//
// Score first, then words solved — the same tiebreak the live board orders by,
// because a past day's page and the board it was taken from disagreeing about
// who came second is the kind of thing nobody can explain afterwards. A tie is
// therefore both fields matching, not just the score.
export function computeStandings(runs, limit = 10) {
  const key = (r) => [r.score || 0, r.wordsGuessed || 0];
  const sorted = [...runs].sort((a, b) => (b.score || 0) - (a.score || 0) || (b.wordsGuessed || 0) - (a.wordsGuessed || 0));
  let place = 0;
  return sorted.slice(0, limit).map((r, i) => {
    const prev = i > 0 ? key(sorted[i - 1]) : null;
    const mine = key(r);
    if (i === 0 || prev[0] !== mine[0] || prev[1] !== mine[1]) place = i + 1;
    return { place, name: r.username || "Player", score: r.score || 0, solved: r.wordsGuessed || 0 };
  });
}

export function computeDistribution(runs) {
  const counts = new Array(WORD_COUNT + 1).fill(0);
  for (const r of runs) {
    const n = Math.max(0, Math.min(WORD_COUNT, Number(r.wordsGuessed) || 0));
    counts[n]++;
  }
  return counts;
}

// ----------------------------------------------------------- publishing ---

/*
 * Whether a finished day is worth a page.
 *
 * A day nobody completed renders as its words and "Nobody finished this
 * one", and unlike the rest of the archive it can never improve: a past
 * Gauntlet cannot be played retroactively, so its run count is final the
 * moment the day ends. Those pages stay thin forever, which is why the
 * default threshold is 1 rather than 0.
 */
export function shouldPublish(runCount, minPlayers = 1) {
  return runCount >= minPlayers;
}

/*
 * What a full rebuild should delete: days on disk that the rebuild did not
 * produce, because they no longer meet the threshold (or their puzzle is
 * gone).
 *
 * The refusal is the point of this being a function. A rebuild that read
 * nothing — a transient Firestore failure, expired credentials — looks
 * exactly like a rebuild where no day qualifies, and the second is a
 * legitimate outcome. Deleting the whole archive on the first is not
 * recoverable from the runner, so an empty build against a non-empty
 * archive refuses instead of pruning.
 */
export function planPrune(existingDates, builtDates) {
  const keep = new Set(builtDates);
  const remove = existingDates.filter((d) => !keep.has(d));
  if (!builtDates.length && existingDates.length) {
    return { refuse: true, remove: [], reason: `this run built none of the ${existingDates.length} existing day(s)` };
  }
  return { refuse: false, remove, reason: "" };
}

// -------------------------------------------------------------- render ----

export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const num = (n) => Number(n || 0).toLocaleString("en-US");
const pct = (v) => v === null ? "—" : `${Math.round(v * 100)}%`;
const avg = (v) => v === null ? "—" : v.toFixed(1);

const STYLE = `
        :root {
            /* signals — the only thing a theme may never repaint */
            --c-correct: #24688f;
            --c-present: #9e6713;
            --c-loss: #b3261e;
            /* one per mode */
            --c-endless: #4a7c59;
            --c-gauntlet: #6b5b95;
            --c-clash: #b5563f;
            --c-ffa: #8a6b26;
            /* a letter that is in no part of the word */
            --c-absent: #c9c0ae;
            --c-absent-ink: #635c4c;
            /* surfaces, named for the job rather than the lightness: on paper
               the ramp runs the other way, and "darkest to lightest" would be
               a lie the next repaint inherits */
            --c-page: #f7f3ea;     /* the paper everything sits on */
            --c-panel: #ffffff;    /* cards, modals, lists */
            --c-raised: #fbf7ee;   /* control faces: inputs, tabs, menu rows */
            --c-line: #e6dece;     /* ordinary rules and borders */
            --c-line-2: #d8cdb6;   /* the same, one step stronger */
            /* ink, strongest to faintest */
            --c-ink: #2a2420;
            --c-ink-2: #403930;
            --c-ink-3: #5c5447;
            --c-ink-4: #6f675a;
            --c-ink-5: #847c6c;
            --c-ink-6: #a89e8c;
            /* Ink that goes on top of a filled accent. Every accent above is
               mid-tone on purpose, so this is white for all seven rather than
               one rule per fill. It was --c-on-bright and black, which is the
               same idea upside down. */
            --c-on-accent: #ffffff;
            /* Elevation, now that a glow cannot do it. */
            --c-shadow: 0 1px 0 rgba(42, 36, 32, .05), 0 2px 8px rgba(42, 36, 32, .10);

            /* ---- type, space and geometry -----------------------------
               The page had sixteen font sizes on a 1px ramp and thirty-one
               border-radius declarations across seven values, which is why
               nothing on it read as more or less important than anything
               else. A 1px step encodes nothing a reader can see.

               Radius tracks OBJECT SIZE rather than the spacing rhythm, so
               --r-2 staying 7px while --s-3 is 6px is deliberate: do not
               "fix" one to match the other. */
            --fs-1: 10px;   /* eyebrow, micro-label, badge */
            --fs-2: 12px;   /* meta, caption, dense cell, mode label */
            --fs-3: 14px;   /* body, list row, control label */
            --fs-4: 16px;   /* item title, section head */
            --fs-5: 20px;   /* figure: stat value, timer */
            --fs-6: 26px;   /* hero figure: end-of-run score */
            --fw-body: 400; --fw-med: 600; --fw-bold: 700;
            --ls-eyebrow: 1.2px;  /* only with --fs-1 + uppercase */
            --ls-label: .8px;     /* only with --fs-2 + uppercase */
            --ls-ui: .2px;        /* sentence-case control labels */
            --ls-num: -.3px;      /* figures at --fs-5 / --fs-6 */
            --ls-glyph: .5px;     /* tile and wordmark letters */
            --lh-tight: 1.2; --lh-ui: 1.45; --lh-prose: 1.7;
            --r-1: 3px;     /* <=16px: swatches, bars, inline badges */
            --r-2: 7px;     /* 20-60px: tiles, keys, inputs, tabs, pills */
            --r-3: 10px;    /* full-width controls and panels */
            --r-4: 14px;    /* modals */
            --r-pill: 999px;
            --bw: 1px;          /* every border on the page */
            --bw-focus: 2px;    /* where you are, and this is you. Nothing else */
            --s-1: 2px; --s-2: 4px; --s-3: 6px; --s-4: 8px; --s-5: 12px;
            --s-6: 16px; --s-7: 20px; --s-8: 24px; --s-9: 32px; --s-10: 48px;
            --w-col: 460px; --pad-page: 20px;
            /* 64 = two 20px gutters + four 6px gaps. At 320px this gives a
               51.2px cell and a 280px board, which is exactly the content
               width. On :root rather than #board so a tile rendered outside
               the board still has a size. */
            --cell: min(58px, calc((100vw - 64px) / 5));
        }
        /* .container is width:100% PLUS padding and border, which on a 390px
           phone rendered 404px inside a 350px slot and pushed the document
           sideways. The hand-written pages carry the identical fix. */
        *, *::before, *::after { box-sizing: border-box; }
        button, input, select, textarea { font-family: inherit; font-size: inherit; line-height: inherit; color: inherit; }
        body { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'; -webkit-font-smoothing: antialiased; background-color: var(--c-page); color: var(--c-ink-2); display: flex; flex-direction: column; align-items: center; font-size: var(--fs-3); line-height: var(--lh-prose); padding: var(--s-7); margin: 0; min-height: 100vh; }
        .container { background-color: var(--c-panel); border: var(--bw) solid var(--c-gauntlet); border-radius: var(--r-3); padding: var(--s-8); max-width: 700px; width: 100%; box-shadow: var(--c-shadow); line-height: var(--lh-prose); font-size: var(--fs-4); }
        h1 { color: var(--c-ink); text-align: center; margin-top: 0; font-size: var(--fs-6); letter-spacing: var(--ls-num); }
        .sub { text-align: center; color: var(--c-ink-4); font-size: var(--fs-2); margin-top: -10px; margin-bottom: var(--s-8); }
        h2 { color: var(--c-ink); font-size: var(--fs-5); margin-top: var(--s-9); border-bottom: var(--bw) solid var(--c-line); padding-bottom: var(--s-3); }
        a { color: var(--c-correct); text-decoration: none; font-weight: var(--fw-bold); }
        a:hover { text-decoration: underline; }
        /* display:block so a table too wide for the screen scrolls inside
           itself instead of stretching the page. The word table is six
           columns and does not fit a phone at full size. */
        table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; width: 100%; border-collapse: collapse; margin: var(--s-6) 0; font-size: var(--fs-3); }
        th, td { text-align: left; padding: var(--s-4) var(--s-5); border-bottom: var(--bw) solid var(--c-line); white-space: nowrap; }
        th { color: var(--c-ink-4); text-transform: uppercase; font-size: var(--fs-1); letter-spacing: var(--ls-eyebrow); }
        td.n, th.n { text-align: right; }
        .word { font-weight: var(--fw-bold); color: var(--c-correct); letter-spacing: 2px; }
        .tier { font-size: var(--fs-1); text-transform: uppercase; letter-spacing: var(--ls-eyebrow); color: var(--c-ink-4); }
        .lede { color: var(--c-ink-2); font-size: var(--fs-4); }
        .stat-row { display: flex; justify-content: space-between; gap: var(--s-5); margin: var(--s-7) 0; text-align: center; }
        .stat-row div { flex: 1; font-size: var(--fs-1); color: var(--c-ink-5); text-transform: uppercase; letter-spacing: var(--ls-eyebrow); }
        .stat-row b { display: block; font-size: var(--fs-5); color: var(--c-ink); font-weight: var(--fw-bold); letter-spacing: var(--ls-num); text-transform: none; }
        .bar { background: var(--c-line); border-radius: var(--r-1); height: 16px; position: relative; overflow: hidden; }
        .bar > span { display: block; height: 100%; background: var(--c-gauntlet); }
        .pager { display: flex; justify-content: space-between; margin-top: var(--s-9); font-size: var(--fs-3); gap: var(--s-5); }
        .pager span { color: var(--c-ink-5); }
        .back-btn { background-color: var(--c-raised); color: var(--c-ink); border: var(--bw) solid var(--c-line-2); min-height: 46px; padding: 0 var(--s-6); font-size: var(--fs-3); font-weight: var(--fw-bold); letter-spacing: var(--ls-ui); cursor: pointer; border-radius: var(--r-3); width: 100%; margin-top: var(--s-8); }
        .back-btn:hover { background-color: var(--c-line); border-color: var(--c-ink-5); }
        .nav-links { margin-top: var(--s-9); font-size: var(--fs-2); text-align: center; color: var(--c-ink-4); line-height: 2; }
        /* Declared before the media query below: at equal specificity the
           later rule wins, so putting this after it silently defeated the
           override and the short label never rendered. */
        .only-sm { display: none; }
        @media (max-width: 480px) {
            body { padding: var(--s-5); }
            .container { padding: var(--s-6); }
            table { font-size: var(--fs-2); }
            th, td { padding: var(--s-3); }
            h1 { font-size: var(--fs-5); }
            /* Four across cramped "Top score" and "Avg solved" onto two lines
               while the other two stayed on one, so the numbers no longer
               lined up. Two by two gives every label a full line. */
            .stat-row { flex-wrap: wrap; }
            .stat-row div { flex: 1 1 42%; margin-bottom: var(--s-4); }
            .stat-row b { font-size: var(--fs-4); }
            /* One column per table earns its place least on a phone, and
               dropping it is what lets the rest fit without a sideways
               scroll: the word list's Tier (the easiest-first ordering and
               the sentence above the table already say it) and the hub's
               Perfect count. */
            .hide-sm { display: none; }
            .only-sm { display: inline; }
            /* 2px between letters over a column of five-letter words is real width
               on a 334px table, and the word is legible without it. */
            .word { letter-spacing: 1px; }
        }
        .support { margin-top: var(--s-9); padding: var(--s-5) var(--s-6); border: var(--bw) solid var(--c-line); border-radius: var(--r-2); background: var(--c-raised); font-size: var(--fs-2); color: var(--c-ink-4); line-height: var(--lh-ui); }`;

const NAV = `        <div class="nav-links">
            <a href="/">Play</a> · <a href="/gauntlet/">Past Gauntlets</a> · <a href="/how-to-play.html">How To Play</a> · <a href="/strategy.html">Strategy Guide</a> · <a href="/faq.html">FAQ</a><br>
            <a href="/about.html">About</a> · <a href="/privacy.html">Privacy Policy</a> · <a href="/terms.html">Terms of Service</a>
        </div>`;

const SUPPORT = `        <div class="support">
            Lexathon is a small project, free to play, with no ads and nothing to buy that affects the game.
            If you'd like to help keep it running, <a href="https://ko-fi.com/lexathon" rel="noopener">support it on Ko-fi</a>.
        </div>`;

function head(title, description, canonical) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(canonical)}">
    <!-- How a shared archive link unfurls. These pages are the ones most
         likely to be posted on their own - "look what word beat everyone
         yesterday" - so a bare URL costs more here than on the static pages.
         One card for the whole site; the title and description carry the day.
         Absolute URLs are required: scrapers do not resolve relative paths. -->
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="Lexathon">
    <meta property="og:url" content="${escapeHtml(canonical)}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${SITE}/og-card.png?v=8bdfa4c2">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="Lexathon - a competitive five-letter word game.">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${SITE}/og-card.png?v=8bdfa4c2">
    <link rel="icon" href="/favicon.ico" sizes="32x32">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
    <style>${STYLE}
    </style>
    <!-- analytics:cloudflare | Cookieless, so no consent banner is required.
         Change the token or turn it off everywhere at once with:
             node tools/set-analytics-token.mjs <token|--off> -->
    <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"21957ededacf4e538abc5a0c42767ce7"}'></script>
</head>
<body>
`;
}

/*
 * One day's page. `day` is:
 *   { date, words[10], runs[{username,score,wordsGuessed}], attempts[history],
 *     prev, next }
 */
export function renderDayPage(day) {
  const n = gauntletNumber(day.date);
  const pretty = prettyDate(day.date);
  const stats = computeWordStats(day.words, day.attempts);
  const standings = computeStandings(day.runs);
  const dist = computeDistribution(day.runs);
  const players = day.runs.length;
  const perfect = dist[WORD_COUNT];
  const topScore = standings.length ? standings[0].score : 0;
  const avgSolved = players ? day.runs.reduce((a, r) => a + (r.wordsGuessed || 0), 0) / players : 0;
  // The word that caught the most people out, which is the thing people argue
  // about. Ties broken by the later word, since a late word beating an early
  // one by the same count is the harder scalp on a puzzle built easiest-first.
  const nemesis = stats.filter((s) => s.missedBy > 0).sort((a, b) => b.missedBy - a.missedBy || b.index - a.index)[0] || null;
  /*
   * Which rule was this day played under? Nobody stored a flag, so it is read
   * off the data - but only where the data actually proves it.
   *
   * Proof of play-all-words is positive and specific: somebody missed a word and
   * went on to play a later one, which the old rule made impossible. Proof of
   * the old rule is equally positive: some word was reached by fewer players
   * than finished, which the new rule makes impossible.
   *
   * Neither is guaranteed to be present. A day on which every finisher solved
   * every word looks identical under both rules - and inferring from "everyone
   * reached every word" alone would label exactly that day wrongly. So when the
   * data cannot tell, the page says the thing that is true either way rather
   * than guessing.
   */
  const playedOn = day.attempts.some((h) =>
    h.some((e, i) => e && e.guesses.length > 0 && !e.solved && h.slice(i + 1).some((x) => x && x.guesses.length > 0)));
  const someoneStoppedShort = players > 0 && stats.some((s) => s.reached < players);
  const era = playedOn ? "all-words" : someoneStoppedShort ? "sudden-death" : "unknown";
  const distMax = Math.max(1, ...dist);

  const title = `Lexathon Gauntlet #${n} — ${pretty}`;
  const description = players
    ? `All ${day.words.length} words from Lexathon Gauntlet #${n} (${pretty}), with the final standings, how many guesses each word took, and which one caught the most people out.`
    : `The ${day.words.length} words from Lexathon Gauntlet #${n} (${pretty}).`;

  let html = head(title, description, `${SITE}/gauntlet/${day.date}/`);
  html += `
    <div class="container">
        <h1>Gauntlet #${n}</h1>
        <div class="sub">${escapeHtml(pretty)}</div>
`;

  if (players) {
    html += `        <div class="stat-row">
            <div>Players<b>${num(players)}</b></div>
            <div>Perfect<b>${num(perfect)}</b></div>
            <div>Top score<b>${num(topScore)}</b></div>
            <div>Avg solved<b>${avgSolved.toFixed(1)}</b></div>
        </div>
`;
    html += `        <p class="lede">${num(players)} ${players === 1 ? "player" : "players"} finished this one. `;
    html += perfect > 0
      ? `${num(perfect)} got all ${day.words.length}.`
      : `Nobody got all ${day.words.length}.`;
    if (nemesis) html += ` <strong>${escapeHtml(nemesis.word)}</strong> caught the most people out — ${num(nemesis.missedBy)} missed it.`;
    html += `</p>\n`;
  } else {
    html += `        <p class="lede">Nobody finished this one.</p>\n`;
  }

  html += `
        <h2>The Words</h2>
        <p>Drawn easiest-first, spread across the easy, middle and hardest thirds of the word list.</p>
        <table>
            <tr><th>#</th><th>Word</th><th class="hide-sm">Tier</th><th class="n">Missed</th><th class="n">Solved</th><th class="n"><span class="hide-sm">Avg guesses</span><span class="only-sm">Avg</span></th></tr>
`;
  for (const s of stats) {
    html += `            <tr><td>${s.index + 1}</td><td class="word">${escapeHtml(s.word)}</td>`
      + `<td class="tier hide-sm">${s.tier}</td><td class="n">${num(s.missedBy)}</td>`
      + `<td class="n">${pct(s.solveRate)}</td><td class="n">${avg(s.avgGuesses)}</td></tr>\n`;
  }
  html += `        </table>\n`;
  if (players) html += era === "all-words"
    ? `        <p style="font-size:var(--fs-2);color:var(--c-ink-4);">Everyone plays all ${day.words.length} words, so every player saw every word here \u2014 "Solved" is the share of the whole field that got it.</p>\n`
    : era === "sudden-death"
    ? `        <p style="font-size:var(--fs-2);color:var(--c-ink-4);">On this puzzle a miss ended the run, so later words were only seen by players still going \u2014 "Solved" is the share of those who got that far.</p>\n`
    : `        <p style="font-size:var(--fs-2);color:var(--c-ink-4);">"Solved" is the share of the players who reached that word.</p>\n`;

  if (standings.length) {
    html += `
        <h2>Final Standings</h2>
        <table>
            <tr><th>#</th><th>Player</th><th class="n">Solved</th><th class="n">Score</th></tr>
`;
    for (const r of standings) {
      html += `            <tr><td>${r.place}</td><td>${escapeHtml(r.name)}</td>`
        + `<td class="n">${r.solved}/${WORD_COUNT}</td><td class="n">${num(r.score)}</td></tr>\n`;
    }
    html += `        </table>\n`;

    html += `
        <h2>How Everyone Did</h2>
        <table>
`;
    for (let i = WORD_COUNT; i >= 0; i--) {
      if (dist[i] === 0) continue;
      const w = Math.round((dist[i] / distMax) * 100);
      html += `            <tr><td style="width:64px;">${i}/${WORD_COUNT}</td>`
        + `<td><div class="bar"><span style="width:${w}%;"></span></div></td>`
        + `<td class="n" style="width:56px;">${num(dist[i])}</td></tr>\n`;
    }
    html += `        </table>\n`;
  }

  const prevLink = day.prev ? `<a href="/gauntlet/${day.prev}/">← Gauntlet #${gauntletNumber(day.prev)}</a>` : `<span>← Start of the archive</span>`;
  const nextLink = day.next ? `<a href="/gauntlet/${day.next}/">Gauntlet #${gauntletNumber(day.next)} →</a>` : `<span>Newest →</span>`;
  html += `
        <div class="pager">${prevLink}${nextLink}</div>

        <p style="margin-top:24px;">Today's Gauntlet is a different set of words, and everyone plays the same ones. <a href="/">Play today's</a>, or <a href="/gauntlet/">browse the archive</a>.</p>

        <a href="/" class="back-btn">Back to Arcade</a>

${SUPPORT}
${NAV}
    </div>

</body>
</html>
`;
  return html;
}

// The hub. `days` is newest-first: [{ date, players, perfect, topScore }]
export function renderHubPage(days) {
  const newest = days[0];
  const title = "Past Gauntlets — Every Lexathon Daily Puzzle";
  const description = `Every past Lexathon Gauntlet: every word from each day, the final standings, and which word caught the most people out. ${days.length} puzzles so far.`;
  let html = head(title, description, `${SITE}/gauntlet/`);
  html += `
    <div class="container">
        <h1>Past Gauntlets</h1>
        <div class="sub">${days.length} ${days.length === 1 ? "puzzle" : "puzzles"} so far</div>

        <p class="lede">The Gauntlet is one shared puzzle a day: seven words, five guesses each, and everybody plays all ten. Everybody gets the same ten. Once a day is over its words go here, along with the final standings and how hard each word turned out to be.</p>

        <p>Today's puzzle is never listed — <a href="/">play it first</a>.</p>

        <table>
            <tr><th>Puzzle</th><th>Date</th><th class="n">Players</th><th class="n hide-sm">Perfect</th><th class="n">Top score</th></tr>
`;
  for (const d of days) {
    html += `            <tr><td><a href="/gauntlet/${d.date}/">#${gauntletNumber(d.date)}</a></td>`
      + `<td>${escapeHtml(shortDate(d.date))}</td><td class="n">${num(d.players)}</td>`
      + `<td class="n hide-sm">${num(d.perfect)}</td><td class="n">${num(d.topScore)}</td></tr>\n`;
  }
  html += `        </table>
`;
  if (newest) html += `        <p>Most recent: <a href="/gauntlet/${newest.date}/">Gauntlet #${gauntletNumber(newest.date)}</a>.</p>\n`;
  html += `
        <a href="/" class="back-btn">Back to Arcade</a>

${SUPPORT}
${NAV}
    </div>

</body>
</html>
`;
  return html;
}

/*
 * Rewrites sitemap.xml so the archive URLs sit alongside the hand-written
 * ones. Existing non-archive entries are preserved verbatim; every
 * /gauntlet/ entry is replaced, so re-running never duplicates or strands a
 * URL. lastmod is the puzzle's own date — these pages never change after the
 * day they cover.
 */
export function renderSitemap(existingXml, days) {
  const kept = [...existingXml.matchAll(/<url>[\s\S]*?<\/url>/g)]
    .map((m) => m[0])
    .filter((u) => !/<loc>[^<]*\/gauntlet\//.test(u));

  const archive = [`  <url>
    <loc>${SITE}/gauntlet/</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`];
  for (const d of days) {
    archive.push(`  <url>
    <loc>${SITE}/gauntlet/${d.date}/</loc>
    <lastmod>${d.date}</lastmod>
    <changefreq>never</changefreq>
    <priority>0.6</priority>
  </url>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${kept.map((u) => u.replace(/^\s*/gm, (m) => m.length ? m : "  ")).join("\n")}
${archive.join("\n")}
</urlset>
`;
}
