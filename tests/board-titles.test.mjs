/*
 * The equipped title, on every board a name appears on.
 *
 * It was on exactly one: the Hall of Fame renderer did its own SHOP_ITEMS
 * lookup, and the five other boards never got one. Three of them — the home
 * card's three tabs, Sprint's standings and Marathon's — had each hand-copied
 * the same row markup, which is how a field can go missing from all of them
 * at once and from none of them visibly.
 *
 * So there is now one row builder and one title lookup, and this runs them:
 * the shipped dailyBoardRow and titleText, over the real SHOP_ITEMS table.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(got === want, name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// Forward-only slice. `src.slice(indexOf(a), indexOf(b))` returns "" whenever
// b happens to sit earlier in the file than a, and every negative assertion
// about the result then passes on an empty string — which has quietly hidden
// four real failures in this repo.
const between = (from, to) => {
  const a = html.indexOf(from);
  if (a < 0) throw new Error(`no start anchor: ${from}`);
  const b = html.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`end anchor is not after the start: ${to}`);
  return html.slice(a, b);
};

// ---- the shipped code, lifted and run -------------------------------------
const src = [
  grab(/        function escapeHtml\(str\) \{\n[\s\S]*?\n        \}/),
  grab(/        function safeCosmetic\(value, fallback\) \{\n[\s\S]*?\n        \}/),
  // The real table. A stub would prove the lookup works against ids the game
  // does not sell. Its closing brace is indented 12 — the body is nested.
  grab(/        const SHOP_ITEMS = \{\n[\s\S]*?\n            \};/),
  grab(/        function titleText\(equipped\) \{\n[\s\S]*?\n        \}/),
  grab(/        function boardScore\(n\) \{[^\n]*\}/),
  grab(/        function boardDate\(ts\) \{\n[\s\S]*?\n        \}/),
  grab(/        function dailyBoardRow\(place, name, equipped, scoreCell, note\) \{\n[\s\S]*?\n        \}/),
].join('\n\n');
const lift = new Function(`${src}\nreturn { titleText, boardScore, boardDate, dailyBoardRow, SHOP_ITEMS };`)();
const { titleText, boardScore, boardDate, dailyBoardRow, SHOP_ITEMS } = lift;

// ---- titleText -------------------------------------------------------------
{
  // Picked out of the table rather than written in: a renamed title changes
  // what this expects, instead of failing a test that disagreed with the shop.
  const sold = SHOP_ITEMS.titles.find((x) => x.display);
  eq('a sold title resolves to its display text', titleText({ title: sold.id }), sold.display);
  ck(sold.display.length > 0, 'and that text is not empty', JSON.stringify(sold));

  const none = SHOP_ITEMS.titles.find((x) => !x.display);
  ck(none, 'the shop has a no-title option', JSON.stringify(SHOP_ITEMS.titles.map((x) => x.id)));
  eq('"No Title" is empty text, not the word None', titleText({ title: none.id }), '');

  eq('an id the shop never sold is nothing', titleText({ title: 'title_hacked' }), '');
  eq('and so is markup posing as one', titleText({ title: '<script>alert(1)</script>' }), '');
  eq('a profile with no equipped map at all', titleText(undefined), '');
  eq('...or an empty one', titleText({}), '');
  eq('...or a null title', titleText({ title: null }), '');
  // The whole reason the lookup is a lookup: a title can never be a string
  // somebody else chose, so it can never be markup however it got stored.
  ck(SHOP_ITEMS.titles.every((x) => !/[<>&"]/.test(x.display || '')),
     'no title in the shop contains a character that would need escaping');
}

// ---- the row ---------------------------------------------------------------
const titled = SHOP_ITEMS.titles.find((x) => x.display);
const rowOf = (name, equipped, cell = boardScore(1234567)) => dailyBoardRow(3, name, equipped, cell);

{
  const r = rowOf('SODA', { title: titled.id, banner: 'banner_default', effect: 'effect_none' });
  ck(r.includes(titled.display), 'the row shows the equipped title', r);
  ck(/class="daily-board-title"/.test(r), '...in its own element', r);
  const at = (s) => r.indexOf(s);
  ck(at('daily-board-place') < at('daily-board-name'), 'place, then name', r);
  ck(at('daily-board-name') < at('daily-board-title'), 'then the title under it', r);
  ck(at('daily-board-title') < at('daily-board-score'), 'and the score last', r);
  ck(at('daily-board-col') < at('daily-board-name') && at('daily-board-col') < at('daily-board-title'),
     'name and title share one stacked column, which is what puts one under the other', r);
  ck(r.includes('1,234,567'), 'the score cell is passed through verbatim', r);
}

{
  // Omitted, not emptied. An empty element still takes its own margin, so a
  // blank title line would make all ten rows taller for no one.
  for (const [label, equipped] of [
    ['no equipped map', undefined],
    ['an empty map', {}],
    ['"No Title" equipped', { title: SHOP_ITEMS.titles.find((x) => !x.display).id }],
    ['a tampered id', { title: 'title_hacked' }],
  ]) {
    const r = rowOf('SODA', equipped);
    ck(!/daily-board-title/.test(r), `${label}: no title element at all`, r);
    ck(/daily-board-name/.test(r) && r.includes('SODA'), `${label}: the name still renders`, r);
  }
}

{
  // Hostile input. A home-board row is built from a /users doc and a Sprint or
  // Marathon row from the same, but `username` is player-chosen either way.
  const r = rowOf('<img src=x onerror=alert(1)>', { banner: 'banner_default" onload="alert(1)', effect: 'effect_none' });
  ck(r.includes('&lt;img') && !r.includes('<img'), 'markup in a handle renders as escaped text', r);
  ck(!/<(?!\/?span\b)(?!\/?div\b)/.test(r), 'no tag but the row div and its spans is emitted', r);
  ck(!r.includes('onload'), 'a tampered banner id is rejected rather than placed in class=""', r);
  ck(/class="daily-board-row banner_default"/.test(r), '...falling back to the default banner', r);
  eq('a missing name falls back', /daily-board-name [^"]*">([^<]*)</.exec(rowOf(undefined, {}))[1], 'Player');
}

{
  eq('a negative score clamps to zero', boardScore(-50), '0');
  eq('and a missing one too', boardScore(undefined), '0');
  eq('scores are thousands-separated', boardScore(1234567), '1,234,567');
}

// ---- the date stamp -------------------------------------------------------
// On an all-time board, WHEN is half the claim: a 128,400 from last October
// and one from this morning are not the same thing. The ten-row card had the
// score and not the date; the Hall of Fame tab it expands into had both.
{
  const stamp = (iso) => boardDate({ toDate: () => new Date(iso) });
  const got = stamp('2026-10-02T12:00:00Z');
  ck(got.length > 0, 'a Firestore timestamp becomes a date', got);
  ck(got === new Date('2026-10-02T12:00:00Z').toLocaleDateString(),
     '...in the viewer\'s own locale, like every other date in the game', got);

  // A document written by an older client, or read back before the server
  // timestamp settles, hands you something that is not a Timestamp. Lose the
  // stamp, not the row.
  for (const [label, value] of [
    ['nothing at all', undefined],
    ['null', null],
    ['a plain string', '2026-10-02'],
    ['a number', 1760000000],
    ['an object with no toDate', { seconds: 1760000000 }],
    ['a toDate that returns rubbish', { toDate: () => 'tuesday' }],
    ['a toDate that returns an invalid Date', { toDate: () => new Date('nope') }],
  ]) {
    eq(`${label}: no stamp rather than a crash`, boardDate(value), '');
  }
}

{
  const WHEN = '10/2/2026';
  const withBoth = dailyBoardRow(1, 'SODA', { title: titled.id }, '100', WHEN);
  ck(withBoth.includes(titled.display) && withBoth.includes(WHEN),
     'a row carries the title and the date together', withBoth);
  ck(withBoth.indexOf(titled.display) < withBoth.indexOf(WHEN),
     '...title first, date second, as the Hall of Fame has them', withBoth);
  ck(/-\s*<span style="font-weight:normal;">/.test(withBoth),
     '...separated by a dash, with the date the lighter of the two', withBoth);
  eq('one sub-line, not two', (withBoth.match(/daily-board-title/g) || []).length, 1);

  const dateOnly = dailyBoardRow(1, 'SODA', {}, '100', WHEN);
  ck(dateOnly.includes(WHEN) && /daily-board-title/.test(dateOnly),
     'a player with no title still gets the stamp', dateOnly);
  ck(!dateOnly.includes(' - '), '...with no dash hanging off the front of it', dateOnly);

  const titleOnly = dailyBoardRow(1, 'SODA', { title: titled.id }, '100', '');
  ck(!titleOnly.includes(' - '), 'and no dash hanging off the end when there is no date', titleOnly);

  const neither = dailyBoardRow(1, 'SODA', {}, '100', '');
  ck(!/daily-board-title/.test(neither), 'neither means no sub-line at all', neither);

  // The note reaches innerHTML, so it is escaped like everything else even
  // though today it is only ever a formatted date.
  const hostile = dailyBoardRow(1, 'SODA', {}, '100', '<img src=x onerror=alert(1)>');
  ck(hostile.includes('&lt;img') && !hostile.includes('<img'), 'a note is escaped', hostile);
}

// Which boards carry a stamp is a property of the table, not of the renderer.
{
  const tbl = between('const HOME_BOARDS = {', '\n        };');
  const boards = new Function(`${tbl}\n};\nreturn HOME_BOARDS;`)();
  eq('the all-time board stamps rows with the run that set them',
     boards.all.tsField, 'bestRunAt');
  eq('this week needs no stamp: every row on it is from this week',
     boards.weekly.tsField, null);
  eq('nor does a single day, whose heading already names it',
     boards.daily.tsField, null);
  // Named on every board, so a new one has to decide rather than inherit.
  ck(Object.values(boards).every((b) => 'tsField' in b),
     'and every board says which it is', JSON.stringify(Object.keys(boards)));
}

// ---- every board goes through it ------------------------------------------
// The claim this file exists to defend. Derived from the source rather than
// listed here: a board added later that hand-rolls the markup again fails
// this, which is exactly when somebody needs telling.
{
  const built = (html.match(/class="daily-board-row /g) || []).length;
  eq('the ten-row markup is built in exactly one place', built, 1);

  const callers = {
    'the home card (Today / Weekly / All-Time)': between('function renderDailyBoardRows(rows, emptyText)', '\n        }'),
    "Sprint's standings": between('async function loadSprintBoard()', 'window.leaveSprint = function'),
    "Marathon's standings": between('async function loadMarathonBoard()', 'window.leaveMarathon = function'),
  };
  for (const [what, body] of Object.entries(callers)) {
    ck(/dailyBoardRow\(/.test(body), `${what} draws its rows with the shared builder`, body.slice(0, 120));
  }

  // And the two renderers that build their own markup resolve the title the
  // same way, so there is one lookup in the client and not four.
  eq('titleText is the only SHOP_ITEMS.titles lookup in the client',
     (html.match(/SHOP_ITEMS\.titles\.find/g) || []).length, 1);
  for (const [what, body] of Object.entries({
    'the Hall of Fame': between('window.loadLeaderboardData = async function()', 'GAME LOGIC (STANDARD & VERSUS)'),
    'the Trifecta feed and both archives': between('function renderArchiveBoard(docs, listEl, emptyText, cfg)', '\n        }'),
  })) {
    ck(/titleText\(/.test(body), `${what} uses it too`, body.slice(0, 120));
  }

  // The same for the date: the ten-row card and the Hall of Fame tab it
  // expands into are one board at two depths, and a date formatted twice is
  // a date that eventually reads two ways.
  eq('boardDate is the only place a timestamp becomes text',
     (html.match(/\.toDate\(\)\.toLocaleDateString\(\)/g) || []).length, 0);
  for (const [what, body] of Object.entries({
    'the ten-row card': between('function renderDailyBoardRows(rows, emptyText)', '\n        }'),
    'the Hall of Fame': between('window.loadLeaderboardData = async function()', 'GAME LOGIC (STANDARD & VERSUS)'),
  })) {
    ck(/boardDate\(/.test(body), `${what} stamps its rows through boardDate`, body.slice(0, 160));
  }
}

// ---- the column can actually shrink ---------------------------------------
// A flex item will not go below its content width without min-width:0, and
// without that a long handle pushes the score off the right of a 390px phone
// instead of ellipsising. board-contrast.test.mjs renders this for real; this
// is just the rule being present at all.
{
  const col = between('.daily-board-col {', '}');
  ck(/min-width:\s*0/.test(col), 'the name column may shrink below its content', col);
  ck(/flex-direction:\s*column/.test(col), 'and stacks its two lines', col);
  const name = between('.daily-board-name {', '}');
  ck(/text-overflow:\s*ellipsis/.test(name), 'so a long handle ellipsises', name);
}

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
