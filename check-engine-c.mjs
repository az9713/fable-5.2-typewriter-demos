/* check-engine-c.mjs - checks of engine-c.js (IBM Selectric). Run: node check-engine-c.mjs
 * The script drives the engine offline at 48000 Hz with scripted key events. Exit code 1 if a check fails. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Synth = require('./synth.js');
const Engine = require('./engine-c.js');

const SR = 48000, STEP = Engine.K.STEP_SAMPLES, F = 0.8;        // F: key force of the scripted keys
const timing = Engine.timingFromSynth(Synth.P);
const INT_TOL = 1e-6;
const isInt = (x) => Math.abs(x - Math.round(x)) <= INT_TOL;
const msOf = (n) => n * 1000 / SR;

/* script: [{ t: ms, down | up: code, force } | { t: ms, power: bool }]. Power is on at the start unless opts.power is false. */
function run(script, endMs, seed = 1, Cls = Engine, power = true) {
  const eng = new Cls({ sampleRate: SR, seed, timing, power }), evs = [];
  let now = 0;
  const to = (ms) => { const n = Math.round(ms * SR / 1000 / STEP) * STEP; if (n > now) { for (const e of eng.advance(n - now)) evs.push(e); now = n; } };
  const sorted = script.map((s, i) => [s, i]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]);
  for (const [s] of sorted) {
    to(s.t);
    if ('power' in s) s.ok = eng.setPower(s.power); else if (s.down) s.ok = eng.keyDown(s.down, s.force); else eng.keyUp(s.up);
  }
  to(endMs);
  return { eng, evs };
}
const tap = (t, code, force = F) => [{ t, down: code, force }, { t: t + 20, up: code }];
const word = (codes, t0, gap, force = F) => codes.flatMap((c, i) => tap(t0 + i * gap, c, force));
const of = (evs, type) => evs.filter((e) => e.type === type);
const S = Engine.SNAP;
const snap = (eng) => { const s = eng.snapshot(); return { x: s[S.X], target: s[S.TARGET], line: s[S.LINE], flags: s[S.FLAGS], motor: s[S.MOTOR], tilt: s[S.TILT], rot: s[S.ROTATION], shift: s[S.SHIFT] }; };
const keyIdx = (code) => Engine.KEYS.findIndex((k) => k[0] === code);

let failed = 0, count = 0;
function check(name, fn) {
  count++;
  try { const note = fn(); console.log('ok   ' + name + (note ? ' — ' + note : '')); }
  catch (e) { failed++; console.log('FAIL ' + name + ' — ' + String(e.message).split('\n')[0] + (process.env.DBG ? ' @ ' + e.stack.split('\n').filter((l) => l.includes('check-engine-c')).join(';') : '')); }
}

const T = new Engine({ sampleRate: SR, timing }).times(F);
const gapSlow = 3 * T.cleanAbove, W = 400;                      // W: ms of run-up before the first key (the motor is on at the start)
console.log(`constants at force ${F}: print ${T.travel.toFixed(2)} ms after cycle start, cycle ${T.cycleMs.toFixed(2)} ms, ` +
  `run-up to ready ${T.runUpMs.toFixed(0)} ms, run-down ${T.runDownMs.toFixed(0)} ms, full return ${T.returnMs.toFixed(0)} ms`);

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

check('the print time is the time that the strike sound of synth.js uses', () => {
  const { evs } = run(tap(10, 'KeyA', F), 300);
  const ms = msOf(of(evs, 'print')[0].at - of(evs, 'drive')[0].at);
  const want = Synth.P.C.machine.strike.printMs * (Synth.P.common.strikeVelTime[0] - Synth.P.common.strikeVelTime[1] * F);
  assert.ok(Math.abs(ms - want) <= 1000 * STEP / SR, `print ${ms} ms, synth ${want} ms`);
  return `${ms.toFixed(2)} ms, synth.js ${want.toFixed(2)} ms`;
});

check('one cycle is 65 ms (synth.js cycleMs): two prints are at least one cycle apart', () => {
  const { evs } = run([...tap(10, 'KeyA'), ...tap(10, 'KeyS')], 400);
  const p = of(evs, 'print'), cs = of(evs, 'cycleStart'), ce = of(evs, 'cycleEnd');
  assert.equal(p.length, 2);
  assert.equal(ce[0].at - cs[0].at, Math.round(Synth.P.C.machine.strike.cycleMs * 0.001 * SR));
  const gap = msOf(p[1].at - p[0].at);
  assert.ok(gap >= Synth.P.C.machine.strike.cycleMs - 0.1, `gap ${gap} ms`);
  return `two keys at the same time: prints ${gap.toFixed(2)} ms apart`;
});

