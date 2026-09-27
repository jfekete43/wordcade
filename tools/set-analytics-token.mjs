#!/usr/bin/env node
/*
 * Turns the analytics beacon on (or off, or changes the token) across every
 * page at once.
 *
 *   node tools/set-analytics-token.mjs <token>   go live with this token
 *   node tools/set-analytics-token.mjs --off     back to the pending comment
 *   node tools/set-analytics-token.mjs --status  what each page currently has
 *
 * Eight files carry the block: the seven static pages, plus the shared head()
 * in gauntlet-archive-render.mjs which covers every generated archive page.
 * Those archive pages are in sitemap.xml, so they are a real way in — leaving
 * them out is how you end up with stats that quietly under-report.
 *
 * Doing this by hand is the failure mode this exists to prevent: the one file
 * you miss reports no traffic and nothing tells you.
 *
 * The beacon is cookieless and stores no personal data, which is why the site
 * needs no consent banner. If that ever changes, privacy.html has to change
 * with it.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["about.html", "faq.html", "how-to-play.html", "index.html", "privacy.html",
               "strategy.html", "terms.html", "tools/gauntlet-archive-render.mjs"];

const PENDING = `    <!-- analytics:cloudflare | Cookieless, so no consent banner is required.
         NOT LIVE YET. Get a token at dash.cloudflare.com -> Analytics & Logs ->
         Web Analytics, then stamp it into every page at once with:
             node tools/set-analytics-token.mjs <token>
         Doing it by hand means eight files, and the one you miss is the page
         that quietly reports no traffic. -->
`;
const live = (token) => `    <!-- analytics:cloudflare | Cookieless, so no consent banner is required.
         Change the token or turn it off everywhere at once with:
             node tools/set-analytics-token.mjs <token|--off> -->
    <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${token}"}'></script>
`;

// The block runs from the marker to the end of whichever form is there.
const BLOCK = /[ \t]*<!-- analytics:cloudflare[\s\S]*?-->\n(?:[ \t]*<script defer src="https:\/\/static\.cloudflareinsights\.com[^\n]*\n)?/;

const args = process.argv.slice(2);
if (args.length !== 1) { console.error("usage: set-analytics-token.mjs <token> | --off | --status"); process.exit(1); }
const arg = args[0];

const read = (f) => { const p = path.join(REPO, f); const s = fs.readFileSync(p, "utf8"); return { p, s, crlf: s.includes("\r\n") }; };
const tokenIn = (s) => (s.match(/data-cf-beacon='\{"token":"([^"]*)"\}'/) || [])[1] || null;

if (arg === "--status") {
  let live_ = 0, pending = 0, missing = 0;
  const tokens = new Set();
  for (const f of FILES) {
    const { s } = read(f);
    if (!/analytics:cloudflare/.test(s)) { console.log(`  MISSING  ${f}`); missing++; continue; }
    const t = tokenIn(s);
    if (t) { console.log(`  live     ${f}  token ${t.slice(0, 8)}…`); tokens.add(t); live_++; }
    else { console.log(`  pending  ${f}`); pending++; }
  }
  console.log(`\n${live_} live, ${pending} pending, ${missing} missing`
    + (tokens.size > 1 ? `\nWARNING: ${tokens.size} different tokens in use` : ""));
  process.exit(missing || tokens.size > 1 ? 1 : 0);
}

if (arg !== "--off" && !/^[A-Za-z0-9_-]{8,}$/.test(arg)) {
  console.error("that does not look like a Cloudflare beacon token (expected 8+ of [A-Za-z0-9_-])");
  process.exit(1);
}

const replacement = arg === "--off" ? PENDING : live(arg);
let changed = 0;
for (const f of FILES) {
  const { p, s, crlf } = read(f);
  const flat = s.replace(/\r\n/g, "\n");
  if (!BLOCK.test(flat)) { console.error(`no analytics block in ${f} — add one before using this`); process.exit(1); }
  const out = flat.replace(BLOCK, replacement);
  if (out === flat) { console.log(`  unchanged ${f}`); continue; }
  fs.writeFileSync(p, crlf ? out.replace(/\n/g, "\r\n") : out);
  console.log(`  updated   ${f}`);
  changed++;
}
console.log(arg === "--off"
  ? `\nanalytics off in ${changed} file(s) — the pages carry the pending comment again`
  : `\nanalytics live in ${changed} file(s). index.html and the static pages are served by GitHub Pages`
    + ` within a minute of the push; the archive pages pick it up on the next daily rebuild`
    + ` (or run tools/build-gauntlet-archive.mjs --all).`);
