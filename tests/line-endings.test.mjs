/*
 * Line endings, which nothing was guarding.
 *
 * This repository is deliberately mixed: index.html, privacy.html, terms.html,
 * sw.js and words.js are CRLF; everything else is LF. index.html additionally
 * carries exactly 31 long-standing bare LFs. None of that is a problem on its
 * own - it is only a problem when a script that edits these files gets it
 * wrong, and the damage is invisible in a diff viewer that normalises.
 *
 * Two real failures are the reason this exists.
 *
 * A mutation script read index.html in Python's TEXT mode, which silently
 * converts CRLF to LF on read, and wrote the whole file back as LF. Every line
 * changed; the diff was the entire file.
 *
 * Later, a helper that converted "\n" to "\r\n" was handed lines that already
 * ended "\r\n", and turned each into "\r\r\n". Ten lines got a stray carriage
 * return. The guard in use at the time counted BARE LFs, which were unchanged,
 * so it passed - a lone CR is invisible to a check that only ever looks at
 * line feeds.
 *
 * So this asserts the two things those misses had in common: a file keeps its
 * own style, and no file anywhere contains a carriage return that is not part
 * of a CRLF pair.
 *
 * Pure; reads the working tree.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// The files that are CRLF, named rather than inferred: inferring "whatever it
// is now" from the file itself makes the check agree with any damage done to
// it, which is the one thing it must not do.
const CRLF_FILES = new Set(['index.html', 'privacy.html', 'terms.html', 'sw.js', 'words.js']);
// index.html's 31 bare LFs predate all of this. Pinned exactly: adding content
// to a CRLF file should never add one, and losing them means something
// rewrote the file wholesale.
const INDEX_BARE_LF = 31;

const TEXT = /\.(html|js|mjs|css|json|md|txt|xml|yml|yaml|sh|rules)$/;
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => f && TEXT.test(f));
ck(tracked.length > 100, 'found the tracked text files', String(tracked.length));

const stat = (f) => {
  const b = fs.readFileSync(path.join(ROOT, f));
  let crlf = 0, lf = 0, cr = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 0x0d) { if (b[i + 1] === 0x0a) { crlf++; i++; } else cr++; }
    else if (b[i] === 0x0a) lf++;
  }
  return { crlf, lf, cr };
};

const rows = tracked.map((f) => [f, stat(f)]);

// ---- 1. no stray carriage returns, anywhere -------------------------------
// This is the one with no exceptions. A lone CR is never intentional in this
// repository; it is always a script that wrote "\r" where it meant "\r\n", or
// converted an ending twice.
eq('no file contains a carriage return outside a CRLF pair',
   rows.filter(([, s]) => s.cr > 0).map(([f, s]) => `${f} (${s.cr})`), []);

// ---- 2. each file keeps its own style -------------------------------------
{
  const wrongCrlf = [], wrongLf = [];
  for (const [f, s] of rows) {
    if (CRLF_FILES.has(f)) {
      // A CRLF file may not gain bare LFs - index.html's 31 are checked below.
      if (f !== 'index.html' && s.lf > 0) wrongCrlf.push(`${f} (${s.lf} bare LF)`);
    } else if (s.crlf > 0) {
      wrongLf.push(`${f} (${s.crlf} CRLF)`);
    }
  }
  eq('no CRLF file has picked up a bare LF', wrongCrlf, []);
  eq('no LF file has picked up a CRLF', wrongLf, []);
}

// ---- 3. and the CRLF files are still CRLF ---------------------------------
// Style, not count: adding content legitimately changes how many lines a file
// has. What must not change is which ending they use. A CRLF file that has
// been flattened to LF reads as crlf === 0 here, which is the wholesale
// rewrite this is watching for.
for (const f of CRLF_FILES) {
  const s = rows.find(([n]) => n === f)?.[1];
  ck(s, `${f} is tracked`, 'missing from git ls-files');
  if (s) ck(s.crlf > 0, `${f} is still CRLF`, `${s.crlf} CRLF, ${s.lf} bare LF`);
}

// ---- 4. index.html's 31 ---------------------------------------------------
{
  const s = rows.find(([n]) => n === 'index.html')[1];
  eq(`index.html still has its ${INDEX_BARE_LF} bare LFs`, s.lf, INDEX_BARE_LF);
  ck(s.crlf > 5000, 'and the rest of it is CRLF', `${s.crlf} CRLF`);
}

// ---- 5. no file ends mid-line ---------------------------------------------
// Not a line-ending bug as such, but the same family: a script that writes a
// file without its final newline leaves a diff on the last line of every
// later change.
{
  const noNewline = tracked.filter((f) => {
    const b = fs.readFileSync(path.join(ROOT, f));
    return b.length > 0 && b[b.length - 1] !== 0x0a;
  });
  // Reported, not failed: a few generated and data files legitimately have no
  // trailing newline, and churning them is worse than the inconsistency.
  console.log(noNewline.length
    ? `note: ${noNewline.length} file(s) end without a newline: ${noNewline.slice(0, 6).join(', ')}`
    : 'note: every tracked text file ends with a newline');
}

for (const [ok, name, detail] of t) console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : '— ' + detail);
const bad = t.filter((x) => !x[0]).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
