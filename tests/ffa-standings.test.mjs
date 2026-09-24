/*
 * The FFA in-match standings list.
 *
 * Two things have to hold and neither is obvious from reading the markup:
 *
 *   1. The order players watch during the match is the order they are paid
 *      out on. Placement is decided server-side by computeFfaPlacements, and
 *      the end-of-match screen used to re-derive that order with its own
 *      copy of the sort. A live list is a third copy, and three copies of a
 *      tie-and-leaver rule do not stay in agreement. ffaStandings is now the
 *      only one on the client; these cases pin it against the server's.
 *
 *   2. Reordering must not disturb the rows. They carry live cosmetic
 *      classes and ids, so the list reorders through flex `order` on fixed
 *      DOM rather than by moving nodes; that only works if every visible row
 *      gets an order and every empty slot is hidden.
 *
 * Both the helper and the render block are extracted from index.html and run
 * for real against a DOM, so a rename in either one fails here.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };

const standingsSrc = grab(/        function ffaStandings\(data\) \{\n[\s\S]*?\n        \}/);
const renderSrc = grab(/                    const standings = ffaStandings\(data\);\n[\s\S]*?\n                    \}\n/);
const safeCosmeticSrc = grab(/        function safeCosmetic\(value, fallback\) \{\n[\s\S]*?\n        \}/);
console.log('extracted from index.html:', standingsSrc.length + renderSrc.length, 'chars');

const body = html.match(/<body>([\s\S]*?)<script src="words\.js">/)[1];
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { const { execSync } = await import('node:child_process');
  ({ chromium } = await import(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs'))); }
const launch = {};
if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(launch);
const page = await browser.newPage();
await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}
#ffa-track-container { display: block !important; }
</style></head><body>${body}</body></html>`);

await page.addScriptTag({ content: `
${safeCosmeticSrc}
${standingsSrc}
const CLASH_SKIPS_PER_MATCH = 2;
let myFfaSlot = 0;
window.__standings = ffaStandings;
window.__render = function(data, mySlot) {
  myFfaSlot = mySlot;
${renderSrc}
};
` });

const t = [];
const ok = (name, cond, detail = '') => { t.push({ name, cond, detail }); };

// What the DOM actually shows, top to bottom, after a render.
const visible = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#ffa-players-list .ffa-row')]
    .filter(r => r.style.display !== 'none')
    .sort((a, b) => Number(a.style.order) - Number(b.style.order));
  return rows.map(r => ({
    id: r.id,
    order: r.style.order,
    rank: r.querySelector('.ffa-rank').innerText,
    name: r.querySelector('.lb-name').innerText,
    word: r.children[2].innerText,
    skips: r.children[3].innerText,
    score: r.querySelector('.ffa-row-score').innerText,
    cls: r.className,
  }));
});
const hidden = () => page.evaluate(() =>
  [...document.querySelectorAll('#ffa-players-list .ffa-row')].filter(r => r.style.display === 'none').map(r => r.id));

const match = (over = {}) => Object.assign({
  p0Uid: 'u0', p0Name: 'SLIZZY',   p0Score: 300, p0WordIndex: 4, p0Skips: 1, p0Equipped: { banner: 'banner_cyan', effect: 'effect_none' },
  p1Uid: 'u1', p1Name: 'G_Angle',  p1Score: 900, p1WordIndex: 7, p1Skips: 2,
  p2Uid: 'u2', p2Name: 'MOSSY',    p2Score: 550, p2WordIndex: 5, p2Skips: 0,
  p3Uid: null,
  leftPlayers: [],
}, over);

// --- 1. leader on top, my row flagged, empty slot hidden -------------------
await page.evaluate((d) => window.__render(d, 0), match());
let rows = await visible();
ok('leader is first', rows[0].name === 'G_Angle', rows.map(r => r.name).join(' > '));
ok('order runs 0,1,2 with no gaps', rows.map(r => r.order).join(',') === '0,1,2', rows.map(r => r.order).join(','));
ok('ranks read 1,2,3', rows.map(r => r.rank).join(',') === '1,2,3', rows.map(r => r.rank).join(','));
ok('leader row is marked', rows[0].cls.includes('ffa-row-leader'), rows[0].cls);
ok('only the leader is marked', rows.filter(r => r.cls.includes('ffa-row-leader')).length === 1);
ok('my row is highlighted', rows.find(r => r.id === 'ffa-row-0').cls.includes('ffa-me'));
ok('only my row is highlighted', rows.filter(r => r.cls.includes('ffa-me')).length === 1);
ok('empty slot 3 is hidden', (await hidden()).join(',') === 'ffa-row-3', (await hidden()).join(','));
ok('my banner cosmetic survives', rows.find(r => r.id === 'ffa-row-0').cls.includes('banner_cyan'),
   rows.find(r => r.id === 'ffa-row-0').cls);
ok('word column reads the doc', rows.map(r => r.word).join(',') === '7,5,4', rows.map(r => r.word).join(','));
ok('skips column reads the doc', rows.map(r => r.skips).join(',') === '2,0,1', rows.map(r => r.skips).join(','));
ok('spent-out skips are flagged', await page.evaluate(() =>
  document.getElementById('ffa-skips-2').className.includes('ffa-col-empty')));
ok('remaining skips are not flagged', await page.evaluate(() =>
  !document.getElementById('ffa-skips-1').className.includes('ffa-col-empty')));

// --- 2. the list flips when the lead changes -------------------------------
const before = await page.evaluate(() => document.getElementById('ffa-row-0').isConnected
  && [...document.getElementById('ffa-players-list').children].map(c => c.id).join(','));
await page.evaluate((d) => window.__render(d, 0), match({ p0Score: 1200 }));
rows = await visible();
const after = await page.evaluate(() => [...document.getElementById('ffa-players-list').children].map(c => c.id).join(','));
ok('I am now on top', rows[0].id === 'ffa-row-0', rows.map(r => r.name).join(' > '));
ok('reorder moved no DOM nodes', before === after, `${before} -> ${after}`);
ok('old leader dropped to 2nd', rows[1].name === 'G_Angle' && rows[1].rank === '2');

// --- 3. a leaver sinks below every active player, however high their score --
await page.evaluate((d) => window.__render(d, 0), match({ p1Score: 9999, leftPlayers: ['u1'] }));
rows = await visible();
ok('leaver is last despite the top score', rows[2].name.startsWith('G_Angle'), rows.map(r => r.name).join(' > '));
ok('leaver is labelled', rows[2].name.includes('(left)'), rows[2].name);
ok('leaver row is dimmed', rows[2].cls.includes('ffa-row-left'), rows[2].cls);
ok('leaver never counts as leader', !rows[2].cls.includes('ffa-row-leader'));
ok('top active player leads', rows[0].name === 'MOSSY' && rows[0].cls.includes('ffa-row-leader'), rows[0].name);

// --- 4. tied active players share a place ----------------------------------
await page.evaluate((d) => window.__render(d, 0), match({ p0Score: 500, p1Score: 500, p2Score: 100 }));
rows = await visible();
ok('a score tie shares 1st', rows[0].rank === '1' && rows[1].rank === '1', rows.map(r => r.rank).join(','));
ok('the next player is 3rd, not 2nd', rows[2].rank === '3', rows.map(r => r.rank).join(','));
ok('both tied rows are leaders', rows.filter(r => r.cls.includes('ffa-row-leader')).length === 2);

// --- 5. two leavers keep strict leave order, no shared place ---------------
// u1 left first, so u1 takes the WORST place of the two.
await page.evaluate((d) => window.__render(d, 0), match({
  p3Uid: 'u3', p3Name: 'DRIFT', p3Score: 500, p3WordIndex: 1, p3Skips: 2,
  p1Score: 500, leftPlayers: ['u1', 'u3'],
}));
rows = await visible();
ok('all four slots are shown', rows.length === 4, String(rows.length));
ok('worst place goes to whoever left first', rows[2].name.startsWith('DRIFT') && rows[3].name.startsWith('G_Angle'),
   rows.map(r => r.name).join(' > '));
ok('tied leavers do NOT share a place', rows[2].rank !== rows[3].rank, `${rows[2].rank},${rows[3].rank}`);

// --- 6. a match doc from before pNSkips existed ----------------------------
const legacy = match();
delete legacy.p0Skips; delete legacy.p1Skips; delete legacy.p2Skips;
await page.evaluate((d) => window.__render(d, 0), legacy);
rows = await visible();
ok('a missing skips field reads as full, not zero', rows.every(r => r.skips === '2'), rows.map(r => r.skips).join(','));
ok('and is not flagged as spent', await page.evaluate(() =>
  !document.getElementById('ffa-skips-0').className.includes('ffa-col-empty')));

// --- 7. the list never renders markup from a name --------------------------
await page.evaluate((d) => window.__render(d, 0), match({ p1Name: '<img src=x onerror=alert(1)>' }));
ok('a name is text, never markup', await page.evaluate(() =>
  document.getElementById('ffa-name-1').children.length === 0
  && document.getElementById('ffa-name-1').textContent.includes('<img')));

await browser.close();

let failed = 0;
for (const c of t) { if (!c.cond) failed++; console.log(`${c.cond ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '   [' + c.detail + ']' : ''}`); }
console.log(`\n${t.length - failed}/${t.length} passed`);
process.exit(failed ? 1 : 0);