check('no jam: two keys at 0 ms and at 5 ms gaps print both, in order, on columns 0 and 1', () => {
  for (const gap of [0, 5, 30]) {
    const { evs, eng } = run([...tap(10, 'KeyA'), ...tap(10 + gap, 'KeyS')], 500);
    assert.equal(of(evs, 'jam').length, 0, `gap ${gap}`);
    const p = of(evs, 'print');
    assert.equal(p.map((e) => e.ch).join(''), 'as'); assert.deepEqual(p.map((e) => e.column), [0, 1]);
    assert.equal(snap(eng).flags & Engine.FLAG_JAM, 0);
    const s = eng.snapshot();
    for (let i = 0; i < Engine.KEYS.length; i++) assert.equal(s[S.BARS + i], 0, 'bar slots stay neutral');
  }
  return 'the second key is stored and runs after the first cycle (GUESS: store of 2 keys)';
});

check('the store holds 2 keys: four keys at the same time print 3 characters, in order; the fourth key is refused', () => {
  const s = [...tap(10, 'KeyA'), ...tap(10, 'KeyS'), ...tap(10, 'KeyD'), ...tap(10, 'KeyF')];
  const { evs } = run(s, 600);
  assert.deepEqual(s.filter((e) => e.down).map((e) => e.ok), [true, true, true, false]);
  assert.equal(of(evs, 'print').map((e) => e.ch).join(''), 'asd');
});

check('a held key does not repeat; release() does nothing and returns false', () => {
  const { evs, eng } = run([{ t: 10, down: 'KeyA' }, { t: 20, down: 'KeyA' }, { t: 30, down: 'KeyA' }], 500);
  assert.equal(of(evs, 'print').length, 1);
  assert.equal(eng.release(), false);
});

check('the bell comes 10 columns before the lock column; the keys lock; a return unlocks them', () => {
  const lock = Engine.K.LINE_COLS, bellBefore = Engine.K.BELL_BEFORE, gap = 100, script = [];
  for (let i = 0; i < lock; i++) script.push(...tap(W + i * gap, i % 2 ? 'KeyS' : 'KeyA'));
  const tEnd = W + lock * gap + 200;
  const extra = tap(tEnd, 'KeyD'), sp = tap(tEnd + 100, 'Space');
  script.push(...extra, ...sp, ...tap(tEnd + 300, 'Enter'), ...tap(tEnd + 300 + T.returnMs + 100, 'KeyF'));
  const { evs, eng } = run(script, tEnd + 300 + T.returnMs + 400);
  const p = of(evs, 'print'), bells = of(evs, 'bell');
  assert.equal(bells.length, 1, 'one bell');
  assert.equal(bells[0].column, lock - bellBefore);
  const before = p.filter((e) => e.at < bells[0].at).length;
  assert.equal(before, lock - bellBefore, 'the bell rings when the carrier comes to the bell column');
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
  const { evs, eng } = run([...word(['KeyA', 'KeyB', 'KeyC'], 10, gapSlow), ...tap(800, 'Enter'), ...tap(830, 'KeyX')], 800 + T.returnMs + 400);
  const a = of(evs, 'returnStart')[0], b = of(evs, 'returnEnd')[0];
  assert.ok(a && b);
  assert.equal(a.column, 3); assert.equal(a.line, 0);
  const ms = msOf(b.at - a.at), M = Synth.P.C.machine;
  assert.ok(ms > M.ret.startMs, 'the carrier travel starts after the clutch');
  const s = snap(eng);
  assert.equal(s.x, 0); assert.equal(s.target, 0); assert.equal(s.line, 1);
  assert.equal(of(evs, 'print').length, 3, 'a key during the return does not print');
  return `${ms.toFixed(1)} ms from column 3 (start delay ${M.ret.startMs} ms)`;
});

