/*
 * Every button in the UI must have readable text.
 *
 * This exists because "Find Public Match" shipped as a .btn-cyan — a class
 * whose whole job is cyan fill with BLACK text — with the text colour
 * overridden inline to gold. Gold on cyan measures 1.12:1 against a 3:1
 * minimum for large bold text: not uncomfortable, effectively invisible. It
 * looked deliberate in the markup and nothing flagged it.
 *
 * So the check is mechanical: render the real markup against the real
 * stylesheet, walk every button, resolve the background it actually sits on
 * (a transparent button inherits its container's), and measure. Buttons in
 * this UI are bold and uppercase, so 3:1 is the applicable WCAG threshold.
 *
 * Needs Playwright, not the emulator.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const MIN_CONTRAST = 3.0;

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
// The whole body, minus the module script — the markup is what matters here,
// and the script cannot run without Firebase.
const body = html.match(/<body>([\s\S]*?)<script src="words\.js">/)[1];
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}
/* Force every modal open so their buttons resolve against their real
   container background rather than against nothing. */
.modal-overlay { display: flex !important; }
</style></head><body>${body}</body></html>`;
const tmp = REPO('tests/.button-contrast.tmp.html');
fs.writeFileSync(tmp, page);

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { const { execSync } = await import('node:child_process');
  ({ chromium } = await import(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs'))); }

const launch = {};
if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(launch);
const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

try {
  const p = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await p.goto('file://' + tmp);

  const findings = await p.evaluate((MIN) => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
    // A button with a transparent fill is read against whatever is behind it.
    const effectiveBg = (el) => {
      for (let node = el; node; node = node.parentElement) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) return c.slice(0, 3);
      }
      return [0, 0, 0];
    };
    const out = [];
    for (const el of document.querySelectorAll('button')) {
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      if (!label) continue; // icon-only buttons carry no text to read
      const cs = getComputedStyle(el);
      const fg = parse(cs.color).slice(0, 3);
      const r = ratio(fg, effectiveBg(el));
      out.push({ label, id: el.id || '', fg: cs.color, bg: cs.backgroundColor, ratio: Math.round(r * 100) / 100, ok: r >= MIN });
    }
    return out;
  }, MIN_CONTRAST);

  ck(findings.length > 20, `found buttons to check (${findings.length})`);

  const failures = findings.filter((f) => !f.ok);
  ck(failures.length === 0,
     `every button's text clears ${MIN_CONTRAST}:1 against what it sits on`,
     failures.map((f) => `${f.label || f.id} ${f.ratio}:1 (${f.fg} on ${f.bg})`).join(' | '));

  // The specific regression, named so it cannot come back quietly.
  const find = findings.find((f) => /FIND PUBLIC MATCH/i.test(f.label));
  ck(find && find.ratio >= 10, 'Find Public Match is comfortably readable, not gold-on-cyan',
     find ? `${find.ratio}:1` : 'button not found');

  const worst = [...findings].sort((a, b) => a.ratio - b.ratio)[0];
  console.log(`\nlowest-contrast button: "${worst.label}" at ${worst.ratio}:1 (${worst.fg} on ${worst.bg})\n`);
} finally {
  await browser.close();
  fs.unlinkSync(tmp);
}

// --- the menu stays monochrome ------------------------------------------
// It used to give all eight items a different accent on identical plates, so
// the colour encoded nothing and nothing read as primary. Worse, it spent the
// four MODE colours on things that are not modes, which is what stopped those
// colours meaning anything elsewhere. Hierarchy is brightness now; hue is
// reserved for modes.
// Scoped to the main menu. .menu-list-btn is reused elsewhere — the lobby's
// Cancel is red, which is red doing its actual job and must not fail this.
const mainMenu = (html.match(/<div id="main-menu-modal"[\s\S]*?\n    <\/div>/) || [''])[0];
ck(mainMenu.length > 500, 'found the main-menu modal', String(mainMenu.length));
const menuBtns = [...mainMenu.matchAll(/<button[^>]*class="menu-list-btn[^"]*"[^>]*>/g)].map((m) => m[0]);
ck(menuBtns.length >= 8, 'found the main-menu buttons', String(menuBtns.length));
const coloured = menuBtns.filter((b) => /style="[^"]*\bcolor:/.test(b));
ck(coloured.length === 0, 'no main-menu item carries its own accent colour',
   coloured.join(' | ').slice(0, 200));
