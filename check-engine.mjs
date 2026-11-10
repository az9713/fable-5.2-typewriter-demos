/* check-engine.mjs - checks of engine.js. Run: node check-engine.mjs
 * The script drives the engine offline at 48000 Hz with scripted key events. Exit code 1 if a check fails. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Synth = require('./synth.js');
const Engine = require('./engine.js');

const SR = 48000, STEP = Engine.K.STEP_SAMPLES, F = 0.8;        // F: key force of the scripted keys
const timing = Engine.timingFromSynth(Synth.P);
const INT_TOL = 1e-6;                                           // letter spaces: a column is "integer" inside this tolerance
const isInt = (x) => Math.abs(x - Math.round(x)) <= INT_TOL;

/* script: [{ t: ms, down | up: code, force } | { t: ms, release: true }]. Returns the engine and all events. */
function run(script, endMs, seed = 1, Cls = Engine) {
  const eng = new Cls({ sampleRate: SR, seed, timing }), evs = [];
  let now = 0;
  const to = (ms) => { const n = Math.round(ms * SR / 1000 / STEP) * STEP; if (n > now) { for (const e of eng.advance(n - now)) evs.push(e); now = n; } };
  const sorted = script.map((s, i) => [s, i]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]);
  for (const [s] of sorted) {
    to(s.t);
    if (s.release) eng.release(); else if (s.down) s.ok = eng.keyDown(s.down, s.force); else eng.keyUp(s.up);
  }
  to(endMs);
  return { eng, evs };
}
const tap = (t, code, force = F) => [{ t, down: code, force }, { t: t + 20, up: code }];
const word = (codes, t0, gap, force = F) => codes.flatMap((c, i) => tap(t0 + i * gap, c, force));
const of = (evs, type) => evs.filter((e) => e.type === type);
const snap = (eng) => { const s = eng.snapshot(), S = Engine.SNAP; return { x: s[S.X], target: s[S.TARGET], line: s[S.LINE], flags: s[S.FLAGS] }; };

let failed = 0, count = 0;
function check(name, fn) {
  count++;
  try { const note = fn(); console.log('ok   ' + name + (note ? ' — ' + note : '')); }
  catch (e) { failed++; console.log('FAIL ' + name + ' — ' + String(e.message).split('\n')[0]); }
}

const T = new Engine({ sampleRate: SR, timing }).times(F);      // times that follow from the constants, ms
const gapJam = 0.3 * T.jamBelow, gapMid = 0.5 * (T.jamBelow + T.cleanAbove), gapSlow = 3 * T.cleanAbove;
console.log(`constants at force ${F}: bar travel ${T.travel.toFixed(2)} ms, jam below ${T.jamBelow.toFixed(2)} ms, ` +
  `carriage step ${T.step.toFixed(2)} ms, clean print above ${T.cleanAbove.toFixed(2)} ms, return ${T.returnMs.toFixed(0)} ms`);
console.log(`gaps in the checks: jam ${gapJam.toFixed(2)} ms, off-column ${gapMid.toFixed(2)} ms, slow ${gapSlow.toFixed(2)} ms`);

check('three regimes exist: jam gap < off-column gap < clean gap', () => {
  assert.ok(T.jamBelow > T.travel * 0.2 && T.jamBelow < T.cleanAbove, 'jamBelow must be less than cleanAbove');
});

check('a typed word prints in the typed order, at consecutive columns, on line 0', () => {
  const { evs } = run(word(['KeyH', 'KeyE', 'KeyL', 'KeyL', 'KeyO'], 10, gapSlow), 2000);
  const p = of(evs, 'print');
  assert.equal(p.map((e) => e.ch).join(''), 'hello');
  assert.deepEqual(p.map((e) => e.column), [0, 1, 2, 3, 4]);
  assert.ok(p.every((e) => e.line === 0));
  assert.ok(p.every((e, i) => i === 0 || e.at > p[i - 1].at), 'print sample offsets must increase');
  assert.equal(of(evs, 'jam').length, 0);
  return 'columns ' + p.map((e) => e.column).join(',');
});

check('the bar travel time is the time that the strike sound of synth.js uses', () => {
  const { evs } = run(tap(10, 'KeyA', F), 300);
  const ms = (of(evs, 'print')[0].at - of(evs, 'drive')[0].at) * 1000 / SR;
  const want = Synth.P.B.machine.strike.travelMs * (Synth.P.common.strikeVelTime[0] - Synth.P.common.strikeVelTime[1] * F);
  assert.ok(Math.abs(ms - want) <= 1000 * STEP / SR, `travel ${ms} ms, synth ${want} ms`);
  return `${ms.toFixed(2)} ms, synth.js ${want.toFixed(2)} ms`;
});

