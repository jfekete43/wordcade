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
// The one line out of renderShop that does the ordering.
const sortSrc = html.match(/^ +const items = \[\.\.\.SHOP_ITEMS\[category\]\][^\n]*$/m)[0];
console.log('extracted from index.html:', catalogueSrc.length + sortSrc.length, 'chars');

const SHOP_ITEMS = new Function(catalogueSrc.replace('const SHOP_ITEMS', 'const S') + ' return S;')();
const sortFor = new Function('SHOP_ITEMS', 'category', `${sortSrc}\n return items;`);

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
  ck(sorted.length === SHOP_ITEMS[cat].length, `${cat}: sorting drops nothing`, `${sorted.length} vs ${SHOP_ITEMS[cat].length}`);
  ck(costs[0] === 0, `${cat}: the free default is first`, String(costs[0]));
  // The sort must not mutate the catalogue — it is looked up by id by
  // previewItem, the leaderboard's title lookup and the Cloud Function's copy.
  ck(SHOP_ITEMS[cat] !== sorted, `${cat}: sorts a copy, not SHOP_ITEMS itself`);
}

// Ties keep their declared order (Array.prototype.sort is stable), which is
// what keeps the two 2,500 neon banners in the order they were designed.
const banners = sortFor(SHOP_ITEMS, 'banners');
const tied = banners.filter((b) => b.cost === 2500).map((b) => b.id);
ck(JSON.stringify(tied) === JSON.stringify(['banner_cyan', 'banner_magenta']),
   'same-price items keep their declared order (stable sort)', JSON.stringify(tied));

// The four that were actually out of place before this, by name, so a
// regression names itself rather than just failing an ordering assertion.
const wereMisplaced = ['banner_frostbite', 'banner_titanium', 'effect_haunted', 'effect_permafrost'];
for (const id of wereMisplaced) {
  const cat = id.startsWith('banner') ? 'banners' : 'effects';
  const list = sortFor(SHOP_ITEMS, cat);
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

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
