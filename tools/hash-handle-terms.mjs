#!/usr/bin/env node
/*
 * Generates functions/handle-terms.json — the screened-handle term list.
 *
 * Terms are read from stdin, one per line; blank lines and lines starting with
 * # are ignored. They are stored base64-encoded, which is obfuscation and not
 * security: the point is that this public repository should not contain a
 * greppable list of slurs. See functions/handle-filter.js for the reasoning.
 *
 *   # replace the list wholesale
 *   printf 'term1\nterm2\n' | node tools/hash-handle-terms.mjs
 *
 *   # add to what is already there, without needing the original terms
 *   printf 'newterm\n' | node tools/hash-handle-terms.mjs --add
 *
 *   # see what a term normalises to, and whether it is already covered
 *   printf 'term\n' | node tools/hash-handle-terms.mjs --check
 *
 *   # list the terms currently stored, decoded, to review the list
 *   node tools/hash-handle-terms.mjs --list
 *
 *   # every dictionary word the screen currently refuses, to find false
 *   # positives before players do
 *   node tools/hash-handle-terms.mjs --audit
 *
 * Uses the SAME normaliser as the matcher, which is the point: a term stored in
 * a different form than the matcher computes would match nothing at all.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import hf from "../functions/handle-filter.js";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO, "functions", "handle-terms.json");
const args = process.argv.slice(2);
const flags = ["--add", "--check", "--list", "--audit"];
const unknown = args.filter((a) => !flags.includes(a));
if (unknown.length) { console.error("unknown argument(s): " + unknown.join(" ")); process.exit(1); }
const has = (f) => args.includes(f);

const stored = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : [];
const decode = (b64) => Buffer.from(b64, "base64").toString("utf8");

if (has("--list")) {
  console.log(`${stored.length} term(s) in ${path.relative(REPO, OUT)}:`);
  for (const b of stored) {
    const t = decode(b);
    console.log(`  ${t.padEnd(20)}${t.length < hf.MIN_SUBSTRING_LEN ? "(whole-handle match only)" : ""}`);
  }
  process.exit(0);
}

// Every word in the game's dictionary that the screen would refuse. Some are
// meant to be refused; the rest belong in EXCEPTIONS. Run this after any change
// to the list or the normaliser.
if (has("--audit")) {
  const src = fs.readFileSync(path.join(REPO, "words.js"), "utf8");
  const blocks = [...src.matchAll(/`([\s\S]*?)`/g)].map((m) => m[1]);
  const words = [...new Set(blocks.join("\n").split(/\s+/).filter((w) => /^[a-z]{3,}$/.test(w)))];
  const hits = words.filter((w) => hf.isBlockedHandle(w));
  console.log(`${words.length} dictionary words screened, ${hits.length} refused:`);
  for (const w of hits) console.log("  " + w);
  console.log("\nAnything innocent in that list belongs in EXCEPTIONS in functions/handle-filter.js.");
  process.exit(0);
}

const raw = fs.readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const terms = [];
for (const term of raw) {
  const n = hf.normalizeHandle(term);
  if (!n) { console.error(`skipped (normalises to nothing): ${JSON.stringify(term)}`); continue; }
  if (n.length < 3) { console.error(`skipped (under 3 letters normalised): ${JSON.stringify(term)} -> ${n}`); continue; }
  terms.push(n);
}

if (has("--check")) {
  for (const n of terms) {
    console.log(`${n.padEnd(20)} ${hf.isBlockedHandle(n) ? "already blocked" : "NOT blocked"}`
      + (n.length < hf.MIN_SUBSTRING_LEN ? "  (would match the whole handle only)" : ""));
  }
  process.exit(0);
}

const set = new Set(has("--add") ? stored : []);
const before = set.size;
for (const n of terms) set.add(Buffer.from(n, "utf8").toString("base64"));
// Sorted so the file is stable and a diff shows only real changes. Sorting the
// ENCODED form also means the order carries nothing about the terms.
const out = [...set].sort();
fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + "\n");
console.log(`${path.relative(REPO, OUT)}: ${out.length} term(s)`
  + (has("--add") ? `, ${out.length - before} new (${before} kept)` : `, from ${terms.length} read`));
const short = terms.filter((n) => n.length < hf.MIN_SUBSTRING_LEN).length;
if (short) console.log(`note: ${short} term(s) are under ${hf.MIN_SUBSTRING_LEN} letters, so they match only a handle that is exactly that term`);