check('two keys with a gap much shorter than the bar travel time jam', () => {
  for (const gap of [0, gapJam]) {
    const { evs, eng } = run([...tap(10, 'KeyA'), ...tap(10 + gap, 'KeyS')], 400);
    const j = of(evs, 'jam');
    assert.equal(j.length, 1, `gap ${gap} ms: one jam event`);
    assert.deepEqual([...j[0].bars].sort(), [Engine.KEYS.findIndex((k) => k[0] === 'KeyA'), Engine.KEYS.findIndex((k) => k[0] === 'KeyS')].sort());
    assert.ok(of(evs, 'print').length <= 1, 'the second bar must not print');
    assert.ok(snap(eng).flags & Engine.FLAG_JAM, 'the jam flag stays set');
    const s = eng.snapshot(), S = Engine.SNAP;
    assert.ok(j[0].bars.every((b) => s[S.BARS + b] >= Engine.K.ZONE), 'the bars stay up');
  }
  return `gaps 0 ms and ${gapJam.toFixed(2)} ms (bar travel ${T.travel.toFixed(2)} ms)`;
});

check('the same two keys with a long gap do not jam', () => {
  const { evs, eng } = run([...tap(10, 'KeyA'), ...tap(10 + gapSlow, 'KeyS')], 600);
  assert.equal(of(evs, 'jam').length, 0);
  assert.equal(of(evs, 'print').map((e) => e.ch).join(''), 'as');
  assert.equal(snap(eng).flags & Engine.FLAG_JAM, 0);
});

check('a jam stays until the release action; then the bars go back and the keys print again', () => {
  const script = [...tap(10, 'KeyA'), ...tap(10, 'KeyS'), ...tap(300, 'KeyD'), { t: 600, release: true }, ...tap(900, 'KeyF')];
  const { evs, eng } = run(script, 1200);
  const jams = of(evs, 'jam'), rel = of(evs, 'release');
  assert.equal(jams.length, 2, 'the third bar also stops in the jam');
  assert.equal(of(evs, 'print').filter((e) => e.at < rel[0].at).length, 0, 'no print during the jam');
  assert.equal(rel.length, 1); assert.equal(rel[0].bars.length, 3);
  assert.equal(of(evs, 'print').map((e) => e.ch).join(''), 'f');
  const s = eng.snapshot(), S = Engine.SNAP;
  for (let i = 0; i < Engine.KEYS.length; i++) assert.equal(s[S.BARS + i], 0, 'all bars at rest');
  assert.equal(snap(eng).flags & Engine.FLAG_JAM, 0);
});

check('the bell comes 6 columns before the lock column; the keys lock; a return unlocks them', () => {
  const lock = Engine.K.LINE_COLS, gap = gapSlow, script = [];
  for (let i = 0; i < lock; i++) script.push(...tap(10 + i * gap, i % 2 ? 'KeyS' : 'KeyA'));
  const tEnd = 10 + lock * gap + 200;
  const extra = tap(tEnd, 'KeyD'), sp = tap(tEnd + 100, 'Space');
  script.push(...extra, ...sp, ...tap(tEnd + 300, 'Enter'), ...tap(tEnd + 300 + T.returnMs + 100, 'KeyF'));
  const { evs, eng } = run(script, tEnd + 300 + T.returnMs + 400);
  const p = of(evs, 'print'), bells = of(evs, 'bell');
  assert.equal(bells.length, 1, 'one bell');
  assert.equal(bells[0].column, lock - 6);
  const before = p.filter((e) => e.at < bells[0].at).length;
  assert.equal(before, lock - 6, 'the bell rings when the carriage comes to the bell column');
  assert.equal(extra[0].ok, false, 'a key after the lock is not accepted');
  assert.equal(sp[0].ok, false, 'the space bar after the lock is not accepted');
  assert.equal(p.length, lock + 1, 'no print between the lock and the return');
  assert.equal(p[lock - 1].column, lock - 1);
  const last = p[lock];
  assert.equal(last.ch, 'f'); assert.equal(last.column, 0); assert.equal(last.line, 1);
  assert.equal(snap(eng).flags & Engine.FLAG_LOCK, 0);
  return `lock column ${lock}, bell column ${bells[0].column}, ${before} prints before the bell`;
});

