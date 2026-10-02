/*
 * Shop ordering.
 *
 * SHOP_ITEMS is written in the order items were designed, so every late
 * addition landed out of price order in the grid — four of them had, by the
 * time this was noticed. renderShop sorts a copy by cost instead, so a new
 * item can never be in the wrong slot again.
 *
 * Two things worth pinning: that the sort actually produces ascending prices
 * for every category, and that it does NOT reorder SHOP_ITEMS itself, which is
 * looked up by id from several other places.
 *
 * Pure; no emulator needed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const catalogueSrc = html.match(/        const SHOP_ITEMS = \{[\s\S]*?\n            \};/)[0];
// The whole statement out of renderShop that builds the list - filter, price
// sort, and the lift that puts a live holiday item on top. It used to be one
// line and this matched to end-of-line; when a filter and a second sort were
// chained onto it the match silently shrank to the bare spread, so this suite
// went on asserting ascending prices against an UNSORTED copy. It failed
// loudly, which is the only reason it was caught - but the shape of the bug
// (a regex that still matches something, just less of it) is worth naming.
const sortSrc = (() => {
  const a = html.indexOf('const items = [...SHOP_ITEMS[category]]');
  if (a < 0) throw new Error('could not find the renderShop list builder');
  // To the end of the statement, which now spans several chained calls.
  const end = html.indexOf(';', html.indexOf('.sort((a, b) => (liveSeasonal', a));
  return html.slice(a, end + 1);
})();
// renderShop closes over these; the test supplies its own so the extracted
// statement runs standalone.
const sortPreamble = `
  const owned = (id) => (inventory || []).includes(id);
  const itemAvailable = (i) => !i.seasonal || !!(liveIds || []).includes(i.seasonal.season);
  const liveSeasonal = (i) => !!i.seasonal && itemAvailable(i);
`;
console.log('extracted from index.html:', catalogueSrc.length + sortSrc.length, 'chars');

const SHOP_ITEMS = new Function(catalogueSrc.replace('const SHOP_ITEMS', 'const S') + ' return S;')();

// The server keeps its OWN copy, and purchaseItem charges from that one
// (functions/index.js: wallet: FieldValue.increment(-item.cost)). Nothing tied
// the two together, so a price changed in one file and not the other would show
// the player one number and take another — silently, and in the shop's favour
// or theirs depending on which way it drifted.
const fnSrc = fs.readFileSync(REPO('functions/index.js'), 'utf8').replace(/\r\n/g, '\n');
const serverSrc = fnSrc.match(/^const SHOP_ITEMS = \{[\s\S]*?\n\};/m)[0];
const SERVER_ITEMS = new Function(serverSrc.replace('const SHOP_ITEMS', 'const S') + ' return S;')();
// By default nothing is owned and no holiday is live, which is the state the
// grid is in for most of the year - and the one these price assertions are
// about.
const sortFor = new Function('SHOP_ITEMS', 'category', 'inventory', 'liveIds',
  `${sortPreamble}${sortSrc}\n return items;`);

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

const categories = Object.keys(SHOP_ITEMS);
ck(categories.length === 3, 'three shop categories', categories.join(','));

for (const cat of categories) {
  const sorted = sortFor(SHOP_ITEMS, cat);
  const costs = sorted.map((i) => i.cost);
  const firstDrop = costs.findIndex((c, i) => i > 0 && c < costs[i - 1]);
  ck(firstDrop === -1, `${cat}: every item is priced at least as high as the one above it`,
     firstDrop === -1 ? '' : `${sorted[firstDrop].name} (${costs[firstDrop]}) after ${costs[firstDrop - 1]}`);
  // It used to drop nothing. It now drops exactly one thing: a seasonal item
  // that is out of season and not owned, which is hidden rather than padlocked.
  // Stated as "nothing ELSE is dropped" so a filter that over-reaches fails.
  const kept = new Set(sorted.map((i) => i.id));
  const dropped = SHOP_ITEMS[cat].filter((i) => !kept.has(i.id));
  ck(dropped.every((i) => !!i.seasonal), `${cat}: nothing but a seasonal item is ever dropped`,
     dropped.filter((i) => !i.seasonal).map((i) => i.id).join(', '));
  ck(SHOP_ITEMS[cat].filter((i) => !i.seasonal).every((i) => kept.has(i.id)),
     `${cat}: every ordinary item survives the filter`,
     `${kept.size} kept of ${SHOP_ITEMS[cat].length}`);
  // And with the holiday live, the item comes back.
  for (const s of SHOP_ITEMS[cat].filter((i) => i.seasonal && i.seasonal.season)) {
    const live = sortFor(SHOP_ITEMS, cat, [], [s.seasonal.season]);
    ck(live.some((i) => i.id === s.id), `${cat}: ${s.id} reappears when its holiday is on`);
    ck(live[0].id === s.id, `${cat}: ...and goes straight to the top`, live[0].id);
  }
  ck(costs[0] === 0, `${cat}: the free default is first`, String(costs[0]));
  // The sort must not mutate the catalogue — it is looked up by id by
  // previewItem, the leaderboard's title lookup and the Cloud Function's copy.
  ck(SHOP_ITEMS[cat] !== sorted, `${cat}: sorts a copy, not SHOP_ITEMS itself`);
}

// Ties keep their declared order (Array.prototype.sort is stable), which is
// what keeps the two neon banners in the order they were designed. Found by id,
// not by price: this hardcoded 2,500 and broke the moment the shop was
// repriced, even though the tie it exists to check was still there.
const banners = sortFor(SHOP_ITEMS, 'banners');
const neon = ['banner_cyan', 'banner_magenta'];
const neonCosts = neon.map((id) => SHOP_ITEMS.banners.find((b) => b.id === id).cost);
ck(neonCosts[0] === neonCosts[1], 'the two neon banners are still the same price', JSON.stringify(neonCosts));
const tied = banners.filter((b) => b.cost === neonCosts[0]).map((b) => b.id);
ck(JSON.stringify(tied) === JSON.stringify(neon),
   'same-price items keep their declared order (stable sort)', JSON.stringify(tied));

// The four that were actually out of place before this, by name, so a
// regression names itself rather than just failing an ordering assertion.
const wereMisplaced = ['banner_frostbite', 'banner_titanium', 'effect_haunted', 'effect_permafrost'];
for (const id of wereMisplaced) {
  const cat = id.startsWith('banner') ? 'banners' : 'effects';
  // Two of these four are seasonal, and the grid now hides a seasonal item
  // that is out of season and unowned. Asked for as OWNED so the price-order
  // question can still be put to them: an owned item is listed but not lifted,
  // so it should sit at its own price exactly as it used to.
  const list = sortFor(SHOP_ITEMS, cat, [id]);
  const at = list.findIndex((i) => i.id === id);
  const okBefore = at === 0 || list[at - 1].cost <= list[at].cost;
  const okAfter = at === list.length - 1 || list[at + 1].cost >= list[at].cost;
  ck(at >= 0 && okBefore && okAfter, `${id} now sits in price order`, `index ${at}`);
}

// A brand-new expensive item dropped at the top of the literal must still end
// up last — the whole point of sorting at render.
const withNewbie = { banners: [{ id: 'x_new', name: 'New', cost: 999999 }, ...SHOP_ITEMS.banners] };
const after = sortFor(withNewbie, 'banners');
ck(after[after.length - 1].id === 'x_new', 'a costly item appended anywhere still sorts to the end', after[after.length - 1].id);

// --- the two catalogues must be the same catalogue -----------------------
const clientAll = Object.entries(SHOP_ITEMS).flatMap(([c, xs]) => xs.map((i) => [c, i]));
const serverAll = Object.entries(SERVER_ITEMS).flatMap(([c, xs]) => xs.map((i) => [c, i]));
ck(Object.keys(SHOP_ITEMS).sort().join() === Object.keys(SERVER_ITEMS).sort().join(),
   'both catalogues have the same categories',
   Object.keys(SHOP_ITEMS).join() + ' vs ' + Object.keys(SERVER_ITEMS).join());
ck(clientAll.length === serverAll.length, 'and the same number of items',
   `client ${clientAll.length}, server ${serverAll.length}`);

const serverById = new Map(serverAll.map(([c, i]) => [i.id, { cat: c, cost: i.cost }]));
const missing = clientAll.filter(([, i]) => !serverById.has(i.id)).map(([, i]) => i.id);
ck(missing.length === 0, 'every item the shop shows exists on the server', missing.join(', '));
const orphan = serverAll.filter(([, i]) => !clientAll.some(([, j]) => j.id === i.id)).map(([, i]) => i.id);
ck(orphan.length === 0, 'and the server sells nothing the shop does not show', orphan.join(', '));

// The one that actually takes money.
const wrongPrice = clientAll.filter(([, i]) => serverById.has(i.id) && serverById.get(i.id).cost !== i.cost)
  .map(([, i]) => `${i.id}: shows ${i.cost}, charges ${serverById.get(i.id).cost}`);
ck(wrongPrice.length === 0, 'and charges exactly the price it displays', wrongPrice.join(' | '));
const wrongCat = clientAll.filter(([c, i]) => serverById.has(i.id) && serverById.get(i.id).cat !== c)
  .map(([c, i]) => `${i.id}: ${c} vs ${serverById.get(i.id).cat}`);
ck(wrongCat.length === 0, 'in the same category on both sides', wrongCat.join(' | '));

// --- every cosmetic the shop sells must be renderable --------------------
// An id with no CSS class buys a cosmetic that looks like nothing at all.
// The selector may carry a pseudo-element or be part of a group — banner_matrix
// paints itself entirely through `.banner_matrix::after`, so requiring a bare
// `.id {` reported it as unstyled when it is anything but.
const styled = clientAll.filter(([cat, i]) => cat !== 'titles' && i.cost > 0)
  .filter(([, i]) => !new RegExp(`\\.${i.id}\\b[^{;]*\\{`).test(html))
  .map(([, i]) => i.id);
ck(styled.length === 0, 'every paid banner and effect has a CSS class', styled.join(', '));

// --- the prices themselves ------------------------------------------------
ck(clientAll.every(([, i]) => Number.isInteger(i.cost) && i.cost >= 0), 'every price is a non-negative integer');
// Round numbers only: the repricing pass rounds to a grid, and a stray 15,250
// means something bypassed it.
const ugly = clientAll.filter(([, i]) => i.cost > 0 && i.cost % 50 !== 0).map(([, i]) => `${i.id}=${i.cost}`);
ck(ugly.length === 0, 'and lands on a round number', ugly.join(', '));
ck(new Set(clientAll.map(([, i]) => i.id)).size === clientAll.length, 'no duplicate item ids');

// --- every animated cosmetic must honour reduce-motion -------------------
// The site has a body.reduce-motion opt-out and most cosmetics were in it, but
// nothing enforced that — so the four marble banners added in the previous
// change animated straight through it, and nobody would have found out except
// a player who needs that setting.
const reduceMotion = new Set([...html.matchAll(/body\.reduce-motion \.([a-z0-9_]+)/g)].map((m) => m[1]));
const animated = new Set();
for (const m of html.matchAll(/\.((?:banner|effect)_[a-z0-9]+)(?:::[a-z-]+)?\s*\{([^}]*)\}/g)) {
  if (/animation:/.test(m[2])) animated.add(m[1]);
}
ck(animated.size > 20, 'found the animated cosmetics', String(animated.size));
const unmuted = [...animated].filter((a) => !reduceMotion.has(a));
ck(unmuted.length === 0, 'every animated cosmetic is in the reduce-motion opt-out', unmuted.join(', '));
// And the opt-out must not list classes that no longer exist, or it reads as
// covering more than it does.
const stale = [...reduceMotion].filter((c) => /^(banner|effect)_/.test(c) && !new RegExp(`\\.${c}\\b[^{;]*\\{`).test(html));
ck(stale.length === 0, 'and lists nothing that no longer exists', stale.join(', '));

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
