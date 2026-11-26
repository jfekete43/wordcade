/*
 * The phone's top bar: one line where the wordmark and the 2x2 mode grid were
 * two, with the mode's own numbers riding on the right of it.
 *
 * Players said the top of the screen was doing too much. It came to 246px of a
 * 664px phone before any board: the game's name, a menu button, four mode
 * buttons over two rows, then the mode's figures. The name and the grid go;
 * what is left says which mode you are in, in that mode's colour, and opens
 * everything on a tap.
 *
 * Four things here are easy to get wrong and silent:
 *
 *   THE CASCADE. `.arcade-menu` carries `display: grid` on a plain class
 *   selector. The rule that hides it has the same specificity, so it only
 *   wins by coming later in the file. Written above it - which is where it
 *   first went - the grid stays on the screen it is supposed to be leaving,
 *   and nothing says so.
 *
 *   THE DESKTOP. None of this is a problem with room to spare, so above 600px
 *   the header and the grid are untouched. #mode-bar is `display: contents`
 *   there, which hides the WRAPPER and not its children: the lockup has to be
 *   hidden in its own right or it turns up under the real header.
 *
 *   THE THREE SURFACES. The nav, the bar and the menu's cards all answer "which
 *   mode am I in". They are painted from one function off one answer, because
 *   three call sites is how one of them ends up a mode behind.
 *
 *   THE BANK BUTTON. #score-board moved into the bar as its pills alone. The
 *   button was nested in it precisely so one display toggle served both; it
 *   has its own, which is what makes un-nesting free, and this checks they are
 *   still there.
 *
 * Pure; no emulator. Playwright for the parts that are layout.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const between = (src, a, b) => {
  const i = src.indexOf(a); if (i < 0) throw new Error('missing ' + a);
  const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('missing end of ' + a);
  return src.slice(i + a.length, j);
};

// ---- A. the cascade, which is the bug this nearly shipped with ------------
{
  const hide = html.indexOf('.arcade-head, .arcade-menu { display: none; }');
  ck(hide > 0, 'there is a rule that takes the header and the grid off a phone');
  // Every rule that puts `display` on either of them, by class, at the same
  // specificity. The hide has to be after the LAST of them.
  const base = [...html.matchAll(/^\s*\.arcade-(?:head|menu) \{[^}]*display:[^}]*\}/gm)]
    .map((m) => m.index);
  ck(base.length > 0, 'and base rules that set their display', String(base.length));
  ck(hide > Math.max(...base),
     'the hide comes after all of them, or it loses the tie on source order',
     `hide at ${hide}, last base at ${Math.max(...base)}`);
  // It is a phone rule, not a rule.
  const block = html.slice(html.lastIndexOf('@media', hide), hide);
  ck(/max-width:\s*600px/.test(block),
     'and it is inside the 600px query the grid already folds at', block.slice(0, 60));
}

// ---- B. the desktop is left alone -----------------------------------------
{
  ck(/#mode-bar \{ display: contents; \}/.test(html),
     'the bar is `contents` by default, so above the breakpoint it is not a row at all');
  ck(/#mode-lockup \{ display: none;/.test(html),
     'the lockup is hidden by default - `contents` hides the wrapper, not the children');
  ck(/#mode-lockup \{ display: flex; \}/.test(html),
     'and only the phone query turns it on');
}

// ---- C. one answer, three surfaces ----------------------------------------
{
  const nav = between(html, 'function renderModeNav() {', '\n        }');
  ck(/renderModeLockup\(here\)/.test(nav), 'the nav paints the bar off its own `here`');
  ck(/renderMenuModes\(here\)/.test(nav), 'and the menu cards too');
  // The menu is also painted when it opens: renderModeNav runs off the mode
  // flow, which has not necessarily happened by the time somebody taps.
  ck(/showMainMenu = function\(\)[^\n]*renderMenuModes\(/.test(html),
     'and again when the menu is opened, so the cards are right when looked at');

  const modes = between(html, 'const MODES = {', '\n        };');
  const lockup = between(html, 'function renderModeLockup(here) {', '\n        }');
  const cards = between(html, 'function renderMenuModes(here) {', '\n        }');
  const run = new Function('document', 'escapeHtml', `
    const MODES = {${modes}};
    const MODE_ORDER = Object.keys(MODES);
    const VISIBLE_MODES = MODE_ORDER.filter((m) => !MODES[m].hidden);
    function renderModeLockup(here) {${lockup}}
    function renderMenuModes(here) {${cards}}
    return { renderModeLockup, renderMenuModes, MODES, VISIBLE_MODES };`);

  const el = (id) => ({ id, innerHTML: '', innerText: '', style: { props: {},
    setProperty(k, v) { this.props[k] = v; } },
    // Real nodes have one; the stub did not, so the first thing the lockup
    // did with a class crashed the whole file rather than failing a check.
    classes: new Set(),
    classList: {
      toggle(k, on) { on ? this.owner.classes.add(k) : this.owner.classes.delete(k); },
      contains(k) { return this.owner.classes.has(k); },
    } });
  const nodes = { 'mode-bar': el('mode-bar'), 'mode-lockup-name': el('n'), 'menu-modes': el('m') };
  const body = el('body');
  for (const n of [...Object.values(nodes), body]) n.classList.owner = n;
  const doc = { getElementById: (id) => nodes[id] || null, body };
  const api = run(doc, (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  api.renderModeLockup('marathon');
  eq('the lockup takes the mode’s label', nodes['mode-lockup-name'].innerText, 'MARATHON');
  eq('and the mode’s colour, as one variable', nodes['mode-bar'].style.props['--c-mode'],
     'var(--c-marathon)');
  // The desktop wordmark follows the mode too. It lives in .arcade-head, a
  // SIBLING of the bar, so it cannot inherit a variable set on the bar - this
  // goes on body, the nearest common ancestor.
  eq('the wordmark follows the mode, from body', body.style.props['--wm-mode'],
     'var(--wm-marathon)');
  // --wm-*, not --c-*. The mode colours are built as a button FILL behind
  // white text; as small text on a keycap face six of the twelve measured
  // under 4.5:1. They are also signals, so they cannot be repainted - hence a
  // parallel token of the same hue rather than a tweak to --c-marathon.
  ck(!/--c-marathon/.test(body.style.props['--wm-mode'] || ''),
     'and not the raw mode colour, which is a signal and is not legible there',
     String(body.style.props['--wm-mode']));
  // Marathon is the only mode with three readouts, and at 390px they do not
  // fit beside a 178px lockup - measured, they come to 399px of 358. The
  // class is what drops them onto their own line; without it the row is
  // crushed, which is what it looked like in the game. Only this function
  // knows which mode is showing, so only it can set the class.
  ck(nodes['mode-bar'].classList.contains('bar-roomy'),
     'Marathon marks the bar as needing the extra row',
     [...nodes['mode-bar'].classes].join(',') || '(none)');

  api.renderModeLockup('endless');
  ck(!nodes['mode-bar'].classList.contains('bar-roomy'),
     'and leaving Marathon takes it off again, rather than leaving every mode roomy',
     [...nodes['mode-bar'].classes].join(',') || '(none)');
  eq('Stakes is spelled the way the table spells it, not "endless"',
     nodes['mode-lockup-name'].innerText, 'STAKES');
  eq('and the wordmark moves with it', body.style.props['--wm-mode'], 'var(--wm-endless)');
  // A mode that is not in the table at all must not blank the bar.
  const before = nodes['mode-lockup-name'].innerText;
  api.renderModeLockup('nonsense');
  ck(nodes['mode-lockup-name'].innerText.length > 0,
     'an unknown mode falls back rather than emptying the bar', nodes['mode-lockup-name'].innerText);
  void before;

  api.renderMenuModes('sprint');
  const cardsHtml = nodes['menu-modes'].innerHTML;
  const labels = [...cardsHtml.matchAll(/<b>([^<]*)<\/b>/g)].map((m) => m[1]);
  eq('one card per mode a player can reach', labels, api.VISIBLE_MODES.map((m) => api.MODES[m].label));
  ck(!/TRIFECTA|FFA/.test(cardsHtml),
     'and none for a mode the table has closed', cardsHtml.slice(0, 120));
  const blurbs = [...cardsHtml.matchAll(/<em>([^<]*)<\/em>/g)].map((m) => m[1]);
  ck(blurbs.length === labels.length && blurbs.every((b) => b.length > 3),
     'each says what the mode IS, which four bare buttons never had room for',
     JSON.stringify(blurbs));
  eq('the one you are in is marked, once',
     (cardsHtml.match(/aria-current="true"/g) || []).length, 1);
  ck(cardsHtml.indexOf('aria-current="true"') < cardsHtml.indexOf('MARATHON'),
     'and it is the right one', cardsHtml.slice(0, 160));
  ck(/--c-mode: var\(--c-sprint\)/.test(cardsHtml), 'each card carries its own colour');
  // Picking closes the sheet it was picked from.
  ck(/pickModeFromMenu = function[\s\S]{0,200}main-menu-modal[\s\S]{0,120}goToMode/.test(html),
     'picking a mode closes the menu and then switches');
}

// ---- D. the mark ----------------------------------------------------------
{
  // Scoped to the LOCKUP. The desktop wordmark is eight of the same mark now
  // and sits earlier in the document, so an unscoped slice took its L - which
  // carries a typeset kc-legend, not the lockup's stroked kc-glyph - and
  // reported the lockup as having lost its letter.
  const lockup = between(html, '<button id="mode-lockup"', '</button>');
  const svg = between(lockup, '<svg class="lex-keycap"', '</svg>');
  for (const part of ['kc-body', 'kc-foot', 'kc-face', 'kc-rim', 'kc-glyph']) {
    ck(svg.includes(part), `the keycap has its ${part}`);
  }
  // The wordmark reuses the mark rather than reimplementing it: same four
  // shapes, same classes, so one CSS block serves both and they cannot drift.
  const title = between(html, '<h1 class="arcade-title"', '</h1>');
  const wmCaps = (title.match(/<svg class="lex-keycap"/g) || []).length;
  eq('the wordmark is eight of the same mark', wmCaps, 8);
  const wmFirst = between(title, '<svg class="lex-keycap"', '</svg>');
  for (const part of ['kc-body', 'kc-foot', 'kc-face', 'kc-rim']) {
    ck(wmFirst.includes(part), `a wordmark cap has its ${part}`);
  }
  // Typeset, not stroked: eight hand-cut letterforms would have to agree with
  // each other, and the lockup's L only has to agree with itself.
  ck(wmFirst.includes('kc-legend') && !wmFirst.includes('kc-glyph'),
     'and a typeset legend rather than the stroked one', wmFirst.slice(-90));
  eq('the letters are real text nodes, in order',
     [...title.matchAll(/<text class="kc-legend"[^>]*>([^<]+)<\/text>/g)].map((m) => m[1]).join(''),
     'LEXATHON');
  // currentColor, so .arcade-title keeps the colour decision - which is where
  // the season rule and the seasonal contrast suite both already look.
  ck(/\.lex-keycap \.kc-legend \{[^}]*fill: currentColor/.test(html),
     'the legend takes its colour from .arcade-title, not a literal',
     (html.match(/\.lex-keycap \.kc-legend \{[^}]*/) || [''])[0].slice(0, 110));
  // Paper face, coloured letter: the face is a fixed token and only the
  // glyph follows the mode. A face that took --c-mode would be the other
  // variant, and would stop matching the home-screen icon.
  ck(/\.lex-keycap \.kc-face \{ fill: var\(--kc-face\); \}/.test(html),
     'the face is paper in every mode');
  ck(/\.lex-keycap \.kc-glyph \{[^}]*stroke: var\(--c-mode/.test(html),
     'and the letter is what carries the mode');
  ck(!/\.lex-keycap \.kc-face \{[^}]*--c-mode/.test(html),
     'the face never takes the mode colour');
  // Top-left, where a moulded key prints its legend. The glyph starts well
  // inside the face's top-left quadrant; a centred one would start past the
  // middle of a 68-unit face that begins at 3.
  // Compare the glyph's CENTRE with the face's. "Starts left of the middle"
  // is not enough: a centred L starts at 26 on a face that spans 3..71, which
  // is left of 37 and still dead centre once its own width is counted.
  const d = (svg.match(/class="kc-glyph" d="M([\d.]+) ([\d.]+) ?V([\d.]+) ?H([\d.]+)/) || []);
  ck(d.length === 5, 'the legend is an L: down, then right', svg.match(/kc-glyph[^/]*/) || '');
  if (d.length === 5) {
    const [x1, y1, y2, x2] = d.slice(1).map(Number);
    const sw = Number((html.match(/\.lex-keycap \.kc-glyph \{[\s\S]*?stroke-width: ([\d.]+)/) || [])[1]);
    ck(sw > 0, 'with a stroke width to size it by', String(sw));
    // Round caps, so the ink reaches half a stroke past each end.
    const gc = [(Math.min(x1, x2) - sw / 2 + Math.max(x1, x2) + sw / 2) / 2,
                (Math.min(y1, y2) - sw / 2 + Math.max(y1, y2) + sw / 2) / 2];
    const faceC = [3 + 68 / 2, 4 + 68 / 2];
    const off = [(faceC[0] - gc[0]) / 68, (faceC[1] - gc[1]) / 68];
    ck(off[0] > 0.10 && off[1] > 0.10,
       'the legend sits up and left of the face\u2019s middle, as a key prints it',
       `centre ${gc.map((v) => v.toFixed(1))} vs face ${faceC}, offset ${off.map((v) => (v * 100).toFixed(0) + '%')}`);
  }
  for (const tok of ['--kc-face', '--kc-rim', '--kc-right', '--kc-bottom']) {
    eq(`${tok} is defined for both themes`,
       (html.match(new RegExp(tok + ':', 'g')) || []).length >= 2, true);
  }
}

// ---- E. the Bank button kept its own toggles ------------------------------
{
  const board = between(html, '<div id="score-board">', '\n    </div>');
  ck(!/btn-cash-out/.test(board), 'the Bank button is no longer nested in #score-board', board.slice(0, 120));
  ck(/id="score-board"[\s\S]{0,400}id="continues"/.test(html), 'which still holds the two pills');
  const toggles = (html.match(/btn-cash-out"\)\.style\.display/g) || []).length;
  ck(toggles >= 6, 'and the button has display toggles of its own, so un-nesting costs no JS',
     String(toggles));
  // It is inside the bar, which is what puts the numbers on the lockup's line.
  const bar = html.slice(html.indexOf('<div id="mode-bar"'),
                         html.indexOf('<!-- Out of #score-board'));
  for (const id of ['mode-lockup', 'score-board',
                    'sprint-header', 'marathon-header', 'daily-header']) {
    ck(bar.includes(`id="${id}"`), `#${id} rides in the bar`);
  }
  ck(!bar.includes('id="btn-cash-out"'),
     'and the full-width action does not ride on a line of numbers',
     (bar.match(/[^\n]*btn-cash-out[^\n]*/) || [''])[0].trim());
  // Stakes used to name itself twice - the lockup, then a row below saying
  // STAKES again - and the phone build hid the second one with a CSS rule.
  // The row is gone outright now, on both halves, so the rule has nothing to
  // hide and the check is that the element does not exist at all.
  ck(!/endless-mode-label/.test(html),
     'Stakes does not name itself twice: the element is gone, not hidden',
     (html.match(/[^\n]*endless-mode-label[^\n]*/) || [''])[0].trim());
}

// ---- F. it is one line, and it fits ---------------------------------------
{
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { const { execSync } = await import('node:child_process');
    ({ chromium } = await import(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs'))); }
  const launch = {};
  if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(launch);
  const file = 'file://' + REPO('index.html');
  for (const [w, label] of [[430, 'large phone'], [390, 'phone'], [375, 'SE'], [360, 'narrow'], [320, 'fold']]) {
    const p = await browser.newPage({ viewport: { width: w, height: 760 } });
    await p.goto(file, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1200);
    const r = await p.evaluate(() => {
      const bar = document.getElementById('mode-bar');
      const kids = [...bar.children].filter((c) => getComputedStyle(c).display !== 'none');
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        barH: Math.round(bar.getBoundingClientRect().height),
        // Centres, not tops: `align-items: center` gives a 42px lockup and a
        // 17px word count different top edges on the same line.
        rows: new Set(kids.map((c) => {
          const q = c.getBoundingClientRect();
          return Math.round((q.top + q.bottom) / 2 / 8);
        })).size,
        kids: kids.length,
      };
    });
    ck(!r.overflow, `${label} (${w}px): the page does not scroll sideways`);
    // Two: the lockup and the one visible mode header. It was three while
    // Stakes carried a separate word-count row beside its pills.
    ck(r.kids >= 2, `${label}: the lockup and the mode's numbers are both in the bar`, String(r.kids));
    // Height, not a row count: bucketing centres splits a line whenever two
    // items differ enough in size, which on this bar they always do. One line
    // is the tallest item plus nothing; a wrap is visibly taller than that.
    if (w > 340) ck(r.barH <= 56, `${label}: all on one line`, `${r.barH}px tall`);
    // 320px is the one width where four things genuinely do not fit, and the
    // word count takes a line rather than the page scrolling sideways.
    else ck(r.barH > 56, `${label}: the word count wraps instead of overflowing`, `${r.barH}px tall`);
    await p.close();
  }
  // Desktop: nothing moved.
  const p = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await p.goto(file, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  const d = await p.evaluate(() => {
    const show = (s) => { const e = document.querySelector(s);
      return !!e && getComputedStyle(e).display !== 'none'; };
    return { head: show('.arcade-head'), nav: show('.arcade-menu'), lockup: show('#mode-lockup'),
             barDisplay: getComputedStyle(document.getElementById('mode-bar')).display };
  });
  ck(d.head && d.nav, 'desktop keeps the wordmark row and the mode grid',
     `head ${d.head} nav ${d.nav}`);
  ck(!d.lockup, 'and never shows the phone lockup', String(d.lockup));
  eq('with the bar itself laying out as nothing', d.barDisplay, 'contents');
  await p.close();
  await browser.close();
}

// ---- G. finishing a run offers the other modes ---------------------------
// The button is old; what it did stopped being enough. It used to tear the
// mode down and land you on Stakes, which was the whole offer because the
// four-up grid sat on the screen you landed on. On a phone that grid is gone.
{
  for (const modal of ['sprint-end-modal', 'marathon-end-modal']) {
    const block = html.slice(html.indexOf(`id="${modal}"`),
                             html.indexOf(`id="${modal}"`) + 3000);
    const btn = (block.match(/<button[^>]*>Play Another Mode<\/button>/) || [''])[0];
    ck(btn.length > 0, `${modal} offers another mode when you finish`, block.slice(0, 80));
    ck(/pickAnotherMode\(\)/.test(btn),
       `${modal}'s button offers the modes rather than choosing one`, btn);
    ck(!/leaveSprint\(\)|leaveMarathon\(\)/.test(btn),
       `${modal} no longer lands you on Stakes without asking`, btn);
  }

  // Run it. Tearing down here would be wrong twice over: goToMode already
  // does it, and doing it early moves a player who then closes the menu.
  const fnSrc = between(html, 'window.pickAnotherMode = function() {', '\n        };');
  const shown = {};
  const doc = { getElementById: (id) => ({ style: { set display(v) { shown[id] = v; }, get display() { return shown[id]; } } }) };
  let menuOpened = 0;
  new Function('document', 'window', `(function() {${fnSrc}})();`)
    (doc, { showMainMenu: () => { menuOpened++; },
            leaveSprint: () => ck(false, 'pickAnotherMode must not tear Sprint down'),
            leaveMarathon: () => ck(false, 'pickAnotherMode must not tear Marathon down') });
  eq('it closes the Sprint result', shown['sprint-end-modal'], 'none');
  eq('and the Marathon one', shown['marathon-end-modal'], 'none');
  eq('and opens the menu, which leads with the modes', menuOpened, 1);

  // The teardown path itself is untouched: goToMode still does it when a
  // mode is actually picked.
  const go = between(html, 'window.goToMode = async function(target) {', '\n        };');
  ck(/window\.leaveSprint\(\)/.test(go) && /window\.leaveMarathon\(\)/.test(go),
     'and goToMode still tears the old mode down when one is picked');
}

for (const [ok, name, detail] of t) console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : '— ' + detail);
const bad = t.filter((x) => !x[0]).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