// Exactly one primary, or the hierarchy is back to flat.
ck(menuBtns.filter((b) => /is-primary/.test(b)).length === 1,
   'exactly one menu item is the primary one',
   String(menuBtns.filter((b) => /is-primary/.test(b)).length));
// Red means error or danger everywhere else; it was on the sign-in button.
const authBtn = (mainMenu.match(/<button[^>]*id="auth-action-btn"[^>]*>/) || [''])[0];
ck(!/#ff3333|red/i.test(authBtn), 'and the sign-in button is not styled as a warning', authBtn);

// --- Cash Out belongs to Standard, not to the mode nav -------------------
// In the nav it read as a fifth MODE beside Gauntlet/Clash/FFA. It is an action
// on the score, and only Standard has one.
const nav = (html.match(/<nav class="arcade-menu">[\s\S]*?<\/nav>/) || [''])[0];
ck(!/btn-cash-out/.test(nav), 'Cash Out is not in the mode nav', nav);
ck((nav.match(/<button/g) || []).length === 4, 'which now holds exactly the four modes',
   String((nav.match(/<button/g) || []).length));
// Positional, not a nested-div match. `<div id="score-board">[\s\S]*?</div>`
// stops at the first closing tag it meets, which is the inner .score-row's —
// so the button fell outside the extract the moment the markup gained a level.
const sbStart = html.indexOf('<div id="score-board">');
const sbEnd = html.indexOf('<!-- DAILY GAUNTLET UI -->', sbStart);
ck(sbStart !== -1 && sbEnd > sbStart, 'found the score board', `${sbStart}..${sbEnd}`);
const scoreBoard = html.slice(sbStart, sbEnd);
ck(/btn-cash-out/.test(scoreBoard), 'it sits with the score it banks', scoreBoard.slice(0, 160));
// It lost its only styling when it left .arcade-menu; without a standalone rule
// it renders as a default browser button.
ck(/\n\s*\.cash-out-btn \{/.test(html), 'and has a rule of its own outside the nav');

let bad = 0;
// ---- each mode's modals wear that mode's colour -------------------------
// Not contrast, but the same family of mistake and nothing else was looking:
// Clash's nav button is orange and its lobby was cyan, so tapping an orange
// button opened a blue box. FFA and the Gauntlet already matched, which is
// what made Clash look like an oversight rather than a choice.
//
// Only the chrome is checked. The colours INSIDE an end modal are signals -
// green for a win, red for a loss, red for a destructive Cancel - and must not
// be dragged into the theme.
{
  const src = fs.readFileSync(REPO('index.html'), 'utf8');
  const colourOf = (re) => { const m = src.match(re); return m ? m[1].toLowerCase() : null; };
  const MODES = [
    { name: 'Clash',    button: /\.arcade-menu \.mode-clash \{ color: (#[0-9a-fA-F]{6});/,    modals: ['versus-lobby-modal', 'versus-end-modal'] },
    { name: 'FFA',      button: /\.arcade-menu \.mode-ffa \{ color: (#[0-9a-fA-F]{6});/,      modals: ['ffa-lobby-modal', 'ffa-end-modal'] },
    { name: 'Gauntlet', button: /\.arcade-menu \.mode-gauntlet \{ color: (#[0-9a-fA-F]{6});/, modals: ['daily-end-modal', 'gauntlet-archive-modal'] },
  ];
  for (const mode of MODES) {
    const want = colourOf(mode.button);
    ck(!!want, `${mode.name}: its nav button states a colour`, String(want));
    for (const id of mode.modals) {
      const at = src.indexOf(`id="${id}"`);
      const box = at < 0 ? '' : src.slice(at, at + 400);
      const border = (box.match(/border-color: (#[0-9a-fA-F]{6})/) || [])[1];
      ck(at > 0, `${mode.name}: ${id} exists`);
      ck(border && border.toLowerCase() === want,
         `${mode.name}: ${id} is bordered in the mode's own colour`, `${border} vs ${want}`);
    }
  }
  // A filled button owns its text colour, which is why .btn-gold exists at all
  // (gold text on a cyan fill measured 1.12:1). Each mode's primary action gets
  // its own class rather than an inline override of half the pair.
  ck(/\.btn-orange \{ background-color: #ff9800; color: #000; \}/.test(src),
     'Clash has a filled button class rather than an inline override');
  ck(!/class="btn-cyan"[^>]*onclick="window\.(findRandomMatch|rematchVersusMatch)\(\)"/.test(src),
     "and Clash's primary actions no longer use the generic cyan one");
}

for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
