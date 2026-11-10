/* engine-a.js - the mechanism of the 1897 machine (Remington Standard No. 2, an understrike "blind writer").
 * Same public interface as engine.js (setting B). A pure class: no DOM, no Web Audio, no Math.random().
 * It is a classic script (global TypeEngineA). It works in Node, on the page, and as the body of an AudioWorklet
 * (TypeEngineA.source is its own text).
 *
 * Differences from machine B, each with its source (SOURCED) or the word GUESS:
 *  - The type bars swing UP to the underside of the platen. The typist cannot see the line. The carriage lifts on a hinge
 *    (liftCarriage / lowerCarriage). While the carriage is not fully down, no character key and no space bar is accepted.
 *    CHOICE: the bars would hit nothing; the sources do not say what a key does then.
 *  - The carriage moves one space when the key is RELEASED, not when the bar prints. SOURCED: Scientific American 1888 in
 *    https://type-writer.org/?p=1652 ("without any movement of the carriage" on the press; the carriage moves forward one notch on release).
 *  - Case change: the platen (roller frame) moves on the carriage, and it returns when the finger leaves the key.
 *    SOURCED: same page. The reference.md contradiction 4 (platen against carriage) is settled for "platen"; the print column is the same either way.
 *  - No back-space key. No source lists one for this machine. The input does nothing (GUESS).
 *  - No margin lock. No source shows a key lock at the margin of the 1890s machine. The carriage stops at the end of the rack, and the keys
 *    still print on one column (GUESS). The bell rings BELL_BEFORE spaces before that column (the manual says "several"; the number is GUESS).
 *  - 38 type bars, no keys for the digits 0 and 1 (GUESS; the letters O and l serve).
 */
