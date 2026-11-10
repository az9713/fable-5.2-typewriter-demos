/* engine.js - the mechanism of the 1927 machine (Remington Portable No. 2).
 * A pure class: no DOM, no Web Audio, no Math.random(). It is a classic script (global TypeEngine).
 * It works in Node, on the page, and as the body of an AudioWorklet (TypeEngine.source is its own text).
 *
 * The machine is a set of parts with state. advance(n) moves all parts in fixed steps of 16 samples.
 * A sound is never a cause here. The parts move, and the engine reports what occurred as events.
 */
(function (root) {
function define() {
'use strict';

/* ======================================================================================
 * CONSTANTS. Each line has a unit and the mark GUESS, CHOICE or SOURCED.
 * CHOICE = a setting of this model or of the machine that the operator can change.
 * The timings of the sounds are not here. The engine gets them from the parameter block of synth.js
 * (see timingFromSynth), so that the motion and the sound use the same numbers.
 * ==================================================================================== */
var K = {
  STEP_SAMPLES: 16,        // samples in one mechanism step. CHOICE: 128 / 16 = 8 steps in one audio block (0.33 ms at 48000 Hz)
  ZONE: 0.75,              // fraction of the bar travel where the common zone starts (the last 25 % before the print point). GUESS
  FORCE_SD: 0.07,          // standard deviation of the key force (scale 0 to 1) when the caller gives no force. GUESS
  FORCE_MIN: 0.5,          // lowest key force that the engine makes by itself (scale 0 to 1). GUESS
  PULL_N: 4.45,            // N, pull of the carriage spring. GUESS. Basis: the Remington No. 2 directions give one pound for a different model (SOURCES 'rem2-manual' in synth.js)
  CARRIAGE_KG: 0.5,        // kg, mass of the carriage with the platen. GUESS
  PITCH_M: 0.00254,        // m, one letter space (pica, 10 for each inch). Weak source, 2 dealer pages: https://mrmrsvintagetypewriters.com/products/remington-portable-model-2-typewriter and reference.md [S14]
  TOOTH_RESTITUTION: 0.4,  // ratio of the speed after and before the rack tooth hits the escapement dog. GUESS
  SETTLE_SPEED: 2,         // letter spaces per s. Below this rebound speed the dog holds the rack. GUESS
  BACK_S: 0.04,            // s, time of one backspace push. GUESS
  SHIFT_S: 0.045,          // s, travel time of the shift, down and up. GUESS
  SCALE_MAX: 84,           // highest mark of the carriage scale. SOURCED: the operating guide names the stop positions 0 and 84 (URL below)
  LEFT_STOP: 10,           // scale mark of the left margin stop. CHOICE (the stops are adjustable)
  LINE_COLS: 65,           // letter spaces from the left stop to the right stop. CHOICE. The keys lock at this column
  BELL_BEFORE: 6,          // letter spaces between the bell and the key lock. SOURCED: "The bell rings six letter spaces before the keys lock"
                           // https://archive.org/stream/AnEasyGuideForOperatingTheRemingtonPortableTypewriter/AnEasyGuideForOperatingTheRemingtonPortableTypewriter_djvu.txt
  BELL_REARM: 0.5          // letter spaces that the carriage must go back before the bell can ring again. GUESS
};

/* The keyboard: 42 keys in 4 rows. [position code of the computer key, small character, shift character].
 * SOURCED: four rows ("four-bank keyboard"), https://site.xavier.edu/polt/typewriters/rem-portables.htm
 * SOURCED, for the Portable No. 1 of 1923 and not confirmed for the No. 2: 42 character keys, https://collections.museumsvictoria.com.au/items/394007
 * GUESS: the keys in each row (10, 11, 11, 10) and each character. No source for the key tops was found.
 * This table has no key for the digit 1: on machines of this type the small letter l is the digit 1. GUESS for this model. */
var KEYS = [
  ['Digit2', '2', '"'], ['Digit3', '3', '#'], ['Digit4', '4', '$'], ['Digit5', '5', '%'], ['Digit6', '6', '_'],
  ['Digit7', '7', '&'], ['Digit8', '8', '\''], ['Digit9', '9', '('], ['Digit0', '0', ')'], ['Minus', '-', '*'],
  ['KeyQ', 'q', 'Q'], ['KeyW', 'w', 'W'], ['KeyE', 'e', 'E'], ['KeyR', 'r', 'R'], ['KeyT', 't', 'T'], ['KeyY', 'y', 'Y'],
  ['KeyU', 'u', 'U'], ['KeyI', 'i', 'I'], ['KeyO', 'o', 'O'], ['KeyP', 'p', 'P'], ['BracketLeft', '½', '¼'],
  ['KeyA', 'a', 'A'], ['KeyS', 's', 'S'], ['KeyD', 'd', 'D'], ['KeyF', 'f', 'F'], ['KeyG', 'g', 'G'], ['KeyH', 'h', 'H'],
  ['KeyJ', 'j', 'J'], ['KeyK', 'k', 'K'], ['KeyL', 'l', 'L'], ['Semicolon', ';', ':'], ['Quote', '@', '¢'],
  ['KeyZ', 'z', 'Z'], ['KeyX', 'x', 'X'], ['KeyC', 'c', 'C'], ['KeyV', 'v', 'V'], ['KeyB', 'b', 'B'], ['KeyN', 'n', 'N'],
  ['KeyM', 'm', 'M'], ['Comma', ',', ','], ['Period', '.', '.'], ['Slash', '/', '?']
];
var ROWS = [10, 11, 11, 10];                 // keys in each row, from the top row to the bottom row
var NB = KEYS.length;                        // number of type bars: one for each key

/* States of a type bar. */
var REST = 0, TRAVEL = 1, ATPRINT = 2, RETURN = 3, JAM = 4;
/* States of the carriage. HELD: the dog holds the rack. FREE: the spring pulls the carriage to the next tooth.
 * BACK: the backspace key pushes it one tooth back. RET: the hand moves it with the return lever. */
var HELD = 0, FREE = 1, BACK = 2, RET = 3;

/* Layout of the state snapshot (a Float32Array). */
var SNAP = { T: 0, X: 1, TARGET: 2, LINE: 3, SHIFT: 4, FLAGS: 5, BARS: 6, KEYS: 6 + NB, SPACE: 6 + 2 * NB, BACKSPACE: 7 + 2 * NB, SHIFTKEY: 8 + 2 * NB, LEVER: 9 + 2 * NB, LEN: 10 + 2 * NB };
var FLAG_JAM = 1, FLAG_LOCK = 2, FLAG_RETURN = 4;

function makeRng(seed) {                     // mulberry32, a seeded generator
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The timings that the sounds of synth.js use. P is Synth.P. All values are in ms or are ratios.
 * synth.js marks these values GUESS, with the exception of the one lever for line space and return (SOURCED there). */
function timingFromSynth(P) {
  var M = P.B.machine, C = P.common;
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
  if (!opts.timing) throw new Error('TypeEngine: give opts.timing (use TypeEngine.timingFromSynth(Synth.P))');
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
  this.backT = 0; this.backX0 = 0;
  /* return lever and line feed */
  this.returning = false; this.feeding = false; this.retTravel = false; this.retT0 = 0; this.retX0 = 0;
  this.feedEndN = Math.round((tm.feedFirstMs + (tm.feedClicks - 1) * tm.feedGapMs) * 0.001 * sr);   // the last ratchet click
  this.trvStartN = Math.round((tm.feedClicks * tm.feedGapMs + tm.retGapMs) * 0.001 * sr);            // same sum as carriageReturn() in synth.js
  this.trvN = Math.round(tm.retTravelMs * 0.001 * sr);
  this.escN = Math.round(tm.escMs * 0.001 * sr); this.spaceEscN = Math.round(tm.spaceEscMs * 0.001 * sr);
  this.line = 0; this.feed = 0;              // line number; fraction of the line feed in progress
  /* shift: 0 = small characters, 1 = shift characters */
  this.shift = 0; this.shiftL = false; this.shiftR = false;
  this.held = new Uint8Array(NB); this.spaceHeld = 0; this.backHeld = 0;
  this.codeIndex = {};
  for (i = 0; i < NB; i++) this.codeIndex[KEYS[i][0]] = i;
}

Engine.prototype._emit = function (ev) { this.events.push(ev); };
Engine.prototype._r32 = function () { return (this.rnd() * 4294967296) >>> 0; };
Engine.prototype.locked = function () { return this.target >= this.lockCol; };

/* Key force (0 to 1) to travel time and contact time, in s. Same formulas as keyStrike() and impact() in synth.js. */
Engine.prototype._travelS = function (f) { return this.tm.travelMs * (this.tm.velTime[0] - this.tm.velTime[1] * f) * 0.001; };
Engine.prototype._dwellS = function (f) { return this.tm.contactMs * (this.tm.contact[0] - this.tm.contact[1] * f) * 0.001; };

/* A key goes down. force is 0 to 1; without it the engine makes a force from its seed. Returns true if the machine accepted the key. */
Engine.prototype.keyDown = function (code, force) {
  var i = this.codeIndex[code];
  if (i !== undefined) {
    if (this.returning || this.locked() || this.bst[i] !== REST) return false;   // hand on the lever, key lock, or the bar is not back
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
  if (code === 'Backspace') {
    if (this.returning || this.target <= 0 || this.backHeld) return false;
    this.backHeld = 1; this.target -= 1; this.mode = BACK; this.backT = 0; this.backX0 = this.x; this.v = 0;
    this._emit({ type: 'backspace', at: this.t, column: this.target });
    return true;
  }
  if (code === 'Enter') return this._startReturn();
  return false;                              // the machine does not have this key
};

Engine.prototype.keyUp = function (code) {
  var i = this.codeIndex[code];
  if (i !== undefined) this.held[i] = 0;
  else if (code === 'ShiftLeft') this.shiftL = false;
  else if (code === 'ShiftRight') this.shiftR = false;
  else if (code === 'Space') this.spaceHeld = 0;
  else if (code === 'Backspace') this.backHeld = 0;
};

/* The operator pulls the jammed bars apart. They fall back into the basket. */
Engine.prototype.release = function () {
  var bars = [], i;
  for (i = 0; i < NB; i++) if (this.bst[i] === JAM) { this.bst[i] = RETURN; this.bv[i] = 0; bars.push(i); }
  this.jamN = 0;
  if (bars.length) this._emit({ type: 'release', at: this.t, bars: bars });
  return bars.length > 0;
};

/* ADDITION. A new sheet is in the machine: the carriage is at the given column (default 0, the left margin) and the line is the given number (default 0).
 * The page also uses it to put the machine back at the saved position. Bars in motion are not changed. */
Engine.prototype.newSheet = function (column, line) {
  var c = Math.max(0, Math.min(this.lockCol, Math.round(column) || 0));
  this.x = c; this.v = 0; this.target = c; this.mode = HELD; this.backT = 0; this.pend.length = 0;
  this.returning = false; this.feeding = false; this.retTravel = false; this.feed = 0;
  this.line = Math.max(0, Math.round(line) || 0); this.bellArmed = c < this.bellCol;
};

Engine.prototype._pend = function (at) { this.pend.push(at); if (this.pend.length > 1) this.pend.sort(function (a, b) { return a - b; }); };

/* The escapement lets the rack go one tooth. The margin stop does not let the carriage go past the lock column. */
Engine.prototype._trip = function () {
  if (this.mode === RET || this.target >= this.lockCol) return;
  this.target += 1; this.mode = FREE;
};

/* One lever does the line space and the carriage return (SOURCED in synth.js, 'remport-manual').
 * At the left margin the lever only feeds the line. */
Engine.prototype._startReturn = function () {
  if (this.returning) return false;
  this.returning = true; this.feeding = true; this.retT0 = this.t; this.pend.length = 0;
  this.retTravel = this.x > 0 || this.target > 0;
  if (this.retTravel) {
    this.retX0 = this.x; this.target = 0; this.mode = RET; this.v = 0;
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
  else if (this.mode === BACK) {                                  // the key lever pushes the rack back at a constant speed
    this.backT += dt;
    if (this.backT >= K.BACK_S) { this.x = this.target; this.mode = HELD; }
    else this.x = this.backX0 + (this.target - this.backX0) * (this.backT / K.BACK_S);
  } else if (this.mode === RET) {                                 // the hand moves the carriage: slow at first, then fast, then the stop
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

  /* 2. line feed: the lever turns the platen one line */
  if (this.feeding) {
    el = t + N - this.retT0;
    if (el >= this.feedEndN) { this.line += 1; this.feed = 0; this.feeding = false; if (!this.retTravel) this.returning = false; }
    else this.feed = el / this.feedEndN;
  }

  /* 3. shift */
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
    if (st === TRAVEL) {                                          // the key lever drives the bar: constant acceleration to the print point
      a = this.ba[i]; pn = p + v * dt + 0.5 * a * dt * dt;
      if (pn < 1) { this.bp[i] = pn; this.bv[i] = v + a * dt; continue; }
      var tau = (-v + Math.sqrt(v * v + 2 * a * (1 - p))) / a, at;
      f = tau / dt; at = t + Math.min(N - 1, Math.floor(f * N));
      this.bp[i] = 1; this.bv[i] = 0; this.bst[i] = ATPRINT; this.bw[i] = this._dwellS(this.bf[i]) - (dt - tau);
      this._emit({ type: 'print', at: at, bar: i, ch: KEYS[i][this.shift >= 0.5 ? 2 : 1], force: this.bf[i],
        column: x0 + f * (x1 - x0),                               // the carriage position at the instant of the print
        line: this.line + this.feed, shift: this.shift, r: this._r32() });
      this._pend(at + this.escN);
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

/* Compact state for the picture. out is a Float32Array of length TypeEngine.SNAP.LEN. */
Engine.prototype.snapshot = function (out) {
  var i;
  out = out || new Float32Array(SNAP.LEN);
  out[SNAP.T] = this.t; out[SNAP.X] = this.x; out[SNAP.TARGET] = this.target; out[SNAP.LINE] = this.line + this.feed; out[SNAP.SHIFT] = this.shift;
  out[SNAP.FLAGS] = (this.jamN > 0 ? FLAG_JAM : 0) | (this.locked() ? FLAG_LOCK : 0) | (this.returning ? FLAG_RETURN : 0);
  for (i = 0; i < NB; i++) { out[SNAP.BARS + i] = this.bp[i]; out[SNAP.KEYS + i] = this.held[i]; }
  out[SNAP.SPACE] = this.spaceHeld; out[SNAP.BACKSPACE] = this.backHeld; out[SNAP.SHIFTKEY] = (this.shiftL ? 1 : 0) + (this.shiftR ? 2 : 0);
  out[SNAP.LEVER] = this.returning ? 1 : 0;
  return out;
};

/* Times in ms that follow from the constants, for one key force. The checks and the readout use them.
 * jamBelow: two keys with the same force jam if the gap between them is less than this.
 * cleanAbove: the second print is on its column if the gap between two prints is more than this. */
Engine.prototype.times = function (force) {
  var tm = this.tm, f = typeof force === 'number' ? force : tm.defaultVel, A = this.accel;
  var T = this._travelS(f) * 1000, zoneIn = T * Math.sqrt(K.ZONE);
  var zoneOut = this._dwellS(f) * 1000 + this.barRetS * 1000 * Math.sqrt(1 - K.ZONE);
  var step = 1000 * Math.sqrt(2 / A), vv = A * step * 0.001, settle = step;
  for (;;) { vv *= K.TOOTH_RESTITUTION; if (vv < K.SETTLE_SPEED) break; settle += 2000 * vv / A; }
  return { travel: T, jamBelow: T + zoneOut - zoneIn, step: step, settle: settle, cleanAbove: tm.escMs + settle,
    returnMs: (this.trvStartN + this.trvN) * 1000 / this.sr };
};

Engine.K = K; Engine.KEYS = KEYS; Engine.ROWS = ROWS; Engine.SNAP = SNAP;
Engine.FLAG_JAM = FLAG_JAM; Engine.FLAG_LOCK = FLAG_LOCK; Engine.FLAG_RETURN = FLAG_RETURN;
Engine.timingFromSynth = timingFromSynth;
return Engine;
}

var Engine = define();
Engine.source = '(' + define.toString() + ')()';   // the text of the class, for the AudioWorklet
root.TypeEngine = Engine;
if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