check('the return time grows with the distance: column 3 < 20 < 60; a full line equals the synth.js travel time', () => {
  const ret = (cols) => {
    const codes = Array.from({ length: cols }, (_, i) => (i % 2 ? 'KeyS' : 'KeyA'));
    const t0 = W + cols * 100 + 100;
    const { evs } = run([...word(codes, W, 100), ...tap(t0, 'Enter')], t0 + 1500);
    const a = of(evs, 'returnStart')[0], b = of(evs, 'returnEnd')[0];
    return msOf(b.at - a.at);
  };
  const r3 = ret(3), r20 = ret(20), r60 = ret(60), M = Synth.P.C.machine.ret;
  assert.ok(r3 < r20 && r20 < r60, `${r3} ${r20} ${r60}`);
  const full = ret(Engine.K.LINE_COLS - 1);
  assert.ok(Math.abs(full - (M.startMs + M.travelMs * (Engine.K.LINE_COLS - 1) / Engine.K.LINE_COLS)) < 1, `full ${full}`);
  return `3 columns ${r3.toFixed(0)} ms, 20 columns ${r20.toFixed(0)} ms, 60 columns ${r60.toFixed(0)} ms`;
});

check('the lever at the left margin feeds one line and does not move the carrier', () => {
  const { evs, eng } = run(tap(W, 'Enter'), W + 400);
  assert.equal(of(evs, 'linefeed').length, 1); assert.equal(of(evs, 'returnStart').length, 0);
  assert.equal(snap(eng).line, 1); assert.equal(snap(eng).x, 0);
});

check('the index key (ArrowDown) feeds one line and keeps the column', () => {
  const { evs, eng } = run([...word(['KeyA', 'KeyB'], W, gapSlow), ...tap(W + 600, Engine.CODE_INDEX), ...tap(W + 800, 'KeyC')], W + 1200);
  const p = of(evs, 'print');
  assert.equal(of(evs, 'linefeed').length, 1);
  assert.deepEqual(p.map((e) => [e.column, e.line]), [[0, 0], [1, 0], [2, 1]]);
  assert.equal(snap(eng).line, 1);
});

check('backspace moves one column back and adds no print', () => {
  const { evs, eng } = run([...word(['KeyA', 'KeyB'], W, gapSlow), ...tap(W + 600, 'Backspace'), ...tap(W + 900, 'KeyC')], W + 1300);
  const mid = run([...word(['KeyA', 'KeyB'], W, gapSlow), ...tap(W + 600, 'Backspace')], W + 800);
  assert.equal(snap(mid.eng).x, 1); assert.equal(of(mid.evs, 'print').length, 2);
  assert.equal(of(mid.evs, 'backspace')[0].column, 1);
  assert.deepEqual(of(evs, 'print').map((e) => e.column), [0, 1, 1]);
  assert.equal(snap(eng).x, 2);
  const none = run(tap(W, 'Backspace'), W + 200);
  assert.equal(of(none.evs, 'backspace').length, 0, 'no backspace at the left margin');
});

check('every print is on a whole column (the carrier is at rest at the print), also in a fast session', () => {
  const { evs } = run(session(10), 10500);
  const p = of(evs, 'print');
  assert.ok(p.length > 50);
  assert.ok(p.every((e) => isInt(e.column)), 'a print is off its column');
  return `${p.length} prints, tolerance ${INT_TOL}`;
});

check('shift: a shift operation turns the element half a turn; the shift character prints after it', () => {
  const key = keyIdx('KeyA');
  const lo = of(run(tap(W, 'KeyA'), W + 300).evs, 'print')[0];
  const up = run([{ t: W, down: 'ShiftLeft' }, ...tap(W + 100, 'KeyA'), { t: W + 300, up: 'ShiftLeft' }, ...tap(W + 600, 'KeyA')], W + 900);
  const p = of(up.evs, 'print'), sh = of(up.evs, 'shift');
  assert.equal(p.map((e) => e.ch).join(''), 'Aa');
  assert.equal(p[0].shift, 1); assert.equal(p[1].shift, 0);
  assert.deepEqual(sh.map((e) => e.to), [1, 0]);
  assert.equal(((p[0].rotation - lo.rotation) % 360 + 360) % 360, 180);
  assert.equal(p[0].tilt, lo.tilt);
  const both = run([{ t: W, down: 'ShiftLeft' }, ...tap(W, 'KeyA')], W + 300);
  const bp = of(both.evs, 'print')[0], bs = of(both.evs, 'shift')[0];
  assert.equal(bp.ch, 'A'); assert.ok(bp.at > bs.at + Math.round(Engine.K.SHIFT_MS * 0.001 * SR) - 1, 'the print waits for the shift operation');
  assert.equal(snap(both.eng).shift, 1);
  return `shift operation ${Engine.K.SHIFT_MS} ms; key ${key}: rotation ${lo.rotation.toFixed(1)} deg, with shift ${p[0].rotation.toFixed(1)} deg`;
});