check('a return sets the column to the left margin and the line to line + 1, and takes time', () => {
  const { evs, eng } = run([...word(['KeyA', 'KeyB', 'KeyC'], 10, gapSlow), ...tap(800, 'Enter'), ...tap(900, 'KeyX')], 800 + T.returnMs + 200);
  const a = of(evs, 'returnStart')[0], b = of(evs, 'returnEnd')[0];
  assert.ok(a && b);
  assert.equal(a.column, 3); assert.equal(a.line, 0);
  const ms = (b.at - a.at) * 1000 / SR, P = Synth.P, L = P.B.machine.linefeed;
  assert.ok(ms > 0);
  assert.equal(b.at - a.at, Math.round((L.clicks * L.gapMs + P.common.ret.gapMs) * 0.001 * SR) + Math.round(P.B.machine.ret.travelMs * 0.001 * SR), 'same length as the return sound');
  const s = snap(eng);
  assert.equal(s.x, 0); assert.equal(s.target, 0); assert.equal(s.line, 1);
  assert.equal(of(evs, 'print').length, 3, 'a key during the return does not print');
  return `${ms.toFixed(1)} ms from column 3`;
});

check('the lever at the left margin feeds one line and does not move the carriage', () => {
  const { evs, eng } = run(tap(10, 'Enter'), 300);
  assert.equal(of(evs, 'linefeed').length, 1); assert.equal(of(evs, 'returnStart').length, 0);
  assert.equal(snap(eng).line, 1); assert.equal(snap(eng).x, 0);
});

check('a print before the carriage settles is off its column; a slow print is on its column', () => {
  const fast = of(run([...tap(10, 'KeyA'), ...tap(10 + gapMid, 'KeyS')], 500).evs, 'print');
  const slow = of(run([...tap(10, 'KeyA'), ...tap(10 + gapSlow, 'KeyS')], 700).evs, 'print');
  assert.equal(fast.length, 2); assert.equal(slow.length, 2);
  assert.ok(isInt(fast[0].column) && fast[0].column === 0);
  const off = Math.abs(fast[1].column - Math.round(fast[1].column));
  assert.ok(off > 0.01, `fast print at column ${fast[1].column}`);
  assert.ok(fast[1].column > 0 && fast[1].column < 1.5);
  assert.ok(isInt(slow[1].column) && Math.round(slow[1].column) === 1, `slow print at column ${slow[1].column}`);
  return `gap ${gapMid.toFixed(1)} ms: column ${fast[1].column.toFixed(4)}; gap ${gapSlow.toFixed(1)} ms: column ${slow[1].column} (tolerance ${INT_TOL})`;
});

check('backspace moves one column back and adds no print', () => {
  const { evs, eng } = run([...word(['KeyA', 'KeyB'], 10, gapSlow), ...tap(600, 'Backspace'), ...tap(900, 'KeyC')], 1300);
  const mid = run([...word(['KeyA', 'KeyB'], 10, gapSlow), ...tap(600, 'Backspace')], 800);
  assert.equal(snap(mid.eng).x, 1); assert.equal(of(mid.evs, 'print').length, 2);
  assert.equal(of(mid.evs, 'backspace')[0].column, 1);
  const p = of(evs, 'print');
  assert.deepEqual(p.map((e) => e.column), [0, 1, 1], 'the next print is on the column of the last print');
  assert.equal(snap(eng).x, 2);
  const none = run(tap(10, 'Backspace'), 200);
  assert.equal(of(none.evs, 'backspace').length, 0, 'no backspace at the left margin');
});

check('the shift has a travel time: a print uses the shift position at its instant', () => {
  const held = of(run([{ t: 10, down: 'ShiftLeft' }, ...tap(200, 'KeyA'), { t: 300, up: 'ShiftLeft' }, ...tap(600, 'KeyA')], 900).evs, 'print');
  assert.equal(held.map((e) => e.ch).join(''), 'Aa');
  assert.equal(held[0].shift, 1); assert.equal(held[1].shift, 0);
  const early = of(run([{ t: 10, down: 'ShiftLeft' }, ...tap(10, 'KeyA')], 300).evs, 'print')[0];
  assert.ok(early.shift > 0 && early.shift < 1, `shift position ${early.shift}`);
  return `key and shift at the same time: shift position ${early.shift.toFixed(3)} at the print, character "${early.ch}"`;
});

check('a key that the machine does not have does nothing', () => {
  const s = [...tap(10, 'Digit1'), ...tap(100, 'F5'), ...tap(200, 'Tab'), ...tap(300, 'Equal')];
  const { evs } = run(s, 600);
  assert.equal(evs.length, 0); assert.ok(s.filter((e) => e.down).every((e) => e.ok === false));
});

