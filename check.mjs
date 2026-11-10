// check.mjs - run with: node check.mjs
// Loads synth.js, renders every sound at 48000 Hz with a fixed seed, and asserts basic properties.
// The machine sounds are checked in version 1 and in version 2 (P.common.machineVersion).
// The spectral checks use the FFT in this file, not the one in synth.js.
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const S = createRequire(import.meta.url)('./synth.js');   // synth.js is a classic script with a CommonJS tail
const SR = 48000, SEED = 1, MAX_MS = 5000, DEFAULT_VERSION = S.P.common.machineVersion;
let failed = 0, count = 0;

function check(name, fn) {
  count++;
  try { const info = fn(); console.log('ok   ' + name + (info ? '  [' + info + ']' : '')); }
  catch (e) { failed++; console.log('FAIL ' + name + '  -> ' + e.message); }
}
const chans = (x) => (x instanceof Float32Array ? [x] : [x.L, x.R]);
const peak = (x) => { let p = 0; for (const c of chans(x)) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > p) p = a; } return p; };
const finite = (x) => chans(x).every((c) => { for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i])) return false; return true; });
const same = (a, b) => { const A = chans(a), B = chans(b); return A.length === B.length && A.every((c, k) => c.length === B[k].length && Buffer.from(c.buffer).equals(Buffer.from(B[k].buffer))); };
const dur = (x) => chans(x)[0].length / SR;
const setVersion = (v) => { S.P.common.machineVersion = v; };

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let k = n >> 1; while (j & k) { j ^= k; k >>= 1; } j ^= k;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + h] * cr - im[i + k + h] * ci, vi = re[i + k + h] * ci + im[i + k + h] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + h] = ur - vr; im[i + k + h] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
function psd(x, nfft) {                       // mean power spectrum, Hann window, 50 % overlap
  const out = new Float64Array(nfft / 2 + 1), re = new Float64Array(nfft), im = new Float64Array(nfft);
  let cnt = 0;
  for (let s = 0; s + nfft <= x.length; s += nfft / 2) {
    for (let i = 0; i < nfft; i++) { re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / nfft)); im[i] = 0; }
    fft(re, im);
    for (let i = 0; i <= nfft / 2; i++) out[i] += re[i] * re[i] + im[i] * im[i];
    cnt++;
  }
  for (let i = 0; i < out.length; i++) out[i] /= cnt;
  return out;
}
function bandPower(p, nfft, lo, hi) { let s = 0; for (let i = 0; i < p.length; i++) { const f = i * SR / nfft; if (f >= lo && f < hi) s += p[i]; } return s; }
function centroid(x) {                        // magnitude-weighted mean frequency, 20 Hz to 20 kHz
  let n = 1; while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n); re.set(x); fft(re, im);
  let a = 0, b = 0;
  for (let i = 1; i < n / 2; i++) { const f = i * SR / n; if (f < 20 || f > 20000) continue; const m = Math.hypot(re[i], im[i]); a += f * m; b += m; }
  return a / b;
}
function envelopePeakHz(x, lo, hi) {          // strongest periodic change of the level between lo and hi Hz
  const D = SR / 200, n = Math.floor(x.length / D), env = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < D; j++) s += Math.abs(x[i * D + j]); env[i] = s / D; mean += env[i]; }
  mean /= n;
  let best = 0, bestF = 0;
  for (let f = lo; f <= hi; f += 0.002) {
    let c = 0, s = 0; const w = 2 * Math.PI * f / 200;
    for (let i = 0; i < n; i++) { const v = env[i] - mean; c += v * Math.cos(w * i); s += v * Math.sin(w * i); }
    const m = c * c + s * s; if (m > best) { best = m; bestF = f; }
  }
  return bestF;
}

/* ---------- measurement of one machine sound: the same method as the measurement of the recordings ----------
 * end: last sample where the 2 ms RMS envelope is above (peak envelope - 60 dB). Octave bands fc/sqrt2..fc*sqrt2, dB re total.
 * attack: 10 % to 90 % rise of the 0.5 ms RMS envelope, up to the first onset above 1.5 kHz. Crest: peak / RMS of the part to the end. */
const BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
function bq(type, f, q) { const w = 2 * Math.PI * f / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q); const b0 = type === 'lp' ? (1 - c) / 2 : (1 + c) / 2, b1 = type === 'lp' ? 1 - c : -(1 + c), a0 = 1 + al; return [b0 / a0, b1 / a0, b0 / a0, -2 * c / a0, (1 - al) / a0]; }
function runBq(x, k) { const y = new Float64Array(x.length); let z1 = 0, z2 = 0; for (let i = 0; i < x.length; i++) { const v = x[i], o = k[0] * v + z1; z1 = k[1] * v - k[3] * o + z2; z2 = k[2] * v - k[4] * o; y[i] = o; } return y; }
const butter4 = (x, f, type) => runBq(runBq(x, bq(type, f, 0.5412)), bq(type, f, 1.3066));
function rmsEnv(x, win) {
  const n = x.length, cs = new Float64Array(n + 1), e = new Float64Array(n), h = Math.floor(win / 2);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i] * x[i];
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n, i - h + win); e[i] = Math.sqrt((cs[b] - cs[a]) / Math.max(1, b - a)); }
  return e;
}
const maxOf = (a) => { let m = 0; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; };
const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));
function endIndex(x) { const e = rmsEnv(x, Math.round(0.002 * SR)), th = maxOf(e) * 1e-3; let last = 0; for (let i = 0; i < e.length; i++) if (e[i] >= th) last = i; return last + 1; }
function onsetsHF(x) {                        // onsets above 1.5 kHz: 1 ms RMS envelope, 0.25 ms hop, 6 dB prominence, within 30 dB of the peak
  const sig = butter4(x, 1500, 'hp'), hop = Math.round(0.00025 * SR), env = rmsEnv(sig, Math.round(0.001 * SR)), m = Math.floor(env.length / hop);
  const L0 = []; for (let i = 0; i < m; i++) L0.push(db(env[i * hop]));
  const pk = Math.max(...L0), L = [-200, ...L0, -200], n = L.length, cand = [];
  for (let i = 1; i < n - 1; i++) {
    if (!(L[i] >= L[i - 1] && L[i] > L[i + 1]) || L[i] < pk - 30) continue;
    let lm = L[i], j = i - 1; while (j >= 0 && L[j] <= L[i]) { if (L[j] < lm) lm = L[j]; j--; }
    let rm = L[i]; j = i + 1; while (j < n && L[j] <= L[i]) { if (L[j] < rm) rm = L[j]; j++; }
    if (L[i] - Math.max(rm, lm) >= 6) cand.push(i);
  }
  const keep = []; for (const i of cand) { const l = keep[keep.length - 1]; if (l !== undefined && i - l < 8) { if (L[i] > L[l]) keep[keep.length - 1] = i; } else keep.push(i); }
  return keep.map((i) => (i - 1) * 0.25);     // ms of the envelope peak of each onset
}
function measureSound(x) {
  x = Float64Array.from(x);
  const end = endIndex(x), r = { durMs: end / SR * 1000 };
  let ss = 0; for (let i = 0; i < end; i++) ss += x[i] * x[i];
  r.crestDb = db(maxOf(x.map(Math.abs))) - db(Math.sqrt(ss / end)); r.rmsDb = db(Math.sqrt(ss / end));
  const on = onsetsHF(x); r.onsets = on.length;
  if (on.length) {
    const ea = rmsEnv(x, Math.round(0.0005 * SR)), lim = Math.min(ea.length, Math.round((on[0] + 1.5) * 1e-3 * SR));
    let m = 0, a = -1, b = -1; for (let i = 0; i < lim; i++) if (ea[i] > m) m = ea[i];
    for (let i = 0; i < lim; i++) { if (a < 0 && ea[i] >= 0.1 * m) a = i; if (a >= 0 && ea[i] >= 0.9 * m) { b = i; break; } }
    r.attackMs = (b - a) / SR * 1000;
  } else r.attackMs = NaN;
  let n = 16384; while (n < end) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n); re.set(x.subarray(0, end)); fft(re, im);
  let ma = 0, mb = 0, tot = 0; const bE = new Float64Array(BANDS.length);
  for (let i = 1; i < n / 2; i++) {
    const f = i * SR / n, p = re[i] * re[i] + im[i] * im[i];
    if (f >= 20) tot += p;
    if (f >= 20 && f <= 20000) { ma += f * Math.sqrt(p); mb += Math.sqrt(p); }
    for (let k = 0; k < BANDS.length; k++) if (f >= BANDS[k] / Math.SQRT2 && f < BANDS[k] * Math.SQRT2) bE[k] += p;
  }
  r.centroid = ma / mb; r.bands = {}; BANDS.forEach((b, k) => { r.bands[b] = 10 * Math.log10(Math.max(bE[k], 1e-30) / tot); });
  return r;
}
function bellPartials(x) {                    // the 5 strongest spectral peaks between 200 Hz and 15 kHz, 2 % apart: [Hz, dB re strongest]
  x = Float64Array.from(x);
  const seg = x.subarray(0, endIndex(x)); let n = 1 << 16; while (n < seg.length * 2) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < seg.length; i++) re[i] = seg[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * (i + seg.length) / (2 * seg.length)));
  fft(re, im);
  const m = new Float64Array(n / 2); let mx = 0; for (let i = 0; i < n / 2; i++) { m[i] = Math.hypot(re[i], im[i]); if (m[i] > mx) mx = m[i]; }
  const pk = [];
  for (let i = 2; i < n / 2 - 1; i++) { const f = i * SR / n; if (f < 200 || f > 15000) continue; if (m[i] > m[i - 1] && m[i] >= m[i + 1] && m[i] > mx * 0.00316) pk.push({ f, m: m[i] }); }
  pk.sort((a, b) => b.m - a.m);
  const top = []; for (const p of pk) { if (top.every((q) => Math.abs(q.f - p.f) / q.f > 0.02)) top.push(p); if (top.length === 5) break; }
  return top.sort((a, b) => a.f - b.f).map((p) => [p.f, 20 * Math.log10(p.m / top.reduce((a, q) => Math.max(a, q.m), 0))]);
}
const meanOf = (rs, f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;

// ---------- music and media: the same in both versions ----------
const RANGES = {                              // expected duration in seconds
  strike: [0.08, 0.7], space: [0.08, 0.7], ret: [0.5, 3], linefeed: [0.1, 1], bell: [0.3, 3], motor: [2, 8],
  music: [15, 30], medium: [15, 30]
};
const MACHINE = ['strike', 'space', 'ret', 'linefeed', 'bell'];
const clips = {};
function clipChecks(id, x, y, ms, name) {
  check(id + ' every sample is finite', () => { assert.ok(finite(x)); });
  check(id + ' peak is above 0.01 and below 1.0', () => { const p = peak(x); assert.ok(p > 0.01 && p < 1.0, 'peak ' + p); return 'peak ' + p.toFixed(3); });
  check(id + ' duration is in its range', () => { const d = dur(x), r = RANGES[name]; assert.ok(d >= r[0] && d <= r[1], d + ' s not in ' + r); return d.toFixed(3) + ' s'; });
  check(id + ' same seed gives bit-identical output', () => { assert.ok(same(x, y)); });
  check(id + ' renders in less than 5 s', () => { assert.ok(ms < MAX_MS, ms + ' ms'); return ms.toFixed(0) + ' ms'; });
}
function render(k, name, params) {
  const t0 = performance.now(), x = S[k][name](SR, SEED, params), ms = performance.now() - t0;
  return { x, y: S[k][name](SR, SEED, params), ms };
}
for (const k of S.KEYS) {
  for (const name of ['music', 'medium']) {
    const r = render(k, name, name === 'medium' ? { input: clips[k + '.music'] } : {});
    clips[k + '.' + name] = r.x;
    clipChecks(k + '.' + name, r.x, r.y, r.ms, name);
  }
  check(k + '.music is stereo only for C', () => { assert.strictEqual(clips[k + '.music'] instanceof Float32Array, k !== 'C'); assert.strictEqual(clips[k + '.medium'] instanceof Float32Array, k !== 'C'); });
  check(k + '.music is bit-identical in machine sound version 1 and version 2', () => {
    setVersion(1); const a = S[k].music(SR, SEED); setVersion(2); const b = S[k].music(SR, SEED); setVersion(DEFAULT_VERSION);
    assert.ok(same(a, b));
  });
}

// ---------- machine sounds: every check runs for version 1 and for version 2 ----------
const strikeCentroids = {};
for (const ver of [1, 2]) {
  setVersion(ver);
  const V = 'v' + ver + ' ';
  for (const k of S.KEYS) {
    for (const name of MACHINE.concat(S[k].motor ? ['motor'] : [])) {
      const r = render(k, name, { velocity: 0.8 });
      clips[V + k + '.' + name] = r.x;
      clipChecks(V + k + '.' + name, r.x, r.y, r.ms, name);
    }
    check(V + k + '.strike velocity changes the level', () => {
      const lo = peak(S[k].strike(SR, SEED, { velocity: 0.3 })), hi = peak(S[k].strike(SR, SEED, { velocity: 1 }));
      assert.ok(hi > 1.5 * lo && hi < 1.0, lo + ' ' + hi); return 'peak ' + lo.toFixed(3) + ' at 0.3, ' + hi.toFixed(3) + ' at 1.0';
    });
    check(V + k + '.strike seed changes the sound', () => { assert.ok(!same(S[k].strike(SR, SEED, {}), S[k].strike(SR, SEED + 1, {}))); });
  }
  check(V + 'C.motor loop is seamless (last sample continues into the first)', () => {
    const m = clips[V + 'C.motor'], n = m.length; let maxStep = 0;
    for (let i = 1; i < n; i++) maxStep = Math.max(maxStep, Math.abs(m[i] - m[i - 1]));
    const wrap = Math.abs(m[0] - m[n - 1]); assert.ok(wrap <= maxStep * 1.05, wrap + ' > ' + maxStep); return 'step at the loop point ' + wrap.toFixed(4) + ', largest step inside ' + maxStep.toFixed(4);
  });
  check(V + 'key strike spectral centroid is ordered A < B < C (the prediction in synth.js)', () => {
    const c = {};
    for (const k of S.KEYS) { let s = 0; for (let i = 0; i < 12; i++) s += centroid(S[k].strike(SR, SEED + i, { velocity: 0.8 })); c[k] = s / 12; }
    strikeCentroids[ver] = c;
    assert.ok(c.A < c.B && c.B < c.C, JSON.stringify(c)); return 'A ' + c.A.toFixed(0) + ' Hz, B ' + c.B.toFixed(0) + ' Hz, C ' + c.C.toFixed(0) + ' Hz (mean of 12 keys)';
  });
}
check('C.motor is bit-identical in version 1 and version 2', () => { assert.ok(same(clips['v1 C.motor'], clips['v2 C.motor'])); });

// ---------- version 1 is bit-identical to the machine sounds before version 2 was added ----------
// sha256 (first 16 hex digits) of all buffers for seeds 1, 2, 3 and the parameters {}, { velocity: 0.3 }, { velocity: 1 }.
const V1_HASHES = {
  'A.strike': 'a9b4bc9249a7e80d', 'A.space': '07f71e7b234e5d6f', 'A.ret': 'b3d1c417a5f1192b', 'A.linefeed': 'f6362b6c7f914ca2', 'A.bell': '995ce2da37dbd64a',
  'B.strike': 'a574abc02eb34915', 'B.space': '24f81b9c1e789bc8', 'B.ret': '31465e5157608c99', 'B.linefeed': '2425e3515a54aadc', 'B.bell': '271f665049dfd72a',
  'C.strike': '19f3ca73a4bc1242', 'C.space': '7449be998831449e', 'C.ret': '249c01dc6fe2c861', 'C.linefeed': '52a316f32868d69f', 'C.bell': '2fe0a03f749bce36',
  'C.motor': 'd96030e2477a3b4b'
};
setVersion(1);
check('v1 machine sounds are bit-identical to the first version (16 hashes, seeds 1 to 3, 3 velocities)', () => {
  const bad = [];
  for (const id of Object.keys(V1_HASHES)) {
    const [k, name] = id.split('.'), h = crypto.createHash('sha256');
    for (const seed of [1, 2, 3]) for (const p of [{}, { velocity: 0.3 }, { velocity: 1 }]) { const x = S[k][name](SR, seed, p); h.update(Buffer.from(x.buffer, x.byteOffset, x.byteLength)); }
    if (h.digest('hex').slice(0, 16) !== V1_HASHES[id]) bad.push(id);
  }
  assert.deepStrictEqual(bad, []); return Object.keys(V1_HASHES).length + ' of ' + Object.keys(V1_HASHES).length + ' hashes agree';
});

// ---------- version 2: levels ----------
setVersion(2);
const PAGE_SEEDS = { strike: Array.from({ length: 24 }, (_, i) => 101 + i), space: [200, 201, 202], ret: [300, 301], linefeed: [400, 401], bell: [501] };   // seeds that index.html uses
const SEEDS12 = Array.from({ length: 12 }, (_, i) => i + 1);
for (const k of S.KEYS) for (const name of MACHINE) {
  check('v2 ' + k + '.' + name + ' peak at velocity 1.0 is between 0.3 and 0.9 (seeds 1 to 12 and the seeds of index.html)', () => {
    let lo = 9, hi = 0;
    for (const s of SEEDS12.concat(PAGE_SEEDS[name])) { const p = peak(S[k][name](SR, s, { velocity: 1 })); lo = Math.min(lo, p); hi = Math.max(hi, p); }
    assert.ok(lo >= 0.3 && hi <= 0.9, 'min ' + lo + ' max ' + hi); return 'min ' + lo.toFixed(3) + ', max ' + hi.toFixed(3);
  });
}
for (const k of S.KEYS) {
  const r = {};
  for (const ver of [1, 2]) { setVersion(ver); const m = SEEDS12.map((s) => measureSound(S[k].strike(SR, s, { velocity: 0.8 }))); r[ver] = [meanOf(m, (q) => q.rmsDb), meanOf(m, (q) => q.rmsDb + 10 * Math.log10(q.durMs / 1000))]; }
  console.log('info ' + k + '.strike at velocity 0.8, RMS of the part to -60 dB: version 1 ' + r[1][0].toFixed(1) + ' dB, version 2 ' + r[2][0].toFixed(1) + ' dB; energy: version 1 ' + r[1][1].toFixed(1) + ' dB, version 2 ' + r[2][1].toFixed(1) + ' dB');
}

// ---------- version 2 of setting B against numeric targets ----------
// measured on recordings of a real manual typewriter
const TARGET = {
  strike: { durMs: 168, centroid: 6783, crestDb: 22.5, bands: { 250: -27.1, 500: -23.3, 4000: -5.0, 8000: -3.3 } },
  space: { durMs: 153, centroid: 5886, crestDb: 23.7, bands: { 250: -24.5, 500: -27.6, 4000: -5.4, 8000: -6.3 } },
  linefeed: { centroid: 8564, bands: { 1000: -31.4, 8000: -1.3 } },
  lever: { centroid: 7305, onsets: 9, bands: { 4000: -6.1, 8000: -3.1 } },
  stop: { durMs: 246, centroid: 6711, attackMs: 9.8, bands: { 250: -15.0, 4000: -5.9, 8000: -4.3 } },
  bell: { durMs: 1243, ratio: [2.5, 3.0], partials: 5 }
};
// Tolerances: centroid +/- 20 %, octave bands +/- 6 dB, duration +/- 30 %, crest +/- 3 dB, attack of strike and space 2 to 8 ms,
// attack of the stop 2 to 20 ms, onsets of the return lever part at most 20 (version 1: about 71).
// Bell: structural checks only (the partial frequencies of the recorded bell are not targets).
// Conditions: seeds 1 to 12; key strike at velocity 0.6, the other sounds at velocity 0.8.
function sounds(name) {
  const M = S.P.B.machine, C = S.P.common, stop = Math.round((M.linefeed.clicks * M.linefeed.gapMs + C.ret.gapMs) * 1e-3 * SR) + Math.round(M.ret.travelMs * 1e-3 * SR);
  return SEEDS12.map((s) => {
    if (name === 'lever' || name === 'stop') { const x = S.B.ret(SR, s, {}); return name === 'lever' ? x.subarray(0, stop) : x.subarray(stop); }
    return S.B[name](SR, s, name === 'strike' ? { velocity: 0.6 } : {});
  });
}
const within = (v, t, rel) => Math.abs(v - t) <= Math.abs(t) * rel;
for (const name of ['strike', 'space', 'linefeed', 'lever', 'stop']) {
  const T = TARGET[name], m = sounds(name).map(measureSound), id = 'v2 B.' + (name === 'lever' ? 'ret lever part' : name === 'stop' ? 'ret end stop' : name);
  const cen = meanOf(m, (q) => q.centroid);
  check(id + ' spectral centroid is within 20 % of ' + T.centroid + ' Hz', () => { assert.ok(within(cen, T.centroid, 0.2), cen.toFixed(0)); return cen.toFixed(0) + ' Hz'; });
  for (const b of Object.keys(T.bands)) {
    const v = meanOf(m, (q) => q.bands[b]);
    check(id + ' octave band ' + b + ' Hz is within 6 dB of ' + T.bands[b] + ' dB re total', () => { assert.ok(Math.abs(v - T.bands[b]) <= 6, v.toFixed(1)); return v.toFixed(1) + ' dB'; });
  }
  if (T.durMs) { const v = meanOf(m, (q) => q.durMs); check(id + ' duration to -60 dB is within 30 % of ' + T.durMs + ' ms', () => { assert.ok(within(v, T.durMs, 0.3), v.toFixed(0)); return v.toFixed(0) + ' ms'; }); }
  if (T.crestDb) { const v = meanOf(m, (q) => q.crestDb); check(id + ' crest factor is within 3 dB of ' + T.crestDb + ' dB', () => { assert.ok(Math.abs(v - T.crestDb) <= 3, v.toFixed(1)); return v.toFixed(1) + ' dB'; }); }
  if (name === 'strike' || name === 'space') { const v = meanOf(m, (q) => q.attackMs); check(id + ' attack of the first event is between 2 and 8 ms', () => { assert.ok(v >= 2 && v <= 8, v.toFixed(2)); return v.toFixed(2) + ' ms'; }); }
  if (T.attackMs) { const v = meanOf(m, (q) => q.attackMs); check(id + ' attack is between 2 and 20 ms (target ' + T.attackMs + ' ms)', () => { assert.ok(v >= 2 && v <= 20, v.toFixed(2)); return v.toFixed(2) + ' ms'; }); }
  if (T.onsets) { const v = meanOf(m, (q) => q.onsets); check(id + ' has at most 20 distinct events above 1.5 kHz (target ' + T.onsets + ')', () => { assert.ok(v <= 20, v.toFixed(1)); return v.toFixed(1) + ' onsets'; }); }
}
{
  const xs = sounds('bell'), T = TARGET.bell, m = xs.map(measureSound), v = meanOf(m, (q) => q.durMs), P5 = bellPartials(xs[0]);
  check('v2 B.bell duration to -60 dB is within 30 % of ' + T.durMs + ' ms', () => { assert.ok(within(v, T.durMs, 0.3), v.toFixed(0)); return v.toFixed(0) + ' ms'; });
  check('v2 B.bell strongest partial is between ' + T.ratio[0] + ' and ' + T.ratio[1] + ' times the lowest partial', () => {
    const top = P5.find((p) => p[1] === 0), r = top[0] / P5[0][0];
    assert.ok(r >= T.ratio[0] && r <= T.ratio[1], JSON.stringify(P5)); return 'ratio ' + r.toFixed(3) + '; ' + P5.map((p) => p[0].toFixed(0) + ' Hz ' + p[1].toFixed(1) + ' dB').join(', ');
  });
  check('v2 B.bell has at least ' + T.partials + ' partials within 20 dB of the strongest', () => {
    const n = P5.filter((p) => p[1] >= -20).length; assert.ok(n >= T.partials, String(n)); return n + ' partials';
  });
}
setVersion(DEFAULT_VERSION);

// ---------- media ----------
const NFFT = 16384;
for (const k of ['A', 'B']) {
  const M = S.P[k].medium, dev = clips[k + '.medium'], rot = M.rpm / 60;
  check(k + '.medium energy outside ' + M.band[0] + ' to ' + M.band[1] + ' Hz is at least 20 dB below the energy inside', () => {
    const p = psd(dev, NFFT), inside = bandPower(p, NFFT, M.band[0], M.band[1]), outside = bandPower(p, NFFT, 0, M.band[0]) + bandPower(p, NFFT, M.band[1], SR);
    const db = 10 * Math.log10(outside / inside); assert.ok(db <= -20, db.toFixed(1) + ' dB'); return db.toFixed(1) + ' dB';
  });
  const silent = S[k].medium(SR, SEED, { input: new Float32Array(20 * SR) });
  check(k + '.medium with a silent input has a periodic level change at the rotation rate ' + rot.toFixed(3) + ' Hz (within 5 %)', () => {
    const f = envelopePeakHz(silent, 0.4, 6); assert.ok(Math.abs(f - rot) / rot < 0.05, 'peak at ' + f.toFixed(3) + ' Hz'); return 'peak at ' + f.toFixed(3) + ' Hz';
  });
  console.log('info ' + k + '.medium with music: strongest level change between 0.4 and 6 Hz is at ' + envelopePeakHz(dev, 0.4, 6).toFixed(3) + ' Hz (not asserted, the music has its own rhythm)');
}
check('C.medium band reaches at least 12 kHz (response at 12 kHz is not more than 6 dB below 1 kHz)', () => {
  const n = 4 * SR, probe = new Float32Array(n); let s = 12345;
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; probe[i] = (s / 4294967296 - 0.5) * 0.5; }
  const a = S.C.medium(SR, SEED, { input: { L: probe, R: new Float32Array(probe) } }).L, b = S.C.medium(SR, SEED, { input: { L: new Float32Array(n), R: new Float32Array(n) } }).L;
  for (let i = 0; i < n; i++) a[i] -= b[i];
  const p = psd(a, 4096), lvl = (f) => 10 * Math.log10(bandPower(p, 4096, f / 1.12, f * 1.12) / (f * 1.12 - f / 1.12));
  const d = lvl(12000) - lvl(1000); assert.ok(d >= -6, d.toFixed(1) + ' dB'); return d.toFixed(1) + ' dB at 12 kHz, ' + (lvl(18000) - lvl(1000)).toFixed(1) + ' dB at 18 kHz';
});
check('C.medium left and right channels are different', () => { const d = clips['C.medium']; assert.ok(!same(d.L, d.R)); });

