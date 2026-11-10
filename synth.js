/* synth.js - Period Listening Tests. All sound generation.
 * Rule: each sound is a pure function (sampleRate, seed, params) -> Float32Array, or {L, R} for stereo.
 * No Web Audio node, no Math.random(), no DOM. Loads as a classic script (global Synth) and in Node.
 */
(function (root) {
'use strict';

/* ======================================================================================
 * PARAMETER BLOCK. Every tunable number is here, grouped by setting.
 * Each comment says SOURCED(key) -> see SOURCES below, or GUESS.
 * Mode tables are [frequency Hz, decay time T60 ms, gain]. All mode tables are GUESS.
 *
 * PREDICTION, written before tuning: spectral centroid of the key strike is A < B < C.
 * Basis: A has a long lever, a wire and a type-bar that swings up (SOURCED officemuseum);
 * B has a short geared type-bar in a light case (SOURCED polt-remport); C has one 1 3/8 inch
 * element and a 65 ms print cycle (SOURCED ibm-selectric, wiki-selectric). A larger part has
 * lower modes. The order is a GUESS from these part sizes. No measured spectrum was found.
 * ==================================================================================== */
var P = {
  /* ------------------------------ values that all settings use. All GUESS ------------------------------ */
  common: {
    impact: { velPow: 1.4, contact: [1.45, 0.7], gainJit: 0.25 }, // level = velocity^1.4; contact time factor = 1.45 - 0.7 * velocity; mode gain change +/- 25 %
    defaultVel: 0.8,                              // velocity when the caller gives none
    strikeJit: 0.06,                              // relative change of the timing inside one key strike
    strikeVelTime: [1.15, 0.3],                   // key travel time factor = 1.15 - 0.3 * velocity
    tailMs: { strike: 260, space: 220, linefeed: 200, ret: 420, retC: 380 }, // ms of buffer after the last event
    fadeMs: { hit: 8, ret: 10, bell: 20 },        // ms, fade at the end of a buffer
    linefeed: { firstMs: 12, gapJit: 0.1, firstVel: 0.8 }, // delay of the first click; change of the gap; level of the first click
    ret: { gapMs: 40, rollPow: 0.6, tickPow: 1.6, tickVel: [0.35, 0.65, 0.6] }, // A and B: speed curve of the carriage and level of the rack ticks
    bell: { velPow: 1.2, f0Jit: 0.004, beatJit: [0.6, 0.8], start: [0.5, 0.1], lenFactor: 1.15 },
    tickUnit: 12,                                 // a click is this many times the noise gain (A and B media)
    tickJit: [0.8, 0.4],                          // size of the tick in each turn = 0.8 + 0.4 * random
    crackleMean: 0.5,                             // mean size of a random click, in tick units
    human: { velSd: 0.06, velMin: 0.2 },          // random change of the note velocity; lowest velocity
    mixRef: 0.1,                                  // RMS of an instrument bus with level 1, before the peak normalisation
    /* Version of the machine sounds (key strike, space bar, return, line feed, bell). 1: the first version, kept
     * bit-identical for comparison. 2: tuned to numbers measured on recordings of a real manual typewriter
     * (the targets are in check.mjs). The music, the devices and the C motor loop are the same in both versions. */
    machineVersion: 2,
    v2: { velTilt: 0.25 }                         // version 2: noise band level change = velocity ^ (velTilt * log2(band Hz / 2000)); a soft hit is darker. GUESS
  },
  /* ------------------------------ A: 1897 news office ------------------------------ */
  A: {
    info: {
      year: 1897,                                   // GUESS: one year in which machine, device and medium were all in use
      place: '1890s news office',
      machine: 'Remington Standard No. 2',          // SOURCED(twmuseum-rem2, twdb-remington): understrike, made 1878 to 1894
      device: 'Edison Home Phonograph with a brown wax cylinder', // SOURCED(edison-home, ucsb-brownwax)
      style: 'Military band march in 2/4 time, no drums',          // SOURCED(ucsb-styles, tinfoil-record)
      instruments: 'cornet, piccolo, two alto horns, trombone, tuba'
    },
    machine: {
      outGain: 0.45,                                // linear output gain. GUESS
      scatter: 0.05,                                // relative mode frequency change per key. GUESS
      strike: {
        travelMs: 40,                               // ms from key-down to type impact. GUESS
        key:   { contactMs: 1.6, noiseMs: 3, noiseMix: 0.4, direct: 0.05, gain: 0.16,
                 modes: [[330, 40, 1.0], [760, 24, 0.6], [1500, 12, 0.25]] },          // wooden key lever and wire
        type:  { contactMs: 1.1, noiseMs: 4, noiseMix: 0.3, direct: 0.10, gain: 1.0,
                 modes: [[140, 120, 0.9], [265, 95, 1.0], [520, 70, 0.8], [940, 48, 0.55], [1650, 30, 0.3], [2700, 16, 0.14]] }, // type-bar on platen, cast frame
        esc:   { delayMs: 16, contactMs: 0.6, noiseMs: 2, noiseMix: 0.4, direct: 0.05, gain: 0.22,
                 modes: [[700, 28, 0.8], [1700, 16, 1.0], [3100, 9, 0.4]] },           // escapement dogs
        fall:  { delayMs: 95, contactMs: 2.4, noiseMs: 6, noiseMix: 0.5, direct: 0.03, gain: 0.2,
                 modes: [[180, 55, 1.0], [430, 34, 0.6]] }                             // type-bar falls back into the basket
      },
      space: {
        bar:   { contactMs: 2.0, noiseMs: 5, noiseMix: 0.45, direct: 0.05, gain: 0.55,
                 modes: [[210, 70, 1.0], [480, 45, 0.7], [1050, 22, 0.3]] },           // wooden space bar on its stop
        esc:   { delayMs: 22, contactMs: 0.6, noiseMs: 2, noiseMix: 0.4, direct: 0.05, gain: 0.3,
                 modes: [[700, 28, 0.8], [1700, 16, 1.0], [3100, 9, 0.4]] }
      },
      linefeed: {
        clicks: 2, gapMs: 55,                       // ratchet clicks of the cylinder, ms between clicks. GUESS
        click: { contactMs: 0.5, noiseMs: 2, noiseMix: 0.35, direct: 0.06, gain: 0.5,
                 modes: [[620, 40, 0.8], [1350, 26, 1.0], [2600, 14, 0.5]] },
        rubMs: 140, rubGain: 0.05, rubHz: [300, 1800] // friction noise of the lever pull. GUESS
      },
      ret: {                                        // SOURCED(rem2-manual): pull lever (line feed), push right to the stop-collar
        travelMs: 900,                              // ms of carriage travel. GUESS
        ticks: 58,                                  // rack teeth that pass the dog. GUESS
        tick:  { contactMs: 0.4, noiseMs: 1, noiseMix: 0.3, direct: 0.04, gain: 0.13,
                 modes: [[1100, 10, 1.0], [2400, 6, 0.6]] },
        rollGain: 0.07, rollHz: [90, 700],          // carriage rolls on the rods. GUESS
        stop:  { contactMs: 2.2, noiseMs: 6, noiseMix: 0.3, direct: 0.06, gain: 1.0,
                 modes: [[85, 170, 1.0], [170, 120, 0.8], [360, 75, 0.5], [760, 40, 0.3], [1500, 22, 0.12]] }
      },
      bell: {                                       // SOURCED(rem2-manual): a bell-ringer exists
        f0: 1750,                                   // Hz. GUESS
        partials: [[1, 1.0, 1300], [2.71, 0.45, 800], [5.2, 0.2, 420], [8.3, 0.08, 220]], // [ratio, gain, T60 ms]. GUESS
        beat: 0.0025,                               // relative split of each partial. GUESS
        hammer: { contactMs: 0.5, noiseMs: 1.5, noiseMix: 0.3, direct: 0.05, gain: 0.25, modes: [[900, 20, 1.0], [2100, 12, 0.6]] },
        gain: 0.5
      },
      /* Version 2. Same method as B (see P.B.machine.v2). A is heavier and slower than B: the band levels are about
       * half an octave lower and the decays about 1.4 times longer than in B, with real energy above 4 kHz. All shifts GUESS. */
      v2: {
        outGain: 0.25,
        strike: {
          level: 0.50, tailMs: 260,
          key:  { gain: 0.14, atkMs: 9,                                      // finger on the key, long key lever and wire start to move
                  bands: [[500, -14, 45], [1000, -8, 45], [2000, -3, 40], [4000, 0, 35], [8000, -6, 25]],
                  body: { contactMs: 4, noiseMs: 3, noiseMix: 0.3, direct: 0.02, gain: 0.3, modes: [[330, 40, 1.0], [760, 24, 0.6]] } },
          type: { gain: 1.0, atkMs: 1.2, crack: [1.5, 4],                    // heavy type-bar on the platen from below, cast frame
                  bands: [[63, -32, 420], [125, -27, 400], [250, -22, 380], [500, -17, 320], [1000, -10, 230], [2000, -4, 200], [4000, -2, 180], [8000, -6, 160], [16000, -30, 110]],
                  body: { contactMs: 1.1, noiseMs: 2, noiseMix: 0.3, direct: 0, gain: 0.25,
                          modes: [[265, 95, 0.6], [520, 70, 0.8], [940, 60, 1.0], [1650, 50, 0.8], [2700, 40, 0.6], [4300, 30, 0.4]] } },
          esc:  { gain: 0.3, atkMs: 0.5,                                     // escapement dogs
                  bands: [[1000, -6, 30], [2000, -2, 25], [4000, 0, 20], [8000, -4, 15]],
                  body: { contactMs: 0.6, noiseMs: 2, noiseMix: 0.4, direct: 0, gain: 0.3, modes: [[700, 28, 0.8], [1700, 16, 1.0], [3100, 9, 0.4]] } },
          fall: { gain: 0.06, atkMs: 4,                                      // type-bar falls back into the basket
                  bands: [[125, -6, 80], [250, -3, 70], [500, -6, 55], [1000, -14, 40]],
                  body: { contactMs: 3, noiseMs: 4, noiseMix: 0.5, direct: 0, gain: 0.3, modes: [[180, 55, 1.0], [430, 34, 0.6]] } }
        },
        space: {
          level: 0.34, tailMs: 260,
          bar: { gain: 0.8, atkMs: 5, crack: [3, 4],                         // wooden space bar on its stop
                 bands: [[63, -18, 300], [125, -20, 330], [250, -22, 330], [500, -26, 240], [1000, -12, 160], [2000, -3, 140], [4000, -4, 130], [8000, -9, 120], [16000, -30, 90]],
                 body: { contactMs: 2, noiseMs: 3, noiseMix: 0.3, direct: 0, gain: 0.05, modes: [[210, 70, 1.0], [480, 45, 0.7], [1050, 30, 0.5]] } },
          esc: { gain: 0.6, atkMs: 0.5,
                 bands: [[1000, -6, 30], [2000, -2, 25], [4000, 0, 20], [8000, -4, 15]],
                 body: { contactMs: 0.6, noiseMs: 2, noiseMix: 0.4, direct: 0, gain: 0.3, modes: [[700, 28, 0.8], [1700, 16, 1.0], [3100, 9, 0.4]] } }
        },
        linefeed: {
          level: 0.85, tailMs: 220,
          click: { gain: 0.8, atkMs: 0.8,                                    // ratchet of the cylinder
                   bands: [[125, -26, 50], [250, -28, 50], [500, -28, 50], [1000, -22, 45], [2000, -10, 45], [4000, -2, 50], [8000, -3, 55], [16000, -20, 40]],
                   body: { contactMs: 0.5, noiseMs: 1.5, noiseMix: 0.4, direct: 0, gain: 0.15, modes: [[1350, 40, 1.0], [2600, 30, 0.8], [4400, 20, 0.5]] } },
          teeth: [[12, 0.3], [24, 0.5]],
          release: [130, 0.3],
          rubGain: 0.01, rubHz: [3000, 9000]
        },
        ret: {
          level: 0.8, tailMs: 480,
          buzz: { gain: 0.06, hz: [2000, 8000], depth: 0.15 },
          roll: { gain: 0.25, hz: [50, 700] },
          jolts: 5,
          jolt: { gain: 0.25, atkMs: 0.8,
                  bands: [[500, -14, 60], [1000, -10, 55], [2000, -5, 55], [4000, 0, 50], [8000, -5, 40], [16000, -20, 25]],
                  body: { contactMs: 0.6, noiseMs: 1.5, noiseMix: 0.4, direct: 0, gain: 0.2, modes: [[1100, 14, 1.0], [2400, 9, 0.6]] } },
          stop: { gain: 1.0, atkMs: 18,                                      // carriage on the stop-collar
                  bands: [[63, -24, 430], [125, -15, 410], [250, -15, 400], [500, -24, 220], [1000, -8, 140], [2000, -9, 135], [4000, -4, 100], [8000, -6, 95], [16000, -20, 70]],
                  body: { contactMs: 5, noiseMs: 4, noiseMix: 0.3, direct: 0, gain: 0.3, modes: [[85, 170, 1.0], [170, 120, 0.8], [360, 75, 0.5], [760, 40, 0.3]] } },
          rebound: [[22, 0.8], [52, 0.5], [76, 0.3]],
          bounce: { gain: 0.6, atkMs: 1.5,
                    bands: [[250, -16, 130], [500, -22, 110], [1000, -6, 85], [2000, -6, 75], [4000, -2, 65], [8000, -4, 60], [16000, -20, 45]],
                    body: { contactMs: 1.5, noiseMs: 2, noiseMix: 0.3, direct: 0, gain: 0.2, modes: [[170, 120, 0.8], [360, 75, 0.5], [760, 40, 0.3]] } }
        },
        bell: {
          lenMs: 2100, atkMs: 10,
          f0: 1750,                                                          // Hz, lowest partial (version 1 value)
          partials: [[1, 0.12, 2200], [2.55, 1.0, 900], [3.8, 0.3, 600], [4.95, 1.2, 380], [6.1, 0.6, 300], [7.3, 0.3, 240]], // own ratios. GUESS
          beat: 0.0025,
          hammer: { gain: 0.15, atkMs: 0.5, bands: [[2000, 0, 35], [4000, 0, 30], [8000, -3, 20]],
                    body: { contactMs: 0.5, noiseMs: 1.5, noiseMix: 0.3, direct: 0, gain: 0.2, modes: [[2100, 12, 1.0], [4300, 8, 0.6]] } },
          gain: 0.85
        }
      }
    },
    music: {
      bpm: 132,                                     // beats per minute. GUESS (beat 2.2 Hz, 10 % from the 2.0 Hz rotation)
      tonic: 58,                                    // MIDI note of the key (B flat). GUESS
      beatsPerBar: 2, introBars: 4, strainBars: 16, tagBars: 4,
      tailS: 1.2, peak: 0.7,                        // s of tail, peak level of the dry clip
      swing: 0.5,                                   // 0.5 = even eighth notes
      cells: [[1, 1], [1, 0.5, 0.5], [0.5, 0.5, 1], [0.75, 0.25, 1], [0.75, 0.25, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5], [1.5, 0.5]], // rhythm cells in beats. Own design
      range: [62, 81], leap: 3.2, chrom: 0,
      introCells: [[0.75, 0.25, 0.5, 0.5], [1, 1], [0.75, 0.25, 0.5, 0.5], [2]], restCell: [1, 1], halfCell: [1.5, 0.5], endCell: [1, -1],
      tagCells: [[0.5, 0.5, 0.5, 0.5], [1, 1], [0.5, 0.5, 0.5, 0.5], [1, -1]],
      grammar: {                                    // chords are [semitones above the tonic, type]. Each bar: one of the options. Own design
        intro: [[0, 'M'], [0, 'M'], [7, '7'], [7, '7']],
        phrase: [[[0, 'M']], [[0, 'M'], [5, 'M'], [9, 'm']], [[2, 'm'], [5, 'M'], [0, 'M']], [[7, '7']], [[0, 'M']], [[5, 'M'], [9, 'm'], [0, 'M']], [[2, '7'], [2, 'm'], [5, 'M']], [[7, '7']]],
        close: [[5, 'M'], [0, 'M'], [7, '7'], [0, 'M']], tag: [[5, 'M'], [0, 'M'], [7, '7'], [0, 'M']]
      },
      perf: {                                       // performance rules. All GUESS
        startAbove: 12,                             // first melody note, semitones above the tonic
        humanMs: [5, 6],                            // random timing change, ms: lead and bass, other voices
        legato: [0.72, 0.86],                       // note length factor: notes of half a beat or less, longer notes
        vel: [0.95, 0.8],                           // velocity on the first beat, on other beats
        piccoloVel: 0.9,
        tuba: [38, 31, 46], tubaFifth: [-3, 29, 46], tubaLen: 0.55,   // [centre, low, high] MIDI notes; length in beats
        horn1: [60, 55, 67], horn2: [63, 56, 68], hornLen: [0.3, 0.6],
        trb: [46, 64], trbStart: -6, trbSplit: 0.35, trbLen: [0.9, 1.85], trbVel: [0.8, 0.75], // trbSplit: probability of two notes in a bar
        fadeMs: 60
      },
      mix: { cornet: 1.0, piccolo: 0.5, horns: 0.42, trombone: 0.6, tuba: 0.75 },      // relative RMS levels. GUESS
      inst: {                                       // FM and additive voices. All GUESS
        cornet:   { ratio: 1, idx: 3.0, atk: 0.028, dec: 0.12, sus: 0.78, rel: 0.05, vibHz: 5.6, vibDepth: 0.004, vibDelay: 0.2 },
        horn:     { ratio: 1, idx: 1.7, atk: 0.03, dec: 0.1, sus: 0.7, rel: 0.05, vibHz: 0, vibDepth: 0, vibDelay: 0 },
        trombone: { ratio: 1, idx: 2.4, atk: 0.045, dec: 0.15, sus: 0.75, rel: 0.07, vibHz: 5.0, vibDepth: 0.003, vibDelay: 0.3 },
        tuba:     { ratio: 1, idx: 1.5, atk: 0.05, dec: 0.16, sus: 0.6, rel: 0.08, vibHz: 0, vibDepth: 0, vibDelay: 0 },
        piccolo:  { h2: 0.22, h3: 0.07, breath: 0.035, atk: 0.035, rel: 0.05, vibHz: 5.3, vibDepth: 0.005, vibDelay: 0.15 }
      }
    },
    medium: {
      rpm: 120,                                     // SOURCED(wiki-cylinder): about 120 rpm. Range 120 to 160 (ucsb-brownwax)
      band: [100, 2500],                            // Hz. SOURCED(loc-acoustic): acoustic recording, about 100 to 2500 Hz
      hp: [170, 4], lp: [2100, 8],                  // [corner Hz, filter order]. GUESS: corners inside the band, small horn
      inGain: 0.9,                                  // GUESS
      recRes: [[620, 3.5, 5], [1250, 4.0, 6]],      // recording horn and diaphragm peaks [Hz, Q, dB]. GUESS
      playRes: [[880, 3.0, 4], [1750, 5.0, 5]],     // reproducer and playback horn peaks [Hz, Q, dB]. GUESS
      drive: 1.5,                                   // saturation of wax and diaphragm. GUESS
      noiseGain: 0.07,                              // GUESS, set for about 22 dB (SOURCED fpi, weak: 20 to 30 dB)
      swishDepth: 0.5,                              // noise change in each turn, 0..1. GUESS
      tickGain: 0.9, crackleRate: 16, crackleGain: 0.5, // tick in each turn; random clicks per s. GUESS
      wow: [[1, 0.003], [0.185, 0.002], [4.6, 0.0008]], // [frequency relative to rotation, peak speed change]. GUESS (spring motor)
      outGain: 0.8
    }
  },

  /* ------------------------------ B: 1927 writer's room ------------------------------ */
  B: {
    info: {
      year: 1927,                                   // GUESS: one year in the production time of the machine and the device
      place: '1920s writer\'s room',
      machine: 'Remington Portable No. 2',          // SOURCED(polt-remport): February 1925 to December 1928
      device: 'Victor Orthophonic Victrola (Credenza, spring motor) with a 78 rpm shellac disc', // SOURCED(wiki-orthophonic, gracyk-credenza)
      style: 'Dance band fox-trot in 4/4 time, electrical recording',  // SOURCED(nja-78, mgthomas-dance, auldworks)
      instruments: 'cornet, clarinet, trombone, banjo, tuba, wood block'
    },
    machine: {
      outGain: 0.5,
      scatter: 0.05,
      strike: {
        travelMs: 24,                               // GUESS: short geared type-bar
        key:   { contactMs: 0.9, noiseMs: 2, noiseMix: 0.4, direct: 0.05, gain: 0.14,
                 modes: [[900, 18, 1.0], [2100, 10, 0.6]] },
        type:  { contactMs: 0.55, noiseMs: 2.5, noiseMix: 0.35, direct: 0.16, gain: 1.0,
                 modes: [[340, 48, 0.6], [690, 38, 0.9], [1320, 30, 1.0], [2250, 22, 0.8], [3600, 14, 0.5], [5400, 8, 0.25]] }, // light bar, thin sheet-metal case
        esc:   { delayMs: 9, contactMs: 0.4, noiseMs: 1.5, noiseMix: 0.4, direct: 0.06, gain: 0.25,
                 modes: [[1500, 16, 0.8], [3300, 10, 1.0], [5600, 6, 0.4]] },
        fall:  { delayMs: 52, contactMs: 1.2, noiseMs: 4, noiseMix: 0.5, direct: 0.04, gain: 0.16,
                 modes: [[520, 26, 1.0], [1250, 16, 0.6]] }
      },
      space: {
        bar:   { contactMs: 1.2, noiseMs: 4, noiseMix: 0.45, direct: 0.06, gain: 0.5,
                 modes: [[420, 40, 1.0], [980, 26, 0.8], [2300, 14, 0.4]] },
        esc:   { delayMs: 12, contactMs: 0.4, noiseMs: 1.5, noiseMix: 0.4, direct: 0.06, gain: 0.3,
                 modes: [[1500, 16, 0.8], [3300, 10, 1.0], [5600, 6, 0.4]] }
      },
      linefeed: {
        clicks: 2, gapMs: 38,
        click: { contactMs: 0.4, noiseMs: 1.5, noiseMix: 0.35, direct: 0.07, gain: 0.5,
                 modes: [[1150, 26, 0.8], [2500, 16, 1.0], [4400, 9, 0.5]] },
        rubMs: 90, rubGain: 0.04, rubHz: [600, 3200]
      },
      ret: {                                        // SOURCED(remport-manual): one lever feeds the line and returns the carriage
        travelMs: 520, ticks: 62,
        tick:  { contactMs: 0.3, noiseMs: 0.8, noiseMix: 0.3, direct: 0.05, gain: 0.12,
                 modes: [[2100, 7, 1.0], [4300, 4, 0.6]] },
        rollGain: 0.05, rollHz: [250, 1600],
        stop:  { contactMs: 1.3, noiseMs: 4, noiseMix: 0.3, direct: 0.08, gain: 0.85,
                 modes: [[210, 80, 1.0], [450, 55, 0.8], [980, 34, 0.5], [2100, 18, 0.25]] }
      },
      bell: {                                       // SOURCED(remport-manual): the bell rings six spaces before the keys lock
        f0: 2550,
        partials: [[1, 1.0, 800], [2.71, 0.4, 480], [5.2, 0.16, 250]],
        beat: 0.003,
        hammer: { contactMs: 0.4, noiseMs: 1.2, noiseMix: 0.3, direct: 0.05, gain: 0.22, modes: [[1500, 14, 1.0], [3400, 8, 0.6]] },
        gain: 0.42
      },
      /* Version 2. The timings (travel, escapement, fall, clicks, return travel) stay in the blocks above: the engine reads them.
       * Each event: gain; atkMs = rise time of the impact noise; bands = [[octave band Hz, level dB, decay T60 ms], ...];
       * body = structure modes (same form as version 1). The band levels and decays are set so that the sounds meet the
       * targets in check.mjs (measured on recordings of a real manual typewriter). The split into events is a GUESS. */
      v2: {
        outGain: 0.25,
        strike: {
          level: 0.42, tailMs: 230,
          key:  { gain: 0.12, atkMs: 7,                                      // finger on the key top, key lever starts to move: soft contact
                  bands: [[1000, -14, 30], [2000, -8, 30], [4000, -3, 25], [8000, 0, 22], [16000, -8, 15]],
                  body: { contactMs: 3, noiseMs: 2, noiseMix: 0.3, direct: 0.02, gain: 0.3, modes: [[900, 18, 1.0], [2100, 10, 0.6]] } },
          type: { gain: 1.0, atkMs: 0.8, crack: [1.5, 3],                      // type face on paper and rubber platen: the main impact
                  bands: [[125, -34, 286], [250, -32, 270], [500, -28, 223], [1000, -19, 161], [2000, -10, 140], [4000, -3, 129], [8000, -1, 124], [16000, -30, 90]],
                  body: { contactMs: 0.5, noiseMs: 1, noiseMix: 0.3, direct: 0, gain: 0.25,
                          modes: [[690, 38, 0.5], [1320, 30, 0.8], [2250, 40, 1.0], [3600, 30, 0.8], [5400, 25, 0.6], [7900, 20, 0.4]] } }, // sheet-metal case and type-bar
          esc:  { gain: 0.3, atkMs: 0.3,                                     // escapement dog drops into the next rack tooth: small metal click
                  bands: [[2000, -6, 20], [4000, -2, 18], [8000, 0, 15], [16000, -6, 10]],
                  body: { contactMs: 0.4, noiseMs: 1, noiseMix: 0.4, direct: 0, gain: 0.3, modes: [[1500, 16, 0.8], [3300, 10, 1.0], [5600, 6, 0.4]] } },
          fall: { gain: 0.05, atkMs: 3,                                      // type-bar falls back onto the felt rest: soft and dull
                  bands: [[250, -6, 60], [500, -3, 50], [1000, -6, 40], [2000, -14, 30]],
                  body: { contactMs: 2.5, noiseMs: 3, noiseMix: 0.5, direct: 0, gain: 0.3, modes: [[520, 26, 1.0], [1250, 16, 0.6]] } }
        },
        space: {
          level: 0.31, tailMs: 220,
          bar: { gain: 0.8, atkMs: 4, crack: [3, 3],                         // wooden space bar on its rubber stop
                 bands: [[63, -20, 234], [125, -34, 255], [250, -26, 255], [500, -43, 175], [1000, -42, 118], [2000, -1, 104], [4000, -4, 100], [8000, -3, 93], [16000, -28, 69]],
                 body: { contactMs: 1.2, noiseMs: 2, noiseMix: 0.3, direct: 0, gain: 0.05, modes: [[420, 40, 1.0], [980, 26, 0.8], [2300, 30, 0.6]] } },
          esc: { gain: 0.6, atkMs: 0.3,
                 bands: [[2000, -6, 20], [4000, -2, 18], [8000, 0, 15], [16000, -6, 10]],
                 body: { contactMs: 0.4, noiseMs: 1, noiseMix: 0.4, direct: 0, gain: 0.3, modes: [[1500, 16, 0.8], [3300, 10, 1.0], [5600, 6, 0.4]] } }
        },
        linefeed: {
          level: 0.85, tailMs: 200,
          click: { gain: 0.8, atkMs: 3.5,                                    // line-space pawl pushes one ratchet tooth: bright steel click
                   bands: [[125, -28, 34], [250, -32, 34], [500, -34, 34], [1000, -33, 30], [2000, -36, 30], [4000, -8, 34], [8000, 0, 41], [16000, -15, 34]],
                   body: { contactMs: 0.3, noiseMs: 1, noiseMix: 0.4, direct: 0, gain: 0.15, modes: [[2500, 30, 1.0], [4400, 25, 0.8], [7100, 20, 0.6]] } },
          teeth: [[9, 0.3], [18, 0.5]],                                                // [ms after each click, level]: the detent roller drops into the next tooth
          release: [100, 0.3],                                               // [ms after the first click, level]: the lever spring returns the lever to its stop
          rubGain: 0.01, rubHz: [5000, 12000]                                // friction of the lever pull
        },
        ret: {
          level: 0.67, tailMs: 420,
          buzz: { gain: 0.06, hz: [3000, 12000], depth: 0.15 },              // escapement dog slides over the rack teeth; level follows the tooth position (depth)
          roll: { gain: 0.25, hz: [60, 1000] },                             // carriage rolls on its rail
          jolts: 5,                                                          // distinct ratchet events in the travel: the hand pushes in steps
          jolt: { gain: 0.25, atkMs: 0.5,
                  bands: [[1000, -14, 40], [2000, -10, 40], [4000, -5, 40], [8000, 0, 35], [16000, -8, 25]],
                  body: { contactMs: 0.4, noiseMs: 1, noiseMix: 0.4, direct: 0, gain: 0.2, modes: [[2100, 12, 1.0], [4300, 8, 0.6]] } },
          stop: { gain: 1.0, atkMs: 14,                                       // carriage meets the margin stop: the rubber bumper compresses
                  bands: [[63, -30, 305], [125, -21, 291], [250, -21, 283], [500, -31, 153], [1000, -12, 100], [2000, -13, 97], [4000, -5, 73], [8000, -2, 69], [16000, -14, 52]],
                  body: { contactMs: 4, noiseMs: 3, noiseMix: 0.3, direct: 0, gain: 0.3, modes: [[210, 80, 1.0], [450, 55, 0.8], [980, 34, 0.5], [2100, 18, 0.25]] } },
          rebound: [[20, 0.8], [34, 0.5], [44, 0.3]],                       // [ms after the stop, level]: the carriage bounces back onto the stop, each bounce shorter. GUESS
          bounce: { gain: 0.6, atkMs: 1,
                    bands: [[250, -21, 93], [500, -27, 77], [1000, -10, 60], [2000, -10, 52], [4000, -3, 45], [8000, 0, 42], [16000, -12, 31]],
                    body: { contactMs: 1, noiseMs: 2, noiseMix: 0.3, direct: 0, gain: 0.2, modes: [[450, 55, 0.8], [980, 34, 0.5], [2100, 18, 0.25]] } }
        },
        bell: {
          lenMs: 1700, atkMs: 5,                                             // atkMs: rise of the partials
          f0: 2550,                                                          // Hz, lowest partial (version 1 value)
          partials: [[1, 0.12, 1700], [2.9, 1.0, 700], [3.55, 0.35, 450], [4.15, 1.5, 280], [5.15, 0.7, 220], [5.8, 0.4, 190]], // [ratio, gain, T60 ms]: own ratios, the strongest partial is not the lowest. GUESS
          beat: 0.003,
          hammer: { gain: 0.15, atkMs: 0.4, bands: [[4000, 0, 30], [8000, 0, 20], [16000, -3, 15]],
                    body: { contactMs: 0.3, noiseMs: 1, noiseMix: 0.3, direct: 0, gain: 0.2, modes: [[3400, 8, 1.0], [6200, 6, 0.6]] } },
          gain: 0.75
        }
      }
    },
    music: {
      bpm: 184,                                     // GUESS (half bar 1.53 Hz, 18 % from the 1.304 Hz rotation)
      tonic: 63,                                    // E flat. GUESS
      beatsPerBar: 4, introBars: 2, chorusBars: 16, tagBars: 2,
      tailS: 1.0, peak: 0.7,
      swing: 0.62,                                  // position of the off-beat eighth note in the beat. GUESS
      cells: [[1.5, 0.5, 1, 1], [1, 1, 1, 1], [0.5, 1, 0.5, 2], [2, 1, 1], [1, 0.5, 0.5, 2], [1.5, 1.5, 1], [-0.5, 0.5, 1, 0.5, 1.5], [3, 1], [0.5, 0.5, 1, 2]],
      range: [60, 80], leap: 3.6, chrom: 0.15,
      halfCell: [2, -1, 1], endCell: [3, -1], tagCells: [[1.5, 1.5, 1], [1, -1, 1, -1]],
      grammar: {                                    // 6 and 7 mark the bars that use bar6 and bar7. Own design
        intro: [[0, '6'], [7, '7']],
        phrase: [[[0, '6']], [[0, '6'], [9, '7']], [[2, '7'], [2, 'm7']], [[7, '7']], [[0, '6']], 6, 7, [[7, '7']]],
        bar6: [[9, '7'], [5, 'M'], [0, '7']], bar7: [[5, 'M'], [2, '7']],
        close: [[0, '7'], [5, 'M'], [0, '6'], [0, '6']], split: [7, '7'], tag: [[7, '7'], [0, '6']]
      },
      perf: {                                       // performance rules. All GUESS
        startAbove: 7, humanMs: [6, 6], legato: [0.8, 0.88], vel: [0.92, 0.78],
        clar: { start: 19, range: [9, 29], turn: 0.15, play: 0.68, len: 0.85, vel: [0.85, 0.7] }, // semitones above the tonic; probabilities; length factor
        banjo: { first: [57, 52, 64], step: [4, 1, 11], strumS: 0.009, humanMs: 3, len: [0.34, 0.9], vel: [0.65, 0.9], hpHz: 180 },
        tuba: [36, 27, 44], tubaLen: 0.8, tubaVel: 0.9, tubaHumanMs: 5,
        trb: [43, 62], trbStart: -12, trbLen: [1.8, 0.9], trbVel: 0.8, trbGlide: 0.6, trbHumanMs: 8,
        block: { humanMs: 4, vel: 0.8, lastVel: 0.95, scatter: 0.02 },
        fadeMs: 60
      },
      mix: { cornet: 1.0, clarinet: 0.5, trombone: 0.55, banjo: 0.6, tuba: 0.75, block: 0.3 },
      inst: {
        cornet:   { ratio: 1, idx: 2.6, atk: 0.022, dec: 0.1, sus: 0.72, rel: 0.045, vibHz: 6.2, vibDepth: 0.006, vibDelay: 0.14 },
        clarinet: { ratio: 2, idx: 1.5, atk: 0.03, dec: 0.1, sus: 0.8, rel: 0.04, vibHz: 5.5, vibDepth: 0.003, vibDelay: 0.2 },
        trombone: { ratio: 1, idx: 2.5, atk: 0.05, dec: 0.15, sus: 0.75, rel: 0.07, vibHz: 5.0, vibDepth: 0.004, vibDelay: 0.3, glideS: 0.13, glideSemi: -2 },
        tuba:     { ratio: 1, idx: 1.5, atk: 0.045, dec: 0.14, sus: 0.6, rel: 0.07, vibHz: 0, vibDepth: 0, vibDelay: 0 },
        banjo:    { t60: 0.5, slope: 0.5, bright: 0.12, pick: 0.14, exc: [0.2, 1.0, 0.5], excLP: 0.25, dampT60: 0.06, body: [[520, 2.5, 6], [1150, 3, 5], [2600, 2, 3]] },
        block:    { contactMs: 0.5, noiseMs: 1.5, noiseMix: 0.2, direct: 0.05, gain: 1, modes: [[1050, 55, 1.0], [1680, 40, 0.5], [2900, 22, 0.25]] }
      }
    },
    medium: {
      rpm: 78.26,                                   // SOURCED(wiki-record): 78.26 rpm with 60 Hz mains; a spring motor is set near this
      band: [100, 5000],                            // Hz. SOURCED(wiki-orthophonic): 100 to 5,000 Hz
      hp: [115, 4], lp: [4300, 8],                  // GUESS: corners inside the band
      inGain: 0.9,
      recRes: [],                                   // electrical recording: no horn on the recording side
      playRes: [[260, 2.0, 3], [2400, 3.0, 5]],     // sound box and folded horn peaks. GUESS
      drive: 1.1,
      noiseGain: 0.012,                             // GUESS, set for about 30 dB (SOURCED rdh4: older shellac 30 to 35 dB)
      swishDepth: 0.4, tickGain: 0.8, crackleRate: 30, crackleGain: 0.45,
      wow: [[1, 0.0018], [0.21, 0.001], [6.5, 0.0005]], // GUESS (four-spring motor)
      outGain: 0.8
    }
  },

  /* ------------------------------ C: 1962 office ------------------------------ */
  C: {
    info: {
      year: 1962,                                   // GUESS: one year after the machine and the turntable came on the market
      place: '1960s office',
      machine: 'IBM Selectric (model 721)',         // SOURCED(ibm-selectric): introduced 31 July 1961
      device: 'AR XA turntable in a stereo hi-fi, with a 12 inch stereo LP', // SOURCED(arxa, wiki-lp)
      style: 'Cool jazz quartet in 4/4 swing time',  // SOURCED(jazzdisco-wp)
      instruments: 'vibraphone, guitar, double bass, drums with brushes'
    },
    machine: {
      outGain: 0.42,
      scatter: 0.03,
      strike: {
        cycleMs: 65,                                // SOURCED(wiki-selectric): full print cycle 65 ms
        printMs: 34,                                // ms from key-down to print. GUESS
        key:   { contactMs: 0.5, noiseMs: 1.5, noiseMix: 0.4, direct: 0.06, gain: 0.2,
                 modes: [[1300, 12, 1.0], [2900, 7, 0.7]] },                           // cycle clutch releases
        type:  { contactMs: 0.3, noiseMs: 1.6, noiseMix: 0.4, direct: 0.3, gain: 1.0,
                 modes: [[420, 22, 0.35], [1150, 20, 0.7], [2400, 16, 1.0], [4100, 11, 0.9], [6300, 7, 0.6], [9000, 4, 0.3]] }, // light element on platen, damped case
        esc:   { delayMs: 12, contactMs: 0.3, noiseMs: 1, noiseMix: 0.4, direct: 0.08, gain: 0.3,
                 modes: [[1900, 12, 0.8], [4400, 7, 1.0], [7200, 4, 0.5]] },           // detent and escapement
        fall:  { delayMs: 30, contactMs: 0.8, noiseMs: 3, noiseMix: 0.5, direct: 0.05, gain: 0.2,
                 modes: [[300, 30, 1.0], [800, 18, 0.6]] },                            // clutch latches again
        whirrGain: 0.05, whirrHz: [900, 4200]       // shaft noise in the cycle. GUESS
      },
      space: {                                      // SOURCED(wiki-selectric): the operational shaft powers the space function
        bar:   { contactMs: 0.9, noiseMs: 3, noiseMix: 0.45, direct: 0.08, gain: 0.6,
                 modes: [[260, 40, 1.0], [640, 28, 0.8], [1700, 14, 0.5], [3600, 8, 0.25]] },
        esc:   { delayMs: 20, contactMs: 0.3, noiseMs: 1, noiseMix: 0.4, direct: 0.08, gain: 0.4,
                 modes: [[1900, 12, 0.8], [4400, 7, 1.0], [7200, 4, 0.5]] }
      },
      linefeed: {                                   // index: the motor turns the platen one line. GUESS for the sound
        clicks: 1, gapMs: 30,
        click: { contactMs: 0.5, noiseMs: 2, noiseMix: 0.4, direct: 0.08, gain: 0.7,
                 modes: [[380, 45, 1.0], [900, 28, 0.9], [2300, 14, 0.6], [4800, 8, 0.3]] },
        rubMs: 60, rubGain: 0.05, rubHz: [800, 4000]
      },
      ret: {                                        // SOURCED(selectric-repair): a clutch drives the cable pulleys to the left margin
        travelMs: 560,                              // ms. GUESS
        indexMs: 20, startMs: 30, unlatchMs: 18, unlatchGain: 0.5, ramp: [12, 30], whineRamp: 3, // timing of index, travel start and unlatch; envelope slopes. GUESS
        clutch: { contactMs: 0.5, noiseMs: 2, noiseMix: 0.4, direct: 0.08, gain: 0.6,
                  modes: [[480, 35, 1.0], [1250, 20, 0.8], [3100, 10, 0.5]] },
        whirrGain: 0.11, whirrHz: [500, 3500],      // GUESS
        whineHz: [310, 520], whineGain: 0.03,       // pulley tone, start and end Hz. GUESS
        stop:  { contactMs: 1.4, noiseMs: 4, noiseMix: 0.3, direct: 0.06, gain: 0.9,
                 modes: [[120, 70, 1.0], [290, 45, 0.8], [700, 26, 0.5], [1800, 12, 0.25]] }
      },
      bell: {                                       // SOURCED(selectric-theory): a bell ringer exists
        f0: 2250,
        partials: [[1, 1.0, 900], [2.71, 0.4, 520], [5.2, 0.15, 260]],
        beat: 0.002,
        hammer: { contactMs: 0.4, noiseMs: 1.2, noiseMix: 0.3, direct: 0.05, gain: 0.2, modes: [[1300, 14, 1.0], [3000, 8, 0.6]] },
        gain: 0.38
      },
      /* Version 2. Same method as B (see P.B.machine.v2). C is motor-driven with one type element: one dominant impact,
       * shorter and tighter than B (decays about 0.55 times those of B), with the band levels shifted up. All shifts GUESS. */
      v2: {
        outGain: 0.25,
        strike: {
          level: 0.27, tailMs: 160,
          whirr: { gain: 0.04, hz: [2000, 9000] },                           // shafts in the print cycle
          key:  { gain: 0.06, atkMs: 1,                                      // cycle clutch releases
                  bands: [[2000, -6, 15], [4000, -2, 12], [8000, 0, 10], [16000, -6, 8]],
                  body: { contactMs: 0.5, noiseMs: 1.5, noiseMix: 0.4, direct: 0, gain: 0.2, modes: [[1300, 12, 1.0], [2900, 7, 0.7]] } },
          type: { gain: 1.0, atkMs: 0.4, crack: [3, 2],                      // light element on the platen, damped case
                  bands: [[250, -38, 120], [500, -34, 110], [1000, -25, 85], [2000, -14, 75], [4000, -5, 70], [8000, 0, 65], [16000, -9, 50]],
                  body: { contactMs: 0.3, noiseMs: 1, noiseMix: 0.4, direct: 0, gain: 0.25,
                          modes: [[1150, 20, 0.5], [2400, 16, 0.8], [4100, 11, 1.0], [6300, 7, 0.8], [9000, 4, 0.5]] } },
          esc:  { gain: 0.12, atkMs: 0.3,                                    // detent and escapement
                  bands: [[2000, -6, 12], [4000, -2, 10], [8000, 0, 8], [16000, -6, 6]],
                  body: { contactMs: 0.3, noiseMs: 1, noiseMix: 0.4, direct: 0, gain: 0.3, modes: [[1900, 12, 0.8], [4400, 7, 1.0], [7200, 4, 0.5]] } },
          fall: { gain: 0.05, atkMs: 2,                                      // clutch latches again
                  bands: [[500, -6, 30], [1000, -3, 25], [2000, -6, 20], [4000, -14, 15]],
                  body: { contactMs: 0.8, noiseMs: 3, noiseMix: 0.5, direct: 0, gain: 0.3, modes: [[300, 30, 1.0], [800, 18, 0.6]] } }
        },
        space: {
          level: 0.31, tailMs: 160,
          bar: { gain: 0.8, atkMs: 2, crack: [3, 2],                         // space bar and operational shaft
                 bands: [[125, -30, 130], [250, -28, 130], [500, -30, 90], [1000, -20, 60], [2000, -6, 55], [4000, -2, 50], [8000, -2, 45], [16000, -12, 35]],
                 body: { contactMs: 0.9, noiseMs: 2, noiseMix: 0.3, direct: 0, gain: 0.05, modes: [[260, 40, 1.0], [640, 28, 0.8], [1700, 14, 0.5], [3600, 8, 0.25]] } },
          esc: { gain: 0.6, atkMs: 0.3,
                 bands: [[2000, -6, 12], [4000, -2, 10], [8000, 0, 8], [16000, -6, 6]],
                 body: { contactMs: 0.3, noiseMs: 1, noiseMix: 0.4, direct: 0, gain: 0.3, modes: [[1900, 12, 0.8], [4400, 7, 1.0], [7200, 4, 0.5]] } }
        },
        linefeed: {
          level: 1.25, tailMs: 160,
          click: { gain: 0.8, atkMs: 0.5,                                    // index: the motor turns the platen one line
                   bands: [[250, -30, 30], [500, -30, 30], [1000, -28, 25], [2000, -18, 25], [4000, -6, 25], [8000, 0, 25], [16000, -8, 20]],
                   body: { contactMs: 0.5, noiseMs: 2, noiseMix: 0.4, direct: 0, gain: 0.15, modes: [[900, 28, 0.6], [2300, 14, 0.8], [4800, 8, 1.0]] } },
          teeth: [[9, 0.3]],
          release: null,
          rubGain: 0.01, rubHz: [5000, 12000]
        },
        ret: {
          level: 1.0, tailMs: 380,
          clutch: { gain: 0.6, atkMs: 0.5,                                   // return clutch engages; again at the end, lower (unlatch)
                    bands: [[500, -20, 40], [1000, -12, 35], [2000, -6, 30], [4000, -2, 25], [8000, 0, 20], [16000, -8, 15]],
                    body: { contactMs: 0.5, noiseMs: 2, noiseMix: 0.4, direct: 0, gain: 0.2, modes: [[480, 35, 1.0], [1250, 20, 0.8], [3100, 10, 0.5]] } },
          whirr: { gain: 0.11, hz: [1500, 9000] },                           // shaft, cable and pulleys
          stop: { gain: 1.0, atkMs: 4,                                       // carrier at the left margin
                  bands: [[125, -24, 160], [250, -22, 150], [500, -26, 100], [1000, -14, 70], [2000, -10, 60], [4000, -4, 50], [8000, -2, 45], [16000, -12, 35]],
                  body: { contactMs: 1.4, noiseMs: 3, noiseMix: 0.3, direct: 0, gain: 0.3, modes: [[120, 70, 1.0], [290, 45, 0.8], [700, 26, 0.5], [1800, 12, 0.25]] } },
          rebound: [[12, 0.4], [26, 0.15]],
          bounce: { gain: 0.6, atkMs: 0.6,
                    bands: [[500, -24, 50], [1000, -12, 40], [2000, -8, 35], [4000, -3, 30], [8000, 0, 25], [16000, -10, 20]],
                    body: { contactMs: 0.6, noiseMs: 1.5, noiseMix: 0.3, direct: 0, gain: 0.2, modes: [[700, 26, 0.5], [1800, 12, 0.25]] } }
        },
        bell: {
          lenMs: 1500, atkMs: 6,
          f0: 2250,                                                          // Hz, lowest partial (version 1 value)
          partials: [[1, 0.12, 1550], [2.95, 1.0, 630], [4.1, 0.35, 400], [5.05, 1.4, 250], [6.0, 0.6, 200]], // own ratios. GUESS
          beat: 0.002,
          hammer: { gain: 0.15, atkMs: 0.4, bands: [[4000, 0, 25], [8000, 0, 18], [16000, -3, 12]],
                    body: { contactMs: 0.4, noiseMs: 1.2, noiseMix: 0.3, direct: 0, gain: 0.2, modes: [[3000, 8, 1.0], [6000, 6, 0.6]] } },
          gain: 0.68
        }
      },
      motor: {                                      // SOURCED(selectric-service): shaded pole motor, belt, two shafts. All numbers GUESS
        loopS: 4,                                   // s, loop length
        mainsHz: 60,                                // SOURCED(twdb-ibm): 115 V, 60 Hz
        hum: [[2, 1.0], [1, 0.25], [4, 0.3], [6, 0.12]], // [multiple of mains, gain]. GUESS
        rotorHz: 28.5, rotorGain: 0.3,              // rotor turn rate. GUESS
        whirrHz: [350, 2600], whirrGain: 0.5, whirrMod: 0.25, // belt and shaft noise. GUESS
        humScale: 0.3,                              // level of the hum and rotor tones in relation to the noise. GUESS
        gain: 0.09
      }
    },
    music: {
      bpm: 138,                                     // GUESS
      tonic: 53,                                    // F. GUESS
      beatsPerBar: 4, introBars: 2, chorusBars: 12,
      tailS: 3.4, peak: 0.7,
      swing: 0.64,                                  // GUESS
      cells: [[1.5, 0.5, -1, 1], [-0.5, 0.5, 0.5, 0.5, 2], [1, 0.5, 1.5, -1], [-1, 1, 0.5, 1.5], [0.5, 0.5, 0.5, 1.5, -1], [2, -1, 0.5, 0.5], [-0.5, 1, 0.5, 1, 1], [1, 1, 0.5, 1.5]],
      range: [60, 84], leap: 3.4, chrom: 0.35,
      fixedCells: [[-3, 0.5, 0.5], [2, -2], [3, -1], [1, 0.5, 2.5]],  // pick-up bar and the last bar of each 4-bar phrase
      grammar: {                                    // each bar has one or two chords. Three 12-bar forms. Own design
        intro: [[[0, 'M7'], [9, '7']], [[2, 'm7'], [7, '7']]],
        forms: [
          [[[0, 'M7']], [[9, 'm7']], [[2, 'm7']], [[7, '7']], [[0, 'M7']], [[7, 'm7'], [0, '7']], [[5, 'M7']], [[5, 'm7'], [10, '7']], [[4, 'm7'], [9, '7']], [[2, 'm7'], [7, '7']], [[0, 'M7'], [9, '7']], [[2, 'm7'], [7, '7']]],
          [[[0, 'M7'], [9, '7']], [[2, 'm7'], [7, '7']], [[4, 'm7'], [9, '7']], [[2, 'm7'], [7, '7']], [[5, 'M7']], [[5, 'm7'], [10, '7']], [[0, 'M7']], [[9, '7']], [[2, 'm7']], [[7, '7']], [[0, 'M7'], [9, 'm7']], [[2, 'm7'], [7, '7']]],
          [[[0, 'M7']], [[5, 'M7']], [[4, 'm7']], [[9, '7']], [[2, 'm7']], [[7, '7']], [[0, 'M7']], [[7, 'm7'], [0, '7']], [[5, 'M7']], [[5, 'm7'], [10, '7']], [[0, 'M7'], [9, '7']], [[2, 'm7'], [7, '7']]]
        ],
        tritone: [1, '7'], last: [0, '69']
      },
      perf: {                                       // performance rules. All GUESS
        tritone: 0.25,                              // probability of the tritone replacement
        startAbove: 19, endPcs: [0, 7], humanMs: 7, legato: [0.92, 1.0], longBeats: 1.5, vel: [0.85, 0.68],
        lastChord: { first: [65, 60, 72], pcs: [4, 9, 2], step: [4, 1, 11], rollS: 0.07, vel: 0.7 },
        guitar: { pats: [[[0, 0.5], [1.5, 0.5]], [[1.5, 0.4], [3.5, 0.4]], [[0, 0.4], [2.5, 0.6]], [[1, 0.4], [3, 0.4]], [[0, 1.2], [2, 0.8]]], // [beat in the bar, length in beats]
                  first: [57, 52, 63], step2: [5, 1, 11], step3: [4, 1, 11], humanMs: 6, vel: 0.7, strumS: 0.011, last: [0.02, 0.028, 2.6, 0.7], hpHz: 70 },
        bass: { start: 41, first: [31, 48], root: [29, 48], tone: [29, 50], jump: 3, humanMs: 5, vel: [0.88, 0.75], len: 0.9, last: [36, 29, 41, 3.0, 0.9], hpHz: 30,
                thumpHz: 95, thumpS: 0.005, thumpLenS: 0.03 },
        drums: { skip: 0.2, ride: [[0, 0.7], [1, 0.95], [1.5, 0.45], [2, 0.7], [3, 0.95], [3.5, 0.45]], rideHumanMs: 5, hatVel: 0.8, brushVel: [0.5, 1], brushHumanMs: 6, kickVel: 0.6, lastRide: 1 },
        fadeMs: 400
      },
      mix: { vibes: 1.0, guitar: 0.42, bass: 0.85, ride: 0.2, hat: 0.1, brush: 0.14, kick: 0.3 }, // relative RMS. GUESS
      pan: { vibes: 0.35, guitar: -0.5, bass: 0.0, ride: -0.2, hat: 0.15, brush: -0.1, kick: 0.0 }, // -1 left .. 1 right. GUESS
      inst: {
        vibes: {
          ratios: [1, 3.98, 9.9],                   // SOURCED(sd-bar, ccrma-perc): bars tuned about 1 : 4 : 10
          gains: [1.0, 0.22, 0.07],                 // GUESS (soft mallet)
          t60: [7.0, 1.6, 0.35],                    // s. First value SOURCED(rossing): 9 s at 220 Hz with the tube open; others GUESS
          dampT60: 0.16,                            // s, damper pad. GUESS
          malletMs: 1.3,                            // ms contact. GUESS
          tremHz: 5.4, tremDepth: 0.3               // motor discs. SOURCED(ccrma-perc) for the effect; numbers GUESS
        },
        guitar: { t60: 2.2, slope: 0.6, bright: 0.42, pick: 0.2, exc: [1.0, 0.25, 0.08], excLP: 0.6, dampT60: 0.09, body: [[110, 2.5, 4], [215, 3, 3]], toneHz: 3200 },
        bass:   { t60: 1.3, slope: 0.35, bright: 0.48, pick: 0.25, exc: [1.0, 0.1, 0.04], excLP: 0.75, dampT60: 0.12, body: [[75, 2.5, 4], [150, 3, 3]], toneHz: 1500, thump: 0.3 },
        ride:   { modes: 18, loHz: 2300, hiHz: 11500, t60: [1.5, 0.45], stickMs: 0.7 },
        hat:    { hz: [6000, 11000], decayMs: 35 },
        brush:  { hz: [1800, 7500], swellMs: [25, 240], swirl: 0.22 },
        kick:   { hz: 58, dropHz: 30, decayMs: 90 }
      },
      reverb: { mix: 0.13, decay: 0.78, damp: 0.35, preMs: 12, wetGain: 0.25, apGain: 0.5,          // small studio room. GUESS
                combs: [[1557, 1617, 1491, 1422], [1580, 1640, 1514, 1445]], aps: [[225, 556], [248, 579]] } // delays in samples at 44100 Hz, left and right. GUESS
    },
    medium: {
      rpm: 33.3333,                                 // SOURCED(wiki-lp)
      band: [20, 20000],                            // Hz. SOURCED(wiki-cmp): 20 Hz to 20 kHz, +/- 3 dB
      hp: [20, 2], lp: [21000, 2],                  // GUESS: corners at the band limits
      riaa: [3180e-6, 318e-6, 75e-6],               // s. SOURCED(wiki-riaa): playback time constants
      noiseGain: 0.00046,                           // GUESS, set for about 56 dB (SOURCED rdh4: vinyl noise about 56 dB below peak level)
      rumbleGain: 0.0006, rumbleHz: [5, 35],        // SOURCED(arxa): rumble near 5 Hz, low; level GUESS
      swishDepth: 0.15, tickRate: 0.7, tickGain: 0.012, // dust clicks per s. GUESS
      crosstalkDb: -25,                             // cartridge channel separation. GUESS
      noiseCommon: 0.7, rumbleRight: -0.6, tickJit: 0.3, // share of the noise that both channels have; rumble sign and level in the right channel. GUESS
      wow: [[1, 0.0005], [0.31, 0.0002], [9.0, 0.00015]], // GUESS, below the 0.1 % in SOURCED(arxa-spec)
      outGain: 0.9
    }
  }
};

/* Sources: key -> [URL, value taken from it]. */
var SOURCES = {
  'wiki-cylinder': ['https://en.wikipedia.org/wiki/Phonograph_cylinder', 'Early cylinders: usually 120 rpm. Standard cylinder: about 2 minutes, about 4 in long, 2 1/4 in diameter.'],
  'ucsb-brownwax': ['https://cylinders.library.ucsb.edu/history-brownwax.php', 'Brown wax cylinders: 1895 to 1901. Recording rate: generally between 120 and 160 rpm.'],
  'loc-acoustic': ['https://www.loc.gov/collections/national-jukebox/articles-and-essays/acoustical-recording/', 'Acoustical recording: approximately 100 to 2500 Hz. Banjo, xylophone, trumpet, trombone and tenor and baritone voices reproduced better than others.'],
  'ucsb-styles': ['https://cylinders.library.ucsb.edu/history-musicalstyles.php', 'Cylinder era: marches were popular. Brass instruments, banjos and xylophones were commonly recorded. Drums were usually avoided. Military bands recorded well.'],
  'tinfoil-record': ['https://www.tinfoil.com/record.htm', 'Horned instruments recorded best. Marching band numbers were prominent. About 15 instruments for a band.'],
  'fpi': ['https://www.enjoythemusic.com/magazine/manufacture/0909/index.html', 'Wax cylinders: signal to noise 20 to 30 dB, 160 Hz to 3 kHz. Secondary source, weak.'],
  'edison-home': ['https://www.edisontinfoil.com/homeskel.htm', 'Edison Home Phonograph: first offered in late 1896 at $40, small single-spring motor.'],
  'twmuseum-rem2': ['https://typewritermuseum.org/collection/brands/index.php?cat=ku&machine=rem2', 'Remington Standard 2: first made 1878. Upstrike: the type hangs in a circle and swings up against the platen. The typist lifts the carriage to see the text. Offered for sale well into the 1890s.'],
  'twdb-remington': ['https://typewriterdatabase.com/remington.42.typewriter-serial-number-database', 'Remington Standard No. 2: production ended in 1894. "Blind writer".'],
  'officemuseum': ['https://officemuseum.com/typewriters_office_models.htm', 'Remington No. 2: each key is on a long horizontal lever. A vertical wire pulls the type-bar. The type swings up and hits the platen from below.'],
  'rem2-manual': ['http://machinesoflovinggrace.com/manuals/manual-Remington2.pdf', 'Remington No. 2 directions: pull the carriage-lever to turn the cylinder, then push the carriage right to the stop-collar. A bell-ringer rings several spaces before the end of the line. A leather strap and a main-spring pull the carriage. A pull of one pound returns it.'],
  'wiki-record': ['https://en.wikipedia.org/wiki/Phonograph_record', '78 rpm disc: 78.26 rpm with 60 Hz mains. 10 inch side: about 3.5 minutes (as the fetch tool quoted it). First electrical discs: spring 1925.'],
  'wiki-orthophonic': ['https://en.wikipedia.org/wiki/Orthophonic_Victrola', 'Victor Orthophonic Victrola: released 1925, made for electrically recorded discs, frequency response 100 to 5,000 Hz, folded exponential horn.'],
  'gracyk-credenza': ['https://gracyk.com/credenza.shtml', 'Credenza: 47,922 made, all with spring motors. Playback is acoustic: steel needle, sound box with aluminum diaphragm, internal folded horn.'],
  'victrola-credenza': ['https://www.victor-victrola.com/8-1.htm', 'Credenza: 4-spring motor, the largest folded exponential horn that Victor made.'],
  'polt-remport': ['https://site.xavier.edu/polt/typewriters/rem-portables.htm', 'Remington Portable #2: February 1925 to December 1928. Geared type-bar mechanism. A lever raises the type-bars to 45 degrees. A vertical lever returns the carriage and advances the paper.'],
  'remport-manual': ['https://archive.org/stream/AnEasyGuideForOperatingTheRemingtonPortableTypewriter/AnEasyGuideForOperatingTheRemingtonPortableTypewriter_djvu.txt', 'Remington Portable guide (model made 1925 to 1928): "The bell rings six letter spaces before the keys lock". One lever does the line space and the carriage return.'],
  'nja-78': ['https://nationaljazzarchive.org.uk/posts/articles/2021/11/how-the-78-rpm-record-helped-popularise-jazz', 'Electrical recording came in 1925. Home players used clockwork. Cornet, trumpet and clarinet led the sound. A wood block was used in place of a snare drum.'],
  'mgthomas-dance': ['http://www.mgthomas.co.uk/Dancebands/IndexPages/DanceBandsIntro.htm', '1920s dance band: trumpets, trombone, saxophones, violin, piano, banjo, tuba, drums. Banjo and tuba went out after electrical recording (1925 to 1926).'],
  'auldworks': ['https://auldworks.com/bbrec1.htm', 'Tuba in place of string bass; wood blocks and cymbals in place of the bass drum. These practices continued until about 1928.'],
  'rdh4': ['http://tazzon.free.fr/racine/%C3%89lectronique/Documentation/RDH4/CHAPTR17.PDF', 'Radiotron Designer\'s Handbook ch. 17: older shellac pressings, signal to noise 30 or 35 dB. New vinyl: surface noise about 56 dB below peak recording level.'],
  'fonoteca': ['https://www.fonoteca.ch/projects/visualAudio/home_en.htm', '78 rpm: signal to noise 30 to 40 dB. 33 rpm: 40 to 60 dB, bandwidth 30 to 15,000 Hz.'],
  'wiki-lp': ['https://en.wikipedia.org/wiki/LP_record', 'LP: 33 1/3 rpm, about 23 to 25 minutes for each 12 inch side, stereo from 1957.'],
  'wiki-riaa': ['https://en.wikipedia.org/wiki/RIAA_equalization', 'RIAA playback time constants: 3180, 318 and 75 microseconds (50.05, 500.5, 2122 Hz). Standard since 1954.'],
  'wiki-cmp': ['https://en.wikipedia.org/wiki/Comparison_of_analog_and_digital_recording', 'Conventional LP player: 20 Hz to 20 kHz, +/- 3 dB. LP dynamic range: about 60 to 70 dB.'],
  'arxa': ['https://www.psaudio.com/blogs/copper/a-classic-turntables-forgotten-roots-the-ar-xa', 'AR XA turntable: 1961, belt drive, synchronous motor, low rumble, rumble frequency about 5 Hz.'],
  'arxa-spec': ['https://auralhifi.com/products/acoustic-research-xa-turntable', 'AR XA factory specifications as a dealer lists them: wow and flutter 0.1 %, speed accuracy +/- 0.3 %. Second-hand source.'],
  'wiki-selectric': ['https://en.wikipedia.org/wiki/IBM_Selectric', 'Selectric: a motor drives a belt and a two-part shaft. The cycle shaft powers tilt and rotate. The operational shaft powers space, backspace and shift. Full print cycle 65 ms. The element moves; the platen does not move sideways.'],
  'ibm-selectric': ['https://www.ibm.com/history/selectric', 'Selectric: introduced 31 July 1961. Element diameter 1 3/8 inch. Model 721 weight 31 pounds.'],
  'selectric-service': ['https://oldbobsoldtypewriters.com/wp-content/uploads/2022/01/IBM_SelectricServiceManual.pdf', 'Selectric service manual: shaded pole motor with a centrifugal clutch; the belt drives the cycle clutch hub, the operational shaft and the cycle shaft.'],
  'selectric-theory': ['https://www.mirrorservice.org/sites/www.bitsavers.org/pdf/ibm/typewriter/selectric/241-5139-2_Selectric_Adjustment_Theory_Jan66.pdf', 'Selectric adjustment theory (1966): names a "bell ringer bellcrank" near the right margin. The machine has a margin bell.'],
  'selectric-repair': ['https://groups.google.com/g/sci.electronics.repair/c/WVEqOu_-HW4', 'Selectric return: the key trips a cam; a clutch spring drives the shaft that is geared to the cable pulleys, until the carrier hits the left margin. Forum source.'],
  'twdb-ibm': ['https://typewriterdatabase.com/ibm.855.typewriter-serial-number-database', 'Selectric 7x1: 31 lb, 115 V, 60 Hz.'],
  'jazzdisco-wp': ['https://www.jazzdisco.org/pacific-jazz-records/catalog-stereo-1000-series/', 'World Pacific stereo 12 inch LPs, 1958 to 1960: jazz small groups with vibes, guitar, bass and drums.'],
  'ccrma-perc': ['https://ccrma.stanford.edu/CCRMA/Courses/150/percussion.html', 'Vibraphone: aluminum bars, first overtone two octaves above the fundamental, tube resonators tuned to the fundamental, motor-driven discs give vibrato, long decay.'],
  'sd-bar': ['https://www.sciencedirect.com/science/article/pii/S0022460X22007118', 'Commercial bar instruments: typical tuning ratios 1 : 4 : 10.'],
  'rossing': ['https://pas.org/wp-content/uploads/2024/03/resfal82.06-18.pdf', 'Vibraphone bar at 220 Hz: 60 dB decay time 40 s without the resonator, 9 s with the tube open. Range F3 to F6.']
};

/* Guessed values, in words. The parameter block marks each number. */
var GUESSES = [
  'All mode tables of the machine sounds: frequency, decay time and gain of each resonant mode.',
  'All timings inside the machine sounds: key travel, escapement delay, carriage travel time, number of rack teeth.',
  'The sound of the carriage return on A and B (rack ticks, roll noise, stop). The sources give the sequence, not the sound.',
  'The sound of the Selectric return, index and space bar. The sources give the mechanism, not the sound.',
  'The bell frequencies: 1750 Hz (A), 2550 Hz (B), 2250 Hz (C), and the partial ratios.',
  'The Selectric motor sound: hum at 120 Hz and its multiples, rotor rate 28.5 Hz, belt noise band.',
  'The order of the key strike centroids (A < B < C). It is reasoned from part sizes, not measured.',
  'The weights of the two Remington machines. No source was found.',
  'The years 1897, 1927 and 1962. Each is one year in which the sources show the machine and the device were available.',
  'A: that an office in 1897 still used a Remington No. 2 (production ended in 1894).',
  'A: the filter corners 170 Hz and 2100 Hz, the horn resonances, the saturation.',
  'A: the noise level target of 22 dB. The only source (20 to 30 dB) is weak.',
  'A and B: the speed variation of the spring motors. No source was found.',
  'B: the filter corners 115 Hz and 4300 Hz, the sound box resonances.',
  'B: that a wind-up motor turns at 78.26 rpm. The source gives this value for mains motors.',
  'C: the level of the vinyl noise in relation to the average music level (the source gives it in relation to the peak level).',
  'C: the channel separation of -25 dB, the click rate, the rumble level.',
  'C: the speed variation parameters. The source gives only a 0.1 % limit, from a dealer page.',
  'All music: tempo, key, rhythm cells, chord rules, instrument synthesis parameters, mix levels, reverberation.',
  'The swing ratios 0.62 (B) and 0.64 (C).',
  'Version 2 of the machine sounds: the split of each sound into events, and all values of A and C (shifted from B: A lower and longer, C shorter and brighter). The B values are set to targets measured on recordings of a real manual typewriter (check.mjs).'
];

/* ====================================== DSP primitives ====================================== */
var TAU = 2 * Math.PI, CM = P.common;

function makeRng(seed) {                     // mulberry32
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mix32(seed, k) {                    // derive an independent seed
  var h = ((seed >>> 0) ^ Math.imul((k | 0) + 1, 0x9E3779B1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
function gauss(rnd) { return (rnd() + rnd() + rnd() + rnd() - 2) * 1.732; }
function pickOf(rnd, arr) { return arr[Math.min(arr.length - 1, Math.floor(rnd() * arr.length))]; }
function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function clampF(sr, f) { return Math.min(f, 0.47 * sr); }
function bqLow(sr, f, q) {
  var w = TAU * clampF(sr, f) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
  return [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - al) / a0];
}
function bqHigh(sr, f, q) {
  var w = TAU * clampF(sr, f) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
  return [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0];
}
function bqPeak(sr, f, q, db) {
  var w = TAU * clampF(sr, f) / sr, c = Math.cos(w), A = Math.pow(10, db / 40), al = Math.sin(w) / (2 * q), a0 = 1 + al / A;
  return [(1 + al * A) / a0, -2 * c / a0, (1 - al * A) / a0, -2 * c / a0, (1 - al / A) / a0];
}
function biquad(x, k) {                      // in place, transposed direct form II
  var b0 = k[0], b1 = k[1], b2 = k[2], a1 = k[3], a2 = k[4], z1 = 0, z2 = 0, n = x.length, i, v, y;
  for (i = 0; i < n; i++) {
    v = x[i]; y = b0 * v + z1; z1 = b1 * v - a1 * y + z2; z2 = b2 * v - a2 * y; x[i] = y;
  }
  return x;
}
function butter(x, sr, f, order, high) {     // Butterworth cascade, even order
  for (var k = 0; k < order / 2; k++) {
    var q = 1 / (2 * Math.cos(Math.PI * (2 * k + 1) / (2 * order)));
    biquad(x, high ? bqHigh(sr, f, q) : bqLow(sr, f, q));
  }
  return x;
}
function bandNoise(n, sr, rnd, lo, hi) {     // white noise between lo and hi Hz
  var x = new Float32Array(n);
  for (var i = 0; i < n; i++) x[i] = rnd() * 2 - 1;
  butter(x, sr, lo, 2, true); butter(x, sr, hi, 2, false);
  return x;
}
function peakOf(x) { var p = 0; for (var i = 0; i < x.length; i++) { var a = x[i] < 0 ? -x[i] : x[i]; if (a > p) p = a; } return p; }
function rmsOf(x) { var s = 0; for (var i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); }
function activeRms(x) { var s = 0, c = 0; for (var i = 0; i < x.length; i++) { var v = x[i]; if (v > 1e-4 || v < -1e-4) { s += v * v; c++; } } return c ? Math.sqrt(s / c) : 0; }

/* Impact: a contact pulse and a noise burst excite a bank of decaying resonant modes.
 * vel 0..1: a harder hit gives a shorter contact (brighter) and a higher level. */
function impact(out, at, sr, rnd, spec, amp, vel, scatter) {
  var nC = Math.max(2, Math.round(spec.contactMs * (CM.impact.contact[0] - CM.impact.contact[1] * vel) * 0.001 * sr));
  var nN = Math.max(1, spec.noiseMs * 0.001 * sr);
  var eLen = Math.max(nC, Math.ceil(nN * 5));
  var exc = new Float64Array(eLen), nb = new Float64Array(eLen), i, s = 0, e2 = 0;
  for (i = 0; i < nC; i++) { exc[i] = Math.sin(Math.PI * (i + 0.5) / nC); s += exc[i]; }
  for (i = 0; i < eLen; i++) { nb[i] = (rnd() * 2 - 1) * Math.exp(-i / nN); e2 += nb[i] * nb[i]; }
  e2 = Math.sqrt(e2) || 1;
  for (i = 0; i < eLen; i++) exc[i] = (i < nC ? exc[i] / s : 0) * (1 - spec.noiseMix) + nb[i] / e2 * spec.noiseMix;
  var g = amp * spec.gain * Math.pow(vel, CM.impact.velPow), maxN = 0, m, nOut = out.length;
  for (m = 0; m < spec.modes.length; m++) {
    var md = spec.modes[m], f = md[0] * (1 + scatter * (rnd() * 2 - 1));
    if (f >= 0.45 * sr) continue;
    var w = TAU * f / sr, r = Math.exp(-6.908 / (md[1] * 0.001 * sr));
    var a1 = 2 * r * Math.cos(w), a2 = r * r, gm = g * md[2] * (1 + CM.impact.gainJit * (rnd() * 2 - 1)) * Math.sin(w);
    var n = Math.min(nOut - at, Math.ceil(md[1] * 0.0012 * sr) + eLen), y1 = 0, y2 = 0, y;
    if (n > maxN) maxN = n;
    for (i = 0; i < n; i++) {
      y = (i < eLen ? exc[i] : 0) + a1 * y1 - a2 * y2; y2 = y1; y1 = y;
      out[at + i] += y * gm;
    }
  }
  var dg = g * spec.direct;                  // air-borne part of the hit
  for (i = 0; i < eLen && at + i < nOut; i++) out[at + i] += nb[i] * dg;
  return maxN;
}
function fadeEnd(x, sr, ms) {                // short fade so that a buffer ends at zero
  var n = Math.min(x.length, Math.round(ms * 0.001 * sr));
  for (var i = 0; i < n; i++) x[x.length - 1 - i] *= i / n;
  return x;
}
function finish(x, sr, ms) {                 // machine sounds: soft limit below 1.0, then the end fade
  for (var i = 0; i < x.length; i++) x[i] = softClip(x[i]);
  return fadeEnd(x, sr, ms);
}
function ms2n(sr, ms) { return Math.round(ms * 0.001 * sr); }
function velOf(params) { var v = params && typeof params.velocity === 'number' ? params.velocity : CM.defaultVel; return Math.max(0.05, Math.min(1, v)); }

/* ====================================== Machine sounds ====================================== */
function keyStrike(key, sr, seed, params) {
  var M = P[key].machine, S = M.strike, rnd = makeRng(mix32(seed, 11)), vel = velOf(params);
  var t0 = S.travelMs || S.printMs;
  var out = new Float32Array(ms2n(sr, t0 + S.fall.delayMs + CM.tailMs.strike));
  var jit = function () { return 1 + CM.strikeJit * (rnd() * 2 - 1); };
  impact(out, 0, sr, rnd, S.key, M.outGain, vel, M.scatter);
  var at = ms2n(sr, t0 * jit() * (CM.strikeVelTime[0] - CM.strikeVelTime[1] * vel));
  impact(out, at, sr, rnd, S.type, M.outGain, vel, M.scatter);
  impact(out, at + ms2n(sr, S.esc.delayMs * jit()), sr, rnd, S.esc, M.outGain, vel, M.scatter);
  impact(out, at + ms2n(sr, S.fall.delayMs * jit()), sr, rnd, S.fall, M.outGain, vel, M.scatter);
  if (S.whirrGain) {                         // C: shaft noise for one print cycle
    var n = ms2n(sr, S.cycleMs), w = bandNoise(n, sr, rnd, S.whirrHz[0], S.whirrHz[1]);
    for (var i = 0; i < n; i++) out[i] += w[i] * S.whirrGain * M.outGain * Math.sin(Math.PI * i / n);
  }
  return finish(out, sr, CM.fadeMs.hit);
}
function spaceBar(key, sr, seed, params) {
  var M = P[key].machine, S = M.space, rnd = makeRng(mix32(seed, 12)), vel = velOf(params);
  var out = new Float32Array(ms2n(sr, S.esc.delayMs + CM.tailMs.space));
  impact(out, 0, sr, rnd, S.bar, M.outGain, vel, M.scatter);
  impact(out, ms2n(sr, S.esc.delayMs), sr, rnd, S.esc, M.outGain, vel, M.scatter);
  return finish(out, sr, CM.fadeMs.hit);
}
function addLineFeed(out, at, key, sr, rnd, vel) {
  var M = P[key].machine, L = M.linefeed, i;
  var n = ms2n(sr, L.rubMs), rub = bandNoise(n, sr, rnd, L.rubHz[0], L.rubHz[1]);
  for (i = 0; i < n && at + i < out.length; i++) out[at + i] += rub[i] * L.rubGain * M.outGain * Math.sin(Math.PI * i / n);
  var LF = CM.linefeed;
  for (i = 0; i < L.clicks; i++) impact(out, at + ms2n(sr, LF.firstMs + i * L.gapMs * (1 + LF.gapJit * (rnd() - 0.5))), sr, rnd, L.click, M.outGain, vel * (i ? 1 : LF.firstVel), M.scatter);
  return ms2n(sr, LF.firstMs + L.clicks * L.gapMs);
}
function lineFeed(key, sr, seed, params) {
  var L = P[key].machine.linefeed, rnd = makeRng(mix32(seed, 13));
  var out = new Float32Array(ms2n(sr, L.rubMs + L.clicks * L.gapMs + CM.tailMs.linefeed));
  addLineFeed(out, 0, key, sr, rnd, velOf(params));
  return finish(out, sr, CM.fadeMs.hit);
}
function carriageReturn(key, sr, seed, params) {
  var M = P[key].machine, R = M.ret, rnd = makeRng(mix32(seed, 14)), vel = velOf(params), i;
  var T = ms2n(sr, R.travelMs), out, at;
  if (key === 'C') {                          // motor return: clutch, index, whirr, stop at the left margin
    out = new Float32Array(T + ms2n(sr, CM.tailMs.retC));
    impact(out, 0, sr, rnd, R.clutch, M.outGain, vel, M.scatter);
    addLineFeed(out, ms2n(sr, R.indexMs), key, sr, rnd, vel);
    at = ms2n(sr, R.startMs);
    var w = bandNoise(T, sr, rnd, R.whirrHz[0], R.whirrHz[1]), ph = 0;
    for (i = 0; i < T; i++) {
      var x = i / T, env = Math.min(1, x * R.ramp[0]) * Math.min(1, (1 - x) * R.ramp[1]);
      ph += TAU * (R.whineHz[0] + (R.whineHz[1] - R.whineHz[0]) * Math.min(1, x * R.whineRamp)) / sr;
      out[at + i] += (w[i] * R.whirrGain + Math.sin(ph) * R.whineGain) * env * M.outGain;
    }
    impact(out, at + T, sr, rnd, R.stop, M.outGain, vel, M.scatter);
    impact(out, at + T + ms2n(sr, R.unlatchMs), sr, rnd, R.clutch, M.outGain * R.unlatchGain, vel, M.scatter);
    return finish(out, sr, CM.fadeMs.ret);
  }
  var lf = ms2n(sr, P[key].machine.linefeed.clicks * P[key].machine.linefeed.gapMs + CM.ret.gapMs);
  out = new Float32Array(lf + T + ms2n(sr, CM.tailMs.ret));
  addLineFeed(out, 0, key, sr, rnd, vel);     // the lever first turns the platen
  var roll = bandNoise(T, sr, rnd, R.rollHz[0], R.rollHz[1]);
  for (i = 0; i < T; i++) {                   // the carriage speeds up, then hits the stop
    var sp = Math.pow((i + 1) / T, CM.ret.rollPow);
    out[lf + i] += roll[i] * R.rollGain * sp * M.outGain;
  }
  for (i = 1; i <= R.ticks; i++) {            // rack teeth pass the escapement dog
    var tk = Math.pow(i / R.ticks, 1 / CM.ret.tickPow);
    impact(out, lf + Math.floor(tk * (T - 1)), sr, rnd, R.tick, M.outGain, CM.ret.tickVel[0] + CM.ret.tickVel[1] * Math.pow(tk, CM.ret.tickVel[2]), M.scatter);
  }
  impact(out, lf + T, sr, rnd, R.stop, M.outGain, vel, M.scatter);
  return finish(out, sr, CM.fadeMs.ret);
}
function bell(key, sr, seed, params) {
  var M = P[key].machine, B = M.bell, rnd = makeRng(mix32(seed, 15)), vel = velOf(params), i, k;
  var CB = CM.bell, out = new Float32Array(ms2n(sr, B.partials[0][2] * CB.lenFactor));
  impact(out, 0, sr, rnd, B.hammer, M.outGain, vel, M.scatter);
  var g = B.gain * M.outGain * Math.pow(vel, CB.velPow), f0 = B.f0 * (1 + CB.f0Jit * (rnd() * 2 - 1));
  for (k = 0; k < B.partials.length; k++) {
    for (var side = -1; side <= 1; side += 2) {  // two close partials give the slow beat of a bell
      var f = f0 * B.partials[k][0] * (1 + side * B.beat * (CB.beatJit[0] + CB.beatJit[1] * rnd()));
      if (f >= 0.45 * sr) continue;
      var w = TAU * f / sr, r = Math.exp(-6.908 / (B.partials[k][2] * 0.001 * sr));
      var a1 = 2 * r * Math.cos(w), a2 = r * r, y1 = 0, y2 = Math.sin(-w) * (CB.start[0] + CB.start[1] * side), y;
      var n = Math.min(out.length, Math.ceil(B.partials[k][2] * 0.0012 * sr)), gk = g * B.partials[k][1];
      for (i = 0; i < n; i++) { y = a1 * y1 - a2 * y2; y2 = y1; y1 = y; out[i] += y * gk; }
    }
  }
  return finish(out, sr, CM.fadeMs.bell);
}
function motorLoop(sr, seed, params) {         // C only: seamless loop, every part has a whole number of cycles
  var M = P.C.machine, Mo = M.motor, rnd = makeRng(mix32(seed, 16)), n = Math.round(Mo.loopS * sr), i, k;
  var out = new Float32Array(n), q = function (f) { return Math.round(f * Mo.loopS) / Mo.loopS; };
  for (k = 0; k < Mo.hum.length; k++) {
    var f = q(Mo.mainsHz * Mo.hum[k][0]), ph = rnd() * TAU, g = Mo.hum[k][1];
    for (i = 0; i < n; i++) out[i] += g * Math.sin(TAU * f * i / sr + ph);
  }
  var fr = q(Mo.rotorHz), w = new Float32Array(n);
  for (i = 0; i < n; i++) { out[i] += Mo.rotorGain * Math.sin(TAU * fr * i / sr); w[i] = rnd() * 2 - 1; }
  var ww = new Float32Array(2 * n);            // filter two rounds; the second round is periodic
  ww.set(w, 0); ww.set(w, n);
  butter(ww, sr, Mo.whirrHz[0], 2, true); butter(ww, sr, Mo.whirrHz[1], 2, false);
  for (i = 0; i < n; i++) out[i] = (out[i] * Mo.humScale + ww[n + i] * Mo.whirrGain * (1 + Mo.whirrMod * Math.sin(TAU * fr * i / sr + 1))) * Mo.gain;
  return out;
}

/* ====================================== Machine sounds, version 2 ======================================
 * Version 1 (above) excites resonant modes only. A recorded machine has much more high-frequency noise, a slower
 * rise and a longer decay. Version 2 adds to each impact the broadband noise that a hit radiates, with its own
 * level and decay in each octave band. The instants of the events are the same as in version 1. */

/* One mechanical impact.
 * body:  the resonant modes of the struck parts, excited by a contact pulse (the function impact above).
 * bands: the noise that the impact radiates. Each octave band has its own level and its own decay T60. The noise rises
 *        in atkMs: a soft contact (a finger, felt, rubber) rises slowly, metal on metal rises fast.
 * crack: [extra level, ms]: while the parts are in contact, the first ms radiate more than the free decay that follows.
 * vel 0..1: a harder hit is louder, rises faster (same contact factor as version 1) and has more high-frequency energy. */
function hit2(out, at, sr, rnd, E, amp, vel, scatter) {
  if (at < 0 || at >= out.length) return;
  var cf = CM.impact.contact[0] - CM.impact.contact[1] * vel, g = amp * E.gain, gv = g * Math.pow(vel, CM.impact.velPow);
  if (E.body) impact(out, at, sr, rnd, E.body, g, vel, scatter);
  var nA = Math.max(1, Math.round(E.atkMs * cf * 0.001 * sr)), b, i;
  var kC = E.crack ? E.crack[0] : 0, nC = E.crack ? Math.max(1, E.crack[1] * 0.001 * sr) : 1;   // crack: the parts are in contact; the first ms radiate more
  for (b = 0; b < E.bands.length; b++) {
    var fc = E.bands[b][0], t60 = E.bands[b][2] * 0.001 * sr;
    if (fc * Math.SQRT1_2 >= 0.45 * sr) continue;
    var n = Math.min(out.length - at, nA + Math.ceil(t60 * 1.1)), x = new Float32Array(n), s = 0;
    for (i = 0; i < n; i++) x[i] = rnd() * 2 - 1;
    butter(x, sr, fc * Math.SQRT1_2, 4, true); butter(x, sr, fc * Math.SQRT2, 4, false);   // one octave around fc
    for (i = 0; i < n; i++) s += x[i] * x[i];
    var gb = gv * Math.pow(10, E.bands[b][1] / 20) * Math.pow(vel, CM.v2.velTilt * Math.log(fc / 2000) / Math.LN2) / (Math.sqrt(s / n) || 1);
    for (i = 0; i < n; i++) {
      var e = i < nA ? Math.pow(Math.sin(0.5 * Math.PI * (i + 1) / nA), 2) : Math.exp(-6.908 * (i - nA) / t60) * (1 + kC * Math.exp(-(i - nA) / nC));
      out[at + i] += x[i] * gb * e;
    }
  }
}
function keyStrike2(key, sr, seed, params) {
  var M = P[key].machine, S = M.strike, W = M.v2.strike, g = M.v2.outGain * W.level, rnd = makeRng(mix32(seed, 51)), vel = velOf(params);
  var t0 = S.travelMs || S.printMs;
  var out = new Float32Array(ms2n(sr, t0 + S.fall.delayMs + W.tailMs));
  var jit = function () { return 1 + CM.strikeJit * (rnd() * 2 - 1); };
  var at = ms2n(sr, t0 * jit() * (CM.strikeVelTime[0] - CM.strikeVelTime[1] * vel));   // type impact: same rule as version 1 (the engine reads it)
  hit2(out, 0, sr, rnd, W.key, g, vel, M.scatter);
  hit2(out, at, sr, rnd, W.type, g, vel, M.scatter);
  hit2(out, at + ms2n(sr, S.esc.delayMs * jit()), sr, rnd, W.esc, g, vel, M.scatter);
  hit2(out, at + ms2n(sr, S.fall.delayMs * jit()), sr, rnd, W.fall, g, vel, M.scatter);
  if (W.whirr) {                             // C: shaft noise for one print cycle
    var n = ms2n(sr, S.cycleMs), w = bandNoise(n, sr, rnd, W.whirr.hz[0], W.whirr.hz[1]);
    for (var i = 0; i < n; i++) out[i] += w[i] * W.whirr.gain * g * Math.sin(Math.PI * i / n);
  }
  return finish(out, sr, CM.fadeMs.hit);
}
function spaceBar2(key, sr, seed, params) {
  var M = P[key].machine, S = M.space, W = M.v2.space, g = M.v2.outGain * W.level, rnd = makeRng(mix32(seed, 52)), vel = velOf(params);
  var out = new Float32Array(ms2n(sr, S.esc.delayMs + W.tailMs));
  hit2(out, 0, sr, rnd, W.bar, g, vel, M.scatter);
  hit2(out, ms2n(sr, S.esc.delayMs), sr, rnd, W.esc, g, vel, M.scatter);
  return finish(out, sr, CM.fadeMs.hit);
}
/* Line feed: the clicks come at the instants of version 1. After each click the detent drops into the next tooth.
 * alone: the lever is released after the feed and hits its rest (not in a carriage return: the hand keeps pushing). */
function addLineFeed2(out, at, key, sr, rnd, vel, alone, g) {
  var M = P[key].machine, L = M.linefeed, W = M.v2.linefeed, LF = CM.linefeed, i, k;
  var n = Math.min(out.length - at, ms2n(sr, L.rubMs)), rub = bandNoise(Math.max(1, n), sr, rnd, W.rubHz[0], W.rubHz[1]);
  for (i = 0; i < n; i++) out[at + i] += rub[i] * W.rubGain * g * Math.sin(Math.PI * i / n);
  var first = at + ms2n(sr, LF.firstMs);
  for (i = 0; i < L.clicks; i++) {
    var c = at + ms2n(sr, LF.firstMs + i * L.gapMs * (1 + LF.gapJit * (rnd() - 0.5))), v = vel * (i ? 1 : LF.firstVel);
    hit2(out, c, sr, rnd, W.click, g, v, M.scatter);
    for (k = 0; k < W.teeth.length; k++) hit2(out, c + ms2n(sr, W.teeth[k][0]), sr, rnd, W.click, g * W.teeth[k][1], v, M.scatter);
  }
  if (alone && W.release) hit2(out, first + ms2n(sr, W.release[0]), sr, rnd, W.click, g * W.release[1], vel, M.scatter);
}
function lineFeed2(key, sr, seed, params) {
  var L = P[key].machine.linefeed, W = P[key].machine.v2.linefeed, rnd = makeRng(mix32(seed, 53));
  var out = new Float32Array(ms2n(sr, L.rubMs + L.clicks * L.gapMs + W.tailMs));
  addLineFeed2(out, 0, key, sr, rnd, velOf(params), true, P[key].machine.v2.outGain * W.level);
  return finish(out, sr, CM.fadeMs.hit);
}
/* The carriage stop and its rebounds. The rebounds are the carriage that bounces back onto the stop. */
function addStop2(out, at, sr, rnd, R, g, vel, scatter) {
  hit2(out, at, sr, rnd, R.stop, g, vel, scatter);
  for (var k = 0; k < R.rebound.length; k++) hit2(out, at + ms2n(sr, R.rebound[k][0] * (0.9 + 0.2 * rnd())), sr, rnd, R.bounce, g * R.rebound[k][1], vel, scatter);
}
function carriageReturn2(key, sr, seed, params) {
  var M = P[key].machine, R = M.ret, W = M.v2.ret, g = M.v2.outGain * W.level, rnd = makeRng(mix32(seed, 54)), vel = velOf(params), i, k;
  var T = ms2n(sr, R.travelMs), out, at, x;
  if (key === 'C') {                         // motor return: clutch, index, whirr, stop at the left margin, clutch release
    out = new Float32Array(T + ms2n(sr, W.tailMs));
    hit2(out, 0, sr, rnd, W.clutch, g, vel, M.scatter);
    addLineFeed2(out, ms2n(sr, R.indexMs), key, sr, rnd, vel, false, g);
    at = ms2n(sr, R.startMs);
    var w = bandNoise(T, sr, rnd, W.whirr.hz[0], W.whirr.hz[1]), ph = 0;
    for (i = 0; i < T && at + i < out.length; i++) {
      x = i / T;
      var env = Math.min(1, x * R.ramp[0]) * Math.min(1, (1 - x) * R.ramp[1]);
      ph += TAU * (R.whineHz[0] + (R.whineHz[1] - R.whineHz[0]) * Math.min(1, x * R.whineRamp)) / sr;
      out[at + i] += (w[i] * W.whirr.gain + Math.sin(ph) * R.whineGain) * env * g;
    }
    addStop2(out, at + T, sr, rnd, W, g, vel, M.scatter);
    hit2(out, at + T + ms2n(sr, R.unlatchMs), sr, rnd, W.clutch, g * R.unlatchGain, vel, M.scatter);
    return finish(out, sr, CM.fadeMs.ret);
  }
  var lf = ms2n(sr, M.linefeed.clicks * M.linefeed.gapMs + CM.ret.gapMs);   // same instants as version 1 (the engine reads them)
  out = new Float32Array(lf + T + ms2n(sr, W.tailMs));
  addLineFeed2(out, 0, key, sr, rnd, vel, false, g);   // the lever first turns the platen
  var nF = Math.max(1, ms2n(sr, W.stop.atkMs)), buzz = bandNoise(T, sr, rnd, W.buzz.hz[0], W.buzz.hz[1]), roll = bandNoise(T, sr, rnd, W.roll.hz[0], W.roll.hz[1]);
  for (i = 0; i < T; i++) {                  // the carriage speeds up; the dog slides over the rack teeth; the bumper slows the carriage at the end
    x = (i + 1) / T;
    var sp = Math.pow(x, CM.ret.rollPow) * Math.min(1, (T - i) / nF);
    var tooth = 1 + W.buzz.depth * Math.sin(TAU * R.ticks * Math.pow(x, CM.ret.tickPow));
    out[lf + i] += (buzz[i] * W.buzz.gain * tooth + roll[i] * W.roll.gain) * sp * g;
  }
  for (k = 0; k < W.jolts; k++) {            // a few distinct ratchet events: the hand pushes the lever in steps
    var tj = (k + 0.3 + 0.4 * rnd()) / W.jolts;
    hit2(out, lf + Math.floor(Math.pow(tj, 1 / CM.ret.tickPow) * (T - nF)), sr, rnd, W.jolt, g * (0.4 + 0.6 * rnd()), vel, M.scatter);
  }
  addStop2(out, lf + T, sr, rnd, W, g, vel, M.scatter);
  return finish(out, sr, CM.fadeMs.ret);
}
function bell2(key, sr, seed, params) {
  var M = P[key].machine, B = M.v2.bell, rnd = makeRng(mix32(seed, 55)), vel = velOf(params), i, k;
  var CB = CM.bell, out = new Float32Array(ms2n(sr, B.lenMs));
  hit2(out, 0, sr, rnd, B.hammer, M.v2.outGain, vel, M.scatter);
  var g = B.gain * M.v2.outGain * Math.pow(vel, CB.velPow), f0 = B.f0 * (1 + CB.f0Jit * (rnd() * 2 - 1));
  var nR = Math.max(1, ms2n(sr, B.atkMs));    // the bell needs a few ms to build up its vibration after the hammer contact
  for (k = 0; k < B.partials.length; k++) {
    for (var side = -1; side <= 1; side += 2) {  // two close partials give the slow beat of a bell
      var f = f0 * B.partials[k][0] * (1 + side * B.beat * (CB.beatJit[0] + CB.beatJit[1] * rnd()));
      if (f >= 0.45 * sr) continue;
      var w = TAU * f / sr, r = Math.exp(-6.908 / (B.partials[k][2] * 0.001 * sr));
      var a1 = 2 * r * Math.cos(w), a2 = r * r, y1 = 0, y2 = Math.sin(-w) * (CB.start[0] + CB.start[1] * side), y;
      var n = Math.min(out.length, Math.ceil(B.partials[k][2] * 0.0012 * sr)), gk = g * B.partials[k][1];
      for (i = 0; i < n; i++) { y = a1 * y1 - a2 * y2; y2 = y1; y1 = y; out[i] += y * gk * (i < nR ? Math.pow(Math.sin(0.5 * Math.PI * i / nR), 2) : 1); }
    }
  }
  return finish(out, sr, CM.fadeMs.bell);
}

/* ====================================== Instruments ====================================== */
/* FM voice: carrier + one modulator. The index follows the level, as in a brass tone.
 * ratio 1 gives all harmonics (brass); ratio 2 gives odd harmonics (clarinet). */
function fmNote(bus, sr, t0, dur, midi, vel, p, glideSemi) {
  var f0 = midiHz(midi), at = Math.round(t0 * sr), n = Math.round((dur + p.rel) * sr), nd = Math.round(dur * sr);
  if (at < 0 || at >= bus.length) return;
  n = Math.min(n, bus.length - at);
  var idx = p.idx * (0.55 + 0.45 * vel) * Math.min(1, 700 / f0 + 0.35);   // less index for high notes
  var pc = 0, pm = 0, env = 0, i, t, a, f, relStart = 0;
  var kd = Math.exp(-1 / (p.dec * sr)), s = 1, gs = p.glideS || 0;
  for (i = 0; i < n; i++) {
    t = i / sr;
    if (i < nd) {
      if (t < p.atk) env = Math.sqrt(t / p.atk);
      else { s = p.sus + (s - p.sus) * kd; env = s; }
      relStart = env;
    } else env = relStart * (1 - (i - nd) / (n - nd + 1));
    f = f0;
    if (p.vibDepth && t > p.vibDelay) f *= 1 + p.vibDepth * Math.min(1, (t - p.vibDelay) * 4) * Math.sin(TAU * p.vibHz * t);
    if (glideSemi && t < gs) f *= Math.pow(2, glideSemi * (1 - t / gs) / 12);
    a = TAU * f / sr; pc += a; pm += a * p.ratio;
    bus[at + i] += Math.sin(pc + idx * env * Math.sin(pm)) * env * vel;
  }
}
/* Flute or piccolo: three harmonics and a small breath noise. */
function fluteNote(bus, sr, t0, dur, midi, vel, p, rnd) {
  var f0 = midiHz(midi), at = Math.round(t0 * sr), n = Math.round((dur + p.rel) * sr), nd = Math.round(dur * sr);
  if (at < 0 || at >= bus.length) return;
  n = Math.min(n, bus.length - at);
  var ph = 0, i, t, env, f, lp = 0;
  for (i = 0; i < n; i++) {
    t = i / sr;
    env = i < nd ? Math.min(1, t / p.atk) : Math.max(0, 1 - (i - nd) / (n - nd + 1));
    f = f0 * (1 + (t > p.vibDelay ? p.vibDepth * Math.sin(TAU * p.vibHz * t) : 0));
    ph += TAU * f / sr;
    lp += 0.2 * ((rnd() * 2 - 1) - lp);
    bus[at + i] += (Math.sin(ph) + p.h2 * Math.sin(2 * ph) + p.h3 * Math.sin(3 * ph) + p.breath * lp * 4) * env * vel;
  }
}
/* Plucked string (Karplus-Strong): a delay line with a loss filter and an all-pass for exact pitch. */
function pluckNote(bus, sr, t0, dur, midi, vel, p, rnd) {
  var f0 = midiHz(midi), at = Math.round(t0 * sr);
  if (at < 0 || at >= bus.length) return;
  var t60 = p.t60 * Math.pow(220 / f0, p.slope), s = p.bright;
  var loop = sr / f0 - s, N = Math.floor(loop - 0.1), d = loop - N, C = (1 - d) / (1 + d);
  if (N < 4) return;
  var rho = Math.pow(10, -3 / (t60 * f0)), rhoD = Math.pow(10, -3 / (p.dampT60 * f0));
  /* Start shape of the string: a triangle with its peak at the pluck point (harmonics fall as 1/n^2),
   * plus its slope (1/n, brighter) and a little noise. A smoothing filter makes a soft pluck darker. */
  var dl = new Float64Array(N), i, lp = 0, k = Math.min(0.98, p.excLP * (1.25 - 0.5 * vel)), e2 = 0, mean = 0;
  var pk = Math.max(1, Math.min(N - 1, Math.round(p.pick * N)));
  for (i = 0; i < N; i++) {
    dl[i] = p.exc[0] * (i < pk ? i / pk : (N - i) / (N - pk)) + p.exc[1] * 0.5 * (i < pk ? 1 : -pk / (N - pk)) + p.exc[2] * (rnd() * 2 - 1);
    mean += dl[i];
  }
  mean /= N; lp = dl[N - 1] - mean;
  for (var pass = 0; pass < 2; pass++) for (i = 0; i < N; i++) { lp += (1 - k) * (dl[i] - (pass ? 0 : mean) - lp); dl[i] = lp; }
  for (i = 0; i < N; i++) e2 += dl[i] * dl[i];
  e2 = Math.sqrt(e2 / N) || 1;
  for (i = 0; i < N; i++) dl[i] = dl[i] / e2 * vel * 0.3;
  var nd = Math.round(dur * sr), n = Math.min(bus.length - at, nd + Math.round(p.dampT60 * 1.5 * sr)), n2 = Math.round(t60 * 1.1 * sr) + nd;
  if (n > n2) n = n2;
  var idx = 0, x, y, ap, xp = 0, ax = 0, ay = 0, r = rho;
  for (i = 0; i < n; i++) {
    if (i === nd) r = rhoD;
    x = dl[idx];
    y = r * ((1 - s) * x + s * xp); xp = x;
    ap = C * y + ax - C * ay; ax = y; ay = ap;
    dl[idx] = ap; idx++; if (idx === N) idx = 0;
    bus[at + i] += x;
  }
}
/* Vibraphone bar: three modes at 1 : 4 : 10, long decay, damper at note end, motor tremolo on the fundamental. */
function vibeNote(bus, sr, t0, dur, midi, vel, p) {
  var f0 = midiHz(midi), at = Math.round(t0 * sr), nd = Math.round(dur * sr);
  if (at < 0 || at >= bus.length) return;
  var n = Math.min(bus.length - at, nd + Math.round(p.dampT60 * 1.3 * sr));
  var nC = Math.max(3, Math.round(p.malletMs * (1.4 - 0.6 * vel) * 0.001 * sr)), i, m, s = 0;
  var exc = new Float64Array(nC);
  for (i = 0; i < nC; i++) { exc[i] = 0.5 - 0.5 * Math.cos(TAU * (i + 0.5) / nC); s += exc[i]; }
  for (m = 0; m < p.ratios.length; m++) {
    var f = f0 * p.ratios[m];
    if (f >= 0.45 * sr) continue;
    var w = TAU * f / sr, r = Math.exp(-6.908 / (p.t60[m] * Math.pow(220 / f0, 0.5) * sr)), rD = Math.exp(-6.908 / (p.dampT60 * sr));
    var a1 = 2 * r * Math.cos(w), a2 = r * r, y1 = 0, y2 = 0, y, g = p.gains[m] * vel * Math.sin(w) / s * (m ? Math.pow(vel, 0.8) : 1);
    var trem = m === 0 ? p.tremDepth : 0, tw = TAU * p.tremHz / sr;
    for (i = 0; i < n; i++) {
      if (i === nd) { a1 = 2 * rD * Math.cos(w); a2 = rD * rD; }
      y = (i < nC ? exc[i] : 0) + a1 * y1 - a2 * y2; y2 = y1; y1 = y;
      bus[at + i] += y * g * (1 - trem * (0.5 + 0.5 * Math.sin(tw * (at + i))));
    }
  }
}
/* Ride cymbal: one bank of inharmonic modes for the whole clip, excited by each stick hit. */
function rideBus(n, sr, hits, p, rnd) {
  var exc = new Float32Array(n), out = new Float32Array(n), i, k, h;
  var nS = Math.max(2, Math.round(p.stickMs * 0.001 * sr));
  for (h = 0; h < hits.length; h++) {
    var at = Math.round(hits[h][0] * sr);
    for (i = 0; i < nS * 4 && at + i < n; i++) exc[at + i] += (rnd() * 2 - 1) * Math.exp(-i / nS) * hits[h][1];
  }
  for (k = 0; k < p.modes; k++) {
    var x = k / (p.modes - 1), f = p.loHz * Math.pow(p.hiHz / p.loHz, x) * (1 + 0.06 * (rnd() * 2 - 1));
    if (f >= 0.45 * sr) continue;
    var w = TAU * f / sr, r = Math.exp(-6.908 / ((p.t60[0] + (p.t60[1] - p.t60[0]) * x) * sr));
    var a1 = 2 * r * Math.cos(w), a2 = r * r, y1 = 0, y2 = 0, y, g = (0.6 + 0.8 * rnd()) * Math.sin(w);
    for (i = 0; i < n; i++) { y = exc[i] + a1 * y1 - a2 * y2; y2 = y1; y1 = y; out[i] += y * g; }
  }
  for (i = 0; i < n; i++) out[i] += exc[i] * 0.5;
  return butter(out, sr, 1500, 2, true);
}
function noiseHits(n, sr, hits, lo, hi, decayMs, rnd) {   // short filtered noise bursts (hi-hat)
  var out = new Float32Array(n), d = decayMs * 0.001 * sr, h, i;
  for (h = 0; h < hits.length; h++) {
    var at = Math.round(hits[h][0] * sr);
    for (i = 0; i < d * 6 && at + i < n; i++) out[at + i] += (rnd() * 2 - 1) * Math.exp(-i / d) * hits[h][1];
  }
  butter(out, sr, lo, 2, true); butter(out, sr, hi, 2, false);
  return out;
}
function brushBus(n, sr, hits, p, endS, rnd) {            // wire brushes on a snare head: swirl plus soft taps
  var out = new Float32Array(n), env = new Float32Array(n), a = p.swellMs[0] * 0.001 * sr, d = p.swellMs[1] * 0.001 * sr, h, i;
  var nEnd = Math.min(n, Math.round(endS * sr));
  for (i = 0; i < nEnd; i++) env[i] = p.swirl * Math.min(1, (nEnd - i) / (0.3 * sr));
  for (h = 0; h < hits.length; h++) {
    var at = Math.round(hits[h][0] * sr);
    for (i = 0; i < a + d * 5 && at + i < n; i++) env[at + i] += hits[h][1] * (i < a ? i / a : Math.exp(-(i - a) / d));
  }
  for (i = 0; i < n; i++) out[i] = (rnd() * 2 - 1) * env[i];
  butter(out, sr, p.hz[0], 2, true); butter(out, sr, p.hz[1], 2, false);
  return out;
}
function kickBus(n, sr, hits, p) {
  var out = new Float32Array(n), d = p.decayMs * 0.001 * sr, h, i;
  for (h = 0; h < hits.length; h++) {
    var at = Math.round(hits[h][0] * sr), ph = 0;
    for (i = 0; i < d * 6 && at + i < n; i++) {
      ph += TAU * (p.hz + p.dropHz * Math.exp(-i / (0.3 * d))) / sr;
      out[at + i] += Math.sin(ph) * Math.exp(-i / d) * hits[h][1];
    }
  }
  return out;
}
/* Small stereo room: four damped comb filters and two all-pass filters for each channel. */
function reverb(L, R, sr, p) {
  var n = L.length, ch, i, c, pre = Math.round(p.preMs * 0.001 * sr);
  var combs = p.combs, aps = p.aps;
  var mono = new Float32Array(n);
  for (i = pre; i < n; i++) mono[i] = 0.5 * (L[i - pre] + R[i - pre]);
  for (ch = 0; ch < 2; ch++) {
    var wet = new Float32Array(n), out = ch ? R : L;
    for (c = 0; c < 4; c++) {
      var len = Math.round(combs[ch][c] * sr / 44100), buf = new Float32Array(len), idx = 0, lp = 0, y;
      for (i = 0; i < n; i++) {
        y = buf[idx]; lp = y * (1 - p.damp) + lp * p.damp;
        buf[idx] = mono[i] + lp * p.decay; idx++; if (idx === len) idx = 0;
        wet[i] += y;
      }
    }
    for (c = 0; c < 2; c++) {
      var len2 = Math.round(aps[ch][c] * sr / 44100), b2 = new Float32Array(len2), id2 = 0, v, o;
      for (i = 0; i < n; i++) {
        v = b2[id2]; o = -wet[i] + v; b2[id2] = wet[i] + v * p.apGain; id2++; if (id2 === len2) id2 = 0;
        wet[i] = o;
      }
    }
    for (i = 0; i < n; i++) out[i] += wet[i] * p.mix * p.wetGain;
  }
}

/* ====================================== Composition rules ====================================== */
/* A chord is [root in semitones above the tonic, type]. All pieces are made here from the seed.
 * No existing tune is used: chords come from a small grammar, the melody from the rules below. */
var MAJOR = [0, 2, 4, 5, 7, 9, 11];
var CHORDS = { M: [0, 4, 7], m: [0, 3, 7], '6': [0, 4, 7, 9], '7': [0, 4, 7, 10], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], '69': [0, 4, 7, 9, 14] };
function mod12(x) { return ((x % 12) + 12) % 12; }
function chordPcs(ch) { return CHORDS[ch[1]].map(function (iv) { return mod12(ch[0] + iv); }); }
function scalePcs(ch) {                       // major scale of the key, bent to contain the chord tones
  var sc = MAJOR.slice(), pcs = chordPcs(ch);
  pcs.forEach(function (pc) {
    if (sc.indexOf(pc) < 0) { sc = sc.filter(function (s) { return mod12(s - pc) !== 1 && mod12(pc - s) !== 1; }); sc.push(pc); }
  });
  return sc;
}
function inSet(midi, tonic, pcs) { return pcs.indexOf(mod12(midi - tonic)) >= 0; }
function stepIn(midi, dir, tonic, pcs) { var m = midi + dir; while (!inSet(m, tonic, pcs)) m += dir; return m; }
function chordAtFn(spans) {                   // spans: [[startBeat, chord], ...] in order
  return function (beat) { var c = spans[0][1]; for (var i = 0; i < spans.length && spans[i][0] <= beat + 1e-6; i++) c = spans[i][1]; return c; };
}
function swingTime(beat, sw, spb) { var b = Math.floor(beat + 1e-6), f = beat - b; return (b + (f < 0.5 ? f * sw / 0.5 : sw + (f - 0.5) * (1 - sw) / 0.5)) * spb; }
function makeSlots(cells, startBeat) {        // cells: one rhythm cell for each bar; a negative length is a rest
  var slots = [], b = startBeat;
  cells.forEach(function (cell) {
    cell.forEach(function (d) {
      var len = Math.abs(d), onBeat = Math.abs(b - Math.round(b)) < 1e-6;
      if (d > 0) slots.push({ beat: b, dur: len, strong: onBeat || len >= 1, midi: 0 });
      b += len;
    });
  });
  return slots;
}
/* Melody rule. Strong slots take chord tones near the last note, on an arch-shaped register curve.
 * Weak slots take scale steps that lead to the next strong note. */
function makeMelody(rnd, slots, chordAt, o) {
  var prev = o.start, i, j, n = slots.length, lo = o.range[0], hi = o.range[1];
  for (i = 0; i < n; i++) {
    var s = slots[i];
    if (!s.strong) continue;
    var ch = chordAt(s.beat + (Math.abs(s.beat - Math.round(s.beat)) > 1e-6 ? 0.5 : 0));
    var pcs = (i === n - 1 && o.endPcs) ? o.endPcs : chordPcs(ch);
    var x = n > 1 ? i / (n - 1) : 0, center = lo + (hi - lo) * (0.3 + 0.45 * Math.sin(Math.PI * Math.pow(x, 0.8)));
    var cand = [], wts = [], tot = 0, m;
    for (m = lo; m <= hi; m++) {
      if (!inSet(m, o.tonic, pcs)) continue;
      var w = Math.exp(-Math.abs(m - prev) / o.leap) * Math.exp(-Math.abs(m - center) / 7) * (m === prev ? 0.3 : 1);
      cand.push(m); wts.push(w); tot += w;
    }
    var r = rnd() * tot; m = cand[cand.length - 1];
    for (j = 0; j < cand.length; j++) { r -= wts[j]; if (r <= 0) { m = cand[j]; break; } }
    s.midi = m; prev = m;
  }
  i = 0;
  while (i < n) {                             // fill each run of weak slots
    if (slots[i].strong) { i++; continue; }
    var a = i; while (i < n && !slots[i].strong) i++;
    var k = i - a, p = a > 0 ? slots[a - 1].midi : null, q = i < n ? slots[i].midi : null;
    var sc = scalePcs(chordAt(slots[a].beat)), path = [], t;
    if (p === null && q === null) { p = o.start; q = o.start; }
    if (p === null) { t = q; for (j = 0; j < k; j++) { t = stepIn(t, -1, o.tonic, sc); path.unshift(t); } }
    else if (q === null) { var dir0 = rnd() < 0.5 ? 1 : -1; t = p; for (j = 0; j < k; j++) { t = stepIn(t, dir0, o.tonic, sc); path.push(t); } }
    else if (p === q) { for (j = 0; j < k; j++) path.push(stepIn(p, (j + (rnd() < 0.5 ? 0 : 1)) % 2 ? -1 : 1, o.tonic, sc)); }
    else {
      var dir = q > p ? 1 : -1, between = [];
      t = stepIn(p, dir, o.tonic, sc);
      while ((q - t) * dir > 0) { between.push(t); t = stepIn(t, dir, o.tonic, sc); }
      if (between.length >= k) { for (j = 0; j < k; j++) path.push(between[Math.min(between.length - 1, Math.round((j + 1) * (between.length + 1) / (k + 1)) - 1)]); }
      else {
        var need = k - between.length;
        for (j = 0; j < need; j++) path.push(j % 2 === 0 ? stepIn(p, -dir, o.tonic, sc) : p);
        path = path.concat(between);
        if (!between.length && need === 1) path[0] = stepIn(q, dir, o.tonic, sc);   // one step past the target, then back
      }
    }
    if (q !== null && o.chrom && rnd() < o.chrom) {                               // chromatic approach note
      var ap = q + (rnd() < 0.7 ? -1 : 1), before = k > 1 ? path[k - 2] : p;
      if (before === null || Math.abs(ap - before) <= 4) path[k - 1] = ap;
    }
    for (j = 0; j < k; j++) slots[a + j].midi = Math.max(lo - 5, Math.min(hi + 5, path[j]));
  }
  return slots;
}
function nearest(pc, tonic, center, lo, hi) { // MIDI note with this pitch class nearest to center, inside lo..hi
  var best = null, m;
  for (m = lo; m <= hi; m++) if (mod12(m - tonic) === mod12(pc) && (best === null || Math.abs(m - center) < Math.abs(best - center))) best = m;
  return best === null ? center : best;
}
function mixBus(master, bus, level) {         // add a bus at a relative RMS level
  var r = activeRms(bus); if (!r) return;
  var g = level * CM.mixRef / r;
  for (var i = 0; i < master.length; i++) master[i] += bus[i] * g;
}
function normalize(bufs, peak) {
  var p = 0, i, b; for (b = 0; b < bufs.length; b++) p = Math.max(p, peakOf(bufs[b]));
  if (p > 0) for (b = 0; b < bufs.length; b++) for (i = 0; i < bufs[b].length; i++) bufs[b][i] *= peak / p;
}

/* ====================================== Music, dry ====================================== */
function human(rnd, ms) { return gauss(rnd) * ms * 0.001; }
function velJ(rnd, v) { return Math.max(CM.human.velMin, Math.min(1, v + CM.human.velSd * gauss(rnd))); }
function panGains(pan) { var a = (pan + 1) * Math.PI / 4; return [Math.cos(a), Math.sin(a)]; }

/* A: march for a small military band. 4 bars of introduction, two 8-bar phrases, 4 bars of ending. */
function barChord(rnd, opts) { return opts.length > 1 ? pickOf(rnd, opts) : opts[0]; }
function musicA(sr, seed) {
  var m = P.A.music, F = m.perf, G = m.grammar, rnd = makeRng(mix32(seed, 21)), spb = 60 / m.bpm, bpb = m.beatsPerBar, T = m.tonic, I = m.inst;
  var p1 = G.phrase.map(function (opts) { return barChord(rnd, opts); });
  var bars = G.intro.concat(p1, p1.slice(0, 4), G.close, G.tag);
  var nBars = bars.length, chordAt = chordAtFn(bars.map(function (c, i) { return [i * bpb, c]; }));
  var n = Math.ceil((nBars * bpb * spb + m.tailS) * sr);
  var bus = { cornet: new Float32Array(n), piccolo: new Float32Array(n), horns: new Float32Array(n), trombone: new Float32Array(n), tuba: new Float32Array(n) };
  var c1 = pickOf(rnd, m.cells), c2 = pickOf(rnd, m.cells), c3 = pickOf(rnd, m.cells), c4 = pickOf(rnd, m.cells), busy = pickOf(rnd, [m.cells[4], m.cells[5]]);
  var o = { tonic: T, range: m.range, leap: m.leap, chrom: m.chrom, start: T + F.startAbove };
  var sIntro = makeMelody(rnd, makeSlots(m.introCells, 0), chordAt, Object.assign({}, o, { endPcs: [7] }));
  var sP1 = makeMelody(rnd, makeSlots([c1, c2, c1, m.restCell, c3, c4, busy, m.halfCell], 8), chordAt, Object.assign({}, o, { start: sIntro[sIntro.length - 1].midi }));
  var sP2a = sP1.filter(function (s) { return s.beat < 16; }).map(function (s) { return { beat: s.beat + 16, dur: s.dur, strong: s.strong, midi: s.midi }; });
  var sP2b = makeMelody(rnd, makeSlots([c3, c4, busy, m.endCell], 32), chordAt, Object.assign({}, o, { start: sP2a[sP2a.length - 1].midi, endPcs: [0] }));
  var sTag = makeMelody(rnd, makeSlots(m.tagCells, 40), chordAt, Object.assign({}, o, { start: sP2b[sP2b.length - 1].midi, endPcs: [0] }));
  var mel = sIntro.concat(sP1, sP2a, sP2b, sTag), h1ms = F.humanMs[0], h2ms = F.humanMs[1];
  mel.forEach(function (s) {
    var t = s.beat * spb + human(rnd, h1ms), d = s.dur * spb * (s.dur <= 0.5 ? F.legato[0] : F.legato[1]), v = velJ(rnd, s.beat % bpb === 0 ? F.vel[0] : F.vel[1]);
    fmNote(bus.cornet, sr, Math.max(0, t), d, s.midi, v, I.cornet, 0);
    if (s.beat < 8 || s.beat >= 24) fluteNote(bus.piccolo, sr, Math.max(0, t + human(rnd, h2ms)), d, s.midi + 12, v * F.piccoloVel, I.piccolo, rnd);
    if (s.beat < 8) fmNote(bus.trombone, sr, Math.max(0, t + human(rnd, h2ms)), d, s.midi - 12, v, I.trombone, 0);
  });
  var tp = T + F.trbStart, b, bar;
  for (bar = 0; bar < nBars; bar++) {
    var ch = bars[bar], pcs = chordPcs(ch), last = bar === nBars - 1, b0 = bar * bpb;
    var root = nearest(pcs[0], T, F.tuba[0], F.tuba[1], F.tuba[2]), fifth = nearest(pcs[2], T, root + F.tubaFifth[0], F.tubaFifth[1], F.tubaFifth[2]);
    for (b = 0; b < (last ? 1 : bpb); b++) fmNote(bus.tuba, sr, Math.max(0, (b0 + b) * spb + human(rnd, h1ms)), F.tubaLen * spb, b === 0 ? root : fifth, velJ(rnd, b === 0 ? F.vel[0] : F.vel[1]), I.tuba, 0);
    if (bar < m.introBars) continue;
    var h1 = nearest(pcs[1], T, F.horn1[0], F.horn1[1], F.horn1[2]), h2 = nearest(pcs.length > 3 ? pcs[3] : pcs[2], T, F.horn2[0], F.horn2[1], F.horn2[2]);
    for (b = 0; b < bpb; b++) {                // alto horns on the after-beats; on the beat in the last bar
      var hb = last ? b0 : b0 + b + 0.5; if (last && b) break;
      fmNote(bus.horns, sr, hb * spb + human(rnd, h1ms), (last ? F.hornLen[1] : F.hornLen[0]) * spb, h1, velJ(rnd, F.vel[1]), I.horn, 0);
      fmNote(bus.horns, sr, hb * spb + human(rnd, h1ms), (last ? F.hornLen[1] : F.hornLen[0]) * spb, h2, velJ(rnd, F.vel[1]), I.horn, 0);
    }
    if (last) { fmNote(bus.trombone, sr, b0 * spb, F.hornLen[1] * spb, nearest(pcs[0], T, tp, F.trb[0], F.trb[1]), F.vel[0], I.trombone, 0); continue; }
    tp = nearest(pickOf(rnd, pcs.length > 3 ? [pcs[1], pcs[3]] : [pcs[1], pcs[2], pcs[0]]), T, tp, F.trb[0], F.trb[1]);
    if (rnd() < F.trbSplit) {                  // trombone counter line: one long note, or two notes with a step
      fmNote(bus.trombone, sr, b0 * spb + human(rnd, h2ms), F.trbLen[0] * spb, tp, velJ(rnd, F.trbVel[0]), I.trombone, 0);
      tp = stepIn(tp, rnd() < 0.5 ? 1 : -1, T, scalePcs(ch));
      fmNote(bus.trombone, sr, (b0 + 1) * spb + human(rnd, h2ms), F.trbLen[0] * spb, tp, velJ(rnd, F.trbVel[1]), I.trombone, 0);
    } else fmNote(bus.trombone, sr, b0 * spb + human(rnd, h2ms), F.trbLen[1] * spb, tp, velJ(rnd, F.trbVel[0]), I.trombone, 0);
  }
  var out = new Float32Array(n);
  Object.keys(bus).forEach(function (k) { mixBus(out, bus[k], m.mix[k]); });
  normalize([out], m.peak);
  return fadeEnd(out, sr, F.fadeMs);
}

/* B: fox-trot for a 1920s dance band. 2 bars of introduction, two 8-bar phrases, 2 bars of ending. */
function musicB(sr, seed) {
  var m = P.B.music, F = m.perf, G = m.grammar, rnd = makeRng(mix32(seed, 22)), spb = 60 / m.bpm, T = m.tonic, I = m.inst, sw = m.swing;
  var x6 = pickOf(rnd, G.bar6);                 // bar 6 first; bar 7 depends on it
  var p1 = G.phrase.map(function (opts) { return opts === 6 ? x6 : opts === 7 ? (x6[0] === 0 ? G.bar7[0] : G.bar7[1]) : barChord(rnd, opts); });
  var bars = G.intro.concat(p1, p1.slice(0, 4), G.close, G.tag), nBars = bars.length;
  var spans = bars.map(function (c, i) { return [i * 4, c]; });
  spans.splice(17, 0, [16 * 4 + 2, G.split]);  // chorus bar 15: tonic for two beats, then the dominant
  var chordAt = chordAtFn(spans), total = nBars * 4, n = Math.ceil((total * spb + m.tailS) * sr);
  var bus = { cornet: new Float32Array(n), clarinet: new Float32Array(n), trombone: new Float32Array(n), banjo: new Float32Array(n), tuba: new Float32Array(n), block: new Float32Array(n) };
  var tm = function (beat) { return swingTime(beat, sw, spb); };
  var c = [0, 1, 2, 3, 4, 5, 6].map(function () { return pickOf(rnd, m.cells); });
  var o = { tonic: T, range: m.range, leap: m.leap, chrom: m.chrom, start: T + F.startAbove };
  var sP1 = makeMelody(rnd, makeSlots([c[0], c[1], c[0], c[2], c[0], c[1], c[3], m.halfCell], 8), chordAt, o);
  var sP2a = sP1.filter(function (s) { return s.beat < 24; }).map(function (s) { return { beat: s.beat + 32, dur: s.dur, strong: s.strong, midi: s.midi }; });
  var sP2b = makeMelody(rnd, makeSlots([c[4], c[5], c[6], m.endCell], 56), chordAt, Object.assign({}, o, { start: sP2a[sP2a.length - 1].midi, endPcs: [0, 4] }));
  var sTag = makeMelody(rnd, makeSlots(m.tagCells, 72), chordAt, Object.assign({}, o, { start: sP2b[sP2b.length - 1].midi, endPcs: [0] }));
  sP1.concat(sP2a, sP2b, sTag).forEach(function (s) {
    var t = tm(s.beat) + human(rnd, F.humanMs[0]), d = (tm(s.beat + s.dur) - tm(s.beat)) * (s.dur <= 0.5 ? F.legato[0] : F.legato[1]);
    fmNote(bus.cornet, sr, t, d, s.midi, velJ(rnd, s.strong ? F.vel[0] : F.vel[1]), I.cornet, 0);
  });
  var CL = F.clar, BJ = F.banjo, cp = T + CL.start, cdir = 1, bar, b, e, tb = T + F.trbStart;
  for (bar = 1; bar < nBars - 1; bar++) {       // clarinet: runs of eighth notes above the tune
    for (var half = 0; half < 2; half++) {
      if (bar === 1 && half === 0) continue;
      if (bar > 1 && rnd() > CL.play) continue;
      for (e = 0; e < 4; e++) {
        var beat = bar * 4 + half * 2 + e * 0.5, ch = chordAt(beat);
        var set = e % 2 === 0 ? chordPcs(ch) : scalePcs(ch);
        if (cp >= T + CL.range[1]) cdir = -1; else if (cp <= T + CL.range[0]) cdir = 1; else if (rnd() < CL.turn) cdir = -cdir;
        cp = stepIn(cp, cdir, T, set);
        fmNote(bus.clarinet, sr, tm(beat) + human(rnd, F.humanMs[1]), (tm(beat + 0.5) - tm(beat)) * CL.len, cp, velJ(rnd, e % 2 ? CL.vel[1] : CL.vel[0]), I.clarinet, 0);
      }
    }
  }
  for (bar = 0; bar < nBars; bar++) {
    var last = bar === nBars - 1;
    for (b = 0; b < 4; b++) {
      if (last && (b === 1 || b === 3)) continue;
      var bt = bar * 4 + b, cc = chordAt(bt), pcs = chordPcs(cc), t0 = tm(bt);
      var v4 = [nearest(pcs[0], T, BJ.first[0], BJ.first[1], BJ.first[2])];  // banjo: four strings, one chord on each beat
      for (e = 1; e < pcs.length; e++) v4.push(nearest(pcs[e], T, v4[e - 1] + BJ.step[0], v4[e - 1] + BJ.step[1], v4[e - 1] + BJ.step[2]));
      for (e = 0; e < v4.length; e++) pluckNote(bus.banjo, sr, t0 + e * BJ.strumS + human(rnd, BJ.humanMs), (last ? BJ.len[1] : BJ.len[0]) * spb, v4[e], velJ(rnd, b % 2 ? BJ.vel[1] : BJ.vel[0]), I.banjo, rnd);
      if (b % 2 === 0) {                         // tuba and trombone on beats 1 and 3
        var rt = nearest(b === 0 || last ? pcs[0] : pcs[2], T, F.tuba[0], F.tuba[1], F.tuba[2]);
        fmNote(bus.tuba, sr, t0 + human(rnd, F.tubaHumanMs), F.tubaLen * spb, rt, velJ(rnd, F.tubaVel), I.tuba, 0);
        tb = nearest(b === 0 ? pcs[0] : pickOf(rnd, [pcs[1], pcs[2]]), T, tb, F.trb[0], F.trb[1]);
        fmNote(bus.trombone, sr, t0 + human(rnd, F.trbHumanMs), (last ? F.trbLen[1] : F.trbLen[0]) * spb, tb, velJ(rnd, F.trbVel), I.trombone, b === 0 && rnd() < F.trbGlide ? I.trombone.glideSemi : 0);
      } else impact(bus.block, Math.round((t0 + human(rnd, F.block.humanMs)) * sr), sr, rnd, I.block, 1, velJ(rnd, F.block.vel), F.block.scatter);
      if (last && b === 2) impact(bus.block, Math.round(t0 * sr), sr, rnd, I.block, 1, F.block.lastVel, F.block.scatter);
    }
  }
  I.banjo.body.forEach(function (r) { biquad(bus.banjo, bqPeak(sr, r[0], r[1], r[2])); });
  butter(bus.banjo, sr, BJ.hpHz, 2, true);
  var out = new Float32Array(n);
  Object.keys(bus).forEach(function (k) { mixBus(out, bus[k], m.mix[k]); });
  normalize([out], m.peak);
  return fadeEnd(out, sr, F.fadeMs);
}

/* C: cool jazz for a quartet. 2 bars of introduction, one 12-bar chorus, one last chord that rings. */
function musicC(sr, seed) {
  var m = P.C.music, F = m.perf, G = m.grammar, rnd = makeRng(mix32(seed, 23)), spb = 60 / m.bpm, T = m.tonic, I = m.inst, sw = m.swing;
  var bars = G.intro.concat(pickOf(rnd, G.forms)), spans = [], bar, b, e, i;
  var is = function (c, r, t) { return c[0] === r && c[1] === t; };
  bars.forEach(function (bc, k) { spans.push([k * 4, bc[0]]); if (bc.length > 1) spans.push([k * 4 + 2, bc[1]]); });
  for (i = 0; i < spans.length - 1; i++)        // sometimes replace a dominant chord by the chord a tritone away
    if (spans[i][0] >= 8 && is(spans[i][1], 7, '7') && is(spans[i + 1][1], 0, 'M7') && rnd() < F.tritone) spans[i][1] = G.tritone;
  var endBeat = bars.length * 4;
  spans.push([endBeat, G.last]);
  var chordAt = chordAtFn(spans), n = Math.ceil((endBeat * spb + m.tailS) * sr), endT = endBeat * spb;
  var tm = function (beat) { return swingTime(beat, sw, spb); };
  var bus = { vibes: new Float32Array(n), guitar: new Float32Array(n), bass: new Float32Array(n) };
  /* vibraphone tune */
  var c = [0, 1, 2, 3, 4, 5, 6].map(function () { return pickOf(rnd, m.cells); }), X = m.fixedCells;
  var cells = [X[0], c[0], c[1], c[0], X[1], c[0], c[2], c[3], X[2], c[4], c[5], c[6], X[3]];
  var mel = makeMelody(rnd, makeSlots(cells, 4), chordAt, { tonic: T, range: m.range, leap: m.leap, chrom: m.chrom, start: T + F.startAbove, endPcs: F.endPcs });
  mel.forEach(function (s) {
    var t = tm(s.beat) + human(rnd, F.humanMs), d = (tm(s.beat + s.dur) - tm(s.beat)) * (s.dur >= F.longBeats ? F.legato[1] : F.legato[0]);
    vibeNote(bus.vibes, sr, t, d, s.midi, velJ(rnd, s.strong ? F.vel[0] : F.vel[1]), I.vibes);
  });
  var LC = F.lastChord, fin = [nearest(0, T, LC.first[0], LC.first[1], LC.first[2])];
  LC.pcs.forEach(function (pc) { fin.push(nearest(pc, T, fin[fin.length - 1] + LC.step[0], fin[fin.length - 1] + LC.step[1], fin[fin.length - 1] + LC.step[2])); });
  fin.forEach(function (mn, k) { vibeNote(bus.vibes, sr, endT + k * LC.rollS, m.tailS, mn, LC.vel, I.vibes); });
  /* guitar chords: third, seventh and ninth of each chord */
  var GT = F.guitar;
  var voice = function (ch) {
    var iv = CHORDS[ch[1]], pcs = ch[1] === '69' ? [ch[0] + 4, ch[0] + 9, ch[0] + 2] : [ch[0] + iv[1], ch[0] + iv[3], ch[0] + 2];
    var v0 = nearest(pcs[0], T, GT.first[0], GT.first[1], GT.first[2]), v1 = nearest(pcs[1], T, v0 + GT.step2[0], v0 + GT.step2[1], v0 + GT.step2[2]), v2 = nearest(pcs[2], T, v1 + GT.step3[0], v1 + GT.step3[1], v1 + GT.step3[2]);
    return [v0, v1, v2];
  };
  for (bar = 0; bar < bars.length; bar++) {
    pickOf(rnd, GT.pats).forEach(function (h) {
      var beat = bar * 4 + h[0], off = Math.abs(h[0] - Math.round(h[0])) > 0.1;
      var v = voice(chordAt(beat + (off ? 0.5 : 0))), t = tm(beat) + human(rnd, GT.humanMs), vel = velJ(rnd, GT.vel);
      for (e = 0; e < 3; e++) pluckNote(bus.guitar, sr, t + e * GT.strumS, h[1] * spb, v[e], vel, I.guitar, rnd);
    });
  }
  voice(G.last).forEach(function (mn, k) { pluckNote(bus.guitar, sr, endT + GT.last[0] + k * GT.last[1], GT.last[2], mn, GT.last[3], I.guitar, rnd); });
  /* walking bass: root on a chord change, a chord tone between, a half-step approach before the next root */
  var BS = F.bass, bp = nearest(0, T, BS.start, BS.first[0], BS.first[1]), same = function (x, y) { return x[0] === y[0] && x[1] === y[1]; };
  for (b = 0; b < endBeat; b++) {
    var ch = chordAt(b), nx = chordAt(b + 1), pcs = chordPcs(ch), note;
    if (b % 4 === 0 || !same(ch, chordAt(b - 1))) note = nearest(pcs[0], T, bp, BS.root[0], BS.root[1]);
    else if (!same(nx, ch) || (b + 1) % 4 === 0) { var tg = nearest(nx[0], T, bp, BS.root[0], BS.root[1]); note = tg + (bp < tg ? -1 : 1); }
    else { note = nearest(pickOf(rnd, [pcs[1], pcs[2], pcs[3]]), T, bp + (rnd() < 0.5 ? BS.jump : -BS.jump), BS.tone[0], BS.tone[1]); if (note === bp) note = stepIn(bp, 1, T, scalePcs(ch)); }
    bp = note;
    var tb = b * spb + human(rnd, BS.humanMs), vb = velJ(rnd, b % 2 ? BS.vel[1] : BS.vel[0]), at = Math.round(tb * sr);
    pluckNote(bus.bass, sr, tb, BS.len * spb, note, vb, I.bass, rnd);
    for (i = 0; i < BS.thumpLenS * sr && at + i < n && at >= 0; i++) bus.bass[at + i] += I.bass.thump * vb * Math.exp(-i / (BS.thumpS * sr)) * Math.sin(TAU * BS.thumpHz * i / sr);
  }
  pluckNote(bus.bass, sr, endT, BS.last[3], nearest(0, T, BS.last[0], BS.last[1], BS.last[2]), BS.last[4], I.bass, rnd);
  [bus.guitar, bus.bass].forEach(function (x, k) {
    var p = k ? I.bass : I.guitar;
    p.body.forEach(function (r) { biquad(x, bqPeak(sr, r[0], r[1], r[2])); });
    butter(x, sr, p.toneHz, 2, false); butter(x, sr, k ? BS.hpHz : GT.hpHz, 2, true);
  });
  /* drums: ride cymbal, hi-hat on beats 2 and 4, brushes, soft bass drum */
  var D = F.drums, ride = [], hat = [], br = [], kick = [];
  for (bar = 0; bar < bars.length; bar++) {
    var skip = rnd() > D.skip, b0 = bar * 4;
    D.ride.forEach(function (h) {
      if (h[0] % 1 && !skip) return;
      ride.push([tm(b0 + h[0]) + human(rnd, D.rideHumanMs), velJ(rnd, h[1])]);
    });
    hat.push([tm(b0 + 1), velJ(rnd, D.hatVel)], [tm(b0 + 3), velJ(rnd, D.hatVel)]);
    for (b = 0; b < 4; b++) br.push([tm(b0 + b) + human(rnd, D.brushHumanMs), velJ(rnd, b % 2 ? D.brushVel[1] : D.brushVel[0])]);
    kick.push([tm(b0), velJ(rnd, D.kickVel)]);
  }
  ride.push([endT, D.lastRide]);
  var dr = { ride: rideBus(n, sr, ride, I.ride, rnd), hat: noiseHits(n, sr, hat, I.hat.hz[0], I.hat.hz[1], I.hat.decayMs, rnd),
             brush: brushBus(n, sr, br, I.brush, endT, rnd), kick: kickBus(n, sr, kick, I.kick) };
  var L = new Float32Array(n), R = new Float32Array(n), all = Object.assign({}, bus, dr);
  var add = function (k) { var g = panGains(m.pan[k]), tl = new Float32Array(n); mixBus(tl, all[k], m.mix[k]); for (var j = 0; j < n; j++) { L[j] += tl[j] * g[0]; R[j] += tl[j] * g[1]; } };
  ['vibes', 'guitar', 'ride', 'hat', 'brush'].forEach(add);
  reverb(L, R, sr, m.reverb);
  ['bass', 'kick'].forEach(add);                // the low instruments stay dry
  normalize([L, R], m.peak);
  return { L: fadeEnd(L, sr, F.fadeMs), R: fadeEnd(R, sr, F.fadeMs) };
}

/* ====================================== Medium (playback device) ====================================== */
var TAPS = 32, PHASES = 1024, SINC = null;
function sincTable() {                        // windowed-sinc interpolation table for the speed variation
  if (SINC) return SINC;
  SINC = new Float32Array((PHASES + 1) * TAPS);
  for (var p = 0; p <= PHASES; p++) {
    var sum = 0, k, h = new Float64Array(TAPS);
    for (k = 0; k < TAPS; k++) {
      var x = k - (TAPS / 2 - 1) - p / PHASES, u = x / (TAPS / 2);
      var w = Math.abs(u) >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
      h[k] = (Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * w; sum += h[k];
    }
    for (k = 0; k < TAPS; k++) SINC[p * TAPS + k] = h[k] / sum;
  }
  return SINC;
}
/* Speed variation (wow): read the input at a position that moves faster and slower.
 * comps: [[frequency relative to the rotation rate, peak relative speed change], ...]. */
function warp(x, sr, comps, rotHz, seed) {
  var n = x.length, out = new Float32Array(n), tab = sincTable(), rnd = makeRng(seed), half = TAPS / 2 - 1, c, i, k;
  var W = [], A = [], PH = [], C0 = [];
  for (c = 0; c < comps.length; c++) {
    var f = comps[c][0] * rotHz, ph = rnd() * TAU;
    W.push(TAU * f / sr); A.push(-comps[c][1] * sr / (TAU * f)); PH.push(ph); C0.push(Math.cos(ph));
  }
  for (i = 0; i < n; i++) {
    var pos = i;
    for (c = 0; c < W.length; c++) pos += A[c] * (Math.cos(W[c] * i + PH[c]) - C0[c]);
    var i0 = Math.floor(pos), row = Math.round((pos - i0) * PHASES) * TAPS, base = i0 - half, acc = 0;
    if (base >= 0 && base + TAPS <= n) for (k = 0; k < TAPS; k++) acc += x[base + k] * tab[row + k];
    else for (k = 0; k < TAPS; k++) { var j = base + k; if (j >= 0 && j < n) acc += x[j] * tab[row + k]; }
    out[i] = acc;
  }
  return out;
}
function softClip(y) { var a = y * y; return y / Math.sqrt(Math.sqrt(1 + a * a)); }   // linear when low, never above 1
function riaaCoef(sr, T) {                     // RIAA playback curve, bilinear transform, 0 dB at 1 kHz
  var K = 2 * sr, a = T[0] * K, b = T[1] * K, c = T[2] * K, d0 = (1 + a) * (1 + c);
  var k = [(1 + b) / d0, 2 / d0, (1 - b) / d0, 2 * (1 - a * c) / d0, (1 - a) * (1 - c) / d0];
  var w = TAU * 1000 / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  var nr = k[0] + k[1] * c1 + k[2] * c2, ni = -k[1] * s1 - k[2] * s2, dr = 1 + k[3] * c1 + k[4] * c2, di = -k[3] * s1 - k[4] * s2;
  var g = Math.sqrt((dr * dr + di * di) / (nr * nr + ni * ni));
  return [k[0] * g, k[1] * g, k[2] * g, k[3], k[4]];
}
/* A and B: mono. Order of the chain: speed variation, recording resonances, saturation,
 * surface noise (with a change and a tick in each turn), reproducer resonances, band limit.
 * The gain is fixed: a silent input gives the noise floor alone. */
function mediumMono(key, sr, seed, params) {
  var M = P[key].medium, x = params.input, n = x.length, rot = M.rpm / 60, i;
  var y = warp(x, sr, M.wow, rot, mix32(seed, 31)), rN = makeRng(mix32(seed, 32)), rT = makeRng(mix32(seed, 33));
  M.recRes.forEach(function (r) { biquad(y, bqPeak(sr, r[0], r[1], r[2])); });
  var ph0 = rT() * TAU, tickAt = rT(), unit = M.noiseGain * CM.tickUnit, pC = M.crackleRate / sr, lastTurn = -1, dv = M.drive;
  for (i = 0; i < n; i++) {
    var turns = rot * i / sr, v = softClip(y[i] * M.inGain * dv) / dv;
    v += (rN() * 2 - 1) * M.noiseGain * (1 + M.swishDepth * Math.sin(TAU * turns + ph0));
    var tn = Math.floor(turns + tickAt);
    if (tn !== lastTurn) { if (lastTurn >= 0) v += M.tickGain * unit * (CM.tickJit[0] + CM.tickJit[1] * rT()); lastTurn = tn; }
    if (rT() < pC) v += M.crackleGain * unit * -Math.log(1 - rT()) * CM.crackleMean * (rT() < 0.5 ? -1 : 1);
    y[i] = v;
  }
  M.playRes.forEach(function (r) { biquad(y, bqPeak(sr, r[0], r[1], r[2])); });
  butter(y, sr, M.hp[0], M.hp[1], true); butter(y, sr, M.lp[0], M.lp[1], false);
  for (i = 0; i < n; i++) y[i] = softClip(y[i] * M.outGain);
  return y;
}
/* C: stereo LP on a hi-fi. Wide band, low noise. The noise passes the RIAA playback curve. */
function mediumStereo(key, sr, seed, params) {
  var M = P[key].medium, n = params.input.L.length, rot = M.rpm / 60, i, ch;
  var L = warp(params.input.L, sr, M.wow, rot, mix32(seed, 31)), R = warp(params.input.R, sr, M.wow, rot, mix32(seed, 31));
  var xt = Math.pow(10, M.crosstalkDb / 20), rN = makeRng(mix32(seed, 32)), rT = makeRng(mix32(seed, 33));
  var ph0 = rT() * TAU, pT = M.tickRate / sr, nz = [new Float32Array(n), new Float32Array(n)];
  for (i = 0; i < n; i++) {
    var sw = 1 + M.swishDepth * Math.sin(TAU * rot * i / sr + ph0), cm = (rN() * 2 - 1) * M.noiseCommon;
    nz[0][i] = (cm + (rN() * 2 - 1) * M.noiseCommon) * M.noiseGain * sw; nz[1][i] = (cm + (rN() * 2 - 1) * M.noiseCommon) * M.noiseGain * sw;
    if (rT() < pT) { var a = M.tickGain * (M.tickJit + rT()) * (rT() < 0.5 ? -1 : 1), bal = rT(); nz[0][i] += a * bal; nz[1][i] += a * (1 - bal); }
  }
  var rum = bandNoise(n, sr, rN, M.rumbleHz[0], M.rumbleHz[1]), rk = riaaCoef(sr, M.riaa), outs = [L, R];
  for (ch = 0; ch < 2; ch++) biquad(nz[ch], rk);
  for (i = 0; i < n; i++) {
    var l = L[i], r = R[i];
    L[i] = l + xt * r + nz[0][i] + rum[i] * M.rumbleGain; R[i] = r + xt * l + nz[1][i] + rum[i] * M.rumbleGain * M.rumbleRight;
  }
  for (ch = 0; ch < 2; ch++) {
    butter(outs[ch], sr, M.hp[0], M.hp[1], true); butter(outs[ch], sr, Math.min(M.lp[0], 0.45 * sr), M.lp[1], false);
    for (i = 0; i < n; i++) outs[ch][i] = softClip(outs[ch][i] * M.outGain);
  }
  return { L: L, R: R };
}
function medium(key, sr, seed, params) { return key === 'C' ? mediumStereo(key, sr, seed, params) : mediumMono(key, sr, seed, params); }
function music(key, sr, seed) { return key === 'A' ? musicA(sr, seed) : key === 'B' ? musicB(sr, seed) : musicC(sr, seed); }

/* ====================================== Measurement ====================================== */
function fft(re, im) {                         // in place, length is a power of 2
  var n = re.length, i, j = 0, k, len, t;
  for (i = 1; i < n; i++) {
    k = n >> 1; while (j & k) { j ^= k; k >>= 1; } j ^= k;
    if (i < j) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (len = 2; len <= n; len <<= 1) {
    var ang = -TAU / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for (i = 0; i < n; i += len) {
      var cr = 1, ci = 0;
      for (k = 0; k < h; k++) {
        var ur = re[i + k], ui = im[i + k], vr = re[i + k + h] * cr - im[i + k + h] * ci, vi = re[i + k + h] * ci + im[i + k + h] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + h] = ur - vr; im[i + k + h] = ui - vi;
        t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
function welch(x, nfft) {                      // mean power spectrum, Hann window, 50 % overlap
  var out = new Float64Array(nfft / 2 + 1), re = new Float64Array(nfft), im = new Float64Array(nfft), cnt = 0, s, i;
  for (s = 0; s + nfft <= x.length; s += nfft / 2) {
    for (i = 0; i < nfft; i++) { re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(TAU * i / nfft)); im[i] = 0; }
    fft(re, im);
    for (i = 0; i <= nfft / 2; i++) out[i] += re[i] * re[i] + im[i] * im[i];
    cnt++;
  }
  for (i = 0; i < out.length; i++) out[i] /= Math.max(1, cnt);
  return out;
}
function zerosLike(key, n) { return key === 'C' ? { L: new Float32Array(n), R: new Float32Array(n) } : new Float32Array(n); }
function both(key, x) { return key === 'C' ? { L: x, R: new Float32Array(x) } : x; }
function left(key, x) { return key === 'C' ? x.L : x; }
/* Three numbers for one medium, all computed from rendered audio:
 * noiseDb  - level of the device with a silent input, relative to the music part of the device output;
 * loHz,hiHz - where the response to a white noise probe is 6 dB below the median pass-band level;
 * wowPct   - peak speed variation, from the frequency of a probe tone that passed the device. */
function measure(key, sr, seed, params) {
  var dry = (params && params.dry) || music(key, sr, seed), n = left(key, dry).length, i, k;
  var dev = medium(key, sr, seed, { input: dry }), sil = medium(key, sr, seed, { input: zerosLike(key, n) });
  var sN = 0, sM = 0, chans = key === 'C' ? [[dev.L, sil.L], [dev.R, sil.R]] : [[dev, sil]];
  chans.forEach(function (c) { for (i = 0; i < n; i++) { var d = c[0][i] - c[1][i]; sM += d * d; sN += c[1][i] * c[1][i]; } });
  var res = { noiseDb: 10 * Math.log10(sN / sM) };
  var nP = 4 * sr, probe = new Float32Array(nP), rnd = makeRng(mix32(seed, 41));
  for (i = 0; i < nP; i++) probe[i] = (rnd() * 2 - 1) * 0.25;
  var a = left(key, medium(key, sr, seed, { input: both(key, probe) })), b = left(key, medium(key, sr, seed, { input: zerosLike(key, nP) }));
  for (i = 0; i < nP; i++) a[i] -= b[i];
  var nfft = 8192, psd = welch(a, nfft), fs = [], lv = [];
  for (k = 0; ; k++) {
    var f = 20 * Math.pow(2, k / 12); if (f > 0.49 * sr) break;
    var b0 = Math.max(1, Math.floor(f * Math.pow(2, -1 / 6) * nfft / sr)), b1 = Math.max(b0, Math.ceil(f * Math.pow(2, 1 / 6) * nfft / sr)), s = 0;
    b1 = Math.min(b1, nfft / 2);
    for (i = b0; i <= b1; i++) s += psd[i];
    fs.push(f); lv.push(10 * Math.log10(s / (b1 - b0 + 1) + 1e-30));
  }
  var pk = Math.max.apply(null, lv), pass = lv.filter(function (v) { return v > pk - 12; }).sort(function (x, y) { return x - y; });
  var ref = pass[Math.floor(pass.length / 2)] - 6, lo = 0, hi = lv.length - 1;
  while (lo < lv.length - 1 && lv[lo] < ref) lo++;
  while (hi > 0 && lv[hi] < ref) hi--;
  var cross = function (i0, i1) { if (i0 < 0 || i1 >= lv.length || lv[i0] === lv[i1]) return fs[Math.max(0, Math.min(lv.length - 1, i1))]; return fs[i0] * Math.pow(fs[i1] / fs[i0], (ref - lv[i0]) / (lv[i1] - lv[i0])); };
  res.loHz = lo === 0 ? fs[0] : cross(lo - 1, lo);
  res.hiHz = hi === lv.length - 1 ? fs[hi] : cross(hi + 1, hi);
  res.hiAtLimit = hi === lv.length - 1; res.loAtLimit = lo === 0;   // true: the response is still up at the edge of the measurement
  var f0 = key === 'C' ? 3150 : 1000, nT = 8 * sr, tone = new Float32Array(nT), w = TAU * f0 / sr;
  for (i = 0; i < nT; i++) tone[i] = 0.3 * Math.sin(w * i);
  var o = left(key, medium(key, sr, seed, { input: both(key, tone) }));
  var cI = new Float64Array(nT + 1), cQ = new Float64Array(nT + 1), Wn = Math.round(0.04 * sr), D = Math.round(sr / 200);
  for (i = 0; i < nT; i++) { cI[i + 1] = cI[i] + o[i] * Math.cos(w * i); cQ[i + 1] = cQ[i] - o[i] * Math.sin(w * i); }
  var ph = [], prev = 0, off = 0;
  for (i = Wn; i + Wn < nT; i += D) {
    var p = Math.atan2(cQ[i + Wn] - cQ[i - Wn], cI[i + Wn] - cI[i - Wn]);
    if (ph.length) { while (p + off - prev > Math.PI) off -= TAU; while (p + off - prev < -Math.PI) off += TAU; }
    prev = p + off; ph.push(prev);
  }
  var mn = Infinity, mx = -Infinity, skip = Math.round(0.5 * sr / D);
  for (i = skip + 2; i < ph.length - skip - 2; i++) {
    var dv = ((ph[i + 2] - ph[i - 2]) / (4 * D / sr)) / (TAU * f0);
    if (dv < mn) mn = dv; if (dv > mx) mx = dv;
  }
  res.wowPct = 100 * (mx - mn) / 2; res.toneHz = f0;
  return res;
}

/* ====================================== Public interface ====================================== */
function setting(key) {
  var v1 = function () { return CM.machineVersion === 1; };   // machine sounds: version 1 or version 2 (P.common.machineVersion)
  var o = {
    strike: function (sr, seed, params) { return v1() ? keyStrike(key, sr, seed, params) : keyStrike2(key, sr, seed, params); },
    space: function (sr, seed, params) { return v1() ? spaceBar(key, sr, seed, params) : spaceBar2(key, sr, seed, params); },
    ret: function (sr, seed, params) { return v1() ? carriageReturn(key, sr, seed, params) : carriageReturn2(key, sr, seed, params); },
    linefeed: function (sr, seed, params) { return v1() ? lineFeed(key, sr, seed, params) : lineFeed2(key, sr, seed, params); },
    bell: function (sr, seed, params) { return v1() ? bell(key, sr, seed, params) : bell2(key, sr, seed, params); },
    music: function (sr, seed, params) { return music(key, sr, seed); },
    medium: function (sr, seed, params) { return medium(key, sr, seed, params); }
  };
  if (key === 'C') o.motor = motorLoop;
  return o;
}
var Synth = {
  P: P, SOURCES: SOURCES, GUESSES: GUESSES, KEYS: ['A', 'B', 'C'],
  A: setting('A'), B: setting('B'), C: setting('C'),
  measure: measure
};
root.Synth = Synth;
if (typeof module !== 'undefined' && module.exports) module.exports = Synth;
})(typeof globalThis !== 'undefined' ? globalThis : this);
