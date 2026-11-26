/*
 * "You finished 1st of 11" on a board people can still play.
 *
 * The archive's day view renders a settled day for every row in the list -
 * which starts at yesterday - so its wording was written for a day that is
 * over. But Sprint's "Full leaderboard" sends TODAY straight into the same
 * view: the Hall of Fame's Sprint tab ranks all-time best streak, a different
 * board with a different player on top, so the full version of the card is
 * that same day at full depth, which is exactly what this view renders.
 *
 * Reported from the game: finish today's Sprint in the lead, open Full
 * leaderboard, and it tells you that you finished first - on a day with hours
 * left in it and ten other people who can still pass you.
 *
 * The only thing separating the live case from the settled one is the date,
 * so that is what the wording has to ask.
 *
 * Pure; no emulator, no browser.
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

// ---- 1. the path that caused it still exists ------------------------------
{
  const fn = between(html, 'window.expandHomeBoard = function() {', '\n        };');
  ck(/viewPastDay\(getTodayDateStr\(\)\)/.test(fn),
     "Sprint's Full leaderboard opens TODAY in the archive day view", fn.slice(0, 120));
  // If this ever stops being true the live wording below is dead code rather
  // than wrong - worth knowing either way.
  ck(/boardLbTab === "sprint"/.test(fn), 'and only for Sprint');
}

// ---- 2. the view itself, run both ways ------------------------------------
const body = between(html, 'window.viewPastDay = async function(dateStr) {', '\n        };');
ck(body.length > 600, 'lifted viewPastDay', String(body.length));

/*
 * Drives the real function against stubs. Only the standing line is of
 * interest, so the board half is given a resolved empty result and the DOM is
 * a map of fake elements.
 */
async function render({ viewing, today, place = 1, total = 11, played = true }) {
  const els = {};
  const el = () => ({ innerHTML: '', innerText: '', href: '', style: {} });
  for (const id of ['archive-board', 'archive-standing', 'archive-browse', 'archive-detail',
                    'archive-title', 'archive-full', 'archive-more', 'archive-live-note']) els[id] = el();
  const run = new Function('ARGS', `
    const { els, viewing, today, place, total, played } = ARGS;
    const document = { getElementById: (id) => els[id] || null };
    const console = { error() {} };
    const escapeHtml = (s) => String(s);
    const ordinal = (n) => n + ['th','st','nd','rd'][(n % 100 >> 3 ^ 1) && n % 10 < 4 ? n % 10 : 0];
    const runScore = () => 150;
    const placeBadge = () => 'BADGE';
    let painted = 0;
    const paintRollover = () => { painted++; };
    const PLACE_BADGES = { plain: 'PLAIN' };
    const getTodayDateStr = () => today;
    const marathonKeyFor = () => today;
    const archiveCfg = () => ({
      weekly: false, colour: '#000', full: null,
      number: () => 24, name: (n) => 'Sprint #' + n, dateLabel: (d) => d,
    });
    const fetchMyArchiveRun = async () => (played ? { score: 150 } : null);
    const fetchArchiveStanding = async () => ({ place, total });
    const fetchArchiveBoard = async () => [];
    const renderArchiveBoard = () => {};
    const viewPastDay = async function(dateStr) {${body}};
    return viewPastDay(viewing).then(() => ({
      standing: els['archive-standing'].innerHTML,
      noteShown: els['archive-live-note'].style.display,
      painted,
    }));
  `);
  return run({ els, viewing, today, place, total, played });
}

const TODAY = '2026-11-25';
const PAST = '2026-11-20';

// ---- 3. a live day ---------------------------------------------------------
{
  const r = await render({ viewing: TODAY, today: TODAY });
  ck(!/you finished/.test(r.standing),
     'today does NOT say you finished', r.standing);
  ck(/so far/.test(r.standing), "it says where you are so far", r.standing);
  ck(/1st of 11/.test(r.standing), 'and still reports the placing', r.standing);
  eq('and the board says it can still change', r.noteShown, 'block');
}

// ---- 4. a settled day ------------------------------------------------------
{
  const r = await render({ viewing: PAST, today: TODAY });
  ck(/you finished/.test(r.standing), 'a past day still says you finished', r.standing);
  ck(!/so far/.test(r.standing), 'and does not hedge', r.standing);
  eq('and the in-progress note is hidden', r.noteShown, 'none');
}

