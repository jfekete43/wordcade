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

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
