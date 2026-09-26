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
// 3/4/3 from the easy/medium/hard thirds of the whole word list and then
// sorts all ten by difficulty ascending. Because the thirds don't overlap,
// sorting cannot move a word across a tier boundary — so position in the
// published list IS the tier it was drawn from, and these counts label it.
export const TIER_SIZES = [3, 4, 3];
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

export function prettyDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// ----------------------------------------------------------- statistics ---

export function tierOf(index) {
  let seen = 0;
  for (let t = 0; t < TIER_SIZES.length; t++) {
    seen += TIER_SIZES[t];
    if (index < seen) return TIER_NAMES[t];
  }
  return TIER_NAMES[TIER_NAMES.length - 1];
}

/*
 * Per-word difficulty for one day, from the finished attempts.
 *
 * `attempts` is one entry per player who FINISHED, each the `history` array
 * off dailyAttempts/{uid}/days/{date}: one { guesses:[], solved } per word,
 * in play order, with untouched words left empty. A miss ends the run, so a
 * word's `reached` count is also how many players were still alive when they
 * got to it — which is why `endedRuns` is worth reporting separately from a
 * plain fail rate.
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
      index: i, word, tier: tierOf(i), reached, solved, endedRuns,
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
export function computeStandings(runs, limit = 10) {
  const sorted = [...runs].sort((a, b) => (b.score || 0) - (a.score || 0));
  let place = 0;
  return sorted.slice(0, limit).map((r, i) => {
    if (i === 0 || (sorted[i - 1].score || 0) !== (r.score || 0)) place = i + 1;
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
 * A day nobody completed renders as ten words and "Nobody finished this
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
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #121213; color: #ccc; display: flex; flex-direction: column; align-items: center; padding: 20px; margin: 0; min-height: 100vh; }
        .container { background-color: #1a1a1d; border: 2px solid #b967ff; border-radius: 10px; padding: 25px; max-width: 700px; width: 100%; box-shadow: 0 0 15px #b967ff; line-height: 1.7; font-size: 15px; }
        h1 { color: #b967ff; text-transform: uppercase; font-style: italic; text-align: center; margin-top: 0; font-size: 28px; letter-spacing: 2px; }
        .sub { text-align: center; color: #888; font-size: 13px; margin-top: -10px; margin-bottom: 22px; }
        h2 { text-transform: uppercase; font-size: 18px; margin-top: 32px; border-bottom: 1px dashed #555; padding-bottom: 6px; }
        a { color: #4caf50; text-decoration: none; font-weight: bold; }
        a:hover { color: #00ffff; }
        table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 14px; }
        th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #333; }
        th { color: #b967ff; text-transform: uppercase; font-size: 12px; letter-spacing: 1px; }
        td.n, th.n { text-align: right; }
        .word { font-weight: bold; color: #00ffff; letter-spacing: 2px; }
        .tier { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; }
        .lede { color: #ddd; font-size: 16px; }
        .stat-row { display: flex; justify-content: space-between; gap: 10px; margin: 18px 0; text-align: center; }
        .stat-row div { flex: 1; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
        .stat-row b { display: block; font-size: 22px; color: #fff; font-weight: bold; letter-spacing: 0; text-transform: none; }
        .bar { background: #222; border-radius: 3px; height: 16px; position: relative; overflow: hidden; }
        .bar > span { display: block; height: 100%; background: #b967ff; }
        .pager { display: flex; justify-content: space-between; margin-top: 26px; font-size: 14px; gap: 10px; }
        .pager span { color: #555; }
        .back-btn { background-color: #333; color: white; border: 2px solid #777; padding: 12px; font-size: 16px; font-weight: bold; text-transform: uppercase; cursor: pointer; border-radius: 5px; margin-top: 25px; text-decoration: none; display: block; text-align: center; transition: background 0.2s; }
        .back-btn:hover { background-color: #555; }
        .nav-links { margin-top: 28px; font-size: 13px; text-align: center; color: #666; line-height: 2; }
        .support { margin-top: 26px; padding: 14px 16px; border: 1px solid #333; border-radius: 6px; background: #151517; font-size: 13px; color: #999; line-height: 1.6; }`;

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
    <link rel="icon" href="/favicon.ico" sizes="32x32">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
    <style>${STYLE}
    </style>
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
  // The word that ended the most runs, which is the thing people argue about.
  const nemesis = stats.filter((s) => s.endedRuns > 0).sort((a, b) => b.endedRuns - a.endedRuns)[0] || null;
  const distMax = Math.max(1, ...dist);

  const title = `Lexathon Gauntlet #${n} — ${pretty}`;
  const description = players
    ? `All ten words from Lexathon Gauntlet #${n} (${pretty}), with the final standings, how many guesses each word took, and which one ended the most runs.`
    : `The ten words from Lexathon Gauntlet #${n} (${pretty}).`;

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
      ? `${num(perfect)} got all ten.`
      : `Nobody got all ten.`;
    if (nemesis) html += ` <strong>${escapeHtml(nemesis.word)}</strong> ended the most runs — ${num(nemesis.endedRuns)} of them.`;
    html += `</p>\n`;
  } else {
    html += `        <p class="lede">Nobody finished this one.</p>\n`;
  }

  html += `
        <h2>The Ten Words</h2>
        <p>Drawn easiest-first: three from the easy third of the word list, four from the middle, three from the hardest.</p>
        <table>
            <tr><th>#</th><th>Word</th><th>Tier</th><th class="n">Reached</th><th class="n">Solved</th><th class="n">Avg guesses</th></tr>
`;
  for (const s of stats) {
    html += `            <tr><td>${s.index + 1}</td><td class="word">${escapeHtml(s.word)}</td>`
      + `<td class="tier">${s.tier}</td><td class="n">${num(s.reached)}</td>`
      + `<td class="n">${pct(s.solveRate)}</td><td class="n">${avg(s.avgGuesses)}</td></tr>\n`;
  }
  html += `        </table>\n`;
  if (players) html += `        <p style="font-size:13px;color:#888;">"Reached" counts players still alive when they got to that word — a miss ends the run, so later words are seen by fewer people by design.</p>\n`;

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

        <p style="margin-top:24px;">Today's Gauntlet is a different ten words, and everyone plays the same ones. <a href="/">Play today's</a>, or <a href="/gauntlet/">browse the archive</a>.</p>

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
  const description = `Every past Lexathon Gauntlet: all ten words from each day, the final standings, and which word ended the most runs. ${days.length} puzzles so far.`;
  let html = head(title, description, `${SITE}/gauntlet/`);
  html += `
    <div class="container">
        <h1>Past Gauntlets</h1>
        <div class="sub">${days.length} ${days.length === 1 ? "puzzle" : "puzzles"} so far</div>

        <p class="lede">The Gauntlet is one shared puzzle a day: ten words, five guesses each, and a single miss ends the run. Everybody gets the same ten. Once a day is over its words go here, along with the final standings and how hard each word turned out to be.</p>

        <p>Today's puzzle is never listed — <a href="/">play it first</a>.</p>

        <table>
            <tr><th>Puzzle</th><th>Date</th><th class="n">Players</th><th class="n">Perfect</th><th class="n">Top score</th></tr>
`;
  for (const d of days) {
    html += `            <tr><td><a href="/gauntlet/${d.date}/">#${gauntletNumber(d.date)}</a></td>`
      + `<td>${escapeHtml(prettyDate(d.date))}</td><td class="n">${num(d.players)}</td>`
      + `<td class="n">${num(d.perfect)}</td><td class="n">${num(d.topScore)}</td></tr>\n`;
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
