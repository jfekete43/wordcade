/*
 * Code parked in SHELVED.md, checked from both ends.
 *
 * "Save the code, I'll bring it back eventually" only works if the saved
 * copy is still exact when that day comes. Git history technically has it,
 * but nobody goes looking through history for a button they half remember,
 * and a copy pasted into a markdown file rots silently - a stray edit, a
 * reflowed line, a smart quote - and is found to be broken only at the
 * moment someone needs it.
 *
 * So each entry is pinned twice: the app must NOT carry the code, and
 * SHELVED.md MUST carry it, character for character, in a form that can be
 * pasted straight back. One check without the other is half a promise.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);

const shelf = fs.readFileSync(REPO('SHELVED.md'), 'utf8');
// index.html is CRLF; the shelf is LF. Compare on normalised text, and check
// the real line endings separately (line-endings.test.mjs owns that).
const home = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');

ck(shelf.length > 500, 'SHELVED.md exists and has something in it', `${shelf.length} chars`);

/*
 * Every fenced block in the shelf, so an entry cannot be described in prose
 * while the code itself quietly goes missing.
 */
const blocks = [...shelf.matchAll(/```html\n([\s\S]*?)\n```/g)].map((m) => m[1]);
ck(blocks.length >= 1, 'it carries at least one block of code', `${blocks.length} blocks`);
for (const [i, b] of blocks.entries()) {
  ck(b.trim().length > 50, `block ${i + 1} is not an empty fence`, `${b.length} chars`);
}

// ---- 1. the Discord button -------------------------------------------------
{
  const INVITE = 'discord.gg/xBVDym8TF9';
  const BRAND = '#5865F2';

  // Out of the app. The invite URL is the thing that would actually send
  // someone somewhere, so it is what gets asked about.
  ck(!home.includes(INVITE), 'the app no longer links to the Discord invite',
     (home.match(/[^\n]*discord\.gg[^\n]*/) || [''])[0].trim());
  ck(!/<button[^>]*discord/i.test(home), 'and carries no Discord button');

  // Still on the shelf, whole. Not "mentions Discord" - the exact element,
  // with the invite and the icon, because a button without its path data is
  // not something you can paste back.
  const block = blocks.find((b) => b.includes(INVITE));
  ck(!!block, 'the shelf keeps the Discord button itself', blocks.length + ' blocks, none matching');
  if (block) {
    ck(block.includes(BRAND), "...with Discord's brand colour", BRAND);
    ck(/onclick="window\.open\('https:\/\/discord\.gg\/[^']+', '_blank', 'noopener'\)"/.test(block),
       '...and the handler it was wired with, noopener included');
    // The icon is ~700 characters of path data. A truncated copy renders as
    // an empty square and is the likeliest thing to be lost to a tidy-up.
    const d = (block.match(/ d="([^"]+)"/) || [])[1] || '';
    ck(d.length > 500, '...and the whole icon, not a truncated path', `${d.length} chars of path data`);
    ck(/viewBox="0 0 127\.14 96\.36"/.test(block), '...with the viewBox that path is drawn for');
    // Balanced, so what comes back out is a valid element rather than a
    // fragment that silently breaks the row it is pasted into.
    ck((block.match(/<button/g) || []).length === 1
       && (block.match(/<\/button>/g) || []).length === 1,
       '...as exactly one complete button', block.slice(0, 60));
  }

  // The row it came out of still holds the other two, in order. Removing one
  // button should not have disturbed its neighbours.
  const row = (home.match(/<div style="display: flex; justify-content: center; gap: 10px; margin-top: 15px;">[\s\S]*?<\/div>/) || [''])[0];
  ck(row.length > 200, 'found the social row the button came out of', `${row.length} chars`);
  ck((row.match(/<button/g) || []).length === 2,
     'it now holds two buttons, not three', `${(row.match(/<button/g) || []).length}`);
  ck(row.indexOf('x.com/playlexathon') < row.indexOf('ko-fi.com/lexathon')
     && row.includes('x.com/playlexathon') && row.includes('ko-fi.com/lexathon'),
     'X first, Ko-fi last, both untouched', row.replace(/\s+/g, ' ').slice(0, 90));

  // Restoring it must not then trip the literal-colour check, which is the
  // one thing that would make putting it back look like a new mistake.
  const docs = fs.readFileSync(REPO('tests/docs-consistency.test.mjs'), 'utf8');
  const allowed = (docs.match(/const ALLOWED = [^\n]+/) || [''])[0];
  ck(new RegExp(BRAND.slice(1), 'i').test(allowed),
     "Discord's blue stays in the allowed-literals list, so restoring is clean",
     allowed.slice(0, 80));

  // The digests are a different feature that happens to share the name. They
  // still run, and nothing here should have touched them.
  const fns = fs.readFileSync(REPO('functions/index.js'), 'utf8');
  ck(/DISCORD_SPRINT_WEBHOOK/.test(fns), 'the Discord digests are untouched and still posting');
  ck(/Discord digests/.test(fs.readFileSync(REPO('DEPLOY.md'), 'utf8')),
     'and DEPLOY.md still documents them');
}

