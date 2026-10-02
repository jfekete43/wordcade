/*
 * Seasonal shop items: when they are on sale, and where they sit in the grid.
 *
 * Three things, each of which fails quietly in its own way.
 *
 * WHEN. An item now names a holiday rather than a date pair, because two of the
 * eight move: Easter wanders between 22 March and 25 April, Thanksgiving is the
 * fourth Thursday of November. The dates are computed in index.html AND again
 * in functions/index.js, because the client copy is advisory and the server
 * copy is the one that refuses a purchase. Two copies of arithmetic is exactly
 * the thing that drifts, so both are run here and compared to each other.
 *
 * WHETHER IT IS SHOWN. Out of season and not owned, an item is gone from the
 * grid entirely. Owned, it stays, or you could not equip something you paid
 * for. That second case is the one worth pinning: it is invisible until a
 * player who bought last Halloween opens the shop in July.
 *
 * WHERE IT SITS. The grid is a price list, except a holiday item on sale right
 * now goes to the top. It is purchasable about a fortnight a year.
 *
 * Pure; no browser, no emulator.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8').replace(/\r\n/g, '\n');

const t = [];
const ck = (name, cond, detail = '') => t.push({ name, cond: !!cond, detail });

// ---- both implementations, lifted out of the files that ship them ---------
const clientSrc = (html.match(/        const Seasons = \(\(\) => \{[\s\S]*?\n        \}\)\(\);/) || [''])[0];
const Seasons = new Function(`${clientSrc}\nreturn Seasons;`)();
ck('extracted the client Seasons module', clientSrc.length > 1500, `${clientSrc.length} chars`);

const serverSrc = (() => {
  const a = fn.indexOf('const utcDay = (y, m, d)');
  const b = fn.indexOf('\n}', fn.indexOf('function isItemAvailable'));
  return a < 0 || b < 0 ? '' : fn.slice(a, b + 2);
})();
ck('extracted the server seasonal gate', serverSrc.includes('isSeasonActive') && serverSrc.includes('isItemAvailable'),
   `${serverSrc.length} chars`);
const server = new Function(`${serverSrc}\nreturn { isSeasonActive, isItemAvailable, easterFor, thanksgivingFor };`)();

const at = (s) => new Date(s + 'T12:00:00Z');
const ymd = (d) => d.toISOString().slice(0, 10);

// ---- the two copies of the arithmetic must not drift ----------------------
let easterDrift = [], tgDrift = [];
for (let y = 2024; y <= 2074; y++) {
  if (ymd(Seasons.easterFor(y)) !== ymd(server.easterFor(y))) easterDrift.push(y);
  if (ymd(Seasons.thanksgivingFor(y)) !== ymd(server.thanksgivingFor(y))) tgDrift.push(y);
}
ck('client and server agree on Easter for 50 years', easterDrift.length === 0, easterDrift.slice(0, 5).join(','));
ck('and on Thanksgiving', tgDrift.length === 0, tgDrift.slice(0, 5).join(','));

// Every day of a decade, every season: the client UI and the server gate must
// answer identically, or the shop offers something the purchase call refuses.
let gateDrift = [];
for (let d = new Date(Date.UTC(2026, 0, 1)); d < new Date(Date.UTC(2036, 0, 1)); d.setUTCDate(d.getUTCDate() + 1)) {
  for (const s of Seasons.TABLE) {
    const now = new Date(d);
    if (Seasons.isActive(s.id, now) !== server.isSeasonActive(s.id, now)) gateDrift.push(`${ymd(now)}:${s.id}`);
  }
}
ck('the shop UI and the purchase gate agree on every day of 2026-2035',
   gateDrift.length === 0, gateDrift.slice(0, 4).join(' | '));

// isActive is NOT current(): Easter outranks St Patrick's for the theme, but a
// St Patrick's item must still be on sale during its own window.
ck('a St Patrick’s item is on sale on 17 March even in a year Easter outranks the theme',
   Seasons.isActive('stpatricks', at('2027-03-17')) === true);
ck('...and the theme that day is still St Patrick’s', Seasons.current(at('2027-03-17')).id === 'stpatricks');
ck('...while on the overlap day the theme is Easter', Seasons.current(at('2027-03-18')).id === 'easter');
ck('...and BOTH items are on sale that day',
   Seasons.isActive('easter', at('2027-03-18')) && Seasons.isActive('stpatricks', at('2027-03-18')));

// ---- the catalogue --------------------------------------------------------
const catalogueSrc = html.match(/        const SHOP_ITEMS = \{[\s\S]*?\n            \};/)[0];
const SHOP_ITEMS = new Function(catalogueSrc.replace('const SHOP_ITEMS', 'const S') + ' return S;')();
const all = Object.entries(SHOP_ITEMS).flatMap(([cat, list]) => list.map((i) => ({ ...i, cat })));
const seasonalItems = all.filter((i) => i.seasonal);
ck('there are seasonal items in both banners and effects',
   new Set(seasonalItems.map((i) => i.cat)).size === 2, seasonalItems.map((i) => i.cat).join(','));
ck('every holiday with an item names a season the calendar knows',
   seasonalItems.filter((i) => i.seasonal.season).every((i) => Seasons.TABLE.some((s) => s.id === i.seasonal.season)),
   seasonalItems.map((i) => i.seasonal.season).join(','));
// A named-season item is the new shape; the two originals keep their MM-DD.
ck('the original two keep their fixed windows, so nothing silently changed under them',
   seasonalItems.filter((i) => i.seasonal.fromMonthDay).map((i) => i.id).sort().join(',') === 'banner_frostbite,effect_haunted');
ck('every seasonal item is reachable at some point in the year',
   seasonalItems.every((i) => {
     for (let d = new Date(Date.UTC(2026, 0, 1)); d < new Date(Date.UTC(2027, 0, 1)); d.setUTCDate(d.getUTCDate() + 1)) {
       if (i.seasonal.season ? Seasons.isActive(i.seasonal.season, new Date(d)) : true) return true;
     }
     return false;
   }));

// Seasonal items are priced alike, so the sort cannot be hiding a price quirk.
ck('all seasonal items share one price', new Set(seasonalItems.map((i) => i.cost)).size === 1,
   [...new Set(seasonalItems.map((i) => i.cost))].join(','));

// ---- the render rules, run rather than read ------------------------------
// The two lines that decide visibility and order, lifted verbatim.
// Sliced positionally rather than matched against the filter's own text: an
// anchored regex stops matching the moment the thing under test changes, so a
// broken filter would fail "could not extract" instead of failing a behaviour
// check, and the mutation would look caught for the wrong reason.
const filterSrc = (() => {
  const a = html.indexOf('const items = [...SHOP_ITEMS[category]]');
  if (a < 0) return '';
  const chainStart = html.indexOf('.filter(', a);
  const end = html.indexOf(';', html.indexOf('.sort(', html.indexOf('.sort(', chainStart) + 1));
  return chainStart < 0 || end < 0 ? '' : html.slice(chainStart, end + 1);
})();
ck('extracted the filter and sort from renderShop', filterSrc.includes('.filter(') && filterSrc.includes('.sort('),
   `${filterSrc.length} chars`);

// The two predicates come out of index.html as well. Defining them here
// instead meant a mutation to the real liveSeasonal changed nothing the test
// could see - it escaped the whole suite until this was fixed.
const gateSrc = (() => {
  const a = html.indexOf('const itemAvailable = (i) => !i.seasonal');
  const b = html.indexOf(';', html.indexOf('const liveSeasonal', a));
  return a < 0 || b < 0 ? '' : html.slice(a, b + 1);
})();
ck('extracted the availability predicates too', gateSrc.includes('itemAvailable') && gateSrc.includes('liveSeasonal'),
   `${gateSrc.length} chars`);

// Time is injected by binding Seasons to a fixed date rather than by editing
// the extracted code, so what runs here is byte-for-byte what ships.
const build = new Function('items', 'inventory', 'nowISO', 'realSeasons', `
  const now = new Date(nowISO);
  const Seasons = { isActive: (id) => realSeasons.isActive(id, now) };
  const isWithinSeasonalWindow = () => false;
  const owned = (id) => inventory.includes(id);
${gateSrc}
  return [...items]
${filterSrc};
`);

const sample = [
  { id: 'banner_cheap', cost: 100 },
  { id: 'banner_mid', cost: 2500 },
  { id: 'banner_dear', cost: 9000 },
  { id: 'banner_harvest', cost: 4600, seasonal: { season: 'thanksgiving' } },
  { id: 'banner_sweetheart', cost: 4600, seasonal: { season: 'valentines' } },
];
const ids = (rows) => rows.map((r) => r.id);

// In season: lifted to the top, out of price order.
const duringTg = build(sample, [], '2026-11-20T12:00:00Z', Seasons);
ck('a live holiday item is first, ahead of cheaper things',
   ids(duringTg)[0] === 'banner_harvest', ids(duringTg).join(','));
ck('and the rest stay in price order behind it',
   ids(duringTg).slice(1).join(',') === 'banner_cheap,banner_mid,banner_dear', ids(duringTg).join(','));
ck('an out-of-season item is not shown at all',
   !ids(duringTg).includes('banner_sweetheart'), ids(duringTg).join(','));

// Out of season and unowned: invisible.
const inJuly = build(sample, [], '2026-07-15T12:00:00Z', Seasons);
ck('in July neither holiday item appears',
   !ids(inJuly).includes('banner_harvest') && !ids(inJuly).includes('banner_sweetheart'), ids(inJuly).join(','));
ck('and the ordinary items are untouched, in price order',
   ids(inJuly).join(',') === 'banner_cheap,banner_mid,banner_dear', ids(inJuly).join(','));

// Owned: still listed out of season, or it could never be equipped again.
const ownedInJuly = build(sample, ['banner_harvest'], '2026-07-15T12:00:00Z', Seasons);
ck('something you already own stays visible out of season',
   ids(ownedInJuly).includes('banner_harvest'), ids(ownedInJuly).join(','));
ck('...but is NOT lifted to the top, because it is not on sale',
   ids(ownedInJuly)[0] === 'banner_cheap', ids(ownedInJuly).join(','));
ck('...and sits at its own price', ids(ownedInJuly).join(',') === 'banner_cheap,banner_mid,banner_harvest,banner_dear',
   ids(ownedInJuly).join(','));

// Two live at once (the Easter/St Patrick overlap) - both lift, both keep order.
const bothSample = [
  { id: 'banner_cheap', cost: 100 },
  { id: 'banner_sp', cost: 4600, seasonal: { season: 'stpatricks' } },
  { id: 'banner_ea', cost: 4600, seasonal: { season: 'easter' } },
];
const overlap = build(bothSample, [], '2027-03-18T12:00:00Z', Seasons);
ck('on the overlap day both holiday items are on sale and both lift',
   ids(overlap)[0] !== 'banner_cheap' && ids(overlap)[1] !== 'banner_cheap', ids(overlap).join(','));
ck('...with the ordinary item last', ids(overlap)[2] === 'banner_cheap', ids(overlap).join(','));

// ---- the markup the renderer emits ---------------------------------------
ck('a live seasonal row gets a class of its own', /rowClass \+= " seasonal-live"/.test(html));
ck('and that class is actually styled', /\.grid-item\.seasonal-live \{/.test(html));
ck('an owned out-of-season row says so rather than claiming unavailability',
   /Out Of Season/.test(html) && !/\u{1F512} Not Available/u.test(html));
ck('the client gate mirrors the server one by name',
   /isItemAvailable/.test(fn) && /const itemAvailable = \(i\) =>/.test(html));
ck('the server refuses a purchase through the shared gate',
   /if \(!isItemAvailable\(item\)\) \{/.test(fn));

// ---- client and server carry the same seasonal metadata ------------------
const serverItemsSrc = fn.match(/const SHOP_ITEMS = \{[\s\S]*?\n\};/)[0];
const SERVER_ITEMS = new Function(serverItemsSrc.replace('const SHOP_ITEMS', 'const S') + ' return S;')();
const serverAll = Object.values(SERVER_ITEMS).flat();
const mismatched = seasonalItems.filter((c) => {
  const srv = serverAll.find((x) => x.id === c.id);
  return !srv || JSON.stringify(srv.seasonal) !== JSON.stringify(c.seasonal);
});
ck('every seasonal item has the same window on the server', mismatched.length === 0,
   mismatched.map((i) => i.id).join(', '));
const serverOnlySeasonal = serverAll.filter((x) => x.seasonal && !seasonalItems.some((c) => c.id === x.id));
ck('and the server marks nothing seasonal that the shop does not', serverOnlySeasonal.length === 0,
   serverOnlySeasonal.map((i) => i.id).join(', '));

for (const c of t) console.log(c.cond ? 'ok  ' : 'FAIL', c.name, c.cond ? '' : '— ' + c.detail);
const bad = t.filter((c) => !c.cond).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
