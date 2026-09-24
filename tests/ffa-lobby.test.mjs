/*
 * A public FFA lobby starting itself when its grace period elapses.
 *
 * The bug this pins: the deadline check used to live inside the match
 * document's onSnapshot handler. Setting `lobbyDeadline` is the LAST write a
 * two-player lobby receives — after it, nothing touches the document, so no
 * snapshot arrives, so the check never ran again. The countdown ticked to zero
 * and the lobby sat there forever. The mode only worked when a fourth player
 * joined, because the server starts that case itself.
 *
 * A deadline is a wall-clock event that no write announces, so the check has to
 * be driven by the clock. These cases replay the exact timeline — one snapshot
 * setting the deadline, then silence — against a controlled clock.
 *
 * Pure; no emulator needed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };
const src = [
  grab(/        function ffaLobbyTick\(\) \{\n[\s\S]*?\n        \}/),
  grab(/        function maybeAutoStartFfa\(\) \{\n[\s\S]*?\n        \}/),
].join('\n\n');
const GRACE_MS = Number(fs.readFileSync(REPO('functions/index.js'), 'utf8')
  .match(/const FFA_LOBBY_GRACE_MS = (\d+);/)[1]);
console.log('extracted from index.html:', src.length, 'chars | grace period', GRACE_MS / 1000, 's');

// A lobby harness: a controllable clock, a stub callable, and the two real
// extracted functions driving it.
function makeLobby({ failFirstCall = false, failEvery = false } = {}) {
  const state = { now: 1_000_000, calls: [], rendered: 0, failNext: failFirstCall, failEvery };
  const env = new Function('getNow', 'onStart', 'state', `
    const document = { getElementById: () => ({ style: { display: 'block' } }) };
    // The retry case deliberately rejects once; its console.error would
    // otherwise print a stack trace that reads like a test failure.
    const console = { error: () => {}, log: () => {} };
    let currentMatchId = 'ROOMX';
    let lastFfaMatchData = null;
    let ffaAutoStartRequested = false;
    let ffaAutoStartAttempts = 0;
    let ffaAutoStartError = null;
    const Date = { now: getNow };
    function renderFfaLobbyWaiting() { state.rendered++; }
    function callStartFfaMatch(arg) { return onStart(arg); }
    ${src}
    return {
      tick: ffaLobbyTick,
      setData: (d) => { lastFfaMatchData = d; },
      lastError: () => ffaAutoStartError,
      reset: () => { ffaAutoStartRequested = false; ffaAutoStartAttempts = 0; ffaAutoStartError = null; },
    };
  `)(() => state.now, (arg) => {
    state.calls.push(arg);
    if (state.failEvery) return Promise.reject(new Error('The grace period hasn\'t elapsed yet.'));
    if (state.failNext) { state.failNext = false; return Promise.reject(new Error('transient')); }
    return Promise.resolve({ ok: true });
  }, state);
  return { state, ...env };
}

const waiting = (deadlineFromNow, now, extra = {}) => ({
  status: 'waiting', isPublic: true, playerCount: 2,
  lobbyDeadline: now + deadlineFromNow, ...extra,
});

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);
const settle = () => new Promise((r) => setTimeout(r, 0));

// ===== the regression: one snapshot, then silence =========================
{
  const L = makeLobby();
  // The second player joins. This snapshot sets the deadline — and is the last
  // write the document will ever receive with two players in the room.
  L.setData(waiting(GRACE_MS, L.state.now));
  L.tick();
  ck(L.state.calls.length === 0, 'does not start while the grace period is still running');

  // 20 one-second ticks, no further snapshots — exactly what really happens.
  for (let i = 0; i < GRACE_MS / 1000; i++) { L.state.now += 1000; L.tick(); }
  await settle();
  ck(L.state.calls.length === 1, 'starts itself once the deadline passes, with no snapshot to prompt it',
     `${L.state.calls.length} calls`);
  ck(L.state.calls[0] && L.state.calls[0].matchId === 'ROOMX', 'starts the right match', JSON.stringify(L.state.calls[0]));
  ck(L.state.rendered >= GRACE_MS / 1000, 'and kept the countdown redrawing throughout', String(L.state.rendered));

  // Keep ticking: every joined client races to call this, so it must not also
  // spam it once per second from each of them.
  for (let i = 0; i < 10; i++) { L.state.now += 1000; L.tick(); }
  await settle();
  ck(L.state.calls.length === 1, 'asks exactly once, not once per tick', `${L.state.calls.length} calls`);
}

// ===== a transient failure must not strand the lobby ======================
{
  const L = makeLobby({ failFirstCall: true });
  L.setData(waiting(-1, L.state.now)); // already past the deadline
  L.tick();
  await settle();
  ck(L.state.calls.length === 1, 'first attempt is made');
  L.state.now += 1000; L.tick();
  await settle();
  ck(L.state.calls.length === 2, 'a failed start is retried on the next tick rather than stranding the lobby',
     `${L.state.calls.length} calls`);
  L.state.now += 1000; L.tick();
  await settle();
  ck(L.state.calls.length === 2, 'and once it succeeds it stops asking', `${L.state.calls.length} calls`);
}

// ===== a persistent failure has to become visible =========================
// A lobby sitting at "Starting in 0s" with no explanation is impossible to
// diagnose from a phone, which is the position the original bug left everyone
// in. A start that keeps being refused now says so on screen.
{
  const L = makeLobby({ failEvery: true });
  L.setData(waiting(-1, L.state.now));
  L.tick(); await settle();
  ck(L.lastError() === null, 'one failure stays quiet — no alarming flash for a blip');
  L.state.now += 1000; L.tick(); await settle();
  L.state.now += 1000; L.tick(); await settle();
  ck(typeof L.lastError() === 'string' && /grace period/.test(L.lastError()),
     'a persistent failure surfaces the server\'s own reason', String(L.lastError()));
  ck(L.state.calls.length >= 3, 'and it keeps retrying while it does', `${L.state.calls.length} calls`);
}

// ===== everything that must NOT start =====================================
const never = async (label, data) => {
  const L = makeLobby();
  L.setData(data);
  for (let i = 0; i < 5; i++) { L.state.now += 10000; L.tick(); }
  await settle();
  ck(L.state.calls.length === 0, label, `${L.state.calls.length} calls`);
};
await never('a private room never auto-starts — its host decides', { ...waiting(-1, 1_000_000), isPublic: false });
await never('a public lobby with no deadline set (still 1 player) does not start', { status: 'waiting', isPublic: true, playerCount: 1 });
await never('a match already playing is left alone', { ...waiting(-1, 1_000_000), status: 'playing' });
await never('a finished match is left alone', { ...waiting(-1, 1_000_000), status: 'finished' });
{
  const L = makeLobby();
  L.setData(null);
  L.tick(); L.state.now += 60000; L.tick();
  await settle();
  ck(L.state.calls.length === 0, 'no match data at all is a no-op, not a crash');
}

// ===== a fresh lobby is not blocked by the previous one ===================
{
  const L = makeLobby();
  L.setData(waiting(-1, L.state.now));
  L.tick();
  await settle();
  ck(L.state.calls.length === 1, 'first lobby starts');
  L.reset(); // what listenToFfaMatch/leave do
  L.setData(waiting(-1, L.state.now));
  L.tick();
  await settle();
  ck(L.state.calls.length === 2, 'a second lobby in the same session can still start', `${L.state.calls.length} calls`);
}

// ===== the JOIN side: when does a public lobby get its deadline? =========
// The countdown only exists once a lobby is startable, so the trigger count
// and FFA_MIN_PLAYERS have to be the same number. They were both 2 and the
// trigger was written as a literal, so raising the minimum to 3 would have
// left public lobbies counting down from two players and then failing to
// start — a countdown to a refusal.
{
  const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8').replace(/\r\n/g, '\n');
  const MIN = Number(fn.match(/const FFA_MIN_PLAYERS = (\d+);/)[1]);
  const MAX = Number(fn.match(/const FFA_MAX_PLAYERS = (\d+);/)[1]);
  // Anchored on the deadline assignment, not on the first closing brace —
  // a lazy /\n    \}/ stops at the `} else if` and silently extracts only
  // the first branch, which is exactly how this case first passed on code
  // it was not running.
  const joinBlock = fn.match(
    /    let started = false;\n[\s\S]*?lobbyDeadline\] = Date\.now\(\) \+ FFA_LOBBY_GRACE_MS;\n    \}|    let started = false;\n[\s\S]*?lobbyDeadline = Date\.now\(\) \+ FFA_LOBBY_GRACE_MS;\n    \}/)[0];
  if (!/else if/.test(joinBlock)) throw new Error('join block extraction missed the deadline branch');
  const decide = new Function('FFA_MAX_PLAYERS', 'FFA_MIN_PLAYERS', 'FFA_MATCH_MS',
    'FFA_LOBBY_GRACE_MS', 'Date', 'match', 'newCount', 'update',
    `${joinBlock}\nreturn { started, update };`);
  const run = (newCount, isPublic, lobbyDeadline) => {
    const update = {};
    return decide(MAX, MIN, 420000, 20000, Date, { isPublic, lobbyDeadline }, newCount, update);
  };

  ck(MIN >= 3, 'the minimum really is above a duel', `FFA_MIN_PLAYERS=${MIN}`);
  for (let c = 1; c < MIN; c++) {
    ck(!('lobbyDeadline' in run(c, true).update),
       `a public lobby of ${c} gets no countdown yet`, JSON.stringify(run(c, true).update));
  }
  ck('lobbyDeadline' in run(MIN, true).update,
     `the countdown starts at exactly ${MIN}`, JSON.stringify(run(MIN, true).update));
  ck(!('lobbyDeadline' in run(MIN, true, 123).update),
     'an existing countdown is never restarted by a later join');
  ck(!('lobbyDeadline' in run(MIN, false).update),
     'a private room never gets a countdown');
  ck(run(MAX, true).started === true, `a full lobby of ${MAX} starts immediately`);
  ck(run(MAX - 1, true).started === false, `a lobby of ${MAX - 1} does not`);
}

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
