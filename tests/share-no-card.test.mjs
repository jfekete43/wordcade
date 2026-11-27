/*
 * A shared score must not grow a preview card. A shared link to the game
 * must.
 *
 * Whether a card appears is a property of the PAGE a link points at, not of
 * the message it sits in, so the only way to have one share carry one and
 * another not is to point them at different pages. /play/ is that second
 * page: no og:, no twitter:, no description, and a script that moves a human
 * on to the game before they can read it.
 *
 * It replaced `preview: false`, which wrapped the link as <https://...> -
 * the convention Discord and Slack read as "do not unfurl". That worked in
 * those two clients and nowhere else; on X the brackets were just
 * punctuation around the link, which is what prompted dropping them.
 *
 * The second half is where a share lands. Sprint is the landing and what the
 * site leads with, so a Sprint score and a plain lexathon.gg link both want
 * the default and carry no parameter. A score from another mode carries ?m=,
 * because a twenty-word Marathon grid opening onto today's single Sprint
 * word shows the reader a different game from the one in the message.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const grab = (src, re) => { const m = src.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const page = fs.readFileSync(REPO('play/index.html'), 'utf8');

// ---- 1. the page carries nothing that could become a card ------------------
{
  // Comments explain why the tags are absent and name them while doing it,
  // so the check has to look at markup rather than at the file.
  const markup = page.replace(/<!--[\s\S]*?-->/g, '');
  ck(markup.length > 200, 'read play/index.html with its comments stripped', `${markup.length} chars`);

  for (const [what, re] of [
    ['og: tags', /<meta[^>]+property=["']og:/i],
    ['twitter: tags', /<meta[^>]+name=["']twitter:/i],
    ['description tags', /<meta[^>]+name=["']description/i],
    ['image tags', /<meta[^>]+(image|itemprop)/i],
  ]) {
    ck(!re.test(markup), `the card-less page has no ${what}`, (markup.match(re) || [''])[0]);
  }
  // The one that would be easiest to add back by reflex, since every other
  // page on the site has it.
  ck(!/og-card\.png/.test(markup), 'and does not reference the card image');

  // What it DOES carry.
  ck(/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(markup),
     'it is noindex, so a blank redirect page cannot be indexed', (markup.match(/<meta[^>]*robots[^>]*>/i) || [''])[0]);
  ck(/follow/i.test(grab(markup, /<meta[^>]*robots[^>]*>/i)),
     '...but follow, so the link out of it is still crawled');
  // noindex plus a canonical is a contradiction, and index.html already
  // claims the canonical this page would want. The SEO suite caught it.
  ck(!/rel=["']canonical/i.test(markup),
     'and no canonical, which would collide with index.html’s', (markup.match(/<link[^>]*canonical[^>]*>/i) || [''])[0]);
}

// ---- 2. a human gets moved on, a crawler does not --------------------------
{
  const markup = page.replace(/<!--[\s\S]*?-->/g, '');
  ck(/location\.replace\(/.test(markup), 'a person is redirected to the game');
  ck(!/location\.assign\(|location\.href\s*=/.test(markup),
     'with replace, so Back does not bounce through here again');
  // A meta refresh or a server redirect would be followed by the unfurler
  // too, landing it on index.html and handing the card straight back. The
  // redirect being script-only is the whole mechanism, not a shortcut.
  ck(!/http-equiv=["']refresh/i.test(markup),
     'and NOT by meta refresh, which an unfurler would follow to the card');

  // The query has to survive the hop or every share lands on Sprint.
  ck(/location\.replace\(\s*["']\/["']\s*\+\s*(window\.)?location\.search\s*\)/.test(markup),
     'the query string is carried across, which is what names the mode',
     (markup.match(/location\.replace\([^)]*\)/) || [''])[0]);

  // No-JS: the page is otherwise a dead end for anyone with scripts off.
  ck(/<a[^>]+href=["']\/["']/.test(markup), 'and there is a real link for anyone without scripts');
}

// ---- 3. nothing points a crawler at it -------------------------------------
{
  const sitemap = fs.readFileSync(REPO('sitemap.xml'), 'utf8');
  ck(!/\/play\//.test(sitemap), 'it is not in the sitemap', (sitemap.match(/[^\n]*play[^\n]*/) || [''])[0]);
  // Not linked from the site either - it exists only at the end of a shared
  // link. A nav link to it would be a redirect sitting in the middle of the
  // site for no reason.
  ck(!/href="\/play\//.test(html), 'and nothing on the site links to it');
}