// ---------- the three reported numbers for each medium (computed by Synth.measure from rendered audio) ----------
for (const k of S.KEYS) {
  const t0 = performance.now(), m = S.measure(k, SR, SEED, { dry: clips[k + '.music'] }), ms = performance.now() - t0;
  check(k + '.measure gives three finite numbers', () => { assert.ok([m.noiseDb, m.loHz, m.hiHz, m.wowPct].every(Number.isFinite)); assert.ok(m.noiseDb < 0 && m.hiHz > m.loHz && m.wowPct > 0); });
  console.log('info ' + k + ' medium: noise ' + m.noiseDb.toFixed(1) + ' dB relative to the music; -6 dB bandwidth ' + m.loHz.toFixed(0) + (m.loAtLimit ? ' (or lower)' : '') + ' to ' + m.hiHz.toFixed(0) + ' Hz' + (m.hiAtLimit ? ' (or higher)' : '') +
    '; speed variation +/- ' + m.wowPct.toFixed(3) + ' % (probe tone ' + m.toneHz + ' Hz); measured in ' + ms.toFixed(0) + ' ms');
}

console.log(failed ? '\n' + failed + ' of ' + count + ' checks FAILED' : '\nall ' + count + ' checks passed');
process.exit(failed ? 1 : 0);