check('element tilt and rotation change with the character, and are in the snapshot', () => {
  const at = (code) => { const r = run(tap(W, code), W + 300); return { p: of(r.evs, 'print')[0], s: snap(r.eng) }; };
  const a = at('KeyA'), q = at('KeyQ'), s = at('KeyS'), one = at('Digit1');
  assert.notEqual(a.s.tilt, q.s.tilt, 'row a and row q have different tilt');
  assert.equal(a.s.tilt, a.p.tilt); assert.ok(Math.abs(a.s.rot - a.p.rotation) < 1e-3, `${a.s.rot} ${a.p.rotation}`);
  assert.equal(a.p.tilt, s.p.tilt, 'two keys of one tilt row');
  assert.notEqual(a.s.rot, s.s.rot, 'two keys of one tilt row have different rotation');
  assert.equal(new Set([a.s.tilt, q.s.tilt, one.s.tilt]).size, 3);
  assert.ok(Engine.K.TILT_ROWS === 4 && Engine.KEYS.length === 44);
  const mid = run(tap(W, 'KeyQ'), W + 6);                        // 6 ms after key-down: the element is still moving
  assert.ok(snap(mid.eng).tilt > 0 && snap(mid.eng).tilt < q.s.tilt, `tilt ${snap(mid.eng).tilt}`);
  return `a: tilt ${a.s.tilt} rot ${a.s.rot.toFixed(1)}; s: rot ${s.s.rot.toFixed(1)}; q: tilt ${q.s.tilt}; 1: tilt ${one.s.tilt}`;
});

check('motor off: keys do nothing (no print, no event, key refused); the motor needs the switch', () => {
  const s = [...word(['KeyA', 'KeyB'], 10, 100), ...tap(300, 'Space'), ...tap(400, 'Enter'), { t: 500, down: 'ShiftLeft' }];
  const { evs, eng } = run(s, 1500, 1, Engine, false);
  assert.equal(evs.length, 0);
  assert.ok(s.filter((e) => e.down).every((e) => e.ok === false));
  assert.equal(snap(eng).motor, 0); assert.equal(snap(eng).x, 0);
});

check('motor run-up: motorOn at the switch, motorReady after the run-up, speed rises; a key in the run-up prints after motorReady', () => {
  const k = tap(60, 'KeyA');
  const r = run([{ t: 10, power: true }, ...k], 1000, 1, Engine, false);
  const on = of(r.evs, 'motorOn')[0], ready = of(r.evs, 'motorReady')[0], pr = of(r.evs, 'print')[0];
  assert.ok(on && ready && pr); assert.equal(k[0].ok, true);
  const run_ms = msOf(ready.at - on.at);
  assert.ok(Math.abs(run_ms - T.runUpMs) < 1, `run-up ${run_ms}`);
  assert.ok(pr.at > ready.at, 'no print before the motor is at speed');
  const early = run([{ t: 10, power: true }], 10 + 100, 1, Engine, false);
  const sp = snap(early.eng).motor;
  assert.ok(sp > 0.1 && sp < 0.9, `speed at 100 ms ${sp}`);
  assert.equal(snap(r.eng).motor, 1);
  assert.ok(snap(r.eng).flags & Engine.FLAG_MOTOR);
  return `run-up ${run_ms.toFixed(1)} ms; speed after 100 ms ${sp.toFixed(2)}`;
});