/* a long scripted session with forces from the seed: used for the repeat check and the speed check */
function session(seconds) {
  const codes = Engine.KEYS.map((k) => k[0]), s = [];
  let t = 50, i = 0, col = 0;
  while (t < seconds * 1000) {
    const gap = 70 + ((i * 37) % 90);                             // 70 to 159 ms between keys
    if (col >= 62) { s.push({ t, down: 'Enter' }, { t: t + 20, up: 'Enter' }); t += 800; col = 0; }
    else if (i % 6 === 5) { s.push({ t, down: 'Space' }, { t: t + 20, up: 'Space' }); t += gap; col++; }
    else {
      const c = codes[(i * 11) % codes.length]; s.push({ t, down: c }, { t: t + 20, up: c }); col++;
      if (i % 17 === 16) { t += 12; const d = codes[(i * 11 + 5) % codes.length]; s.push({ t, down: d }, { t: t + 20, up: d }, { t: t + 150, release: true }); t += 300; }   // a jam, then the release
      else t += (i % 5 === 0 ? 45 : gap);                          // some fast pairs: off-column prints
    }
    i++;
  }
  return s;
}

check('the same seed and the same events give an identical event list twice', () => {
  const s = session(20), a = run(s, 20500, 7).evs, b = run(s, 20500, 7).evs, c = run(s, 20500, 8).evs;
  assert.ok(a.length > 100);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(a), JSON.stringify(c), 'a different seed gives different key forces');
  const n = (t) => of(a, t).length;
  return `${a.length} events: ${n('print')} prints, ${n('space')} spaces, ${n('jam')} jams, ${n('returnEnd')} returns, ${n('bell')} bells`;
});

check('the worklet text (TypeEngine.source) runs in an empty context', () => {
  const Cls = vm.runInNewContext(Engine.source, Object.create(null));
  assert.equal(typeof Cls, 'function');
  const { evs } = run(word(['KeyW', 'KeyO', 'KeyR', 'KeyD'], 10, gapSlow), 1500, 1, Cls);
  assert.equal(of(evs, 'print').map((e) => e.ch).join(''), 'word');
  return `${Engine.source.length} characters of source`;
});

check('the engine runs faster than real time', () => {
  const seconds = 120, s = session(seconds), eng = new Engine({ sampleRate: SR, seed: 3, timing });
  let k = 0, n = 0;
  const sorted = s.slice().sort((a, b) => a.t - b.t), snapBuf = new Float32Array(Engine.SNAP.LEN), t0 = performance.now();
  for (let done = 0; done < seconds * SR; done += 128) {          // blocks of 128 samples, as the AudioWorklet does
    while (k < sorted.length && sorted[k].t * SR / 1000 <= done) { const e = sorted[k++]; if (e.release) eng.release(); else if (e.down) eng.keyDown(e.down); else eng.keyUp(e.up); }
    n += eng.advance(128).length;
    if ((done / 128) % 6 === 0) eng.snapshot(snapBuf);
  }
  const ms = performance.now() - t0, factor = seconds * 1000 / ms;
  assert.ok(n > 500 && factor > 20, `factor ${factor}`);
  return `${seconds} s of machine time in ${ms.toFixed(0)} ms: ${factor.toFixed(0)} times real time (${n} events)`;
});

check('newSheet puts the machine at the left margin and line 0, or at a given position', () => {
  const { eng } = run(word(['KeyA', 'KeyB', 'KeyC'], 10, gapSlow), 1000);
  assert.equal(snap(eng).x, 3, 'three letters typed');
  eng.newSheet();
  const a = snap(eng);
  assert.equal(a.x, 0); assert.equal(a.target, 0); assert.equal(a.line, 0);
  const N = STEP * Math.round(0.4 * SR / STEP), evs = [];
  assert.ok(eng.keyDown('KeyD', F), 'the machine takes a key after newSheet');
  for (const e of eng.advance(N)) evs.push(e);
  eng.keyUp('KeyD');
  for (const e of eng.advance(N)) evs.push(e);
  const p = of(evs, 'print')[0];
  assert.ok(p, 'a print'); assert.ok(Math.abs(p.column) < 0.01, 'print column ' + p.column); assert.equal(Math.floor(p.line), 0);
  eng.newSheet(7, 4);
  const b = snap(eng);
  assert.equal(b.x, 7); assert.equal(b.target, 7); assert.equal(b.line, 4);
  return 'column 0 line 0; then column 7 line 4';
});

console.log(failed ? `${failed} of ${count} checks FAILED` : `all ${count} checks passed`);
process.exit(failed ? 1 : 0);