// ---- 5. not having played reads differently too ----------------------------
{
  const live = await render({ viewing: TODAY, today: TODAY, played: false });
  ck(/haven't played this one yet/.test(live.standing),
     "today is one you haven't played YET", live.standing);
  const past = await render({ viewing: PAST, today: TODAY, played: false });
  ck(/didn't play this one/.test(past.standing) && !/yet/.test(past.standing),
     'a past day is one you did not play', past.standing);
}

// ---- 5b. the countdown -----------------------------------------------------
{
  const live = await render({ viewing: TODAY, today: TODAY });
  ck(live.painted > 0, 'a live day paints the countdown', String(live.painted));
  const past = await render({ viewing: PAST, today: TODAY });
  eq('a settled day does not', past.painted, 0);

  // Reuses msUntilPuzzleRollover rather than carrying a second copy. The
  // first version of this computed wall-clock seconds left in the ET day,
  // which is wrong on the two DST days - an ET day is 23 or 25 hours long
  // then, so wall-clock subtraction lands a full hour out. That function's
  // own comment had already rejected the approach; this one had to not
  // reinvent it.
  const painter = between(html, 'function paintRollover() {', '\n        }');
  ck(/formatCountdown\(msUntilPuzzleRollover\(\)\)/.test(painter),
     'the countdown goes through the shared arithmetic', painter.slice(0, 120));
  ck(!/wall-clock|86400 -/.test(painter), 'and does not do its own');
  // One timer for every element, started on the first paint, so a card that
  // is never opened costs nothing.
  ck(/if \(!rolloverTimer\) rolloverTimer = setInterval/.test(painter),
     'one interval for all of them, armed once', painter.slice(-160));

  // The shared instant maths, exercised rather than read.
  const inst = between(html, 'function nextPuzzleInstant(todayEtDate) {', '\n        }');
  ck(/etOffsetMs\(naive\)/.test(inst), 'the next midnight is resolved as a real instant');
  const fmt = new Function('ms', between(html, 'function formatCountdown(ms) {', '\n        }') + '\n');
  eq('two hours and a bit', fmt(2 * 3600e3 + 14 * 60e3), '2h 14m');
  eq('under an hour is minutes', fmt(45 * 60e3), '45m');
  eq('the last minute says so rather than showing zero', fmt(30e3), 'under a minute');
  eq('and a day already over does not go negative', fmt(-5000), 'under a minute');
}

// ---- 5c. and it is readable beside the label ------------------------------
{
  // It first reused .daily-board-title, which is the same 11px bold the card
  // eyebrow is and inherits the parent's uppercase and letter-spacing. The
  // two rendered as "TODAY'S SPRINT2H 22M LEFT" - one string, no space.
  const card = between(html, "titleEl.innerHTML = \"Today's Sprint\"", ';');
  ck(/class="board-rollover"/.test(card), 'the card countdown has its own class', card);
  ck(!/daily-board-title/.test(card), 'and not the eyebrow\u2019s', card);

  const css = between(html, '.board-rollover {', '}');
  ck(/text-transform: none/.test(css), 'it opts out of the inherited uppercase', css);
  ck(/letter-spacing: normal/.test(css), 'and the inherited eyebrow letter-spacing', css);
  ck(/margin-left:/.test(css), 'and is pushed off the label', css);
  ck(/--fw-med/.test(css) && !/--fw-bold/.test(css),
     'and is lighter than the label beside it', css);
  // The separator is what makes it two things rather than one run-on string.
  const before = between(html, '.board-rollover::before {', '}');
  ck(/content:/.test(before) && /margin-right:/.test(before),
     'with a separator that has room on both sides', before);
}

// ---- 6. the boundary is named ---------------------------------------------
{
  // A player west of Eastern loses the day before their own clock says
  // midnight. Saying which midnight is the difference between "this is wrong"
  // and "oh, that's why".
  const note = between(html, 'id="archive-live-note"', '</div>');
  ck(/midnight Eastern/i.test(note), 'the note names the timezone the day rolls on', note.slice(0, 120));
}

for (const [ok, name, detail] of t) console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : '— ' + detail);
const bad = t.filter((x) => !x[0]).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
