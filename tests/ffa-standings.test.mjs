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
const visibleSrc = grab(/        function ffaVisibleRows\(standings, mySlot\) \{\n[\s\S]*?\n        \}/);
// Read the caps out of the source so raising them never silently leaves
// these cases testing a smaller game than the one that ships.
const MAX = Number(html.match(/const FFA_MAX_SLOTS = (\d+);/)[1]);
const VIS = Number(html.match(/const FFA_VISIBLE_ROWS = (\d+);/)[1]);
console.log(`caps read from index.html: ${MAX} slots, ${VIS} visible rows`);
// Runs from the first line of the render block through the end of the
// collapsed-rows note, so a case cannot pass by testing half of it.
const renderSrc = grab(/                    const standings = ffaStandings\(data\);\n[\s\S]*?String\(gap \? FFA_VISIBLE_ROWS : FFA_VISIBLE_ROWS - 1\);\n                    \}/);
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
const FFA_MAX_SLOTS = ${MAX};
const FFA_VISIBLE_ROWS = ${VIS};
${safeCosmeticSrc}
${standingsSrc}
${visibleSrc}
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
const moreNote = () => page.evaluate(() => {
  const el = document.getElementById('ffa-more-note');
  return { shown: el.style.display !== 'none', text: el.innerText, order: el.style.order };
});

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
ok('every empty slot is hidden', (await hidden()).join(',') === 'ffa-row-3,ffa-row-4,ffa-row-5', (await hidden()).join(','));
ok('no "+N more" note on a short field', !(await moreNote()).shown);
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

// --- 6b. a full field collapses to the visible rows -----------------------
// Six players, scores descending by slot, and I am in last place.
const full = (mine) => ({
  p0Uid:'u0', p0Name:'ALPHA', p0Score:600, p0WordIndex:9, p0Skips:0,
  p1Uid:'u1', p1Name:'BRAVO', p1Score:500, p1WordIndex:8, p1Skips:1,
  p2Uid:'u2', p2Name:'CHARLIE', p2Score:400, p2WordIndex:7, p2Skips:2,
  p3Uid:'u3', p3Name:'DELTA', p3Score:300, p3WordIndex:6, p3Skips:2,
  p4Uid:'u4', p4Name:'ECHO', p4Score:200, p4WordIndex:4, p4Skips:1,
  p5Uid:'u5', p5Name:'FOXTROT', p5Score:100, p5WordIndex:2, p5Skips:2,
  leftPlayers: [], __mine: mine,
});
await page.evaluate((d) => window.__render(d, 5), full(5));
rows = await visible();
ok('a six-player field draws only the visible rows', rows.length === VIS, String(rows.length));
ok('the top three are shown', rows.slice(0, 3).map(r => r.name).join(',') === 'ALPHA,BRAVO,CHARLIE',
   rows.map(r => r.name).join(','));
ok('my row is the tail when I am off the board', rows[VIS - 1].id === 'ffa-row-5', rows[VIS - 1].name);
ok('the tail keeps its REAL place number', rows[VIS - 1].rank === '6', rows.map(r => r.rank).join(','));
ok('place numbers skip rather than renumber', rows.map(r => r.rank).join(',') === '1,2,3,6',
   rows.map(r => r.rank).join(','));
let note = await moreNote();
ok('a "+N more" note appears', note.shown && note.text.toLowerCase() === '+2 more', note.text);
ok('the note sits between the top three and the tail',
   Number(note.order) === VIS - 1 && Number(rows[VIS - 1].order) === VIS,
   `note ${note.order}, tail ${rows[VIS - 1].order}`);
ok('the hidden players\' rows are actually hidden',
   (await hidden()).sort().join(',') === 'ffa-row-3,ffa-row-4', (await hidden()).sort().join(','));

// Leading: there is no point showing me twice, so the fourth row is 4th place.
await page.evaluate((d) => window.__render(d, 0), full(0));
rows = await visible();
ok('leading, the tail is 4th place rather than me again', rows[VIS - 1].name === 'DELTA',
   rows.map(r => r.name).join(','));
ok('leading, the ranks run 1,2,3,4', rows.map(r => r.rank).join(',') === '1,2,3,4',
   rows.map(r => r.rank).join(','));
ok('leading, my row is still marked', rows[0].cls.includes('ffa-me'), rows[0].cls);
// 1,2,3,4 is contiguous, so claiming a break between 3rd and 4th would be a
// lie about the standings — the omitted players are below, and so is the note.
note = await moreNote();
ok('leading, the note sits BELOW the last row, not in a fake gap',
   Number(note.order) === VIS && Number(rows[VIS - 1].order) === VIS - 1,
   `note ${note.order}, last row ${rows[VIS - 1].order}`);

// Exactly VIS players: everyone fits, nothing is elided.
const exact = full(0); delete exact.p4Uid; delete exact.p5Uid;
await page.evaluate((d) => window.__render(d, 0), exact);
rows = await visible();
ok('a field of exactly VIS shows everyone', rows.length === VIS, String(rows.length));
ok('and drops the note again', !(await moreNote()).shown);

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
