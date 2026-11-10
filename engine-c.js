/* engine-c.js - the mechanism of the 1962 machine (IBM Selectric, model 721).
 * A pure class: no DOM, no Web Audio, no Math.random(). It is a classic script (global SelectricEngine).
 * It has the same public interface as engine.js (TypeEngine), so a page can use either one.
 * It works in Node, on the page, and as the body of an AudioWorklet (SelectricEngine.source is its own text).
 *
 * Differences from machine B: a motor with a switch (setPower); no type bars, so no jam; one cycle at a time,
 * with a short store for the next keys; the element tilts and rotates; the carrier moves, the paper does not move sideways.
 * Every operation (print, space, backspace, shift, index, return) is a powered operation of the machine.
 */
(function (root) {
function define() {
'use strict';

/* ======================================================================================
 * CONSTANTS. Each line has a unit and one of: SOURCED (with URL), GUESS, CHOICE.
 * CHOICE = a setting of this model that the operator can change.
 * Timings of the sounds come from the parameter block of synth.js (see timingFromSynth).
 * ==================================================================================== */
var K = {
  STEP_SAMPLES: 16,        // samples in one mechanism step. CHOICE: same as engine.js
  FORCE_SD: 0.07,          // standard deviation of the key force (scale 0 to 1) when the caller gives no force. GUESS
  FORCE_MIN: 0.5,          // lowest key force that the engine makes by itself (scale 0 to 1). GUESS
  CYCLE_MS: 65,            // ms, one print cycle. SOURCED: "A full print cycle takes 65 ms" https://en.wikipedia.org/wiki/IBM_Selectric (value read from synth.js at run time)
  ROT_POS: 22,             // rotation positions of the element: 22 characters in each of 4 rows. SOURCED: 4 rows of 22 characters, https://en.wikipedia.org/wiki/IBM_Selectric. The angle of one position (360 / 22 deg) is DERIVED
  TILT_ROWS: 4,            // tilt positions. SOURCED: "one of four possible locations", https://en.wikipedia.org/wiki/IBM_Selectric
  SHIFT_POS: 11,           // rotation positions in the half turn of the shift. SOURCED: the shift turns the element exactly 180 deg, https://en.wikipedia.org/wiki/IBM_Selectric
  SELECT_FRAC: 0.7,        // fraction of the key-down-to-print time that the element needs to tilt and rotate. GUESS
  CARRIER_STEP_MS: 15,     // ms, the carrier moves one letter space. GUESS (the operational shaft is a governor of the carrier speed: https://en.wikipedia.org/wiki/IBM_Selectric)
  SPACE_MS: 40,            // ms, the cycle of the space operation. GUESS
  BACK_MS: 40,             // ms, the cycle of the backspace operation. GUESS
  SHIFT_MS: 50,            // ms, one shift operation (half turn of the element). GUESS
  RUNUP_S: 0.35,           // s, motor from 0 to full speed. GUESS (shaded pole motor with a centrifugal clutch, SOURCED as a type in synth.js 'selectric-service')
  RUNDOWN_S: 2.5,          // s, motor from full speed to 0 after the switch is off. GUESS
  MOTOR_READY: 0.95,       // fraction of full speed at which the cycle clutch can start a cycle. GUESS
  QUEUE_MAX: 2,            // keys that the machine stores while it is busy. SOURCED for one: the second interposer waits and the characters print in order (https://en.wikipedia.org/wiki/IBM_Selectric). The number 2 is a GUESS
  RET_MIN_MS: 40,          // ms, shortest carrier travel in a return. GUESS
  SCALE_MAX: 84,           // highest mark of the margin scale. CHOICE (same as machine B)
  LEFT_STOP: 10,           // scale mark of the left margin stop. CHOICE
  LINE_COLS: 65,           // letter spaces from the left stop to the right stop. CHOICE. The keys lock at this column. The lock is SOURCED for the electric Model B (1954): https://dn720006.ca.archive.org/0/items/ibm-model-b-electric-typewriter-user-manual-1954/IBM%20Model%20B%20Electric%20Typewriter%20User%20Manual%201954_djvu.txt . For the Selectric it is GUESS
  BELL_BEFORE: 10,         // letter spaces between the bell and the key lock. SOURCED for the Model B 1954 (same URL as above, "approximately 10 spaces"). For the Selectric: GUESS
  BELL_REARM: 0.5          // letter spaces that the carrier must go back before the bell can ring again. GUESS
};

/* The keyboard: 44 character keys in 4 rows. SOURCED: 44 character keys, 88 characters (https://collections.museumsvictoria.com.au/items/827791, https://www.ibm.com/history/selectric).
 * GUESS: the keys in each row (12, 11, 11, 10) and each character. [position code of the computer key, small character, shift character]
 * The element has 4 tilt rows of 11 small + 11 shift characters. GUESS: key number i is on tilt row floor(i / 11) at rotation position i mod 11. */
var KEYS = [
  ['Digit1', '1', '!'], ['Digit2', '2', '@'], ['Digit3', '3', '#'], ['Digit4', '4', '$'], ['Digit5', '5', '%'], ['Digit6', '6', '¢'],
  ['Digit7', '7', '&'], ['Digit8', '8', '*'], ['Digit9', '9', '('], ['Digit0', '0', ')'], ['Minus', '-', '_'], ['Equal', '=', '+'],
  ['KeyQ', 'q', 'Q'], ['KeyW', 'w', 'W'], ['KeyE', 'e', 'E'], ['KeyR', 'r', 'R'], ['KeyT', 't', 'T'], ['KeyY', 'y', 'Y'],
  ['KeyU', 'u', 'U'], ['KeyI', 'i', 'I'], ['KeyO', 'o', 'O'], ['KeyP', 'p', 'P'], ['BracketLeft', '½', '¼'],
  ['KeyA', 'a', 'A'], ['KeyS', 's', 'S'], ['KeyD', 'd', 'D'], ['KeyF', 'f', 'F'], ['KeyG', 'g', 'G'], ['KeyH', 'h', 'H'],
  ['KeyJ', 'j', 'J'], ['KeyK', 'k', 'K'], ['KeyL', 'l', 'L'], ['Semicolon', ';', ':'], ['Quote', '\'', '"'],
  ['KeyZ', 'z', 'Z'], ['KeyX', 'x', 'X'], ['KeyC', 'c', 'C'], ['KeyV', 'v', 'V'], ['KeyB', 'b', 'B'], ['KeyN', 'n', 'N'],
  ['KeyM', 'm', 'M'], ['Comma', ',', ','], ['Period', '.', '.'], ['Slash', '/', '?']
];
var ROWS = [12, 11, 11, 10];                 // keys in each row, from the top row to the bottom row. GUESS
var NB = KEYS.length;                        // number of character keys. On this machine there is no type bar for each key; the name NB is kept for the page

/* Codes of the control keys. Machine B has no Index key; the code for it here is an ADDITION. */
var CODE_INDEX = 'ArrowDown';

/* Operation kinds. */
var OP_CHAR = 0, OP_SPACE = 1, OP_BACK = 2, OP_SHIFT = 3, OP_INDEX = 4, OP_RETURN = 5;

/* Layout of the state snapshot (a Float32Array). The first part is the layout of engine.js, with the same offsets.
 * BARS holds 0 for each key: there are no type bars (neutral value). The part after LEVER is an ADDITION. */
var SNAP = { T: 0, X: 1, TARGET: 2, LINE: 3, SHIFT: 4, FLAGS: 5, BARS: 6, KEYS: 6 + NB, SPACE: 6 + 2 * NB, BACKSPACE: 7 + 2 * NB, SHIFTKEY: 8 + 2 * NB, LEVER: 9 + 2 * NB,
  MOTOR: 10 + 2 * NB,      // motor speed, 0 to 1
  TILT: 11 + 2 * NB,       // element tilt, in rows, 0 to 3 (a fraction while the element moves)
  ROTATION: 12 + 2 * NB,   // element rotation, in degrees, 0 (inclusive) to 360 (exclusive)
  STRIKE: 13 + 2 * NB,     // element pressure on the platen, 0 to 1 (a pulse at the print)
  POWER: 14 + 2 * NB,      // power switch, 0 or 1
  CYCLE: 15 + 2 * NB,      // progress of the operation in progress, 0 to 1 (0 if the machine is idle)
  QUEUE: 16 + 2 * NB,      // number of stored operations that wait
  LEN: 17 + 2 * NB };
var FLAG_JAM = 1, FLAG_LOCK = 2, FLAG_RETURN = 4;   // shared with engine.js. The jam flag is never set on this machine
var FLAG_MOTOR = 8, FLAG_BUSY = 16;                  // ADDITION: motor at full speed; an operation is in progress

function makeRng(seed) {                     // mulberry32, a seeded generator
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The timings that the sounds of synth.js use (the block P.C). P is Synth.P. All values are in ms or are ratios. */
function timingFromSynth(P) {
  var M = P.C.machine, C = P.common, S = M.strike;
  return {
    travelMs: S.printMs,                     // key-down (cycle start) to print, before the force factor. Same name as engine.js
    velTime: C.strikeVelTime.slice(),        // print time factor = [0] - [1] * force
    contactMs: S.type.contactMs,             // contact of the element on the platen, before the force factor
    contact: C.impact.contact.slice(),       // contact time factor = [0] - [1] * force
    escMs: S.esc.delayMs,                    // print to the carrier release
    fallMs: S.fall.delayMs,                  // print to the clutch latch
    spaceEscMs: M.space.esc.delayMs,         // space operation start to the carrier release
    feedFirstMs: C.linefeed.firstMs,         // index start to the first ratchet click
    feedClicks: M.linefeed.clicks,
    feedGapMs: M.linefeed.gapMs,
    retGapMs: M.ret.startMs,                 // return start to the start of the carrier travel (name from engine.js)
    retTravelMs: M.ret.travelMs,             // carrier travel for a full line (LINE_COLS letter spaces)
    retPow: 1,                               // not used by machine C (the speed curve is a smooth step); kept for the page
    defaultVel: C.defaultVel,
    velPow: C.impact.velPow,
    cycleMs: S.cycleMs,                      // ADDITION: one print cycle
    retIndexMs: M.ret.indexMs,               // ADDITION: return start to the index (line feed)
    retUnlatchMs: M.ret.unlatchMs            // ADDITION: carrier stop to the clutch release
  };
}

function Engine(opts) {
  opts = opts || {};
  if (!opts.timing) throw new Error('SelectricEngine: give opts.timing (use SelectricEngine.timingFromSynth(Synth.P))');
  var tm = this.tm = opts.timing, sr = this.sr = opts.sampleRate || 48000, i;
  this.dt = K.STEP_SAMPLES / sr;
  this.rnd = makeRng(opts.seed === undefined ? 1 : opts.seed);
  this.t = 0; this.rest = 0; this.events = [];
  this.sched = []; this.seq = 0;             // scheduled actions: { at, seq, fn }
  var ms = function (v) { return Math.max(1, Math.round(v * 0.001 * sr)); };
  this.ms = ms;
  this.cycleN = ms(tm.cycleMs); this.escN = ms(tm.escMs); this.spaceEscN = ms(tm.spaceEscMs);
  this.stepN = ms(K.CARRIER_STEP_MS); this.spaceN = ms(K.SPACE_MS); this.backN = ms(K.BACK_MS); this.shiftN = ms(K.SHIFT_MS);
  this.feedN = ms(tm.feedFirstMs + tm.feedClicks * tm.feedGapMs);
  this.retIndexN = ms(tm.retIndexMs); this.retStartN = ms(tm.retGapMs); this.retUnlatchN = ms(tm.retUnlatchMs);
  this.retFullN = ms(tm.retTravelMs); this.retMinN = ms(K.RET_MIN_MS);
  /* motor and power */
  this.on = !!opts.power; this.speed = this.on ? 1 : 0; this.ready = this.on; this.stopped = !this.on;
  /* carrier: col is the column after the last finished move; cseg is the move in progress (or the last move) */
  this.col = 0; this.cseg = null; this.x = 0;
  this.lockCol = K.LINE_COLS; this.bellCol = K.LINE_COLS - K.BELL_BEFORE; this.bellArmed = true;
  /* element */
  this.tilt = 0; this.rot = 0; this.eseg = null; this.strikeN = -1e12; this.dwellN = 1;
  this.shiftPos = 0; this.shift = 0; this.shiftSeg = null;
  /* operations */
  this.queue = []; this.running = null; this.opStartN = 0; this.opLenN = 1;
  this.line = 0; this.feed = 0; this.feedSeg = null; this.returning = false;
  this.shiftL = false; this.shiftR = false; this.shiftLog = 0;
  this.held = new Uint8Array(NB); this.spaceHeld = 0; this.backHeld = 0; this.indexHeld = 0;
  this.codeIndex = {};
  for (i = 0; i < NB; i++) this.codeIndex[KEYS[i][0]] = i;
}

Engine.prototype._emit = function (ev) { this.events.push(ev); };
Engine.prototype._r32 = function () { return (this.rnd() * 4294967296) >>> 0; };
Engine.prototype._at = function (at, fn) {
  var s = this.sched, e = { at: at, seq: this.seq++, fn: fn }, j = s.length;
  while (j > 0 && s[j - 1].at > at) j--;
  s.splice(j, 0, e);
};
Engine.prototype._printS = function (f) { return this.tm.travelMs * (this.tm.velTime[0] - this.tm.velTime[1] * f) * 0.001; };
Engine.prototype._dwellS = function (f) { return this.tm.contactMs * (this.tm.contact[0] - this.tm.contact[1] * f) * 0.001; };

function smooth(u) { u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u * (3 - 2 * u); }
Engine.prototype._carX = function (n) {
  var s = this.cseg;
  if (!s) return this.col;
  return s.x0 + (s.x1 - s.x0) * smooth((n - s.a) / (s.b - s.a));
};
Engine.prototype._moveTo = function (a, dur, x1) {          // start a carrier move at sample a, from where the carrier is at a
  var x0 = this._carX(a);
  this.cseg = { a: a, b: a + dur, x0: x0, x1: x1 }; this.col = x1;
};
Engine.prototype._elem = function (n) {                      // element tilt and rotation at sample n
  var s = this.eseg;
  if (!s) return [this.tilt, this.rot];
  var u = smooth((n - s.a) / (s.b - s.a));
  return [s.t0 + (s.t1 - s.t0) * u, s.r0 + (s.r1 - s.r0) * u];
};

/* ----- the logical state after all stored operations: used to accept or refuse a key ----- */
Engine.prototype._logic = function () {
  var col = this.running ? this.running.colAfter : this.col, ret = !!(this.running && this.running.kind === OP_RETURN), j;
  for (j = 0; j < this.queue.length; j++) { col = this.queue[j].colAfter; if (this.queue[j].kind === OP_RETURN) ret = true; }
  return { col: col, ret: ret };
};
Engine.prototype.locked = function () { return this._logic().col >= this.lockCol; };
Engine.prototype._stored = function () { var n = 0, j; for (j = 0; j < this.queue.length; j++) if (this.queue[j].kind !== OP_SHIFT) n++; return n; };

Engine.prototype._push = function (op) {
  this.queue.push(op);
  if (!this.running) this._kick(this.t);
};

/* Start the next operation at sample `at`, if the machine is free and the motor is at speed. */
Engine.prototype._kick = function (at) {
  if (this.running || !this.queue.length || !this.on || !this.ready) return;
  var op = this.queue.shift(), self = this, n = at, f, T, d;
  this.running = op; this.opStartN = at;
  var end = function (len) { self.opLenN = len; self._at(at + len, function (a) { self._end(a, op); }); };
  if (op.kind === OP_CHAR) {
    var el = this._elem(at), key = KEYS[op.bar], pos = op.bar % K.SHIFT_POS, row = Math.floor(op.bar / K.SHIFT_POS);
    var tgt = pos + K.SHIFT_POS * this.shiftPos, dd = (((tgt - el[1]) % K.ROT_POS) + K.ROT_POS) % K.ROT_POS;
    if (dd > K.SHIFT_POS) dd -= K.ROT_POS;
    f = op.force;
    var printN = this.ms(this._printS(f) * 1000), selN = Math.max(1, Math.round(printN * K.SELECT_FRAC));
    this.eseg = { a: at, b: at + selN, t0: el[0], t1: row, r0: el[1], r1: el[1] + dd };
    var sh = this.shiftPos, ch = key[sh ? 2 : 1];
    this._emit({ type: 'cycleStart', at: at, bar: op.bar, tilt: row, rotation: (((tgt % K.ROT_POS) + K.ROT_POS) % K.ROT_POS) * 360 / K.ROT_POS, r: this._r32() });
    this._at(at + printN, function (a) {
      var x = self._carX(a);
      self.strikeN = a; self.dwellN = self.ms(self._dwellS(f) * 1000);
      self._emit({ type: 'print', at: a, bar: op.bar, ch: ch, force: f, column: x, line: self.line + self.feed, shift: sh,
        tilt: row, rotation: (((tgt % K.ROT_POS) + K.ROT_POS) % K.ROT_POS) * 360 / K.ROT_POS, r: self._r32() });
      self._at(a + self.escN, function (b) { self._moveTo(b, self.stepN, Math.min(self.col + 1, self.lockCol)); });
    });
    T = Math.max(this.cycleN, printN + this.ms(this.tm.fallMs));
    end(T);
  } else if (op.kind === OP_SPACE) {
    var colS = Math.min(this.col + 1, this.lockCol);
    this._emit({ type: 'space', at: at, column: colS, r: this._r32() });
    this._at(at + this.spaceEscN, function (a) { self._moveTo(a, self.stepN, colS); });
    end(this.spaceN);
  } else if (op.kind === OP_BACK) {
    var colB = Math.max(this.col - 1, 0);
    this._emit({ type: 'backspace', at: at, column: colB });
    this._moveTo(at, this.stepN, colB);
    end(this.backN);
  } else if (op.kind === OP_SHIFT) {
    var to = op.to, el2 = this._elem(at);
    this._emit({ type: 'shift', at: at, to: to });
    this.shiftSeg = { a: at, b: at + this.shiftN, from: this.shiftPos, to: to };
    this.eseg = { a: at, b: at + this.shiftN, t0: el2[0], t1: el2[0], r0: el2[1], r1: el2[1] + K.SHIFT_POS };
    this._at(at + this.shiftN, function () { self.shiftPos = to; self.shift = to; self.shiftSeg = null; });
    end(this.shiftN);
  } else if (op.kind === OP_INDEX) {
    this._emit({ type: 'linefeed', at: at, line: this.line, r: this._r32() });
    this._startFeed(at);
    end(this.feedN);
  } else {                                                    // OP_RETURN
    d = this.col;
    if (d > 0 || this._carX(at) > 0) {
      this.returning = true;
      this._emit({ type: 'returnStart', at: at, column: this._carX(at), line: this.line, r: this._r32() });
      var trv = Math.max(this.retMinN, Math.round(this.retFullN * d / K.LINE_COLS)), a0 = at + this.retStartN;
      this._at(at + this.retIndexN, function (a) { self._startFeed(a); });
      this._at(a0, function (a) { self._moveTo(a, trv, 0); });
      this._at(a0 + trv, function (a) { self._emit({ type: 'returnEnd', at: a, column: 0, line: self.line }); self.bellArmed = true; });
      end(this.retStartN + trv + this.retUnlatchN);
    } else {
      this._emit({ type: 'linefeed', at: at, line: this.line, r: this._r32() });
      this.returning = true;
      this._startFeed(at);
      end(this.feedN);
    }
  }
};

Engine.prototype._startFeed = function (at) {
  var self = this;
  this.feedSeg = { a: at, b: at + this.feedN };
  this._at(at + this.feedN, function () { self.line += 1; self.feed = 0; self.feedSeg = null; });
};

Engine.prototype._end = function (at, op) {
  this.running = null; this.opLenN = 1;
  if (op.kind === OP_RETURN) this.returning = false;
  this._emit({ type: 'cycleEnd', at: at, kind: op.kind });
  this._kick(at);
};

/* The power switch (ADDITION). Returns true if the switch changed. */
Engine.prototype.setPower = function (on) {
  on = !!on;
  if (on === this.on) return false;
  this.on = on;
  if (on) { this.stopped = false; this._emit({ type: 'motorOn', at: this.t }); }
  else {
    this.ready = false; this.queue.length = 0;               // the stored keys are lost; the operation in progress ends (GUESS)
    this.shiftL = this.shiftR = false; this.shiftLog = this.shiftPos;
    this._emit({ type: 'motorOff', at: this.t });
  }
  return true;
};

/* A key goes down. force is 0 to 1; without it the engine makes a force from its seed. Returns true if the machine accepted the key.
 * With the motor off, no key does anything (false, no event). */
Engine.prototype.keyDown = function (code, force) {
  var i = this.codeIndex[code], L, op;
  if (i !== undefined) {
    if (!this.on || this.held[i]) return false;
    L = this._logic();
    if (L.ret || L.col >= this.lockCol || this._stored() >= K.QUEUE_MAX) return false;
    var g = (this.rnd() + this.rnd() + this.rnd() + this.rnd() - 2) * 1.732;
    var f = typeof force === 'number' ? force : this.tm.defaultVel + K.FORCE_SD * g;
    f = Math.max(typeof force === 'number' ? 0.05 : K.FORCE_MIN, Math.min(1, f));
    this.held[i] = 1;
    this._emit({ type: 'drive', at: this.t, bar: i, force: f, r: this._r32() });
    this._push({ kind: OP_CHAR, bar: i, force: f, colAfter: Math.min(L.col + 1, this.lockCol) });
    return true;
  }
  if (code === 'ShiftLeft' || code === 'ShiftRight') {
    if (!this.on) return false;
    if (code === 'ShiftLeft') this.shiftL = true; else this.shiftR = true;
    if (this.shiftLog === 0) { this.shiftLog = 1; this._push({ kind: OP_SHIFT, to: 1, colAfter: this._logic().col }); }
    return true;
  }
  if (code === 'Space') {
    if (!this.on || this.spaceHeld) return false;
    L = this._logic();
    if (L.ret || L.col >= this.lockCol || this._stored() >= K.QUEUE_MAX) return false;
    this.spaceHeld = 1; this._push({ kind: OP_SPACE, colAfter: Math.min(L.col + 1, this.lockCol) });
    return true;
  }
  if (code === 'Backspace') {
    if (!this.on || this.backHeld) return false;
    L = this._logic();
    if (L.ret || L.col <= 0 || this._stored() >= K.QUEUE_MAX) return false;
    this.backHeld = 1; this._push({ kind: OP_BACK, colAfter: L.col - 1 });
    return true;
  }
  if (code === 'Enter') {
    if (!this.on) return false;
    L = this._logic();
    if (L.ret || this._stored() >= K.QUEUE_MAX) return false;
    this._push({ kind: OP_RETURN, colAfter: 0 });
    return true;
  }
  if (code === CODE_INDEX) {
    if (!this.on || this.indexHeld) return false;
    L = this._logic();
    if (L.ret || this._stored() >= K.QUEUE_MAX) return false;
    this.indexHeld = 1; this._push({ kind: OP_INDEX, colAfter: L.col });
    return true;
  }
  return false;                              // the machine does not have this key
};

Engine.prototype.keyUp = function (code) {
  var i = this.codeIndex[code];
  if (i !== undefined) this.held[i] = 0;
  else if (code === 'ShiftLeft' || code === 'ShiftRight') {
    if (code === 'ShiftLeft') this.shiftL = false; else this.shiftR = false;
    if (!this.shiftL && !this.shiftR && this.shiftLog === 1 && this.on) { this.shiftLog = 0; this._push({ kind: OP_SHIFT, to: 0, colAfter: this._logic().col }); }
  }
  else if (code === 'Space') this.spaceHeld = 0;
  else if (code === 'Backspace') this.backHeld = 0;
  else if (code === CODE_INDEX) this.indexHeld = 0;
};

/* Machine B has a jam release. Machine C has no jam. The method exists and does nothing, so page code does not break. */
Engine.prototype.release = function () { return false; };

/* ADDITION. A new sheet is in the machine: the carrier is at the given column (default 0, the left margin) and the line is the given number (default 0).
 * The stored keys and the operation in progress end. The page also uses it to put the machine back at the saved position. The motor is not changed. */
Engine.prototype.newSheet = function (column, line) {
  var c = Math.max(0, Math.min(this.lockCol, Math.round(column) || 0));
  this.sched.length = 0; this.queue.length = 0; this.running = null; this.opLenN = 1; this.returning = false;
  this.col = c; this.cseg = null; this.x = c;
  this.line = Math.max(0, Math.round(line) || 0); this.feed = 0; this.feedSeg = null; this.bellArmed = c < this.bellCol;
};

Engine.prototype._step = function () {
  var t = this.t, N = K.STEP_SAMPLES, tE = t + N, dt = this.dt, s, e, x0 = this.x, x1, f;
  /* 1. motor */
  if (this.on) {
    if (this.speed < 1) this.speed = Math.min(1, this.speed + dt / K.RUNUP_S);
    if (!this.ready && this.speed >= K.MOTOR_READY) { this.ready = true; this._emit({ type: 'motorReady', at: t }); this._kick(t); }
  } else if (this.speed > 0) {
    this.speed = Math.max(0, this.speed - dt / K.RUNDOWN_S);
    if (this.speed === 0 && !this.stopped) { this.stopped = true; this._emit({ type: 'motorStopped', at: t }); }
  }
  /* 2. scheduled actions (they start operations and move parts) */
  s = this.sched;
  while (s.length && s[0].at < tE) { e = s.shift(); e.fn(e.at); }
  /* 3. continuous parts at the end of the step */
  x1 = this.x = this._carX(tE);
  if (this.bellArmed && x0 < this.bellCol && x1 >= this.bellCol) {
    f = (this.bellCol - x0) / (x1 - x0);
    this.bellArmed = false;
    this._emit({ type: 'bell', at: t + Math.min(N - 1, Math.floor(f * N)), column: this.bellCol, r: this._r32() });
  } else if (!this.bellArmed && x1 < this.bellCol - K.BELL_REARM) this.bellArmed = true;
  e = this._elem(tE); this.tilt = e[0]; this.rot = e[1];
  if (this.eseg && tE >= this.eseg.b) { this.eseg = null; }
  if (this.feedSeg) this.feed = Math.min(1, Math.max(0, (tE - this.feedSeg.a) / (this.feedSeg.b - this.feedSeg.a)));
  if (this.shiftSeg) this.shift = this.shiftSeg.from + (this.shiftSeg.to - this.shiftSeg.from) * smooth((tE - this.shiftSeg.a) / (this.shiftSeg.b - this.shiftSeg.a));
  this.t = tE;
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

/* Compact state for the picture. out is a Float32Array of length SelectricEngine.SNAP.LEN. */
Engine.prototype.snapshot = function (out) {
  var i, rot = ((this.rot % K.ROT_POS) + K.ROT_POS) % K.ROT_POS, d = this.t - this.strikeN;
  out = out || new Float32Array(SNAP.LEN);
  out[SNAP.T] = this.t; out[SNAP.X] = this.x; out[SNAP.TARGET] = this.cseg ? this.cseg.x1 : this.col;
  out[SNAP.LINE] = this.line + this.feed; out[SNAP.SHIFT] = this.shift;
  out[SNAP.FLAGS] = (this.locked() ? FLAG_LOCK : 0) | (this.returning ? FLAG_RETURN : 0) | (this.on && this.ready ? FLAG_MOTOR : 0) | (this.running ? FLAG_BUSY : 0);
  for (i = 0; i < NB; i++) { out[SNAP.BARS + i] = 0; out[SNAP.KEYS + i] = this.held[i]; }
  out[SNAP.SPACE] = this.spaceHeld; out[SNAP.BACKSPACE] = this.backHeld; out[SNAP.SHIFTKEY] = (this.shiftL ? 1 : 0) + (this.shiftR ? 2 : 0);
  out[SNAP.LEVER] = this.returning ? 1 : 0;
  out[SNAP.MOTOR] = this.speed; out[SNAP.TILT] = this.tilt; out[SNAP.ROTATION] = rot * 360 / K.ROT_POS;
  out[SNAP.STRIKE] = d >= -this.dwellN && d <= this.dwellN ? 1 - Math.abs(d) / this.dwellN : 0;
  out[SNAP.POWER] = this.on ? 1 : 0;
  out[SNAP.CYCLE] = this.running ? Math.min(1, (this.t - this.opStartN) / this.opLenN) : 0;
  out[SNAP.QUEUE] = this.queue.length;
  return out;
};

/* Times in ms that follow from the constants, for one key force. The checks and the readout use them.
 * Shared names with engine.js: travel (cycle start to print), jamBelow (0: no jam), step, settle, cleanAbove, returnMs. */
Engine.prototype.times = function (force) {
  var tm = this.tm, f = typeof force === 'number' ? force : tm.defaultVel, ck = 1000 / this.sr;
  var cyc = Math.max(this.cycleN, this.ms(this._printS(f) * 1000) + this.ms(tm.fallMs)) * ck;
  return { travel: this._printS(f) * 1000, jamBelow: 0, step: K.CARRIER_STEP_MS, settle: 0, cleanAbove: cyc,
    returnMs: (this.retStartN + this.retFullN + this.retUnlatchN) * ck,
    cycleMs: cyc, runUpMs: K.RUNUP_S * 1000 * K.MOTOR_READY, runDownMs: K.RUNDOWN_S * 1000 };
};
/* Time of a return from a column, in ms (ADDITION). */
Engine.prototype.returnMsFrom = function (col) {
  return (this.retStartN + Math.max(this.retMinN, Math.round(this.retFullN * col / K.LINE_COLS)) + this.retUnlatchN) * 1000 / this.sr;
};

Engine.K = K; Engine.KEYS = KEYS; Engine.ROWS = ROWS; Engine.SNAP = SNAP;
Engine.FLAG_JAM = FLAG_JAM; Engine.FLAG_LOCK = FLAG_LOCK; Engine.FLAG_RETURN = FLAG_RETURN;
Engine.FLAG_MOTOR = FLAG_MOTOR; Engine.FLAG_BUSY = FLAG_BUSY; Engine.CODE_INDEX = CODE_INDEX;
Engine.timingFromSynth = timingFromSynth;
return Engine;
}

var Engine = define();
Engine.source = '(' + define.toString() + ')()';   // the text of the class, for the AudioWorklet
root.SelectricEngine = Engine;
if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