check('motor run-down: motorOff at the switch, speed falls, motorStopped later; keys are refused; stored keys are lost', () => {
  const s = [...tap(W, 'KeyA'), { t: W + 500, power: false }, ...tap(W + 700, 'KeyB')];
  const r = run(s, W + 500 + 1200);
  const off = of(r.evs, 'motorOff')[0];
  assert.ok(off); assert.equal(of(r.evs, 'motorStopped').length, 0, 'the motor is still turning after 1.2 s');
  assert.equal(s[3].ok, false); assert.equal(of(r.evs, 'print').length, 1);
  const sp = snap(r.eng).motor; assert.ok(sp > 0 && sp < 1, `speed ${sp}`);
  const r2 = run([...tap(W, 'KeyA'), { t: W + 500, power: false }], W + 500 + 3000);
  const stop = of(r2.evs, 'motorStopped')[0];
  assert.ok(stop); assert.ok(Math.abs(msOf(stop.at - of(r2.evs, 'motorOff')[0].at) - Engine.K.RUNDOWN_S * 1000) < 2);
  assert.equal(snap(r2.eng).motor, 0);
  const again = run([{ t: 10, power: false }, { t: 20, power: false }], 100);
  assert.equal(of(again.evs, 'motorOff').length, 1, 'a second off does nothing');
  return `speed after 1.2 s of run-down ${sp.toFixed(2)}`;
});

check('a key that the machine does not have does nothing', () => {
  const s = [...tap(W, 'F5'), ...tap(W + 100, 'Tab'), ...tap(W + 200, 'Backquote')];
  const { evs } = run(s, W + 600);
  assert.equal(evs.filter((e) => e.type !== 'motorReady').length, 0); assert.ok(s.filter((e) => e.down).every((e) => e.ok === false));
});

/* a long scripted session with forces from the seed: used for the repeat check and the speed check */
function session(seconds) {
  const codes = Engine.KEYS.map((k) => k[0]), s = [];
  let t = 450, i = 0, col = 0;
  while (t < seconds * 1000) {
    const gap = 40 + ((i * 37) % 120);                            // 40 to 159 ms between keys: some keys go into the store
    if (col >= 62) { s.push({ t, down: 'Enter' }, { t: t + 20, up: 'Enter' }); t += 900; col = 0; }
    else if (i % 6 === 5) { s.push({ t, down: 'Space' }, { t: t + 20, up: 'Space' }); t += gap; col++; }
    else { const c = codes[(i * 11) % codes.length]; s.push({ t, down: c }, { t: t + 20, up: c }); col++; t += gap; }
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
  return `${a.length} events: ${n('print')} prints, ${n('space')} spaces, ${n('returnEnd')} returns, ${n('bell')} bells`;
});

check('the worklet text (SelectricEngine.source) runs in an empty context', () => {
  const Cls = vm.runInNewContext(Engine.source, Object.create(null));
  assert.equal(typeof Cls, 'function');
  const { evs } = run(word(['KeyW', 'KeyO', 'KeyR', 'KeyD'], W, gapSlow), W + 1500, 1, Cls);
  assert.equal(of(evs, 'print').map((e) => e.ch).join(''), 'word');
  return `${Engine.source.length} characters of source`;
});

check('the engine can be loaded with engine.js on one page (two global names)', () => {
  const Other = require('./engine.js');
  assert.notEqual(Other, Engine); assert.equal(typeof globalThis.TypeEngine, 'function'); assert.equal(typeof globalThis.SelectricEngine, 'function');
});

check('the engine runs faster than real time', () => {
  const seconds = 120, s = session(seconds), eng = new Engine({ sampleRate: SR, seed: 3, timing, power: true });
  let k = 0, n = 0;
  const sorted = s.slice().sort((a, b) => a.t - b.t), snapBuf = new Float32Array(Engine.SNAP.LEN), t0 = performance.now();
  for (let done = 0; done < seconds * SR; done += 128) {          // blocks of 128 samples, as the AudioWorklet does
    while (k < sorted.length && sorted[k].t * SR / 1000 <= done) { const e = sorted[k++]; if (e.down) eng.keyDown(e.down); else eng.keyUp(e.up); }
    n += eng.advance(128).length;
    if ((done / 128) % 6 === 0) eng.snapshot(snapBuf);
  }
  const ms = performance.now() - t0, factor = seconds * 1000 / ms;
  assert.ok(n > 500 && factor > 20, `factor ${factor}`);
  return `${seconds} s of machine time in ${ms.toFixed(0)} ms: ${factor.toFixed(0)} times real time (${n} events)`;
});

check('newSheet puts the machine at the left margin and line 0, or at a given position', () => {
  const { eng } = run(word(['KeyA', 'KeyB', 'KeyC'], W, gapSlow), W + 3 * gapSlow + 600);
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