// ---- 1b. the saved copy actually goes back in ------------------------------
{
  // The point of the whole file. Follow the restore steps literally - take
  // the block, give it CRLF, paste it before the Ko-fi button - and check
  // what comes out is the row as it was: three buttons, in order, balanced.
  // Verified once against the pre-removal file byte for byte; this keeps it
  // true as index.html moves on, without pinning a commit nobody will look
  // up.
  const block = blocks.find((b) => b.includes('discord.gg'));
  const raw = fs.readFileSync(REPO('index.html'), 'utf8');   // CRLF, as on disk
  const anchor = '                    <button class="btn-quiet" style="border-color: #FF5E5B';
  ck(raw.split(anchor).length === 2, 'the Ko-fi button is still where the steps say to paste before');
  if (block && raw.includes(anchor)) {
    const restored = raw.replace(anchor, block.replace(/\n/g, '\r\n') + '\r\n' + anchor);
    // No bare newline may survive the paste, or line-endings.test.mjs fails
    // on whoever restores it.
    const bare = (restored.match(/\n/g) || []).length - (restored.match(/\r\n/g) || []).length;
    const bareNow = (raw.match(/\n/g) || []).length - (raw.match(/\r\n/g) || []).length;
    ck(bare === bareNow, 'pasting it back adds no bare newlines', `${bareNow} -> ${bare}`);
    ck(!/\r\r/.test(restored), 'and no doubled carriage returns');

    const row = (restored.replace(/\r\n/g, '\n')
      .match(/<div style="display: flex; justify-content: center; gap: 10px; margin-top: 15px;">[\s\S]*?<\/div>/) || [''])[0];
    ck((row.match(/<button/g) || []).length === 3, 'the row comes back to three buttons',
       `${(row.match(/<button/g) || []).length}`);
    ck((row.match(/<button/g) || []).length === (row.match(/<\/button>/g) || []).length,
       'and every one of them is closed');
    const order = ['x.com/playlexathon', 'discord.gg', 'ko-fi.com/lexathon'].map((u) => row.indexOf(u));
    ck(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2],
       'back in the middle, where it was', JSON.stringify(order));
  }
}

// ---- 2. the shelf says how to put things back ------------------------------
{
  // An entry without restore steps is a snippet in a drawer. These are the
  // two that are not obvious from the code: where it goes, and that the file
  // it goes into is CRLF.
  ck(/## Discord button/.test(shelf), 'the entry is headed by what it is');
  ck(/Restoring it/i.test(shelf), 'and says how to put it back');
  ck(/CRLF/.test(shelf), '...including the line-ending trap in index.html');
  ck(/index\.html/.test(shelf), '...and which file it belongs to');
}

for (const [ok, name, detail] of t) console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : '— ' + detail);
const bad = t.filter((x) => !x[0]).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