(function (root) {
function define() {
'use strict';

/* ======================================================================================
 * CONSTANTS. Each line has a unit and the mark GUESS, CHOICE or SOURCED.
 * The timings of the sounds are not here. The engine gets them from the parameter block of synth.js
 * (see timingFromSynth), so that the motion and the sound use the same numbers.
 * ==================================================================================== */
var K = {
  STEP_SAMPLES: 16,        // samples in one mechanism step. CHOICE: same as engine.js (0.33 ms at 48000 Hz)
  ZONE: 0.75,              // fraction of the bar travel where the common zone starts (the last 25 % before the print point). GUESS
  FORCE_SD: 0.07,          // standard deviation of the key force (scale 0 to 1) when the caller gives no force. GUESS
  FORCE_MIN: 0.5,          // lowest key force that the engine makes by itself (scale 0 to 1). GUESS
  PULL_N: 4.45,            // N, pull of the carriage spring. SOURCED: "a pull of one pound" (1 lb = 4.45 N), http://machinesoflovinggrace.com/manuals/manual-Remington2.pdf
  CARRIAGE_KG: 1.0,        // kg, mass of the carriage with the platen. GUESS (heavier than the portable of setting B)
  PITCH_M: 0.00254,        // m, one letter space (10 for each inch). GUESS (no source for this machine; reference.md A1)
  TOOTH_RESTITUTION: 0.4,  // ratio of the speed after and before the rack tooth hits the escapement dog. GUESS
  SETTLE_SPEED: 2,         // letter spaces per s. Below this rebound speed the dog holds the rack. GUESS
  SHIFT_S: 0.07,          // s, travel time of the platen shift, up and down. GUESS (heavier part than in B)
  LIFT_S: 0.30,            // s, the carriage rises on its hinge. GUESS
  LOWER_S: 0.25,           // s, the carriage goes down to its seat. GUESS
  LINE_COLS: 72,           // letter spaces from the left stop to the end of the rack, where the carriage stops. GUESS
  BELL_BEFORE: 7,          // letter spaces between the bell and the end of the rack. GUESS ("several spaces", https://machinesoflovinggrace.com/manuals/manual-Remington2.pdf)
  BELL_REARM: 0.5          // letter spaces that the carriage must go back before the bell can ring again. GUESS
};

/* The keyboard: 38 keys in 4 rows (10, 10, 9, 9). [position code of the computer key, small character, case-shift character].
 * SOURCED: 4 rows, 38 to 42 type arms, 2 characters on each arm. https://type-writer.org/?p=1652 and reference.md A1.
 * GUESS: the keys in each row and each character. No source for the key tops was found.
 * No key for the digits 0 and 1 (GUESS). Backspace, Tab, Caps Lock and all other keys are missing on this machine. */
var KEYS = [
  ['Digit2', '2', '"'], ['Digit3', '3', '#'], ['Digit4', '4', '$'], ['Digit5', '5', '%'], ['Digit6', '6', '_'],
  ['Digit7', '7', '&'], ['Digit8', '8', '\''], ['Digit9', '9', '('], ['Minus', '-', '*'], ['Slash', '/', '?'],
  ['KeyQ', 'q', 'Q'], ['KeyW', 'w', 'W'], ['KeyE', 'e', 'E'], ['KeyR', 'r', 'R'], ['KeyT', 't', 'T'],
  ['KeyY', 'y', 'Y'], ['KeyU', 'u', 'U'], ['KeyI', 'i', 'I'], ['KeyO', 'o', 'O'], ['KeyP', 'p', 'P'],
  ['KeyA', 'a', 'A'], ['KeyS', 's', 'S'], ['KeyD', 'd', 'D'], ['KeyF', 'f', 'F'], ['KeyG', 'g', 'G'],
  ['KeyH', 'h', 'H'], ['KeyJ', 'j', 'J'], ['KeyK', 'k', 'K'], ['KeyL', 'l', 'L'],
  ['KeyZ', 'z', 'Z'], ['KeyX', 'x', 'X'], ['KeyC', 'c', 'C'], ['KeyV', 'v', 'V'], ['KeyB', 'b', 'B'],
  ['KeyN', 'n', 'N'], ['KeyM', 'm', 'M'], ['Comma', ',', ';'], ['Period', '.', ':']
];
var ROWS = [10, 10, 9, 9];                   // keys in each row, from the top row to the bottom row
var NB = KEYS.length;                        // number of type bars: one for each key

/* States of a type bar. */
var REST = 0, TRAVEL = 1, ATPRINT = 2, RETURN = 3, JAM = 4;
/* States of the carriage. HELD: the dog holds the rack. FREE: the spring pulls the carriage to the next tooth.
 * BACK: unused here (no back-space key; the value is kept so that the numbers equal those of engine.js).
 * RET: the hand moves it with the carriage lever. */
var HELD = 0, FREE = 1, BACK = 2, RET = 3;
/* States of the hinge. */
var DOWN = 0, RISING = 1, UP = 2, LOWERING = 3;

/* Layout of the state snapshot (a Float32Array). The first fields equal those of engine.js. LIFT is an addition. */
var SNAP = { T: 0, X: 1, TARGET: 2, LINE: 3, SHIFT: 4, FLAGS: 5, BARS: 6, KEYS: 6 + NB, SPACE: 6 + 2 * NB, BACKSPACE: 7 + 2 * NB, SHIFTKEY: 8 + 2 * NB, LEVER: 9 + 2 * NB, LIFT: 10 + 2 * NB, LEN: 11 + 2 * NB };
var FLAG_JAM = 1, FLAG_LOCK = 2, FLAG_RETURN = 4, FLAG_LIFT = 8, FLAG_ENDSTOP = 16;   // LOCK: the keys are locked because the carriage is not down. LIFT, ENDSTOP: additions

function makeRng(seed) {                     // mulberry32, a seeded generator
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The timings that the sounds of synth.js use. P is Synth.P. Setting A (P.A) gives the values. */
function timingFromSynth(P) {
  var M = P.A.machine, C = P.common;
  return {
    travelMs: M.strike.travelMs,             // key-down to type impact, before the force factor
    velTime: C.strikeVelTime.slice(),        // travel time factor = [0] - [1] * force
    contactMs: M.strike.type.contactMs,      // contact of the type on the platen, before the force factor
    contact: C.impact.contact.slice(),       // contact time factor = [0] - [1] * force
    escMs: M.strike.esc.delayMs,             // type impact to escapement
    fallMs: M.strike.fall.delayMs,           // type impact to the bar back in the basket
    spaceEscMs: M.space.esc.delayMs,         // space bar on its stop to escapement
    feedFirstMs: C.linefeed.firstMs,         // lever pull to the first ratchet click
    feedClicks: M.linefeed.clicks,           // ratchet clicks for one line
    feedGapMs: M.linefeed.gapMs,             // time between two ratchet clicks
    retGapMs: C.ret.gapMs,                   // pause between the line feed and the carriage travel
    retTravelMs: M.ret.travelMs,             // carriage travel in a return
    retPow: C.ret.tickPow,                   // carriage position in a return = (time / travel time) ^ retPow
    defaultVel: C.defaultVel,                // mean key force
    velPow: C.impact.velPow                  // level of a strike = force ^ velPow (used by the sound player)
  };
}

function Engine(opts) {
  opts = opts || {};
  if (!opts.timing) throw new Error('TypeEngineA: give opts.timing (use TypeEngineA.timingFromSynth(Synth.P))');
  var tm = this.tm = opts.timing, sr = this.sr = opts.sampleRate || 48000, i;
  this.dt = K.STEP_SAMPLES / sr;             // s, one step
  this.rnd = makeRng(opts.seed === undefined ? 1 : opts.seed);
  this.t = 0;                                // samples since the start; a multiple of STEP_SAMPLES
  this.rest = 0;                             // samples that advance() got and that are less than one step
  this.events = [];
  /* type bars. Position 0 = rest, 1 = print point. Speeds are in travel units for each s. */
  this.bst = new Uint8Array(NB); this.bp = new Float64Array(NB); this.bv = new Float64Array(NB);
  this.ba = new Float64Array(NB); this.bw = new Float64Array(NB); this.bf = new Float64Array(NB); this.bn = new Float64Array(NB);
  this.jamN = 0;                             // number of bars in a jam
  this.barRetS = (tm.fallMs - tm.contactMs * (tm.contact[0] - tm.contact[1] * tm.defaultVel)) * 0.001;
  this.barRetA = 2 / (this.barRetS * this.barRetS);     // the bar falls back with a constant acceleration and is at rest fallMs after the print
  /* carriage. x is the column at the print point, in letter spaces from the left margin stop. */
  this.accel = K.PULL_N / K.CARRIAGE_KG / K.PITCH_M;    // letter spaces / s^2: spring force / mass / pitch
  this.x = 0; this.v = 0; this.target = 0; this.mode = HELD;
  this.lockCol = K.LINE_COLS; this.bellCol = K.LINE_COLS - K.BELL_BEFORE; this.bellArmed = true;
  this.pend = [];                            // sample times at which the escapement lets one tooth go
  this.waitUp = new Uint8Array(NB); this.dueAt = new Float64Array(NB);   // a bar has printed; the tooth goes when its key is up
  this.endHit = false;
  /* carriage lever and line feed */
  this.returning = false; this.feeding = false; this.retTravel = false; this.retT0 = 0; this.retX0 = 0;
  this.feedEndN = Math.round((tm.feedFirstMs + (tm.feedClicks - 1) * tm.feedGapMs) * 0.001 * sr);   // the last ratchet click
  this.trvStartN = Math.round((tm.feedClicks * tm.feedGapMs + tm.retGapMs) * 0.001 * sr);            // same sum as carriageReturn() in synth.js
  this.trvN = Math.round(tm.retTravelMs * 0.001 * sr);
  this.escN = Math.round(tm.escMs * 0.001 * sr); this.spaceEscN = Math.round(tm.spaceEscMs * 0.001 * sr);
  this.line = 0; this.feed = 0;              // line number; fraction of the line feed in progress
  /* hinge of the carriage: lstate DOWN, RISING, UP, LOWERING; lpos 0 = down, 1 = up */
  this.lstate = DOWN; this.lpos = 0;
  /* case shift: 0 = small characters, 1 = case-shift characters */
  this.shift = 0; this.shiftL = false; this.shiftR = false;
  this.held = new Uint8Array(NB); this.spaceHeld = 0; this.backHeld = 0;
  this.codeIndex = {};
  for (i = 0; i < NB; i++) this.codeIndex[KEYS[i][0]] = i;
}

Engine.prototype._emit = function (ev) { this.events.push(ev); };
Engine.prototype._r32 = function () { return (this.rnd() * 4294967296) >>> 0; };
/* True if the keys cannot print: the carriage is not fully down. There is no margin lock on this machine. */
Engine.prototype.locked = function () { return this.lstate !== DOWN; };

/* Key force (0 to 1) to travel time and contact time, in s. Same formulas as keyStrike() and impact() in synth.js. */
Engine.prototype._travelS = function (f) { return this.tm.travelMs * (this.tm.velTime[0] - this.tm.velTime[1] * f) * 0.001; };
Engine.prototype._dwellS = function (f) { return this.tm.contactMs * (this.tm.contact[0] - this.tm.contact[1] * f) * 0.001; };

/* A key goes down. force is 0 to 1; without it the engine makes a force from its seed. Returns true if the machine accepted the key. */
Engine.prototype.keyDown = function (code, force) {
  var i = this.codeIndex[code];
  if (i !== undefined) {
    if (this.returning || this.locked() || this.bst[i] !== REST || this.held[i]) return false;   // hand on the lever, carriage lifted, bar not back, key not yet released
    var g = (this.rnd() + this.rnd() + this.rnd() + this.rnd() - 2) * 1.732;      // near a normal distribution
    var f = typeof force === 'number' ? force : this.tm.defaultVel + K.FORCE_SD * g;
    f = Math.max(typeof force === 'number' ? 0.05 : K.FORCE_MIN, Math.min(1, f));
    var T = this._travelS(f);
    this.bst[i] = TRAVEL; this.bp[i] = 0; this.bv[i] = 0; this.ba[i] = 2 / (T * T); this.bf[i] = f; this.held[i] = 1;
    this._emit({ type: 'drive', at: this.t, bar: i, force: f, r: this._r32() });
    return true;
  }
  if (code === 'ShiftLeft') { this.shiftL = true; return true; }
  if (code === 'ShiftRight') { this.shiftR = true; return true; }
  if (code === 'Space') {
    if (this.returning || this.locked() || this.spaceHeld) return false;
    this.spaceHeld = 1; this._pend(this.t + this.spaceEscN);
    this._emit({ type: 'space', at: this.t, column: Math.min(this.target + 1, this.lockCol), r: this._r32() });
    return true;
  }
  if (code === 'Enter') return this._startReturn();
  return false;                              // the machine does not have this key (Backspace is one of them)
};

Engine.prototype.keyUp = function (code) {
  var i = this.codeIndex[code];
  if (i !== undefined) {
    this.held[i] = 0;
    if (this.waitUp[i]) { this.waitUp[i] = 0; this._pend(Math.max(this.t, this.dueAt[i])); }   // the key goes up: the carriage moves one space
  }
  else if (code === 'ShiftLeft') this.shiftL = false;
  else if (code === 'ShiftRight') this.shiftR = false;
  else if (code === 'Space') this.spaceHeld = 0;
};

/* The operator pulls the jammed bars apart. They fall back into the basket. */
Engine.prototype.release = function () {
  var bars = [], i;
  for (i = 0; i < NB; i++) if (this.bst[i] === JAM) { this.bst[i] = RETURN; this.bv[i] = 0; bars.push(i); }
  this.jamN = 0;
  if (bars.length) this._emit({ type: 'release', at: this.t, bars: bars });
  return bars.length > 0;
};

/* ADDITION. The operator takes the carriage frame and lifts it on its hinge to read the line.
 * Refused while a bar is moving, a tooth is pending, the carriage moves, or the hinge is not down. Returns true if it started. */
Engine.prototype.liftCarriage = function () {
  var i;
  if (this.lstate !== DOWN || this.returning || this.mode !== HELD || this.pend.length) return false;
  for (i = 0; i < NB; i++) if (this.bst[i] === TRAVEL || this.bst[i] === ATPRINT || this.waitUp[i]) return false;
  this.lstate = RISING;
  this._emit({ type: 'lift', at: this.t, column: this.x, line: this.line, r: this._r32() });
  return true;
};
/* ADDITION. The operator lets the carriage down. Works while it rises or when it is up. */
Engine.prototype.lowerCarriage = function () {
  if (this.lstate === DOWN || this.lstate === LOWERING) return false;
  this.lstate = LOWERING;
  this._emit({ type: 'lower', at: this.t, column: this.x, line: this.line, r: this._r32() });
  return true;
};

/* ADDITION. A new sheet is in the machine: the carriage is at the given column (default 0, the left margin) and the line is the given number (default 0).
 * The page also uses it to put the machine back at the saved position. Bars in motion and the hinge are not changed. */
Engine.prototype.newSheet = function (column, line) {
  var c = Math.max(0, Math.min(this.lockCol, Math.round(column) || 0)), i;
  this.x = c; this.v = 0; this.target = c; this.mode = HELD; this.pend.length = 0; this.endHit = false;
  for (i = 0; i < NB; i++) this.waitUp[i] = 0;
  this.returning = false; this.feeding = false; this.retTravel = false; this.feed = 0;
  this.line = Math.max(0, Math.round(line) || 0); this.bellArmed = c < this.bellCol;
};

Engine.prototype._pend = function (at) { this.pend.push(at); if (this.pend.length > 1) this.pend.sort(function (a, b) { return a - b; }); };

/* The escapement lets the rack go one tooth. The end of the rack does not let the carriage go on. */
Engine.prototype._trip = function () {
  if (this.mode === RET || this.target >= this.lockCol) return;
  this.target += 1; this.mode = FREE;
};

/* The carriage lever does the line space and the carriage return (SOURCED in synth.js, 'rem2-manual').
 * At the left margin the lever only feeds the line. */
Engine.prototype._startReturn = function () {
  var i;
  if (this.returning) return false;
  this.returning = true; this.feeding = true; this.retT0 = this.t; this.pend.length = 0;
  for (i = 0; i < NB; i++) this.waitUp[i] = 0;
  this.retTravel = this.x > 0 || this.target > 0;
  if (this.retTravel) {
    this.retX0 = this.x; this.target = 0; this.mode = RET; this.v = 0; this.endHit = false;
    this._emit({ type: 'returnStart', at: this.t, column: this.x, line: this.line, r: this._r32() });
  } else this._emit({ type: 'linefeed', at: this.t, line: this.line, r: this._r32() });
  return true;
};

/* The spring pulls the carriage (constant force). The next rack tooth stops it; the carriage rebounds until it is slow. */
Engine.prototype._free = function (dt) {
  var A = this.accel, x = this.x, v = this.v, tg = this.target;
  var xn = x + v * dt + 0.5 * A * dt * dt, vn = v + A * dt;
  if (xn < tg) { this.x = xn; this.v = vn; return -1; }
  var tau = (-v + Math.sqrt(v * v + 2 * A * (tg - x))) / A;       // time in this step at which the tooth hits the dog
  var vb = -K.TOOTH_RESTITUTION * (v + A * tau), rem = dt - tau;
  xn = tg + vb * rem + 0.5 * A * rem * rem;
  if (-vb < K.SETTLE_SPEED || xn >= tg) { this.x = tg; this.v = 0; this.mode = HELD; }
  else { this.x = xn; this.v = vb + A * rem; }
  return tau / dt;                                                // fraction of the step at the hit
};

Engine.prototype._step = function () {
  var t = this.t, N = K.STEP_SAMPLES, dt = this.dt, tm = this.tm, i, p, v, a, pn, f, el;
  var x0 = this.x, hitF = -1, peak;

  /* 1. escapement and carriage */
  while (this.pend.length && this.pend[0] < t + N) { this.pend.shift(); this._trip(); }
  if (this.mode === FREE) hitF = this._free(dt);
  else if (this.mode === RET) {                                   // the hand moves the carriage: slow at first, then fast, then the stop
    el = t + N - this.retT0;
    if (el >= this.trvStartN + this.trvN) {
      this.x = 0; this.v = 0; this.mode = HELD; this.returning = false;
      this._emit({ type: 'returnEnd', at: this.retT0 + this.trvStartN + this.trvN, column: 0, line: this.line });
    } else if (el > this.trvStartN) this.x = this.retX0 * (1 - Math.pow((el - this.trvStartN) / this.trvN, tm.retPow));
  }
  var x1 = this.x;
  peak = hitF >= 0 ? Math.max(x1, this.target) : x1;
  if (this.bellArmed && x0 < this.bellCol && peak >= this.bellCol) {
    f = hitF >= 0 && this.target === this.bellCol ? hitF : (this.bellCol - x0) / (peak - x0);
    this.bellArmed = false;
    this._emit({ type: 'bell', at: t + Math.min(N - 1, Math.floor(f * N)), column: this.bellCol, r: this._r32() });
  } else if (!this.bellArmed && x1 < this.bellCol - K.BELL_REARM) this.bellArmed = true;
  if (!this.endHit && this.target >= this.lockCol && this.mode === HELD && this.x >= this.lockCol) {   // ADDITION: the carriage is at the end of the rack
    this.endHit = true;
    this._emit({ type: 'endstop', at: t, column: this.lockCol, line: this.line, r: this._r32() });
  }

  /* 2. line feed: the lever turns the platen one line */
  if (this.feeding) {
    el = t + N - this.retT0;
    if (el >= this.feedEndN) { this.line += 1; this.feed = 0; this.feeding = false; if (!this.retTravel) this.returning = false; }
    else this.feed = el / this.feedEndN;
  }

  /* 2b. hinge of the carriage */
  if (this.lstate === RISING) {
    this.lpos += dt / K.LIFT_S;
    if (this.lpos >= 1) { this.lpos = 1; this.lstate = UP; this._emit({ type: 'lifted', at: t, r: this._r32() }); }
  } else if (this.lstate === LOWERING) {
    this.lpos -= dt / K.LOWER_S;
    if (this.lpos <= 0) { this.lpos = 0; this.lstate = DOWN; this._emit({ type: 'seated', at: t, r: this._r32() }); }
  }

  /* 3. case shift: the platen moves on the carriage while the key is down */
  if (this.shiftL || this.shiftR) { if (this.shift < 1) this.shift = Math.min(1, this.shift + dt / K.SHIFT_S); }
  else if (this.shift > 0) this.shift = Math.max(0, this.shift - dt / K.SHIFT_S);

  /* 4. type bars. First find the bars in the common zone and the bars that enter it in this step. */
  var Z = K.ZONE, nOcc = 0, nEnt = 0, entF = 1, st, bn = this.bn;
  for (i = 0; i < NB; i++) {
    st = this.bst[i];
    if (st === REST || st === JAM) continue;
    p = this.bp[i];
    if (p >= Z) { nOcc++; continue; }
    if (st === TRAVEL) {
      v = this.bv[i]; a = this.ba[i]; pn = bn[i] = p + v * dt + 0.5 * a * dt * dt;
      if (pn >= Z) { nEnt++; f = (-v + Math.sqrt(v * v + 2 * a * (Z - p))) / a / dt; if (f < entF) entF = f; }
    }
  }
  if (nEnt > 0 && (nOcc + nEnt >= 2 || this.jamN > 0)) {         // two bars in the zone: both stop and stay up
    var bars = [];
    for (i = 0; i < NB; i++) {
      st = this.bst[i];
      if (st === REST || st === JAM) continue;
      p = this.bp[i];
      if (p >= Z || (st === TRAVEL && bn[i] >= Z)) { if (p < Z) this.bp[i] = Z; this.bv[i] = 0; this.bst[i] = JAM; this.jamN++; bars.push(i); }
    }
    this._emit({ type: 'jam', at: t + Math.min(N - 1, Math.floor(entF * N)), bars: bars });
  }
  for (i = 0; i < NB; i++) {
    st = this.bst[i];
    if (st === REST || st === JAM) continue;
    p = this.bp[i]; v = this.bv[i];
    if (st === TRAVEL) {                                          // the key lever drives the bar up: constant acceleration to the print point
      a = this.ba[i]; pn = p + v * dt + 0.5 * a * dt * dt;
      if (pn < 1) { this.bp[i] = pn; this.bv[i] = v + a * dt; continue; }
      var tau = (-v + Math.sqrt(v * v + 2 * a * (1 - p))) / a, at;
      f = tau / dt; at = t + Math.min(N - 1, Math.floor(f * N));
      this.bp[i] = 1; this.bv[i] = 0; this.bst[i] = ATPRINT; this.bw[i] = this._dwellS(this.bf[i]) - (dt - tau);
      this._emit({ type: 'print', at: at, bar: i, ch: KEYS[i][this.shift >= 0.5 ? 2 : 1], force: this.bf[i],
        column: x0 + f * (x1 - x0),                               // the carriage position at the instant of the print
        line: this.line + this.feed, shift: this.shift, r: this._r32(),
        overstrike: this.target >= this.lockCol });               // ADDITION: true if the carriage is at the end of the rack
      if (this.held[i]) { this.waitUp[i] = 1; this.dueAt[i] = at + this.escN; }   // the tooth goes when the key is up (and not before at + escMs)
      else this._pend(at + this.escN);
    } else if (st === ATPRINT) {                                  // the type is on the paper for the contact time
      this.bw[i] -= dt;
      if (this.bw[i] <= 0) { this.bst[i] = RETURN; this.bv[i] = 0; }
    } else {                                                      // RETURN: the bar falls back into the basket
      pn = p - (v * dt + 0.5 * this.barRetA * dt * dt);
      if (pn <= 0) { this.bp[i] = 0; this.bv[i] = 0; this.bst[i] = REST; }
      else { this.bp[i] = pn; this.bv[i] = v + this.barRetA * dt; }
    }
  }
  this.t = t + N;
};

/* Move the machine n samples. Returns the events of these samples (an empty array if there are none).
 * Each event has "at": the sample number, counted from the start of the engine. */
Engine.prototype.advance = function (n) {
  this.rest += n;
  while (this.rest >= K.STEP_SAMPLES) { this._step(); this.rest -= K.STEP_SAMPLES; }
  if (!this.events.length) return this.events;
  var ev = this.events; this.events = [];
  return ev;
};

/* Compact state for the picture. out is a Float32Array of length TypeEngineA.SNAP.LEN. */
Engine.prototype.snapshot = function (out) {
  var i;
  out = out || new Float32Array(SNAP.LEN);
  out[SNAP.T] = this.t; out[SNAP.X] = this.x; out[SNAP.TARGET] = this.target; out[SNAP.LINE] = this.line + this.feed; out[SNAP.SHIFT] = this.shift;
  out[SNAP.FLAGS] = (this.jamN > 0 ? FLAG_JAM : 0) | (this.locked() ? FLAG_LOCK : 0) | (this.returning ? FLAG_RETURN : 0) |
    (this.lstate !== DOWN ? FLAG_LIFT : 0) | (this.target >= this.lockCol ? FLAG_ENDSTOP : 0);
  for (i = 0; i < NB; i++) { out[SNAP.BARS + i] = this.bp[i]; out[SNAP.KEYS + i] = this.held[i]; }
  out[SNAP.SPACE] = this.spaceHeld; out[SNAP.BACKSPACE] = 0; out[SNAP.SHIFTKEY] = (this.shiftL ? 1 : 0) + (this.shiftR ? 2 : 0);
  out[SNAP.LEVER] = this.returning ? 1 : 0;
  out[SNAP.LIFT] = this.lpos;                                     // ADDITION: 0 = carriage down, 1 = fully up
  return out;
};

/* Times in ms that follow from the constants, for one key force. The checks and the readout use them.
 * jamBelow: two keys with the same force jam if the gap between them is less than this.
 * cleanAbove: the second print is on its column if the gap between two prints is more than this
 * (the keys are released before the print; a key held down delays the tooth until its release). */
Engine.prototype.times = function (force) {
  var tm = this.tm, f = typeof force === 'number' ? force : tm.defaultVel, A = this.accel;
  var T = this._travelS(f) * 1000, zoneIn = T * Math.sqrt(K.ZONE);
  var zoneOut = this._dwellS(f) * 1000 + this.barRetS * 1000 * Math.sqrt(1 - K.ZONE);
  var step = 1000 * Math.sqrt(2 / A), vv = A * step * 0.001, settle = step;
  for (;;) { vv *= K.TOOTH_RESTITUTION; if (vv < K.SETTLE_SPEED) break; settle += 2000 * vv / A; }
  return { travel: T, jamBelow: T + zoneOut - zoneIn, step: step, settle: settle, cleanAbove: tm.escMs + settle,
    returnMs: (this.trvStartN + this.trvN) * 1000 / this.sr, liftMs: K.LIFT_S * 1000, lowerMs: K.LOWER_S * 1000 };
};

Engine.K = K; Engine.KEYS = KEYS; Engine.ROWS = ROWS; Engine.SNAP = SNAP;
Engine.FLAG_JAM = FLAG_JAM; Engine.FLAG_LOCK = FLAG_LOCK; Engine.FLAG_RETURN = FLAG_RETURN; Engine.FLAG_LIFT = FLAG_LIFT; Engine.FLAG_ENDSTOP = FLAG_ENDSTOP;
Engine.timingFromSynth = timingFromSynth;
return Engine;
}

var Engine = define();
Engine.source = '(' + define.toString() + ')()';   // the text of the class, for the AudioWorklet
root.TypeEngineA = Engine;
if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