// ---- 4. the share URLs -----------------------------------------------------
const SITE = /const SHARE_URL_SITE = "([^"]*)"/.exec(html)[1];
const SCORE = /const SHARE_URL_SCORE = "([^"]*)"/.exec(html)[1];
{
  eq('the site link is the bare domain', SITE, 'https://lexathon.gg');
  eq('and the card-less link is the /play/ directory', SCORE, 'https://lexathon.gg/play/');
  // Directory form: GitHub Pages serves play/index.html at /play/ and only
  // 301s to it from /play. One hop fewer for the crawler that has to reach
  // this page in order NOT to build a card from it.
  ck(SCORE.endsWith('/'), 'in the form that is served directly, without a redirect', SCORE);
}

// ---- 5. which mode a share opens -------------------------------------------
{
  // The real function, over the real mode table.
  const run = new Function(`
    ${grab(html, /        const MODES = \{\n[\s\S]*?\n        \};/)}
    ${grab(html, /        const SHARE_URL_SCORE = "[^"]*";/)}
    ${grab(html, /        function scoreShareUrl\(mode\) \{\n[\s\S]*?\n        \}/)}
    return { scoreShareUrl, MODES };
  `)();

  // Sprint is the landing and the mode the site leads with, so its share and
  // a plain link to the site both want the default: no parameter at all.
  eq('a Sprint score opens the landing, with nothing to say', run.scoreShareUrl('sprint'), SCORE);
  eq('and so does a share that names no mode', run.scoreShareUrl(''), SCORE);
  eq('and one that names nothing at all', run.scoreShareUrl(undefined), SCORE);

  // The modes that are not the landing have to say so.
  eq('a Marathon score opens Marathon', run.scoreShareUrl('marathon'), SCORE + '?m=marathon');
  eq('a Stakes score opens Stakes', run.scoreShareUrl('endless'), SCORE + '?m=endless');

  // A closed mode would be a link to somewhere nobody can go: goToMode
  // refuses a hidden mode, so the page would open and then sit there.
  ck(run.MODES.gauntlet.hidden, 'the Trifecta is still closed', JSON.stringify(run.MODES.gauntlet.hidden));
  eq('so a Trifecta score falls back to the landing', run.scoreShareUrl('gauntlet'), SCORE);
  eq('as does a mode that does not exist', run.scoreShareUrl('nonsense'), SCORE);

  // Every open mode either is the landing or names itself. Derived from the
  // table, so a mode added later is covered without anyone remembering.
  const open = Object.keys(run.MODES).filter((m) => !run.MODES[m].hidden);
  ck(open.length >= 4, 'found the open modes', open.join(','));
  for (const m of open) {
    const u = run.scoreShareUrl(m);
    ck(m === 'sprint' ? u === SCORE : u === `${SCORE}?m=${m}`,
       `${m} resolves to a link that opens ${m}`, u);
  }
}

// ---- 6. and the page at the other end reads it -----------------------------
{
  const fn = grab(html, /        function openSharedMode\(\) \{\n[\s\S]*?\n        \}/);
  ck(/params\.get\("m"\)/.test(fn), 'the landing reads ?m=', fn.slice(0, 80));
  // `mode` is already the Clash invite links' parameter (?join=XXXXX&mode=duel).
  // Two readers on one name is how one of them ends up answering the other's.
  ck(!/get\("mode"\)/.test(fn), 'and not ?mode=, which belongs to the invite links');
  ck(/\/\?join=\$\{currentMatchId\}&mode=/.test(html), '...which still uses it', '');

  ck(/params\.has\("join"\)/.test(fn), 'an invite outranks a mode to look at');
  ck(/hidden/.test(fn), 'a closed mode is refused here too, not just when building the link');
  ck(/goToMode\(mode\)/.test(fn), 'and an open one is actually opened');

  // Only `m` is stripped. A blanket replaceState would delete a ?join= that
  // tryAutoJoinFromUrl has not read yet - it runs off onAuthStateChanged,
  // this runs off a timer, and the order between them is not guaranteed.
  ck(/params\.delete\("m"\)/.test(fn), 'it strips only its own parameter', fn.slice(-300));
  ck(!/replaceState\(null, "", location\.pathname\)\s*;/.test(fn),
     'rather than the whole query, which would eat a pending invite');

  // It has to run after the landing paints, or the landing paints over it.
  const boot = html.slice(html.indexOf('showSprintLanding();', html.indexOf('Sprint is the landing mode')));
  ck(/^showSprintLanding\(\);\s*\n\s*openSharedMode\(\);/.test(boot.trim()),
     'and runs straight after the landing, not before it', boot.slice(0, 80).trim());
}

for (const [ok, name, detail] of t) console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : '— ' + detail);
const bad = t.filter((x) => !x[0]).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
