/* scene-c.js - the 3D picture of setting C: an office in 1962, an IBM Selectric (model 721) and an AR XA turntable
 * in a stereo hi-fi. A classic script (it must work from file://). It defines one global: buildSceneC.
 *
 * ================================ SCENE INTERFACE (the same as scene-b.js) ================================
 *   const scene = buildSceneC(THREE, canvas, options)
 *     THREE    the three.js 0.186.1 module namespace. The page loads it and gives it. The scene loads nothing.
 *     canvas   the <canvas> that the scene draws on. The scene makes the WebGLRenderer. It throws if WebGL fails.
 *     options  { engine: the engine class SelectricEngine (static tables K, KEYS, ROWS, SNAP, FLAG_*), seed: integer (default 1) }
 *   The scene owns the sheet: the 2D canvas of the paper, the ink and the texture upload. The page keeps the text grid.
 *   Required methods:
 *     scene.update(snap, dt)    snap: Float32Array in the layout engine.SNAP. dt: s since the last call.
 *                               Moves all parts, moves the camera, and renders one frame. Call it once per animation frame.
 *     scene.event(ev)           one engine event. The scene reads these fields:
 *                               print { ch, column, line, force, tilt, rotation, r } -> ink on the sheet; the element is shown
 *                                     at the print pose and on the platen for at least 2 frames; the ribbon lifts.
 *                               cycleStart -> the ribbon starts to lift. returnStart, linefeed -> the Return or Index key dips.
 *                               Other types (drive, space, backspace, shift, bell, motorOn, motorOff, ...) need no action:
 *                               the snapshot carries the carrier, element, keys, motor and switch. Unknown types are ignored.
 *     scene.setView(name, now)  name: one of scene.views ('machine' | 'line' | 'room'). Eased move of 1.1 s; now = true jumps.
 *                               'line' follows the carrier: the print point and the typed text to its left.
 *     scene.resize(w, h)        CSS pixels of the canvas. Pixel ratio = min(devicePixelRatio, 2).
 *     scene.pick(x, y)          CSS pixels from the top-left corner of the canvas. Returns an id or null:
 *                               'switch' (the On/Off rocker), 'player' (the turntable and hi-fi), 'sheet', 'machine'.
 *     scene.dispose()           frees the GPU objects and the renderer. The canvas can get a new scene after this.
 *   Sheet methods (the same as scene B; the page calls each one only if it exists):
 *     scene.newSheet()          takes the current sheet out and puts a blank one in. The next print is on the new sheet.
 *     scene.replay(prints)      draws an array of print events on the current sheet at once, with no part motion.
 *     scene.renderSheet(prints) returns a NEW HTMLCanvasElement: the full flat sheet, the paper and these prints.
 *   Extensions (the same as scene B):
 *     scene.views, scene.view, scene.orbit(dx, dy), scene.zoom(delta),
 *     scene.setMusic(on)        true: the platter turns at 33 1/3 rpm and the arm is on the disc. false: they stop.
 *     scene.setReady(on)        no action on this machine (the motor state comes from the snapshot). Kept for the page.
 *     scene.stats()             { frameMs, renderMs, calls, triangles, geometries, textures, sheetFull, sheetPatches }
 *     scene._debug              internal objects for checks in the browser tools. Not part of the interface.
 * ===================================================================================================================
 * Units: metres. The desk top is at y = 0. +z points to the typist, +x to the right. The sheet is centred on x = 0.
 * Values come from reference.md, section C. SOURCED values have the source number; GUESS marks values without a source.
 */
(function () {
'use strict';

function buildSceneC(THREE, canvas, options) {
options = options || {};
const E = options.engine, K = E.K, SNAP = E.SNAP, KEYS = E.KEYS, NB = KEYS.length;
const SEED = options.seed || 1;

/* ============================================ small tools ============================================ */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(SEED * 7919 + 29);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeIO = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function makeNoise(r) {                                   // smooth value noise on a 256 x 256 lattice
  const p = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) p[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const x0 = xi & 255, x1 = (xi + 1) & 255, y0 = (yi & 255) << 8, y1 = ((yi + 1) & 255) << 8;
    const a = p[y0 | x0], b = p[y0 | x1], c = p[y1 | x0], d = p[y1 | x1];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
const noise = makeNoise(rng(SEED * 31 + 11));
/* Monotone cubic interpolation (Fritsch-Carlson) through [x, y] points with x ascending: no overshoot at the steps of a profile. */
function pchip(pts) {
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {                       // limit the slopes (Fritsch-Carlson)
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const k = (lo + hi) >> 1; if (xs[k] <= x) lo = k; else hi = k; }
    const h = xs[hi] - xs[lo], t = (x - xs[lo]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi];
  };
}

/* ============================================ renderer ============================================ */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;       // filmic curve (Khronos PBR Neutral): white paper stays white, red stays red
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;          // r186: shadow.radius softens PCF
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3a3d3a);
const camera = new THREE.PerspectiveCamera(20, 1.6, 0.02, 30);
const disposables = [];
const keep = (o) => { disposables.push(o); return o; };

function canvasTex(c, srgb, wrap) {
  const t = keep(new THREE.CanvasTexture(c));
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = ANISO;
  return t;
}
function mottle(ctx, w, h, nx, ny, alpha, mode, r) {      // low-frequency blotches: a small random image drawn large
  const s = makeCanvas(nx, ny), x = s.getContext('2d'), d = x.createImageData(nx, ny);
  for (let i = 0; i < d.data.length; i += 4) { const v = r() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  x.putImageData(d, 0, 0);
  ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = mode; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(s, 0, 0, w, h); ctx.restore();
}
function grain(ctx, w, h, amp, r) {                       // per-pixel grain
  const d = ctx.getImageData(0, 0, w, h), a = d.data;
  for (let i = 0; i < a.length; i += 4) { const g = (r() - 0.5) * amp; a[i] += g; a[i + 1] += g; a[i + 2] += g; }
  ctx.putImageData(d, 0, 0);
}
/* Merge non-indexed copies of geometries (position, normal, uv) into one geometry. */
function merge(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += c;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return m;
}
/* Smooth the normals of a non-indexed geometry across edges below the crease angle (the extrude bevels are faceted). */
function smoothNormals(g, creaseDeg) {
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position.array, n = p.length / 3, fn = new Float32Array(n * 3), cosC = Math.cos(creaseDeg * Math.PI / 180);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromArray(p, i * 3); b.fromArray(p, i * 3 + 3); c.fromArray(p, i * 3 + 6);
    c.sub(b); a.sub(b); c.cross(a).normalize();
    for (let k = 0; k < 3; k++) c.toArray(fn, (i + k) * 3);
  }
  const map = new Map(), key = (i) => Math.round(p[i * 3] * 1e5) + ',' + Math.round(p[i * 3 + 1] * 1e5) + ',' + Math.round(p[i * 3 + 2] * 1e5);
  for (let i = 0; i < n; i++) { const k = key(i); let l = map.get(k); if (!l) map.set(k, l = []); l.push(i); }
  const out = new Float32Array(n * 3);
  for (const l of map.values()) for (const i of l) {
    let x = 0, y = 0, z = 0;
    for (const j of l) { const d = fn[i * 3] * fn[j * 3] + fn[i * 3 + 1] * fn[j * 3 + 1] + fn[i * 3 + 2] * fn[j * 3 + 2]; if (d >= cosC) { x += fn[j * 3]; y += fn[j * 3 + 1]; z += fn[j * 3 + 2]; } }
    const L = Math.hypot(x, y, z) || 1; out[i * 3] = x / L; out[i * 3 + 1] = y / L; out[i * 3 + 2] = z / L;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return g;
}
function roundRectShape(w, d, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  r = Math.max(1e-4, Math.min(r, w / 2 - 1e-5, d / 2 - 1e-5));
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
/* A box W x H x D (x, y, z) with round vertical corners (radius r) and a round bevel b on all edges. Centred. */
function rbox(w, h, d, r, b) {
  b = Math.min(b === undefined ? r * 0.5 : b, h / 2 - 1e-4, w / 2 - 1e-4, d / 2 - 1e-4);
  const g = new THREE.ExtrudeGeometry(roundRectShape(w - 2 * b, d - 2 * b, Math.max(1e-4, r - b)), {
    depth: Math.max(1e-5, h - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 4, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); g.translate(0, -(h - 2 * b) / 2, 0);
  return smoothNormals(g, 50);
}
/* A subdivided box with all edges rounded to radius r (a "spherified" box): dense enough to bend afterwards. */
function softBox(w, h, d, r, sx, sy, sz) {
  const g = new THREE.BoxGeometry(w, h, d, sx || 6, sy || 3, sz || 6), p = g.attributes.position, n = g.attributes.normal;
  const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r, v = V3(0, 0, 0), c = V3(0, 0, 0);
  for (let k = 0; k < p.count; k++) {
    v.set(p.getX(k), p.getY(k), p.getZ(k));
    c.set(clamp(v.x, -ix, ix), clamp(v.y, -iy, iy), clamp(v.z, -iz, iz));
    v.sub(c); const L = v.length() || 1; v.multiplyScalar(r / L);
    p.setXYZ(k, c.x + v.x, c.y + v.y, c.z + v.z); n.setXYZ(k, v.x / r, v.y / r, v.z / r);
  }
  return g;
}
/* Extrude a side profile: pts are [z, y] pairs; the solid has thickness t along x, centred on x = 0. */
function profileX(pts, t, b) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 8 });
  g.translate(0, 0, -(t - 2 * b) / 2); g.rotateY(Math.PI / 2);
  return smoothNormals(g, 45);
}
function lathe(pts, seg) { return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg || 40); }
function tube(points, radius, seg, closed, radial) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => V3(p[0], p[1], p[2])), !!closed, 'centripetal'), seg || 40, radius, radial || 10, !!closed);
}
function mk(geo, mat, parent, x, y, z, noShadow) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x || 0, y || 0, z || 0);
  m.castShadow = !noShadow; m.receiveShadow = true;
  if (parent) parent.add(m);
  keep(geo);
  return m;
}

/* ============================================ the sheet (owned by the scene) ============================================ */
const IN = 0.0254;                        // m in one inch
const PX = 200;                           // canvas pixels for one inch. CHOICE: letters stay sharp in the close view
const PXM = PX / IN;                      // canvas pixels for one metre
const COLW = PX / 10;                     // one letter space: 10 for each inch (2.54 mm). SOURCED [S20][S67]
const LINEH = PX / 6;                     // one line: 4.23 mm. GUESS (reference.md C1)
const SW = Math.round(8.5 * PX), SH = 11 * PX;   // sheet 8.5 x 11 in, standard in offices [S47]
const TOP_LINES = 6;                      // empty lines above the first typed line. CHOICE
const GW = 64, GH = 80;                   // size of the stamp and of the region that goes to the GPU, px
const sheet = makeCanvas(SW, SH), sc = sheet.getContext('2d');
(function paper() {                                       // white bond paper, #f7f5ee (GUESS, palette C4)
  const r = rng(SEED * 101 + 9);
  sc.fillStyle = '#f6f4ec'; sc.fillRect(0, 0, SW, SH);
  mottle(sc, SW, SH, 30, 40, 0.06, 'soft-light', r);
  mottle(sc, SW, SH, 160, 210, 0.05, 'soft-light', r);
  for (let i = 0; i < 9000; i++) {                       // fibres
    const x = r() * SW, y = r() * SH, a = r() * Math.PI * 2, l = 5 + r() * 22, bend = (r() - 0.5) * 9;
    sc.strokeStyle = r() < 0.5 ? 'rgba(130,128,118,' + (0.025 + r() * 0.035) + ')' : 'rgba(255,255,255,' + (0.10 + r() * 0.12) + ')';
    sc.lineWidth = 0.5 + r() * 0.8;
    sc.beginPath(); sc.moveTo(x, y);
    sc.quadraticCurveTo(x + Math.cos(a) * l / 2 - Math.sin(a) * bend, y + Math.sin(a) * l / 2 + Math.cos(a) * bend, x + Math.cos(a) * l, y + Math.sin(a) * l);
    sc.stroke();
  }
  grain(sc, SW, SH, 7, r);
})();
const paperBase = makeCanvas(SW, SH); paperBase.getContext('2d').drawImage(sheet, 0, 0);   // the blank paper, kept for new sheets and flat renders
const glyph = makeCanvas(GW, GH), gc = glyph.getContext('2d');
const patch = makeCanvas(GW, GH), pc = patch.getContext('2d');
/* Type face: the element prints Courier, a face that IBM made in 1955 for its typewriters (GUESS for the element on this
 * machine). Drawn with the system font "Courier New". Carbon film ribbon (CHOICE, [S20] gives cloth or carbon film): solid,
 * sharp, very even letters on exact columns; the darkness changes only a little with the print velocity. */
const FONT = '32px "Courier New", Courier, "Nimbus Mono L", "Liberation Mono", monospace';
let sheetTex = null, patchTex = null, uploadsFull = 0, uploadsPatch = 0;
const dstPos = new THREE.Vector2();
function stamp(ev, tc, quiet) {                         // tc: the 2D context to draw on (default: the live sheet). quiet: no texture upload
  const dc = tc || sc;
  const r = rng(ev.r >>> 0);
  const col = Math.round(ev.column), line = Math.round(ev.line);
  const cx = (K.LEFT_STOP + col + 0.5) * COLW + (r() - 0.5) * 0.25;
  const cy = (TOP_LINES + line) * LINEH + (r() - 0.5) * 0.25;
  if (cy - GH > SH) return;
  const f = typeof ev.force === 'number' ? ev.force : 0.8;
  const dark = clamp(0.90 + 0.10 * f + (r() - 0.5) * 0.04, 0.85, 1);
  gc.setTransform(1, 0, 0, 1, 0, 0); gc.globalCompositeOperation = 'source-over'; gc.globalAlpha = 1; gc.clearRect(0, 0, GW, GH);
  gc.translate(GW / 2, GH / 2);
  gc.font = FONT; gc.textAlign = 'center'; gc.textBaseline = 'alphabetic';
  gc.fillStyle = '#000'; gc.strokeStyle = '#000'; gc.lineWidth = 1.5 + f * 0.25; gc.lineJoin = 'round';
  gc.fillText(ev.ch, 0, 9); gc.strokeText(ev.ch, 0, 9);
  gc.setTransform(1, 0, 0, 1, 0, 0);
  gc.globalCompositeOperation = 'source-in'; gc.fillStyle = '#121214'; gc.fillRect(0, 0, GW, GH);
  const x0 = Math.round(cx - GW / 2), y0 = Math.round(cy - GH / 2);
  dc.save(); dc.globalCompositeOperation = 'multiply';
  dc.filter = 'blur(0.9px)'; dc.globalAlpha = 0.10 * dark; dc.drawImage(glyph, x0, y0);   // the carbon presses a little into the fibres
  dc.filter = 'blur(0.25px)'; dc.globalAlpha = dark; dc.drawImage(glyph, x0, y0);
  dc.restore();
  if (quiet || dc !== sc || !sheetTex) return;
  const px = clamp(x0, 0, SW - GW), py = clamp(y0, 0, SH - GH);
  pc.clearRect(0, 0, GW, GH); pc.drawImage(sheet, px, py, GW, GH, 0, 0, GW, GH);
  patchTex.needsUpdate = true;
  renderer.copyTextureToTexture(patchTex, sheetTex, null, dstPos.set(px, SH - py - GH));   // texSubImage2D of GW x GH px only
  uploadsPatch++;
}

/* ============================================ other textures ============================================ */
function bumpTex(size, seed, draw) { const c = makeCanvas(size, size), x = c.getContext('2d'); x.fillStyle = '#808080'; x.fillRect(0, 0, size, size); draw(x, rng(seed)); return canvasTex(c, false, true); }
const tPaperBump = bumpTex(512, SEED * 5 + 2, (x, r) => {
  mottle(x, 512, 512, 64, 64, 0.3, 'soft-light', r);
  for (let i = 0; i < 3000; i++) {
    const px = r() * 512, py = r() * 512, a = r() * Math.PI * 2, l = 4 + r() * 16;
    x.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.16)'; x.lineWidth = 0.6 + r();
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
  }
  grain(x, 512, 512, 36, r);
});
/* Textured paint of the Selectric covers: a fine stipple (GUESS: the covers have a low-gloss textured finish) */
const tStipple = (function () {
  const S = 512, c = makeCanvas(S, S), x = c.getContext('2d'), d = x.createImageData(S, S), r = rng(SEED * 7 + 3), nz = makeNoise(r);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const v = 0.5 + 0.55 * (nz(i * 0.55, j * 0.55) - 0.5) + 0.35 * (nz(i * 0.21 + 50, j * 0.21) - 0.5) + (r() - 0.5) * 0.12;
    const k = (j * S + i) * 4; d.data[k] = d.data[k + 1] = d.data[k + 2] = clamp(v * 255, 0, 255); d.data[k + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return canvasTex(c, false, true);
})();
function smudgeTex() {                                     // finger marks and fine scratches (roughness)
  const c = makeCanvas(512, 512), x = c.getContext('2d'), r = rng(SEED * 13 + 8);
  x.fillStyle = 'rgb(46,46,46)'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 22; i++) {
    const px = r() * 512, py = r() * 512, rad = 12 + r() * 40, g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, 'rgba(120,120,120,' + (0.2 + r() * 0.3) + ')'); g.addColorStop(1, 'rgba(120,120,120,0)');
    x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 140; i++) {
    x.strokeStyle = 'rgba(150,150,150,' + (0.06 + r() * 0.16) + ')'; x.lineWidth = 0.6;
    const px = r() * 512, py = r() * 512, a = r() * Math.PI, l = 10 + r() * 60;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
  }
  grain(x, 512, 512, 14, r);
  return canvasTex(c, false, true);
}
function brushedTex() {                                    // brushed aluminium: fine lines along u
  const c = makeCanvas(512, 64), x = c.getContext('2d'), r = rng(SEED * 15 + 4);
  x.fillStyle = 'rgb(128,128,128)'; x.fillRect(0, 0, 512, 64);
  for (let j = 0; j < 64; j++) { x.fillStyle = 'rgba(' + (r() < 0.5 ? '255,255,255' : '0,0,0') + ',' + (0.05 + r() * 0.12) + ')'; x.fillRect(0, j, 512, 1); }
  return canvasTex(c, false, true);
}
function woodCanvas(w, h, seed, base, dark, light, rings) {   // walnut: straight grain with soft figure
  const c = makeCanvas(w, h), x = c.getContext('2d'), d = x.createImageData(w, h), r = rng(seed), nz = makeNoise(r);
  const cb = new THREE.Color(base), cd = new THREE.Color(dark), cl = new THREE.Color(light), out = new THREE.Color();
  const pores = new Float32Array(h); for (let j = 0; j < h; j++) pores[j] = r();
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = i / w, v = j / h;
    const warp = (nz(u * 3, v * 5) - 0.5) * 0.9 + (nz(u * 11 + 40, v * 23) - 0.5) * 0.12;
    const t = (v + warp * 0.10) * rings;
    let band = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 + nz(u * 2, v * 40) * 2.5);
    band = Math.pow(band, 1.3);
    const fig = nz(u * 8, v * 2.0);
    const pore = pores[(j + Math.floor(nz(u * 4, v * 2) * 9)) % h] < 0.06 ? 0.8 : 1;
    const streak = 0.84 + 0.18 * nz(u * 60, v * 900) + 0.06 * nz(u * 7, v * 260);
    out.copy(cd).lerp(cb, 0.55 + 0.45 * band).lerp(cl, Math.max(0, fig - 0.6) * 0.8);
    const k = (j * w + i) * 4, m = pore * streak;
    d.data[k] = clamp(out.r * 255 * m, 0, 255); d.data[k + 1] = clamp(out.g * 255 * m, 0, 255); d.data[k + 2] = clamp(out.b * 255 * m, 0, 255); d.data[k + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return c;
}
const tSmudge = smudgeTex(), tBrushed = brushedTex();
tPaperBump.repeat.set(7, 9);
const walnutC = woodCanvas(1024, 1024, SEED * 23 + 5, '#6b4a2f', '#4a3020', '#8f6a45', 34);   // oiled walnut [S39][S46], palette #6b4a2f
const tWalnut = canvasTex(walnutC, true, true), tWalnutBump = canvasTex(walnutC, false, true);

/* ============================================ materials ============================================ */
/* Body colour: red, one of the colours of a 1961 machine [S17] (palette #b02a25). CHOICE among the 3 sourced colours:
 * red separates the machine from the grey steel desk best. The paint colour is in the vertex colours of the shell. */
const PAINT = new THREE.Color(0xb02a25), WELL = new THREE.Color(0x1d1d1e);
const MAT = {};
MAT.paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.46, bumpMap: tStipple, bumpScale: 0.22,
  clearcoat: 0.42, clearcoatRoughness: 0.9, clearcoatRoughnessMap: tSmudge });   // the map holds 0.18 to 0.5: satin with finger marks
MAT.paintPart = new THREE.MeshPhysicalMaterial({ color: PAINT, roughness: 0.46, bumpMap: tStipple, bumpScale: 0.22, clearcoat: 0.42, clearcoatRoughness: 0.2 });
MAT.chrome = new THREE.MeshStandardMaterial({ color: 0xdadde0, metalness: 1, roughness: 0.09, roughnessMap: tSmudge });   // chrome [S18], palette #cfd2d4
MAT.satin = new THREE.MeshStandardMaterial({ color: 0xb6b9bc, metalness: 1, roughness: 0.3 });
MAT.dark = new THREE.MeshStandardMaterial({ color: 0x2c2d2f, metalness: 0.55, roughness: 0.48 });   // mechanism under the covers. GUESS
MAT.black = new THREE.MeshPhysicalMaterial({ color: 0x141414, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.25 });   // black moulded plastic
MAT.matte = new THREE.MeshStandardMaterial({ color: 0x0e0e0f, roughness: 0.85 });
MAT.rubber = new THREE.MeshPhysicalMaterial({ color: 0x151515, roughness: 0.66, sheen: 0.45, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x34363a) });
MAT.paper = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, bumpMap: tPaperBump, bumpScale: 0.06, side: THREE.DoubleSide });
MAT.walnut = new THREE.MeshPhysicalMaterial({ map: tWalnut, bumpMap: tWalnutBump, bumpScale: 0.35, roughness: 0.55, clearcoat: 0.18, clearcoatRoughness: 0.4 });   // oiled finish [S39]
MAT.chrome.envMapIntensity = 1.6; MAT.satin.envMapIntensity = 1.4;
for (const k in MAT) keep(MAT[k]);
/* Soft dark patch under an object: the light that it blocks from the room. One plane with a soft texture: black colour, the
 * shape in the alpha of the map. (The earlier attempt failed because an alphaMap reads the GREEN channel, and a canvas drawn
 * in black rgba has green 0 everywhere, so the alpha was 0. The alpha of the map itself is the right channel.) */
function blobTex(rect) {
  const c = makeCanvas(128, 128), x = c.getContext('2d');
  if (rect) { x.filter = 'blur(9px)'; x.fillStyle = '#000'; x.beginPath(); x.roundRect(18, 18, 92, 92, 16); x.fill(); }   // dark over the middle 72 %, then a soft fringe
  else { const g = x.createRadialGradient(64, 64, 2, 64, 64, 63); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.6, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); }
  return canvasTex(c, false, false);
}
const tBlobR = blobTex(true), tBlobO = blobTex(false), blobMats = new Map();
const blobMat = (o, rect) => { const k = Math.round(o * 100) + (rect ? 'r' : 'o'); if (!blobMats.has(k)) blobMats.set(k, keep(new THREE.MeshBasicMaterial({ color: 0x000000, map: rect ? tBlobR : tBlobO, transparent: true, opacity: o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -2 }))); return blobMats.get(k); };
function contactShadow(parent, x, z, w, d, o, rect, y, rot) {
  const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, d)), blobMat(Math.min(1, o * 0.95), rect)); m.renderOrder = 1; m.raycast = () => {};
  m.rotation.x = -Math.PI / 2; if (rot) m.rotation.z = rot; m.position.set(x, (y || 0) + 0.0004, z);
  parent.add(m); return m;
}

/* ============================================ light and environment ============================================ */
/* The motivated light: a ceiling fixture with fluorescent tubes behind a diffuser, above the desk (GUESS fixture).
 * Colour: cool white fluorescent, 4100 to 5000 K [S48][S66]. CHOICE: about 4300 K, shown as a camera balanced for daylight
 * would show it; tint #f4efe2 (my estimate). Mood CHOICE: a bright daytime office, blinds closed against the sun.
 * Reflections come from a code-made room in the environment map: the diffusers are bright rectangles in it. */
const FLUO = new THREE.Color(0xf4efe2), DAY = new THREE.Color(0xcfdcff);
const FLOOR = -0.737;                                      // desk height 737 mm (29 in). GUESS (reference.md C3)
const CEIL = FLOOR + 2.74;                                 // ceiling 2.74 m above the floor. GUESS
const WALL_Z = -1.12, WALL_R = 2.05, WALL_L = -2.4;        // the room. GUESS
(function environment() {
  const env = new THREE.Scene(), box = new THREE.BoxGeometry(1, 1, 1), plane = new THREE.PlaneGeometry(1, 1);
  const basic = (c, side) => new THREE.MeshBasicMaterial({ color: c, side: side || THREE.FrontSide });
  const room = new THREE.Mesh(box, basic(new THREE.Color(0.30, 0.31, 0.28), THREE.BackSide));
  room.scale.set(WALL_R - WALL_L, CEIL - FLOOR, 3.4); room.position.set((WALL_R + WALL_L) / 2, (CEIL + FLOOR) / 2, WALL_Z + 1.7); env.add(room);
  const add = (w, h, x, y, z, c, rx, ry) => { const m = new THREE.Mesh(plane, basic(c, THREE.DoubleSide)); m.scale.set(w, h, 1); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); env.add(m); return m; };
  add(4.4, 3.4, 0.0, FLOOR + 0.01, WALL_Z + 1.7, new THREE.Color(0.16, 0.16, 0.15), -Math.PI / 2);          // floor tiles
  add(4.4, 3.4, 0.0, CEIL - 0.01, WALL_Z + 1.7, new THREE.Color(0.42, 0.42, 0.40), Math.PI / 2);            // acoustic tile ceiling
  for (const [x, z] of [[-0.45, -0.5], [-0.45, 1.0], [1.3, -0.5], [1.3, 1.0], [-2.0, -0.5], [-2.0, 1.0], [-0.45, 2.4]])
    add(0.34, 1.25, x, CEIL - 0.03, z, new THREE.Color(9.0, 8.8, 8.1), Math.PI / 2, Math.PI / 2);       // diffusers of the tube fixtures
  for (let k = 0; k < 14; k++) add(1.5, 0.07, -0.9, FLOOR + 0.92 + k * 0.1, WALL_Z + 0.02, new THREE.Color(2.4, 2.6, 3.0));   // daylight between the slats
  add(0.9, 0.5, 1.2, FLOOR + 0.6, WALL_Z + 0.25, new THREE.Color(0.08, 0.05, 0.03));                      // the walnut hi-fi
  add(1.6, 0.8, 0, FLOOR + 0.35, -0.08, new THREE.Color(0.10, 0.11, 0.105));                              // the desk below the top
  add(1.5, 0.75, 0, 0.0, -0.08, new THREE.Color(0.10, 0.12, 0.11), -Math.PI / 2);                         // desk top
  add(2.0, 2.0, 0.3, 0.6, 2.6, new THREE.Color(0.22, 0.22, 0.21));                                        // the room behind the typist
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.02, 0.05, 20);
  scene.environment = rt.texture; scene.environmentIntensity = 0.5;
  keep(rt); pm.dispose(); box.dispose(); plane.dispose(); env.traverse((o) => o.material && o.material.dispose());
})();
const key = new THREE.DirectionalLight(FLUO, 1.9);         // the fixture above the desk; tuned by eye
key.position.set(-0.55, 1.75, -0.45); key.target.position.set(0, 0, -0.06);   // above the desk, a little behind and left: the shadows fall toward the typist
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -0.95, right: 0.95, top: 0.75, bottom: -0.75, near: 0.6, far: 3.6 });
key.shadow.bias = -0.00025; key.shadow.normalBias = 0; key.shadow.radius = 7;    // no normal bias: the two-sided sheet would shadow itself
scene.add(key, key.target);
const key2 = new THREE.DirectionalLight(FLUO, 0.7); key2.position.set(0.4, 2.0, 1.7); scene.add(key2);   // the next fixture, over the typist: no shadow
const fill = new THREE.HemisphereLight(0xe8ecee, 0x4b4d48, 0.28); scene.add(fill);   // light from the ceiling and the walls
const day = new THREE.DirectionalLight(DAY, 0.45); day.position.set(-1.2, 1.1, -2.2); scene.add(day);   // daylight through the blinds, behind the machine
const spillW = new THREE.SpotLight(DAY, 4, 6, 1.1, 1, 2); spillW.position.set(-0.92, FLOOR + 1.6, WALL_Z + 0.05); spillW.target.position.set(0.2, FLOOR, 0.9); scene.add(spillW, spillW.target);   // the same daylight: its fall-off on the floor and walls
/* Low afternoon sun through the nearly closed blinds of a second window in the left wall (out of the pictures; GUESS, the
 * reference has only "venetian blinds on a wide window"): soft bright stripes across the back wall and the desk, strongest in
 * the middle and falling off to the sides. The stripes are the light's colour map (a cookie); the light has no shadow. */
const sun = new THREE.SpotLight(0xfff0d6, 130, 0, 0.5, 0.5, 2);   // tuned by eye; the fixture and fill are a little lower for it
{
  const c = makeCanvas(512, 512), x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 512, 512); x.filter = 'blur(3px)'; x.fillStyle = '#fff';
  for (let k = 0; k < 40; k++) x.fillRect(0, 4 + k * 13, 512, 7);         // the gaps between the slats, tilted almost closed
  sun.map = canvasTex(c, true, false);
}
sun.position.set(WALL_L + 0.1, FLOOR + 2.0, 0.5); sun.target.position.set(0.0, -0.05, -0.45); scene.add(sun, sun.target);

/* ============================================ the typewriter ============================================ */
/* IBM Selectric, model 721 [S16]: 470 W x 356 D x 171 H mm [S17] (CHOICE: the 171 mm of [S17], not the 190 mm of [S18]).
 * One smooth shell that narrows toward the front, keyboard set into it with a gradual slope [S18][S22]. Shape of the
 * shell, the open slot for the carrier and the platen: GUESS (reference.md C1). */
const MZ = 0.02;
const machine = new THREE.Group(); machine.position.set(0, 0, MZ); machine.userData.pick = 'machine'; scene.add(machine);
const body = new THREE.Group(); machine.add(body);          // the covers and keys: they hum with the motor
const SB = 0.009;                                          // bottom of the shell; rubber feet below it [S18], height GUESS
const ZF = 0.178, ZB = -0.178;
const halfW = (z) => 0.212 - 0.008 * smooth(-0.03, ZF, z); // narrows toward the front [S18]; amount GUESS
const RS = 0.020, RE_F = 0.013, RE_B = 0.032;              // edge radii. GUESS ("no corners" [S18])
const WELL_X = 0.150, CH_X = 0.172;                        // half widths of the keyboard well and of the carrier slot. GUESS
const deck = (z) => 0.036 + (0.158 - z) * 0.27;            // floor of the keyboard well: 15 degrees. GUESS
const dz = [0.08, 0.11, 0.14];
const Hmid = pchip([[-0.178, 0.100], [-0.165, 0.113], [-0.150, 0.118], [-0.138, 0.116], [-0.131, 0.106], [-0.126, 0.072], [-0.121, 0.062],
  [-0.057, 0.062], [-0.052, 0.074], [-0.046, 0.088], [-0.036, 0.096], [-0.020, 0.100], [0.000, 0.098], [0.027, 0.088], [0.031, 0.0835],
  [0.040, 0.081], [0.050, 0.079], [0.055, 0.073], [0.059, deck(0.059)], ...dz.map((z) => [z, deck(z)]), [0.158, deck(0.158)],
  [0.162, 0.041], [0.166, 0.047], [0.170, 0.049], [0.178, 0.049]]);
const Hside = pchip([[-0.178, 0.100], [-0.165, 0.116], [-0.150, 0.124], [-0.120, 0.130], [-0.070, 0.130], [-0.045, 0.124], [-0.020, 0.111],
  [0.000, 0.102], [0.028, 0.0895], [0.040, 0.083], [0.050, 0.080], [0.060, deck(0.060) + 0.013], ...dz.map((z) => [z, deck(z) + 0.013]),
  [0.158, deck(0.158) + 0.013], [0.166, 0.050], [0.178, 0.050]]);
const xa = (z) => WELL_X + (CH_X - WELL_X) * smooth(0.062, 0.045, z);
const shellH = (x, z) => { const a = xa(z); return Hmid(z) + (Hside(z) - Hmid(z)) * smooth(a - 0.006, a + 0.006, Math.abs(x)); };
const wellMask = (z) => smooth(0.052, 0.058, z) * smooth(0.168, 0.161, z), chanMask = (z) => smooth(-0.046, -0.054, z) * smooth(-0.130, -0.123, z);
(function shell() {
  const XS = [];                                           // |x| samples of the top: fine where the walls are
  for (let x = 0; x < 0.1395; x += 0.008) XS.push(x);
  for (let x = 0.140; x < 0.1785; x += 0.0015) XS.push(x);
  const zs = [];
  for (let z = ZB + RE_B; z <= ZF - RE_F + 1e-9; z += 0.0025) zs.push([z, 0]);
  for (const f of [-0.131, -0.126, -0.121, -0.057, -0.052, -0.046, 0.0295, 0.055, 0.059, 0.158, 0.162, 0.166, -0.045, 0.045, 0.062])
    for (let k = -5; k <= 5; k++) { const z = f + k * 0.001; if (z > ZB + RE_B && z < ZF - RE_F) zs.push([z, 0]); }
  for (let k = 1; k <= 10; k++) { const a = k / 10 * Math.PI / 2; zs.push([ZF - RE_F + RE_F * Math.sin(a), RE_F * (1 - Math.cos(a))]); zs.push([ZB + RE_B - RE_B * Math.sin(a), RE_B * (1 - Math.cos(a))]); }
  zs.sort((a, b) => a[0] - b[0]);
  const rings = zs.filter((v, i) => i === 0 || v[0] - zs[i - 1][0] > 2e-4);
  const outline = (z) => {                                 // [x, y] from the bottom of the left side, over the top, to the bottom of the right side
    const W = halfW(z), xe = W - RS, he = shellH(xe, z), o = [[-W, SB]];
    for (let k = 0; k <= 8; k++) { const a = Math.PI - k / 8 * Math.PI / 2; o.push([-xe + RS * Math.cos(a), he - RS + RS * Math.sin(a)]); }
    const tail = []; for (let k = 1; k <= 3; k++) tail.push(0.1785 + (xe - 0.1785) * k / 4);
    const half = XS.concat(tail);
    for (let i = half.length - 1; i >= 0; i--) o.push([-half[i], shellH(-half[i], z)]);
    for (let i = 1; i < half.length; i++) o.push([half[i], shellH(half[i], z)]);
    for (let k = 0; k <= 8; k++) { const a = Math.PI / 2 - k / 8 * Math.PI / 2; o.push([xe + RS * Math.cos(a), he - RS + RS * Math.sin(a)]); }
    o.push([W, SB]);
    return o;
  };
  const inset = (o, e) => {
    if (e <= 0) return o;
    return o.map((p, i) => {
      const a = o[Math.max(0, i - 1)], b = o[Math.min(o.length - 1, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty) || 1;
      return [p[0] + ty / L * e, Math.max(SB, p[1] - tx / L * e)];
    });
  };
  const lean = (x, y, z) => {                              // the sides and the front lean in toward the top: a pebble, not a box. GUESS
    const h = Math.max(0, y - SB), ax = Math.abs(x);
    return [x - Math.sign(x) * 0.10 * h * smooth(0.13, 0.20, ax), y, z - 0.30 * h * smooth(0.150, 0.178, z) + 0.22 * h * smooth(-0.150, -0.178, z)];
  };
  const NR = rings.length, NP = outline(0).length, pos = new Float32Array(NR * NP * 3), col = new Float32Array(NR * NP * 3), uv = new Float32Array(NR * NP * 2);
  const c = new THREE.Color();
  const tint = (x, y, z, out) => {                         // paint colour, the dark inside of the openings, and a little occlusion
    const hs = Hside(z), depth = hs - y, onTop = Math.abs(x) < halfW(z) - RS * 0.6;
    let d = onTop ? smooth(0.003, 0.010, depth) * Math.max(wellMask(z), chanMask(z)) : 0;
    let ao = 1 - (onTop ? 0.45 * smooth(0.0, 0.022, depth) : 0);
    if (onTop && Math.abs(x) < CH_X + 0.004 && z < 0.035 && z > -0.05) ao *= 1 - 0.55 * Math.exp(-Math.pow((z - 0.0295) / 0.0009, 2));   // seam: front edge of the top cover
    if (onTop && z < 0.03 && z > -0.045) ao *= 1 - 0.45 * Math.exp(-Math.pow((Math.abs(x) - CH_X - 0.0045) / 0.0013, 2)) * smooth(-0.045, -0.035, z);   // seams at the side covers
    ao *= 0.55 + 0.45 * smooth(SB, SB + 0.03, y);          // the lower sides get less light from the room
    out.copy(PAINT).lerp(WELL, d).multiplyScalar(ao);
  };
  for (let i = 0; i < NR; i++) {
    const [z, e] = rings[i], o = inset(outline(z), e);
    for (let j = 0; j < NP; j++) {
      const k = i * NP + j, x = o[j][0], y = o[j][1], q = lean(x, y, z);
      pos[k * 3] = q[0]; pos[k * 3 + 1] = q[1]; pos[k * 3 + 2] = q[2];
      tint(x, y, z, c); col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      uv[k * 2] = (x + 0.7 * y) * 8.5; uv[k * 2 + 1] = (z - 0.7 * y) * 8.5;
    }
  }
  const idx = [];
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NP - 1; j++) { const a = i * NP + j, b = a + NP; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const mid = Math.floor(NR / 2) * NP + Math.floor(NP / 2);
  if (g.attributes.normal.getY(mid) < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  mk(g, MAT.paint, body);
  for (const [i, sgn] of [[NR - 1, 1], [0, -1]]) {           // the end faces: flat caps inside the rounded edge
    const z = rings[i][0], o = inset(outline(z), rings[i][1]);
    const tri = THREE.ShapeUtils.triangulateShape(o.map((p) => new THREE.Vector2(p[0], p[1])), []);
    const cp = [], cc = [], cn = [], cu = [];
    for (const t of tri) for (const v of (sgn > 0 ? t : [t[0], t[2], t[1]])) {
      const q = lean(o[v][0], o[v][1], z); cp.push(q[0], q[1], q[2]); cn.push(0, 0, sgn); tint(o[v][0], o[v][1], z, c); cc.push(c.r, c.g, c.b); cu.push((o[v][0] + 0.7 * o[v][1]) * 8.5, (z - 0.7 * o[v][1]) * 8.5);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cg.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3));
    cg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
    cg.computeVertexNormals();
    const m = mk(cg, MAT.paint, body); m.userData.cap = sgn;
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mk(new THREE.CylinderGeometry(0.009, 0.010, SB, 20), MAT.matte, machine, sx * 0.175, SB / 2, sz * 0.145);   // rubber feet [S18]
})();
contactShadow(machine, 0, 0.005, 0.60, 0.50, 0.85, true);

/* ---- keys: 44 character keys in rows of 12, 11, 11, 10 [S19] (row split GUESS), black with white letters [S18], sculptured
 * tops [S22]. Square tops 13.5 mm at 19 mm spacing (GUESS). Back row first. Control keys (names [S21][S22], places GUESS):
 * left MAR REL, TAB, LOCK, SHIFT; right BACK SPACE, INDEX, RETURN, SHIFT. ---- */
const KU = 0.019, KCAP = 0.0135, KH = 0.0085;
const ROWZ = [0.076, 0.095, 0.114, 0.133], ROWOFF = [0, 0.5, 0.75, 1.25], ROWTILT = [0.38, 0.31, 0.25, 0.19];
const X0 = -6.25 * KU;
const keyTop = (z) => deck(z) + 0.0165;
const keyPos = [];                                         // [x, y, z, width in key units, row]
for (let r = 0, i = 0; r < 4; r++) for (let k = 0; k < E.ROWS[r]; k++, i++) { const z = ROWZ[r]; keyPos.push([X0 + (k + 0.5 + ROWOFF[r]) * KU, keyTop(z), z, 1, r]); }
const CTRL = [['MAR', 'REL', 0, -1, 1], ['TAB', '', 1, -1, 1.5], ['LOCK', '', 2, -1, 1.75], ['SHIFT', '', 3, -1, 2.25],
  ['BACK', 'SPACE', 0, 1, 1.5], ['INDEX', '', 1, 1, 2.0], ['RETURN', '', 2, 1, 1.75], ['SHIFT', '', 3, 1, 2.25]];
for (const [, , r, side, w] of CTRL) {
  const z = ROWZ[r], x = side < 0 ? X0 + ROWOFF[r] * KU - w * KU / 2 : X0 + (E.ROWS[r] + ROWOFF[r]) * KU + w * KU / 2;
  keyPos.push([x, keyTop(z), z, w, r]);
}
const NK = keyPos.length, K_RET = NB + 6, K_IDX = NB + 5;
const atlas = makeCanvas(1024, 1024);
(function legends() {
  const x = atlas.getContext('2d'), C = 128;
  for (let i = 0; i < 64; i++) {
    const cx = (i % 8) * C + C / 2, cy = Math.floor(i / 8) * C + C / 2;
    const g = x.createLinearGradient(cx, cy - C / 2, cx, cy + C / 2);
    g.addColorStop(0, '#1d1d1e'); g.addColorStop(1, '#141415');
    x.fillStyle = g; x.fillRect(cx - C / 2, cy - C / 2, C, C);
  }
  x.fillStyle = '#ecebe4'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const fam = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  for (let i = 0; i < NK; i++) {
    const cx = (i % 8) * C + C / 2, cy = Math.floor(i / 8) * C + C / 2;
    x.save(); x.translate(cx, cy);
    if (i < NB) {
      const lo = KEYS[i][1], up = KEYS[i][2];
      if (/[a-z]/.test(lo)) { x.font = '500 50px ' + fam; x.fillText(up, 0, 2); }
      else if (lo === up) { x.font = '500 54px ' + fam; x.fillText(lo, 0, -6); }
      else { x.font = '500 36px ' + fam; x.fillText(up, 0, -22); x.fillText(lo, 0, 22); }
    } else {
      const c = CTRL[i - NB]; x.scale(1 / c[4] * 1.15, 1); x.font = '600 23px ' + fam;
      if (c[1]) { x.fillText(c[0], 0, -13); x.fillText(c[1], 0, 15); } else x.fillText(c[0], 0, 0);
    }
    x.restore();
  }
})();
const tAtlas = canvasTex(atlas, true, false);
const capMat = keep(new THREE.MeshPhysicalMaterial({ map: tAtlas, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.22 }));
capMat.onBeforeCompile = (sh) => {                         // each instance reads its own cell of the legend atlas
  sh.vertexShader = 'attribute vec2 aCell;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vMapUv * 0.125 + aCell;\n#endif');
};
const capGeo = (function () {                              // tapered skirt, dished top (a shallow cylinder across the key)
  const g = softBox(KCAP, KH, KCAP, 0.0017, 8, 3, 8), p = g.attributes.position, n = g.attributes.normal, uvA = g.attributes.uv, hw = KCAP / 2;
  for (let k = 0; k < p.count; k++) {
    let x = p.getX(k), y = p.getY(k) - KH / 2, z = p.getZ(k);
    const top = n.getY(k) > 0.7 && y > -0.0006;
    const s = 1 + 0.12 * (-y / KH); x *= s; z *= s;
    if (top) {
      const u = clamp(x / hw, -1, 1); y -= 0.0007 * (1 - u * u);
      const sl = 0.0007 * 2 * u / hw, L = Math.hypot(sl, 1); n.setXYZ(k, sl / L, 1 / L, 0);
      uvA.setXY(k, clamp(x / KCAP + 0.5, 0.02, 0.98), clamp(0.5 - z / KCAP, 0.02, 0.98));
    } else uvA.setXY(k, 0.03, 0.03);
    p.setXYZ(k, x, y, z);
  }
  return g;
})();
const caps = new THREE.InstancedMesh(keep(capGeo), capMat, NK);
const cells = new Float32Array(NK * 2);
for (let i = 0; i < NK; i++) { cells[i * 2] = (i % 8) / 8; cells[i * 2 + 1] = 1 - (Math.floor(i / 8) + 1) / 8; }
capGeo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
const stems = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.0035, 1, 0.0035).translate(0, -0.5, 0)), MAT.dark, NK);
for (const im of [caps, stems]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; body.add(im); }
const mtx = new THREE.Matrix4(), q0 = new THREE.Quaternion(), sv = V3(1, 1, 1), tv = V3(0, 0, 0), xAx = V3(1, 0, 0);
const keyDip = new Float32Array(NK), keyShown = new Float32Array(NK).fill(-1);
function placeKey(i) {
  const [x, y, z, w, r] = keyPos[i], d = keyDip[i] * 0.0042;
  q0.setFromAxisAngle(xAx, ROWTILT[r]);
  mtx.compose(tv.set(x, y - d, z), q0, sv.set((w * KU - (KU - KCAP)) / KCAP, 1, 1)); caps.setMatrixAt(i, mtx);
  const top = y - d - KH + 0.001, bot = deck(z);
  mtx.compose(tv.set(x, top, z), q0.identity(), sv.set(1, Math.max(0.001, top - bot), 1)); stems.setMatrixAt(i, mtx);
}
for (let i = 0; i < NK; i++) placeKey(i);
const spaceBar = new THREE.Group(); body.add(spaceBar);    // space bar [S21][S22]
{ const sb = mk(softBox(0.150, 0.0068, 0.0115, 0.0022, 12, 2, 2), MAT.black, spaceBar, 0, keyTop(0.150) - 0.0045, 0.150); sb.rotation.x = 0.16;
  for (const s of [-1, 1]) mk(new THREE.BoxGeometry(0.004, 0.012, 0.004), MAT.dark, spaceBar, s * 0.06, deck(0.15) + 0.006, 0.150); }
let spaceDip = 0;

/* ---- On/Off: a rocker at the right side of the keyboard; top = ON, bottom = OFF; a red band shows at the bottom when ON [S21] ---- */
const SWZ = 0.100, SWX = 0.170;
const swG = new THREE.Group(); swG.position.set(SWX, deck(SWZ) + 0.013, SWZ); swG.rotation.x = 0.26; swG.userData.pick = 'switch'; body.add(swG);
mk(rbox(0.0175, 0.003, 0.028, 0.003, 0.001), MAT.matte, swG, 0, -0.0006, 0);                       // bezel
const rocker = new THREE.Group(); rocker.position.y = 0.0004; swG.add(rocker);
mk(softBox(0.0125, 0.0042, 0.0225, 0.0016, 4, 2, 6), MAT.black, rocker, 0, 0.0005, 0);
const redBand = mk(new THREE.BoxGeometry(0.011, 0.0034, 0.0012), keep(new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.5, emissive: 0x300404 })), rocker, 0, -0.0004, 0.0108);
const swHit = new THREE.Mesh(keep(new THREE.BoxGeometry(0.03, 0.02, 0.04)), keep(new THREE.MeshBasicMaterial({ visible: false }))); swG.add(swHit);
let swAng = 0;
/* TAB SET / CLR: the tenth control key [S19][S21]; place and shape GUESS: a rocker on the left cheek, the mirror of On/Off */
{ const tg = new THREE.Group(); tg.position.set(-SWX, deck(SWZ) + 0.013, SWZ); tg.rotation.x = 0.26; body.add(tg);
  mk(rbox(0.0175, 0.003, 0.028, 0.003, 0.001), MAT.matte, tg, 0, -0.0006, 0);
  const t2 = mk(softBox(0.0125, 0.0042, 0.0225, 0.0016, 4, 2, 6), MAT.black, tg, 0, 0.0009, 0); t2.rotation.x = 0.05; }

/* ---- margin scale: chrome, directly above the keyboard, with 2 margin stops [S18][S21][S22]; a red pointer moves with the carrier (GUESS) ---- */
const IN11 = 11 * IN, PITCH = IN / 10, LINE_M = IN / 6;
const SHEET_WM = SW / PXM, SHEET_LM = SH / PXM;
const colX = (c) => -SHEET_WM / 2 + (K.LEFT_STOP + c + 0.5) * PITCH;   // x of a column of the engine
{
  const c = makeCanvas(2048, 64), x = c.getContext('2d'), w = 0.296;
  const g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, '#f2f2f0'); g.addColorStop(0.5, '#c4c6c8'); g.addColorStop(1, '#8f9294'); x.fillStyle = g; x.fillRect(0, 0, 2048, 64);
  x.fillStyle = '#151515'; x.font = 'bold 21px Arial, sans-serif'; x.textAlign = 'center';
  for (let m = 0; m <= 110; m++) {
    const lx = -IN11 / 2 + m * PITCH, px = (lx + w / 2) / w * 2048;
    const h = m % 10 === 0 ? 26 : m % 5 === 0 ? 18 : 11; x.fillRect(px - 1.1, 0, 2.2, h);
    if (m % 10 === 0) x.fillText(String(m), px, 56);
  }
  const t = canvasTex(c, true);
  const sm = mk(new THREE.PlaneGeometry(w, 0.0085), keep(new THREE.MeshStandardMaterial({ map: t, metalness: 0.9, roughness: 0.22 })), body, 0, Hmid(0.0455) + 0.0007, 0.0455, true);
  sm.rotation.x = -Math.PI / 2 + 0.2;
  for (const cc of [0, K.LINE_COLS]) mk(rbox(0.004, 0.003, 0.010, 0.001, 0.0008), MAT.chrome, body, colX(cc), Hmid(0.0455) + 0.0018, 0.0455);   // margin stops
}
const pointer = mk(new THREE.ConeGeometry(0.0022, 0.006, 3).rotateX(-Math.PI / 2 + 0.2), keep(new THREE.MeshStandardMaterial({ color: 0xc02020, roughness: 0.4 })), body, 0, Hmid(0.050) + 0.0016, 0.0505, true);

/* IBM logo plate at the centre front [S18] */
{
  const c = makeCanvas(256, 80), x = c.getContext('2d');
  x.fillStyle = '#101010'; x.fillRect(0, 0, 256, 80);
  x.fillStyle = '#e8e8e8'; x.font = 'bold 60px Rockwell, "Courier New", Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('IBM', 128, 43);
  const fz = ZF - 0.30 * (0.025 - SB), lean = Math.atan(0.30);   // the front face leans back (see the shell)
  const pl = mk(rbox(0.036, 0.0115, 0.0016, 0.0015, 0.0005), MAT.chrome, body, 0, 0.025, fz + 0.0006);
  pl.rotation.x = -lean;
  const lb = mk(new THREE.PlaneGeometry(0.032, 0.0098), keep(new THREE.MeshStandardMaterial({ map: canvasTex(c, true), metalness: 0.6, roughness: 0.3 })), body, 0, 0.025, fz + 0.0015, true);
  lb.rotation.x = -lean;
}

/* ---- platen: fixed in place, does not move sideways [S16][S19]; knobs at both ends [S18][S22]. 11 in paper [S16]. Sizes GUESS ---- */
const PR = 0.019, PC = V3(0, 0.116, -0.100), TH_P = 0;     // platen radius and centre; print point at the front, level with the centre. GUESS
const P = V3(0, PC.y + PR * Math.sin(TH_P), PC.z + PR * Math.cos(TH_P));
const platen = new THREE.Group(); platen.position.copy(PC); machine.add(platen);
mk(new THREE.CylinderGeometry(PR, PR, 0.300, 80, 1).rotateZ(Math.PI / 2), MAT.rubber, platen);
mk(new THREE.CylinderGeometry(0.004, 0.004, 0.44, 12).rotateZ(Math.PI / 2), MAT.chrome, platen);
const knob = (() => {
  const g = lathe([[0.0001, -0.011], [0.017, -0.011], [0.0215, -0.0095], [0.0228, -0.0075], [0.0228, 0.0075], [0.0215, 0.0095], [0.016, 0.011], [0.0001, 0.011]], 120);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k), r = Math.hypot(x, z);
    if (Math.abs(y) < 0.0076 && r > 0.022) { const a = Math.atan2(z, x), d = 0.0005 * Math.cos(a * 60); p.setXYZ(k, x * (r + d) / r, y, z * (r + d) / r); }
  }
  g.computeVertexNormals(); g.rotateZ(Math.PI / 2); return g;
})();
for (const s of [-1, 1]) {
  mk(knob, MAT.black, platen, s * 0.2235, 0, 0);
  mk(new THREE.CylinderGeometry(0.0085, 0.0085, 0.0025, 32).rotateZ(Math.PI / 2), MAT.chrome, platen, s * 0.2352, 0, 0);
  mk(new THREE.CylinderGeometry(PR * 0.85, PR * 0.85, 0.004, 40).rotateZ(Math.PI / 2), MAT.satin, platen, s * 0.152, 0, 0);
}
const tray = mk(new THREE.BoxGeometry(0.344, 0.004, 0.064), MAT.dark, machine, 0, 0.062, -0.090, true);   // floor of the slot under the carrier
const rail = mk(new THREE.CylinderGeometry(0.0045, 0.0045, 0.344, 16).rotateZ(Math.PI / 2), MAT.satin, machine, 0, 0.071, -0.064);   // the round bar of the carrier [S19][S21]
mk(new THREE.BoxGeometry(0.344, 0.006, 0.006), MAT.dark, machine, 0, 0.068, -0.046);

/* ---- carrier: the element, the ribbon cartridge, the card holder [S21]. Shapes GUESS ---- */
const carrier = new THREE.Group(); machine.add(carrier);
const RB = 0.034925 / 2;                                    // element: a sphere of 1 3/8 in [S16][S20]
const STRIKE_GAP = 0.0026;                                  // the element moves this far to the platen at the print. GUESS
const BALL_Z = P.z + 0.0007 + RB;                           // centre of the element on the platen (through ribbon and paper)
mk(rbox(0.086, 0.024, 0.044, 0.006, 0.003), MAT.dark, carrier, 0, 0.081, -0.062);
mk(new THREE.CylinderGeometry(0.0072, 0.0072, 0.05, 20).rotateZ(Math.PI / 2), MAT.dark, carrier, 0, 0.071, -0.064);
mk(rbox(0.030, 0.006, 0.024, 0.006, 0.002), MAT.satin, carrier, 0, 0.0955, BALL_Z);
const cart = mk(rbox(0.052, 0.014, 0.030, 0.004, 0.002), MAT.black, carrier, -0.048, 0.097, -0.064);   // ribbon cartridge, left of the element. GUESS
{
  const lc = makeCanvas(256, 128), lx = lc.getContext('2d');
  lx.fillStyle = '#8e8c86'; lx.fillRect(0, 0, 256, 128); lx.fillStyle = '#161616'; lx.font = 'bold 26px Arial, sans-serif'; lx.textAlign = 'center';
  lx.fillText('CARBON RIBBON', 128, 58); lx.font = '20px Arial, sans-serif'; lx.fillText('→  this side up', 128, 94);
  const lb = mk(new THREE.PlaneGeometry(0.028, 0.014), keep(new THREE.MeshStandardMaterial({ map: canvasTex(lc, true), roughness: 0.7 })), carrier, -0.050, 0.1042, -0.064, true);
  lb.rotation.x = -Math.PI / 2;
}
mk(rbox(0.010, 0.012, 0.010, 0.002, 0.001), MAT.black, carrier, 0.040, 0.099, -0.066);   // impression control. GUESS
const elemY = P.y;
const tiltG = new THREE.Group(); tiltG.position.set(0, elemY, BALL_Z + STRIKE_GAP); carrier.add(tiltG);
const spinG = new THREE.Group(); tiltG.add(spinG);
for (const s of [-1, 1]) {                                  // the tilt ring: a yoke with 2 pins, under the element
  mk(rbox(0.0025, 0.016, 0.006, 0.001, 0.0008), MAT.dark, tiltG, s * (RB + 0.0028), -0.008, 0);
  mk(new THREE.CylinderGeometry(0.0016, 0.0016, 0.005, 12).rotateZ(Math.PI / 2), MAT.satin, tiltG, s * (RB + 0.0014), -0.002, 0);
}
const LAT0 = -42, LAT1 = 55, ROW_LAT = (j) => 18 - 12 * j;   // element rows at 18, 6, -6, -18 degrees of latitude. GUESS
const TILT_RAD = (t) => -(18 - 12 * t) * Math.PI / 180;
const ballC = makeCanvas(2048, 1024), ballRC = makeCanvas(2048, 1024);
(function ballGlyphs() {                                    // raised characters, mirrored, 4 rows of 22 [S16][S20]
  const x = ballC.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 2048, 1024);
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'alphabetic'; x.font = '100px "Courier New", Courier, monospace';
  const pxDegU = 2048 / 360, pxDegV = 1024 / (LAT1 - LAT0), degMm = 180 / Math.PI / (RB * 1000);
  for (let j = 0; j < 4; j++) for (let p = 0; p < 22; p++) {
    const ch = KEYS[j * 11 + (p % 11)][p < 11 ? 1 : 2], lat = ROW_LAT(j);
    const u = (((0.5 - p / 22) % 1) + 1) % 1, v = (lat - LAT0) / (LAT1 - LAT0);
    const sx = pxDegU * degMm / Math.cos(lat * Math.PI / 180) * 4.23 / 100, sy = pxDegV * degMm * 4.23 / 100;
    for (const du of [0, -1, 1]) {
      x.setTransform(-sx, 0, 0, sy, u * 2048 + du * 2048, (1 - v) * 1024);
      x.lineWidth = 7; x.strokeStyle = '#fff'; x.fillText(ch, 0, 30); x.strokeText(ch, 0, 30);
    }
  }
  x.setTransform(1, 0, 0, 1, 0, 0);
  const y = ballRC.getContext('2d');
  y.fillStyle = 'rgb(60,60,60)'; y.fillRect(0, 0, 2048, 1024);
  y.globalCompositeOperation = 'lighter'; y.globalAlpha = 0.7; y.drawImage(ballC, 0, 0);
  const z = makeCanvas(2048, 1024), zc = z.getContext('2d'); zc.filter = 'blur(2px)'; zc.drawImage(ballC, 0, 0);
  x.drawImage(z, 0, 0);                                     // soft shoulders on the raised letters
})();
const ballPts = []; for (let k = 0; k <= 48; k++) { const a = (LAT0 + (LAT1 - LAT0) * k / 48) * Math.PI / 180; ballPts.push([RB * Math.cos(a), RB * Math.sin(a)]); }
const ballMat = keep(new THREE.MeshStandardMaterial({ color: 0xd9dcdf, metalness: 1, roughness: 0.32, roughnessMap: canvasTex(ballRC, false), bumpMap: canvasTex(ballC, false), bumpScale: 3.0 }));   // chrome plated [S16]
ballMat.envMapIntensity = 1.7;
const ball = mk(lathe(ballPts, 128), ballMat, spinG);
mk(lathe([[RB * Math.cos(LAT1 * Math.PI / 180), RB * Math.sin(LAT1 * Math.PI / 180)], [0.0001, RB * Math.sin(LAT1 * Math.PI / 180) - 0.0004]], 64), MAT.chrome, spinG);
mk(lathe([[0.0001, RB * Math.sin(LAT0 * Math.PI / 180) + 0.003], [RB * Math.cos(LAT0 * Math.PI / 180) * 0.94, RB * Math.sin(LAT0 * Math.PI / 180) + 0.0002]], 64), MAT.matte, spinG);
mk(softBox(0.0115, 0.0026, 0.0042, 0.0012, 6, 2, 2), MAT.black, spinG, 0, RB * Math.sin(LAT1 * Math.PI / 180) + 0.0011, 0);   // the release lever on top, black [S21]
mk(new THREE.CylinderGeometry(0.0032, 0.0032, 0.0028, 20), MAT.chrome, spinG, 0, RB * Math.sin(LAT1 * Math.PI / 180) + 0.0008, 0);
/* card holder: clear plastic against the paper, below the print line, with a red centre mark (GUESS shape) */
function platenStrip(r, th0, th1, w, n) {
  const pos = [], uv = [], idx = [];
  for (let k = 0; k <= n; k++) { const th = th0 + (th1 - th0) * k / n; for (const sx of [-1, 1]) { pos.push(sx * w / 2, PC.y + r * Math.sin(th), PC.z + r * Math.cos(th)); uv.push(sx > 0 ? 1 : 0, k / n); } if (k < n) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
{
  const c = makeCanvas(256, 64), x = c.getContext('2d');
  x.fillStyle = 'rgba(220,228,232,0.30)'; x.fillRect(0, 0, 256, 64);
  x.fillStyle = 'rgba(255,255,255,0.7)'; x.fillRect(0, 0, 256, 3); x.fillRect(0, 0, 3, 64); x.fillRect(253, 0, 3, 64);
  x.fillStyle = 'rgba(200,20,20,0.95)'; x.fillRect(126, 0, 4, 34);
  for (let k = -5; k <= 5; k++) if (k) { x.fillStyle = 'rgba(30,30,30,0.6)'; x.fillRect(128 + k * 22 - 1, 0, 2, 10); }
  const m = keep(new THREE.MeshStandardMaterial({ map: canvasTex(c, true), transparent: true, roughness: 0.1, metalness: 0, depthWrite: false, side: THREE.DoubleSide }));
  const ch = mk(platenStrip(PR + 0.0011, TH_P - 0.13, TH_P - 0.5, 0.056, 8), m, carrier, 0, 0, 0, true); ch.renderOrder = 3;
}
/* ribbon: carbon film (CHOICE, [S20]), 8 mm wide (GUESS), between the element and the paper; it lifts for each print */
const RIB_W = 0.008, RIB_DROP = 0.0072;
const ribG = new THREE.Group(); carrier.add(ribG);
const ribMat = keep(new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.28, metalness: 0.2, clearcoat: 0.6, side: THREE.DoubleSide }));
mk(platenStrip(PR + 0.0006, TH_P + RIB_W / 2 / PR, TH_P - RIB_W / 2 / PR, 0.050, 2), ribMat, ribG, 0, 0, 0, true);
for (const s of [-1, 1]) {
  mk(new THREE.CylinderGeometry(0.0016, 0.0016, 0.016, 12), MAT.satin, ribG, s * 0.026, P.y - 0.004, P.z + 0.0015);
  mk(new THREE.BoxGeometry(0.003, 0.012, 0.022), MAT.dark, ribG, s * 0.026, P.y - 0.012, P.z + 0.012);
}
let ribLift = 0, ribHold = 0;

/* ---- the paper path (the technique of scene B). The sheet comes in from the back, goes round the platen and up the front
 * to the print point. Its lower, untyped part (the tail) stands up behind the platen, on the paper support. Its typed upper
 * part (the head) leaves the platen at the front, goes under the bail and lies back against the tail. s = m along the sheet
 * from the print line, positive toward the top edge of the sheet. Shapes: GUESS. ---- */
const TH_D = 30 * Math.PI / 180, TH_T = -150 * Math.PI / 180, PE = PR + 0.0004, EL0 = Math.PI / 2 - TH_D;
const DS = 0.0005, S_MIN = -0.30, TJ = 0.055, OFF = 0.0016;
const S_TE = (TH_T - TH_P) * PE, S_HD = (TH_D - TH_P) * PE;
const tailTab = [];
{
  let y = PC.y + PE * Math.sin(TH_T), z = PC.z + PE * Math.cos(TH_T), el = EL0;
  for (let k = 0; k * DS <= 0.32; k++) {
    tailTab.push([y, z, Math.cos(el), Math.sin(el)]);
    if (k * DS > 0.10) el = Math.max(0.55, el - DS / 0.3);
    y += Math.sin(el) * DS; z -= Math.cos(el) * DS;
  }
}
function tailAt(t, out) {
  const f = clamp(t / DS, 0, tailTab.length - 1.001), k = Math.floor(f), u = f - k, a = tailTab[k], b = tailTab[k + 1];
  for (let i = 0; i < 4; i++) out[i] = a[i] + (b[i] - a[i]) * u;
  return out;
}
const blend = [];
let BL = 0;
{
  const P0 = [PC.y + PE * Math.sin(TH_D), PC.z + PE * Math.cos(TH_D)], D0 = [Math.sin(EL0), -Math.cos(EL0)];
  const T1 = tailAt(TJ, [0, 0, 0, 0]), P1 = [T1[0] + OFF * T1[2], T1[1] + OFF * T1[3]], D1 = [T1[3], -T1[2]];
  const L = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]) * 1.1;
  let py = P0[0], pz = P0[1];
  for (let i = 0; i <= 400; i++) {
    const u = i / 400, u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const y = h00 * P0[0] + h10 * D0[0] * L + h01 * P1[0] + h11 * D1[0] * L, z = h00 * P0[1] + h10 * D0[1] * L + h01 * P1[1] + h11 * D1[1] * L;
    BL += Math.hypot(y - py, z - pz); py = y; pz = z;
    const dy = 6 * u2 * P0[0] - 6 * u * P0[0] + (3 * u2 - 4 * u + 1) * D0[0] * L + (-6 * u2 + 6 * u) * P1[0] + (3 * u2 - 2 * u) * D1[0] * L;
    const dzz = 6 * u2 * P0[1] - 6 * u * P0[1] + (3 * u2 - 4 * u + 1) * D0[1] * L + (-6 * u2 + 6 * u) * P1[1] + (3 * u2 - 2 * u) * D1[1] * L;
    const n = Math.hypot(dy, dzz) || 1;
    blend.push([BL, y, z, -dzz / n, dy / n]);
  }
}
function pathAt(s, out) {                                  // point and outward normal of the sheet at s
  if (s < S_TE) { tailAt(S_TE - s, out); out[2] = -out[2]; out[3] = -out[3]; return out; }
  if (s <= S_HD) { const th = TH_P + s / PE; out[0] = PC.y + PE * Math.sin(th); out[1] = PC.z + PE * Math.cos(th); out[2] = Math.sin(th); out[3] = Math.cos(th); return out; }
  const s2 = s - S_HD;
  if (s2 < BL) {
    let lo = 0, hi = blend.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (blend[m][0] < s2) lo = m; else hi = m; }
    const a = blend[lo], b = blend[hi], u = (s2 - a[0]) / Math.max(1e-9, b[0] - a[0]);
    for (let i = 0; i < 4; i++) out[i] = a[i + 1] + (b[i + 1] - a[i + 1]) * u;
    return out;
  }
  tailAt(TJ + s2 - BL, out); out[0] += OFF * out[2]; out[1] += OFF * out[3];
  return out;
}
{
  /* paper support behind the platen, painted (GUESS); paper guide at the left edge of the sheet */
  const c = tailAt(0.034, [0, 0, 0, 0]);
  const tbl = mk(rbox(0.19, 0.0016, 0.055, 0.008, 0.0007), MAT.dark, machine);   // narrower than the sheet: hidden behind it
  tbl.position.set(0, c[0] - c[2] * 0.0024, c[1] - c[3] * 0.0024); tbl.rotation.x = -(Math.PI / 2 + TH_D);
  const g = tailAt(0.018, [0, 0, 0, 0]);
  const pg = mk(new THREE.BoxGeometry(0.0016, 0.012, 0.03), MAT.chrome, machine); pg.position.set(-SHEET_WM / 2 - 0.0012, g[0], g[1]); pg.rotation.x = -TH_D;
  /* paper bail with 3 rubber rollers [S21][S22] (positions GUESS) */
  const bl = pathAt(S_HD + 0.010, [0, 0, 0, 0]), by0 = bl[0] + bl[2] * 0.0024, bz0 = bl[1] + bl[3] * 0.0024;
  mk(new THREE.CylinderGeometry(0.0013, 0.0013, 0.32, 12).rotateZ(Math.PI / 2), MAT.chrome, machine, 0, by0, bz0);
  for (const x of [-0.07, 0, 0.07]) mk(new THREE.CylinderGeometry(0.0034, 0.0034, 0.009, 20).rotateZ(Math.PI / 2), MAT.rubber, machine, x, by0, bz0);
  for (const s of [-1, 1]) mk(tube([[s * 0.159, by0, bz0], [s * 0.164, by0 - 0.004, bz0 - 0.006], [s * 0.166, PC.y + 0.006, PC.z + 0.002]], 0.0013, 12), MAT.chrome, machine);
  /* levers at the upper right: paper release, line space; line finder at the right end of the platen [S21][S22] (shapes GUESS) */
  mk(tube([[0.190, 0.126, -0.128], [0.192, 0.142, -0.136], [0.194, 0.158, -0.150]], 0.0018, 12), MAT.chrome, machine);
  mk(new THREE.SphereGeometry(0.0042, 16, 12), MAT.black, machine, 0.194, 0.159, -0.151);
  mk(tube([[0.186, 0.128, -0.070], [0.190, 0.140, -0.062], [0.193, 0.150, -0.048]], 0.0016, 12), MAT.chrome, machine);
  mk(softBox(0.006, 0.006, 0.012, 0.002), MAT.black, machine, 0.193, 0.151, -0.046);
  mk(tube([[0.160, 0.128, -0.088], [0.158, 0.137, -0.084]], 0.0011, 6), MAT.chrome, machine);
  /* electric cord at the rear (GUESS) */
  mk(tube([[0.12, 0.030, -0.176], [0.125, 0.012, -0.205], [0.15, 0.004, -0.28], [0.22, 0.004, -0.40], [0.26, 0.0, -0.475], [0.27, -0.08, -0.49], [0.28, -0.30, -0.49]], 0.0028, 60), MAT.matte, machine);
}

/* ---- the paper: a strip mesh along the path; the sheet canvas is its texture. The paper does not move sideways [S19]. ---- */
const PROWS = 140, PCOLS = 9;
const paperGeo = new THREE.BufferGeometry();
paperGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PROWS * PCOLS * 3), 3));
paperGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(PROWS * PCOLS * 3), 3));
paperGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(PROWS * PCOLS * 2), 2));
{ const idx = []; for (let r = 0; r < PROWS - 1; r++) for (let c = 0; c < PCOLS - 1; c++) { const k = r * PCOLS + c; idx.push(k, k + PCOLS, k + 1, k + 1, k + PCOLS, k + PCOLS + 1); } paperGeo.setIndex(idx); }
sheetTex = new THREE.CanvasTexture(sheet); keep(sheetTex);
sheetTex.colorSpace = THREE.SRGBColorSpace; sheetTex.anisotropy = ANISO; sheetTex.generateMipmaps = true; sheetTex.minFilter = THREE.LinearMipmapLinearFilter;
patchTex = keep(new THREE.CanvasTexture(patch)); patchTex.generateMipmaps = false; patchTex.minFilter = THREE.LinearFilter; patchTex.colorSpace = THREE.SRGBColorSpace;
renderer.initTexture(sheetTex); uploadsFull++;
MAT.paper.map = sheetTex; MAT.paper.needsUpdate = true;
const paper = mk(paperGeo, MAT.paper, machine); paper.frustumCulled = false; paper.userData.pick = 'sheet';
let paperShown = -1;
const pa = [0, 0, 0, 0];
function placePaper(line) {
  const yPrint = (TOP_LINES + line) * LINEH, sTop = yPrint / PXM, sLo = Math.max(S_MIN, sTop - SHEET_LM);
  const p = paperGeo.attributes.position.array, n = paperGeo.attributes.normal.array, uv = paperGeo.attributes.uv.array;
  for (let r = 0; r < PROWS; r++) {
    const f = r / (PROWS - 1), s0 = sLo + (sTop - sLo) * f, s = s0 - feed;   // feed: the part of a new sheet not yet fed in
    pathAt(s, pa);
    const v = 1 - (yPrint - s0 * PXM) / SH, flat = Math.max(smooth(0.012, 0.06, s), smooth(0.01, 0.06, S_TE - s));
    for (let c = 0; c < PCOLS; c++) {
      const u = c / (PCOLS - 1), x = -SHEET_WM / 2 + u * SHEET_WM;
      const wav = flat * (0.0005 * Math.sin(u * 9.0 + s * 30) + 0.0018 * Math.sin(u * Math.PI) * smooth(0.04, 0.2, Math.abs(s)) - 0.004 * smooth(0.14, 0.24, -s) * (1 - 0.6 * Math.sin(u * Math.PI)));
      const k = r * PCOLS + c;
      p[k * 3] = x; p[k * 3 + 1] = pa[0] + pa[2] * wav; p[k * 3 + 2] = pa[1] + pa[3] * wav;
      n[k * 3] = 0; n[k * 3 + 1] = -pa[2]; n[k * 3 + 2] = -pa[3];   // the winding faces the platen: the normal goes with it
      uv[k * 2] = u; uv[k * 2 + 1] = v;
    }
  }
  paperGeo.attributes.position.needsUpdate = true; paperGeo.attributes.normal.needsUpdate = true; paperGeo.attributes.uv.needsUpdate = true;
}
/* A new sheet (the same motion in settings A, B and C, CHOICE): the old sheet is pulled up and out in 0.45 s and fades at the
 * end; from 0.25 s a blank sheet, already round the back of the platen, feeds in 70 mm while the platen turns. 0.85 s in all. */
const FEED_D = 0.07, OUT_T = 0.45, IN_T0 = 0.25, IN_T1 = 0.85;
let feed = 0, sheetT = IN_T1;
const ghostC = makeCanvas(SW >> 2, SH >> 2), ghostTex = canvasTex(ghostC, true);
const ghostGeo = keep(new THREE.BufferGeometry());
for (const k of ['position', 'normal', 'uv']) ghostGeo.setAttribute(k, paperGeo.attributes[k].clone());
ghostGeo.setIndex(paperGeo.index.clone());
const ghost = new THREE.Mesh(ghostGeo, keep(new THREE.MeshStandardMaterial({ map: ghostTex, roughness: 0.9, side: THREE.DoubleSide, transparent: true })));
ghost.visible = false; ghost.frustumCulled = false; ghost.raycast = () => {}; machine.add(ghost);
function sheetMotion(dt) {                                // true while a sheet moves
  if (sheetT >= IN_T1) return false;
  sheetT = Math.min(IN_T1, sheetT + dt);
  const a = smooth(0, OUT_T, sheetT);
  ghost.position.set(0, 0.20 * a * a, -0.05 * a * a); ghost.material.opacity = 1 - smooth(0.55, 1, a); ghost.visible = sheetT < OUT_T;
  feed = FEED_D * (1 - smooth(IN_T0, IN_T1, sheetT));
  return true;
}
placePaper(0);

/* ============================================ the room ============================================ */
/* Steel pedestal desk ("tanker desk") [S49]: 1524 x 762 x 737 mm, grey enamel steel, grey-green linoleum top with an
 * aluminium edge, chrome pulls (size and colours GUESS, reference.md C3). */
const room = new THREE.Group(); scene.add(room);
function texCanvas(w, h, seed, draw) { const c = makeCanvas(w, h), x = c.getContext('2d'); draw(x, rng(seed), w, h); return c; }
const linoC = texCanvas(1024, 1024, SEED * 43 + 1, (x, r, w, h) => {      // linoleum: a fine marbled ("jaspe") pattern, grey-green
  const d = x.createImageData(w, h), nz = makeNoise(r), base = new THREE.Color(0x6a776d), lite = new THREE.Color(0x737f76), dk = new THREE.Color(0x626e65), o = new THREE.Color();
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const s = nz(i * 0.010, j * 0.016) * 5 + nz(i * 0.05, j * 0.08) * 1.2 + nz(i * 0.3, j * 0.3) * 0.3;
    const m = 0.5 + 0.5 * Math.sin(s * 3.1), k = (j * w + i) * 4;
    o.copy(dk).lerp(base, smooth(0.15, 0.55, m)).lerp(lite, smooth(0.7, 1.0, m) * 0.7);
    const g = 1 + (r() - 0.5) * 0.06;
    d.data[k] = clamp(o.r * 255 * g, 0, 255); d.data[k + 1] = clamp(o.g * 255 * g, 0, 255); d.data[k + 2] = clamp(o.b * 255 * g, 0, 255); d.data[k + 3] = 255;
  }
  x.putImageData(d, 0, 0);
});
const tLino = canvasTex(linoC, true, true); tLino.repeat.set(3.2, 3.2);
MAT.lino = keep(new THREE.MeshPhysicalMaterial({ map: tLino, roughness: 0.7, clearcoat: 0.12, clearcoatRoughness: 0.45 }));
MAT.steel = keep(new THREE.MeshPhysicalMaterial({ color: 0x8b8f8c, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.3, bumpMap: tStipple, bumpScale: 0.1 }));   // palette #8b8f8c
MAT.alu = keep(new THREE.MeshStandardMaterial({ color: 0xc9ccce, metalness: 1, roughness: 0.28, roughnessMap: tBrushed }));
MAT.alu.envMapIntensity = 1.3;
const DESK_Z = -0.08, DW = 1.524, DD = 0.762, DT = 0.030;
{
  const top = mk(rbox(DW, DT, DD, 0.006, 0.003), [MAT.lino, MAT.alu], room, 0, -DT / 2, DESK_Z);
  const PW = 0.39, PD = 0.70, PH = 0.737 - DT - 0.03;
  for (const s of [-1, 1]) {
    const px = s * (DW / 2 - PW / 2 - 0.012), g = new THREE.Group(); g.position.set(px, FLOOR + 0.03, DESK_Z - 0.01); room.add(g);
    mk(rbox(PW, PH, PD, 0.004, 0.003), MAT.steel, g, 0, PH / 2, 0);
    mk(new THREE.BoxGeometry(PW - 0.03, 0.03, PD - 0.04), MAT.matte, g, 0, -0.015, -0.01, true);    // recessed base
    for (const [cy, hh] of (s < 0 ? [[PH - 0.135, 0.25], [0.21, 0.39]] : [[PH - 0.09, 0.165], [PH - 0.27, 0.165], [0.17, 0.30]])) {
      mk(rbox(PW - 0.022, hh - 0.008, 0.012, 0.003, 0.002), MAT.steel, g, 0, cy, PD / 2 + 0.004);
      mk(rbox(0.11, 0.012, 0.016, 0.004, 0.003), MAT.chrome, g, 0, cy + hh / 2 - 0.04, PD / 2 + 0.016);   // drawers: [y centre, height], GUESS
      mk(new THREE.BoxGeometry(0.09, 0.006, 0.004), MAT.matte, g, 0, cy + hh / 2 - 0.046, PD / 2 + 0.0105, true);
    }
    contactShadow(room, px, DESK_Z - 0.01, PW + 0.12, PD + 0.12, 0.6, true, FLOOR);
  }
  mk(rbox(DW - 2 * 0.40, 0.07, 0.012, 0.003, 0.002), MAT.steel, room, 0, -DT - 0.035, DESK_Z + DD / 2 - 0.02);   // centre drawer
  mk(rbox(0.16, 0.010, 0.014, 0.004, 0.003), MAT.chrome, room, 0, -DT - 0.045, DESK_Z + DD / 2 - 0.008);
  mk(new THREE.BoxGeometry(DW - 2 * 0.40, 0.42, 0.012), MAT.steel, room, 0, -DT - 0.25, DESK_Z - DD / 2 + 0.05);   // modesty panel
  mk(new THREE.BoxGeometry(DW - 2 * 0.40, 0.01, DD - 0.06), MAT.matte, room, 0, -DT - 0.07, DESK_Z, true);
  contactShadow(room, 0, DESK_Z, DW + 0.2, DD + 0.2, 0.7, true, FLOOR);   // the floor under the desk gets less light from the room
  contactShadow(room, 0, DESK_Z - 0.05, DW - 0.6, DD - 0.15, 0.5, true, FLOOR);
}
/* floor: vinyl tiles 9 x 9 in, two pale tones with speckles, waxed (GUESS) */
const floorC = texCanvas(1024, 1024, SEED * 47 + 3, (x, r, w, h) => {
  const n = 4, t = w / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    x.fillStyle = (i + j) % 2 ? '#b4b1a6' : '#a19d92'; x.fillRect(i * t, j * t, t, t);
    for (let k = 0; k < 900; k++) { x.fillStyle = r() < 0.5 ? 'rgba(60,58,52,0.35)' : 'rgba(240,238,230,0.35)'; const s = 1 + r() * 3; x.fillRect(i * t + r() * t, j * t + r() * t, s, s * (0.5 + r())); }
    x.strokeStyle = 'rgba(40,38,34,0.35)'; x.lineWidth = 2; x.strokeRect(i * t + 1, j * t + 1, t - 2, t - 2);
  }
  mottle(x, w, h, 16, 16, 0.12, 'soft-light', r);
});
{
  const tf = canvasTex(floorC, true, true); tf.repeat.set(6 / (4 * 0.2286), 6 / (4 * 0.2286));
  const fl = mk(new THREE.PlaneGeometry(6, 6), keep(new THREE.MeshPhysicalMaterial({ map: tf, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.3, clearcoatRoughnessMap: tSmudge })), room, 0, FLOOR, 0, true);
  fl.rotation.x = -Math.PI / 2;
}
/* walls: pale grey-green paint; a wide window with aluminium venetian blinds; acoustic tile ceiling (all GUESS, reference.md C3) */
const wallC = texCanvas(512, 512, SEED * 53, (x, r, w, h) => { x.fillStyle = '#dde0d6'; x.fillRect(0, 0, w, h); mottle(x, w, h, 10, 10, 0.12, 'soft-light', r); mottle(x, w, h, 60, 60, 0.08, 'soft-light', r); grain(x, w, h, 6, r); });
const tWall = canvasTex(wallC, true, true);
MAT.wall = keep(new THREE.MeshStandardMaterial({ map: tWall, roughness: 0.9 }));
const WIN = { x0: -1.62, x1: -0.22, y0: FLOOR + 0.86, y1: FLOOR + 2.30 };
{
  const H = CEIL - FLOOR, wall = (w, h, x, y, z, ry) => {
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv, u0 = (ry ? z : x) - w / 2, v0 = y - h / 2;   // texture in metres: the pieces of a wall join without a seam
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (u0 + uv.getX(k) * w) / 1.4, (v0 + uv.getY(k) * h) / 1.4);
    const m = mk(g, MAT.wall, room, x, y, z, true); m.rotation.y = ry || 0; return m;
  };
  wall(WIN.x0 - WALL_L, H, (WALL_L + WIN.x0) / 2, FLOOR + H / 2, WALL_Z);
  wall(WALL_R - WIN.x1, H, (WALL_R + WIN.x1) / 2, FLOOR + H / 2, WALL_Z);
  wall(WIN.x1 - WIN.x0, WIN.y0 - FLOOR, (WIN.x0 + WIN.x1) / 2, (FLOOR + WIN.y0) / 2, WALL_Z);
  wall(WIN.x1 - WIN.x0, CEIL - WIN.y1, (WIN.x0 + WIN.x1) / 2, (CEIL + WIN.y1) / 2, WALL_Z);
  wall(4.2, H, WALL_R, FLOOR + H / 2, WALL_Z + 2.1, -Math.PI / 2);
  wall(4.2, H, WALL_L, FLOOR + H / 2, WALL_Z + 2.1, Math.PI / 2);
  wall(WALL_R - WALL_L, H, (WALL_R + WALL_L) / 2, FLOOR + H / 2, WALL_Z + 4.2, Math.PI);
  const base = keep(new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.6 }));          // vinyl cove base. GUESS
  mk(new THREE.BoxGeometry(WALL_R - WALL_L, 0.10, 0.008), base, room, (WALL_R + WALL_L) / 2, FLOOR + 0.05, WALL_Z + 0.004, true);
  mk(new THREE.BoxGeometry(0.008, 0.10, 4.2), base, room, WALL_R - 0.004, FLOOR + 0.05, WALL_Z + 2.1, true);
  mk(new THREE.BoxGeometry(0.008, 0.10, 4.2), base, room, WALL_L + 0.004, FLOOR + 0.05, WALL_Z + 2.1, true);
  /* ceiling tiles 12 x 12 in with fissures and holes */
  const cc = texCanvas(512, 512, SEED * 59, (x, r, w, h) => {
    x.fillStyle = '#d9d8d0'; x.fillRect(0, 0, w, h);
    for (let k = 0; k < 2600; k++) { x.fillStyle = 'rgba(90,88,80,' + (0.2 + r() * 0.4) + ')'; x.beginPath(); x.arc(r() * w, r() * h, 0.8 + r() * 1.4, 0, Math.PI * 2); x.fill(); }
    x.strokeStyle = 'rgba(80,78,70,0.5)'; x.lineWidth = 3; x.strokeRect(0, 0, w, h);
  });
  const tc = canvasTex(cc, true, true); tc.repeat.set((WALL_R - WALL_L) / 0.3048, 4.2 / 0.3048);
  const ce = mk(new THREE.PlaneGeometry(WALL_R - WALL_L, 4.2), keep(new THREE.MeshStandardMaterial({ map: tc, roughness: 0.95 })), room, (WALL_R + WALL_L) / 2, CEIL, WALL_Z + 2.1, true);
  ce.rotation.x = Math.PI / 2;
  /* the fluorescent fixture: 2 tubes behind a diffuser, 1250 x 300 mm (GUESS) */
  for (const [fx, fz] of [[-0.45, -0.5], [-0.45, 1.0], [1.3, -0.5], [-2.0, -0.5]]) {
    const fg = new THREE.Group(); fg.position.set(fx, CEIL - 0.045, fz); fg.rotation.y = Math.PI / 2; room.add(fg);
    mk(rbox(1.27, 0.07, 0.32, 0.01, 0.006), keep(new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.5 })), fg, 0, 0.0, 0, true);
    const dm = mk(new THREE.PlaneGeometry(1.22, 0.27), keep(new THREE.MeshBasicMaterial({ color: FLUO.clone().multiplyScalar(3.2) })), fg, 0, -0.036, 0, true);
    dm.rotation.x = Math.PI / 2;
  }
  /* window: aluminium frame, daylight behind the blinds, slats tilted almost closed */
  const W = WIN.x1 - WIN.x0, Hh = WIN.y1 - WIN.y0, cx = (WIN.x0 + WIN.x1) / 2, cy = (WIN.y0 + WIN.y1) / 2;
  const sky = mk(new THREE.PlaneGeometry(W, Hh), keep(new THREE.MeshBasicMaterial({ color: DAY.clone().multiplyScalar(2.6) })), room, cx, cy, WALL_Z - 0.06, true);
  for (const [w, h, x, y] of [[W + 0.06, 0.04, cx, WIN.y0], [W + 0.06, 0.04, cx, WIN.y1], [0.04, Hh, WIN.x0, cy], [0.04, Hh, WIN.x1, cy], [0.025, Hh, cx, cy]])
    mk(new THREE.BoxGeometry(w, h, 0.07), MAT.alu, room, x, y, WALL_Z - 0.02, true);
  mk(new THREE.BoxGeometry(W + 0.1, 0.03, 0.16), keep(new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.6 })), room, cx, WIN.y0 - 0.01, WALL_Z + 0.05, true);   // sill
  const NSL = Math.floor((Hh - 0.08) / 0.024);
  const slatMat = keep(new THREE.MeshStandardMaterial({ color: 0xdedfdc, metalness: 0.5, roughness: 0.42, side: THREE.DoubleSide }));
  const slats = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(W - 0.03, 0.0008, 0.025)), slatMat, NSL);
  for (let k = 0; k < NSL; k++) { mtx.compose(tv.set(cx, WIN.y1 - 0.07 - k * 0.024, WALL_Z + 0.035), q0.setFromAxisAngle(xAx, 1.05), sv.set(1, 1, 1)); slats.setMatrixAt(k, mtx); }
  slats.receiveShadow = true; room.add(slats);
  mk(new THREE.BoxGeometry(W, 0.045, 0.05), slatMat, room, cx, WIN.y1 - 0.03, WALL_Z + 0.035, true);
  mk(new THREE.BoxGeometry(W - 0.03, 0.012, 0.03), slatMat, room, cx, WIN.y1 - 0.08 - NSL * 0.024, WALL_Z + 0.035, true);
  for (const lx of [-0.45, 0, 0.45]) mk(new THREE.BoxGeometry(0.008, Hh - 0.06, 0.0005), keep(new THREE.MeshStandardMaterial({ color: 0xcfcdc4, roughness: 0.9 })), room, cx + lx, cy - 0.01, WALL_Z + 0.048, true);
  void sky;
}

/* electric office wall clock above the hi-fi, 300 mm (GUESS); it shows a time in the afternoon */
{
  const g = new THREE.Group(); g.position.set(1.0, FLOOR + 1.28, WALL_Z + 0.03); room.add(g);
  const c = makeCanvas(512, 512), x = c.getContext('2d');
  x.fillStyle = '#f4f2ea'; x.beginPath(); x.arc(256, 256, 250, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#151515'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 50px Arial, sans-serif';
  for (let k = 1; k <= 12; k++) { const a = k / 12 * Math.PI * 2; x.fillText(String(k), 256 + Math.sin(a) * 190, 256 - Math.cos(a) * 190); }
  for (let k = 0; k < 60; k++) { const a = k / 60 * Math.PI * 2, l = k % 5 ? 10 : 22; x.lineWidth = k % 5 ? 3 : 6; x.strokeStyle = '#151515'; x.beginPath(); x.moveTo(256 + Math.sin(a) * 236, 256 - Math.cos(a) * 236); x.lineTo(256 + Math.sin(a) * (236 - l), 256 - Math.cos(a) * (236 - l)); x.stroke(); }
  x.font = '18px Arial, sans-serif'; x.fillText('ELECTRIC', 256, 340);
  const face = mk(new THREE.CircleGeometry(0.15, 64), keep(new THREE.MeshStandardMaterial({ map: canvasTex(c, true), roughness: 0.6 })), g, 0, 0, 0.012, true);
  void face;
  mk(new THREE.TorusGeometry(0.152, 0.009, 16, 72), MAT.chrome, g, 0, 0, 0.014, true);
  mk(new THREE.CylinderGeometry(0.152, 0.152, 0.012, 64).rotateX(Math.PI / 2), keep(new THREE.MeshStandardMaterial({ color: 0xe0dfd8, roughness: 0.5 })), g, 0, 0, 0.0, true);
  const hand = (len, w, ang, z, mat) => { const h = mk(new THREE.BoxGeometry(w, len, 0.0015).translate(0, len / 2 - 0.015, 0), mat, g, 0, 0, z, true); h.rotation.z = -ang; return h; };
  const blk = keep(new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 }));
  hand(0.085, 0.008, (3 + 40 / 60) / 12 * Math.PI * 2, 0.016, blk); hand(0.125, 0.006, 40 / 60 * Math.PI * 2, 0.018, blk);
  hand(0.13, 0.002, 0.3 * Math.PI * 2, 0.020, keep(new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.5 })));
  const glassD = mk(new THREE.SphereGeometry(0.4, 48, 8, 0, Math.PI * 2, 0, 0.384).rotateX(Math.PI / 2), keep(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.12, depthWrite: false })), g, 0, 0, -0.357, true); glassD.renderOrder = 2;
}

/* ---- objects on the desk: 7 items from reference.md C3 ---- */
const MATX = {
  phone: keep(new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.1 })),   // black model 500 [S52]
  clear: keep(new THREE.MeshPhysicalMaterial({ color: 0xe8f0f2, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false })),
  glass: keep(new THREE.MeshPhysicalMaterial({ color: 0xc9d9d6, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.34, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false })),
  blue: keep(new THREE.MeshPhysicalMaterial({ color: 0x1f47a8, roughness: 0.3, clearcoat: 0.6 })),   // cap colour GUESS
  white: keep(new THREE.MeshStandardMaterial({ color: 0xf0efe8, roughness: 0.5 })),
  greyFrame: keep(new THREE.MeshStandardMaterial({ color: 0x6e7072, metalness: 0.6, roughness: 0.45 })),
  card: keep(new THREE.MeshStandardMaterial({ color: 0xf2efe2, roughness: 0.9 })),
};
MATX.clear.envMapIntensity = 2.2; MATX.glass.envMapIntensity = 2.4;
/* 1. Western Electric model 500 telephone: moulded plastic housing, rotary dial, handset on 2 U-shaped cradle arms; a black set
 * had a metal finger wheel to about 1964 [S52]. Size and shape GUESS (230 x 170 x 120 mm). */
{
  const t = new THREE.Group(); t.position.set(-0.56, 0, -0.30); t.rotation.y = 0.38; room.add(t);
  mk(profileX([[0.112, 0.0], [0.112, 0.010], [0.105, 0.025], [0.035, 0.085], [-0.060, 0.093], [-0.105, 0.082], [-0.116, 0.05], [-0.116, 0.0]], 0.168, 0.014), MATX.phone, t);   // the bevel adds 14 mm all round
  for (const s of [-1, 1]) {
    mk(profileX([[0.03, 0.08], [0.02, 0.108], [0.008, 0.112], [0.003, 0.098], [-0.003, 0.098], [-0.008, 0.112], [-0.02, 0.108], [-0.03, 0.084]], 0.02, 0.004), MATX.phone, t, s * 0.062, 0.012, -0.035);
  }
  const dial = new THREE.Group(); dial.position.set(0, 0.0685, 0.0812); dial.rotation.x = 0.71; t.add(dial);   // on the sloped front
  const dc = makeCanvas(256, 256), dx = dc.getContext('2d');
  dx.fillStyle = '#0f0f0f'; dx.fillRect(0, 0, 256, 256);
  dx.fillStyle = '#f3f1ea'; dx.beginPath(); dx.arc(128, 128, 120, 0, Math.PI * 2); dx.fill();
  dx.fillStyle = '#111'; dx.font = 'bold 22px Arial, sans-serif'; dx.textAlign = 'center'; dx.textBaseline = 'middle';
  for (let k = 0; k < 10; k++) { const a = (60 + k * 30) * Math.PI / 180; dx.fillText(String((k + 1) % 10), 128 + Math.cos(a) * 94, 128 - Math.sin(a) * 94); }   // 1 at the upper right, 0 at the lower left
  dx.fillStyle = '#fbfaf4'; dx.beginPath(); dx.arc(128, 128, 46, 0, Math.PI * 2); dx.fill(); dx.strokeStyle = '#999'; dx.lineWidth = 2; dx.stroke();
  dx.fillStyle = '#222'; dx.font = '13px Arial, sans-serif'; dx.fillText('EXTENSION 214', 128, 124); dx.fillText('ROOM 6', 128, 142);
  const dface = mk(new THREE.CircleGeometry(0.036, 48), keep(new THREE.MeshStandardMaterial({ map: canvasTex(dc, true), roughness: 0.5 })), dial, 0, 0, 0, true);
  dface.rotation.x = -Math.PI / 2;
  const ws = new THREE.Shape(); ws.absarc(0, 0, 0.0365, 0, Math.PI * 2, false);
  const hole = (a) => { const h = new THREE.Path(); h.absarc(Math.cos(a) * 0.0265, Math.sin(a) * 0.0265, 0.0058, 0, Math.PI * 2, true); return h; };
  for (let k = 0; k < 10; k++) ws.holes.push(hole((60 + k * 30) * Math.PI / 180));
  const ih = new THREE.Path(); ih.absarc(0, 0, 0.0145, 0, Math.PI * 2, true); ws.holes.push(ih);
  const wheel = mk(new THREE.ExtrudeGeometry(ws, { depth: 0.0018, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelSegments: 2, curveSegments: 24 }), MAT.chrome, dial, 0, 0.0004, 0);
  wheel.rotation.x = -Math.PI / 2;
  mk(new THREE.BoxGeometry(0.004, 0.004, 0.010), MAT.chrome, dial, 0.0262, 0.003, 0.0184).rotation.y = 0.6;   // finger stop at 4 o'clock
  const hs = new THREE.Group(); hs.position.set(0, 0.125, -0.035); t.add(hs);                    // handset across the cradle
  mk(tube([[-0.095, 0.0, 0.004], [-0.06, 0.012, 0.0], [0.0, 0.016, 0.0], [0.06, 0.012, 0.0], [0.095, 0.0, 0.004]], 0.0115, 40, false, 16), MATX.phone, hs);
  for (const s of [-1, 1]) {
    const cup = mk(lathe([[0.0, -0.016], [0.022, -0.014], [0.026, -0.006], [0.024, 0.006], [0.014, 0.012], [0.0, 0.012]], 40), MATX.phone, hs, s * 0.100, -0.006, 0.006);
    cup.rotation.z = s * 0.25;
  }
  mk(tube([[0.095, -0.012, 0.0], [0.11, -0.05, 0.04], [0.11, -0.09, 0.08], [0.09, -0.112, 0.10], [0.06, -0.113, 0.07]], 0.0035, 40), MATX.phone, hs);   // cord (plain; a coil is not drawn)
  contactShadow(room, -0.56, -0.30, 0.30, 0.34, 0.8, true, 0, 0.38);
}
/* 2. Rolodex rotary card file: a wheel of cards about 100 mm on a steel frame with 2 black knobs (GUESS shape [S55]) */
{
  const g = new THREE.Group(); g.position.set(-0.30, 0, -0.36); g.rotation.y = 0.25; room.add(g);
  mk(rbox(0.16, 0.010, 0.11, 0.01, 0.003), MATX.greyFrame, g, 0, 0.005, 0);
  for (const s of [-1, 1]) {
    mk(profileX([[0.05, 0.008], [0.03, 0.105], [-0.03, 0.105], [-0.05, 0.008]], 0.004, 0.001), MATX.greyFrame, g, s * 0.072, 0, 0);
    mk(lathe([[0, 0], [0.011, 0], [0.012, 0.006], [0.009, 0.012], [0, 0.013]], 24).rotateZ(-s * Math.PI / 2), MAT.black, g, s * 0.074, 0.09, 0);
  }
  mk(new THREE.CylinderGeometry(0.004, 0.004, 0.15, 12).rotateZ(Math.PI / 2), MAT.chrome, g, 0, 0.09, 0);
  const NC = 90, cards = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.135, 0.058, 0.0005).translate(0, 0.031, 0)), MATX.card, NC);
  for (let k = 0; k < NC; k++) { mtx.compose(tv.set(0, 0.09, 0), q0.setFromAxisAngle(xAx, Math.PI * 0.18 + k / NC * Math.PI * 2 + (R() - 0.5) * 0.02), sv.set(1, 0.95 + R() * 0.05, 1)); cards.setMatrixAt(k, mtx); }
  cards.castShadow = true; cards.receiveShadow = true; g.add(cards);
  contactShadow(room, -0.30, -0.36, 0.22, 0.17, 0.75, true, 0, 0.25);
}
/* 3. Bic Cristal ball pen: 6-sided clear polystyrene barrel, 149 x 13 mm with the cap [S58]; cap blue (GUESS) */
{
  const g = new THREE.Group(); g.position.set(0.31, 0.0066, 0.20); g.rotation.set(0, 0.9, Math.PI / 2); room.add(g);
  const barrel = mk(new THREE.CylinderGeometry(0.0062, 0.0062, 0.118, 6), MATX.clear, g, 0, -0.005, 0, true); barrel.renderOrder = 2;
  mk(new THREE.CylinderGeometry(0.0013, 0.0013, 0.112, 8), MATX.blue, g, 0, -0.004, 0);
  mk(new THREE.ConeGeometry(0.0062, 0.016, 6), MATX.clear, g, 0, -0.072, 0, true).rotation.x = Math.PI;
  mk(new THREE.CylinderGeometry(0.0055, 0.0058, 0.034, 20), MATX.blue, g, 0, 0.068, 0);
  mk(new THREE.BoxGeometry(0.002, 0.03, 0.004), MATX.blue, g, 0.0062, 0.064, 0);
  mk(new THREE.CylinderGeometry(0.0035, 0.0035, 0.006, 16), MATX.blue, g, 0, -0.054, 0);
  contactShadow(room, 0.31, 0.20, 0.17, 0.03, 0.55, true, 0, -0.9 + Math.PI / 2);
}
/* 4. correction fluid ("Mistake Out", 1956 [S59]): small bottle 60 mm, white fluid, brush in the cap (GUESS). Label: generic */
{
  const g = new THREE.Group(); g.position.set(0.31, 0, -0.14); room.add(g);
  const b = mk(lathe([[0, 0], [0.013, 0], [0.0145, 0.004], [0.0145, 0.03], [0.011, 0.038], [0.007, 0.041], [0.007, 0.045], [0, 0.045]], 32), MATX.glass, g, 0, 0, 0, true); b.renderOrder = 2;
  mk(lathe([[0, 0.001], [0.0125, 0.001], [0.0135, 0.004], [0.0135, 0.026], [0, 0.026]], 32), MATX.white, g);
  mk(new THREE.CylinderGeometry(0.0085, 0.0095, 0.020, 24), MAT.black, g, 0, 0.054, 0);
  const lc = makeCanvas(256, 96), lx = lc.getContext('2d');
  lx.fillStyle = '#e9e2c8'; lx.fillRect(0, 0, 256, 96); lx.fillStyle = '#1d3f8a'; lx.fillRect(0, 0, 256, 18); lx.fillRect(0, 78, 256, 18);
  lx.fillStyle = '#222'; lx.font = 'bold 22px Arial, sans-serif'; lx.textAlign = 'center'; lx.fillText('CORRECTION', 128, 47); lx.font = '18px Arial, sans-serif'; lx.fillText('FLUID  ·  WHITE', 128, 70);
  mk(new THREE.CylinderGeometry(0.0147, 0.0147, 0.016, 32, 1, true, -1.2, 2.4), keep(new THREE.MeshStandardMaterial({ map: canvasTex(lc, true), roughness: 0.8 })), g, 0, 0.017, 0);
  contactShadow(room, 0.31, -0.14, 0.06, 0.06, 0.7);
}
/* 5. spare typing element in a clear box: a chrome sphere 34.9 mm with a black lever on top [S16][S21]; box GUESS */
{
  const g = new THREE.Group(); g.position.set(0.36, 0, 0.03); g.rotation.y = -0.3; room.add(g);
  mk(rbox(0.050, 0.006, 0.050, 0.004, 0.002), MAT.black, g, 0, 0.003, 0);
  const e = new THREE.Group(); e.position.y = 0.006 + RB * 0.8; e.rotation.y = 1.3; g.add(e);
  mk(lathe(ballPts, 96), ballMat, e);
  mk(softBox(0.017, 0.0032, 0.0055, 0.0014, 6, 2, 2), MAT.black, e, 0, RB * Math.sin(LAT1 * Math.PI / 180) + 0.0012, 0);
  const lid = mk(rbox(0.048, 0.044, 0.048, 0.004, 0.002), MATX.clear, g, 0, 0.006 + 0.022, 0, true); lid.renderOrder = 2;
  const lc = makeCanvas(256, 64), lx = lc.getContext('2d');
  lx.fillStyle = '#f2efe4'; lx.fillRect(0, 0, 256, 64); lx.fillStyle = '#1b1b1b'; lx.font = 'bold 26px Arial, sans-serif'; lx.textAlign = 'center'; lx.fillText('COURIER 72', 128, 30);
  lx.font = '16px Arial, sans-serif'; lx.fillText('10 PITCH', 128, 52);
  mk(new THREE.PlaneGeometry(0.036, 0.009), keep(new THREE.MeshStandardMaterial({ map: canvasTex(lc, true), roughness: 0.8 })), g, 0, 0.0035, 0.0252, true);
  contactShadow(room, 0.36, 0.03, 0.08, 0.08, 0.7, true, 0, -0.3);
}
/* 6. heavy glass ashtray, 150 mm (GUESS) */
{
  const g = new THREE.Group(); g.position.set(-0.56, 0, 0.13); room.add(g);
  const pts = [[0, 0], [0.062, 0], [0.075, 0.006], [0.075, 0.026], [0.07, 0.03], [0.058, 0.03], [0.05, 0.012], [0, 0.012]];
  const a = mk(lathe(pts, 64), MATX.glass, g, 0, 0, 0, true); a.renderOrder = 2;
  for (let k = 0; k < 3; k++) { const n = mk(new THREE.CylinderGeometry(0.006, 0.006, 0.03, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), MATX.glass, g, 0, 0.031, 0, true); n.position.set(Math.cos(k * 2.09) * 0.066, 0.031, Math.sin(k * 2.09) * 0.066); n.rotation.y = -k * 2.09; n.renderOrder = 2; }
  contactShadow(room, -0.56, 0.13, 0.2, 0.2, 0.45);
}
/* 7. LP sleeve on the desk: card 315 mm square with a printed front (GUESS). The design is original. */
const sleeveC = texCanvas(512, 512, SEED * 61, (x, r, w, h) => {
  x.fillStyle = '#e9e3d2'; x.fillRect(0, 0, w, h);
  const cols = ['#d9541e', '#1f6f8b', '#e8b63a', '#232323'];
  for (let k = 0; k < 9; k++) { x.fillStyle = cols[k % 4]; x.globalAlpha = 0.85; x.beginPath(); x.arc(80 + (k % 3) * 150 + r() * 30, 150 + Math.floor(k / 3) * 95 + r() * 20, 30 + r() * 46, 0, Math.PI * 2); x.fill(); }
  x.globalAlpha = 1; x.fillStyle = '#232323'; x.fillRect(0, 0, w, 64);
  x.fillStyle = '#f2eee2'; x.font = 'bold 40px "Futura", "Century Gothic", Arial, sans-serif'; x.textAlign = 'left'; x.fillText('STEREO', 24, 46);
  x.font = '22px "Futura", "Century Gothic", Arial, sans-serif'; x.textAlign = 'right'; x.fillText('33⅓', 488, 44);
  x.fillStyle = '#232323'; x.textAlign = 'left'; x.font = 'bold 44px "Futura", "Century Gothic", Arial, sans-serif'; x.fillText('After Five', 28, 470);
  x.font = '20px "Futura", "Century Gothic", Arial, sans-serif'; x.fillText('The Quartet in Stereo Sound', 30, 498);
  grain(x, w, h, 10, r);
});
{
  const m = mk(new THREE.BoxGeometry(0.315, 0.003, 0.315), [MATX.card, MATX.card, keep(new THREE.MeshStandardMaterial({ map: canvasTex(sleeveC, true), roughness: 0.7 })), MATX.card, MATX.card, MATX.card], room, 0.56, 0.0015, 0.06);
  m.rotation.y = -0.22;
  contactShadow(room, 0.56, 0.06, 0.36, 0.36, 0.45, true, 0, -0.22);
}
/* blank sheets, 8.5 x 11 in [S47] */
{
  const g = new THREE.Group(); g.position.set(-0.36, 0, -0.04); g.rotation.y = 0.12; room.add(g);
  const pm = keep(new THREE.MeshStandardMaterial({ color: 0xeceae2, roughness: 0.9, bumpMap: tPaperBump, bumpScale: 0.25 }));
  for (let k = 0; k < 8; k++) mk(new THREE.BoxGeometry(0.216, 0.0009, 0.279), pm, g, (R() - 0.5) * 0.004, 0.00045 + k * 0.001, (R() - 0.5) * 0.004).rotation.y = (R() - 0.5) * 0.03;
  contactShadow(room, -0.36, -0.04, 0.26, 0.32, 0.4, true, 0, 0.12);
}

/* low walnut shelf against the back wall, left of the hi-fi (GUESS, the "low walnut shelf" of reference.md C2), with:
 * the dust cover of the turntable, off for play [S39][S40] (clear plastic box, shape GUESS); 3 LP sleeves lying flat [S38];
 * 2 spare typing elements in clear boxes [S16][S21] */
{
  const SX = -0.07, SZ = WALL_Z + 0.185, TOPH = 0.69;            // centre x and z, height of the top above the floor. GUESS
  const g = new THREE.Group(); g.position.set(SX, FLOOR, SZ); room.add(g);
  mk(rbox(0.74, TOPH - 0.05, 0.36, 0.005, 0.004), MAT.walnut, g, 0, 0.05 + (TOPH - 0.05) / 2, 0);
  mk(new THREE.BoxGeometry(0.70, 0.05, 0.32), MAT.matte, g, 0, 0.025, -0.01, true);
  for (const s of [-1, 1]) mk(new THREE.BoxGeometry(0.008, 0.06, 0.008), MAT.chrome, g, s * 0.02, 0.36, 0.181);   // door pulls
  mk(new THREE.BoxGeometry(0.002, TOPH - 0.09, 0.004), MAT.matte, g, 0, 0.05 + (TOPH - 0.05) / 2, 0.181, true);        // the joint of the 2 doors
  const top = TOPH;
  const cover = mk(rbox(0.425, 0.07, 0.324, 0.012, 0.004), MATX.clear, g, -0.165, top + 0.035, 0.0, true); cover.renderOrder = 2;
  const lpTop = keep(new THREE.MeshStandardMaterial({ map: canvasTex(sleeveC, true), roughness: 0.7 }));
  mk(new THREE.BoxGeometry(0.315, 0.009, 0.315), MATX.card, g, 0.205, top + 0.0045, 0);   // the stack: one box, the print on top
  const lt = mk(new THREE.PlaneGeometry(0.315, 0.315), lpTop, g, 0.205, top + 0.0091, 0, true); lt.rotation.x = -Math.PI / 2;
  for (let k = 0; k < 2; k++) {
    const e = new THREE.Group(); e.position.set(0.15 + k * 0.07, top + 0.009, 0.06 - k * 0.02); e.rotation.y = 0.2 + k * 0.5; g.add(e);
    mk(rbox(0.050, 0.006, 0.050, 0.004, 0.002), MAT.black, e, 0, 0.003, 0);
    const b = new THREE.Group(); b.position.y = 0.006 + RB * 0.8; e.add(b);
    mk(lathe(ballPts, 32), ballMat, b);
    const lid = mk(rbox(0.048, 0.044, 0.048, 0.004, 0.002), MATX.clear, e, 0, 0.028, 0, true); lid.renderOrder = 2;
    contactShadow(e, 0, 0, 0.075, 0.075, 0.6, true, 0);
  }
  contactShadow(g, -0.165, 0, 0.5, 0.39, 0.45, true, top);
  contactShadow(g, 0.205, 0, 0.37, 0.37, 0.45, true, top);
  contactShadow(g, 0, 0, 0.9, 0.5, 0.75, true, 0);
}

/* ============================================ the music device ============================================ */
/* AR XA turntable [S39]: 425 W x 324 D (axis order GUESS), oiled walnut base [S39][S46], "Smooth Grey" top plate [S39],
 * 2-part aluminium platter (outer 295 mm, GUESS) with a foam mat [S42], 3 mm gap to the plate [S42], a thin arm at the right
 * rear with a plastic headshell, a counterweight and a black rest [S39][S41][S42], one on/off switch [S41] at the front left
 * (GUESS). The dust cover is not shown: it is off for play [S39]. The rest of the hi-fi (cabinet, amplifier, 2 speakers): GUESS. */
const hifi = new THREE.Group(); hifi.position.set(1.12, FLOOR, WALL_Z + 0.25); hifi.userData.pick = 'player'; scene.add(hifi);
const CW = 1.60, CD = 0.44, CH = 0.44, LEG = 0.17, CTOP = LEG + CH;
const MATH = {
  plate: keep(new THREE.MeshStandardMaterial({ color: 0x8e9092, metalness: 0.75, roughness: 0.42 })),        // palette #8e9092
  platter: keep(new THREE.MeshStandardMaterial({ color: 0xb9bcbe, metalness: 1, roughness: 0.26, roughnessMap: tBrushed })),   // palette #b9bcbe
  foam: keep(new THREE.MeshStandardMaterial({ color: 0x2e2f30, roughness: 1 })),
  cloth: null, gold: keep(new THREE.MeshStandardMaterial({ color: 0xcdb98a, metalness: 1, roughness: 0.32, roughnessMap: tBrushed })),
  tan: keep(new THREE.MeshPhysicalMaterial({ color: 0xb08a5c, roughness: 0.4, clearcoat: 0.5 })),
  brass: keep(new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 1, roughness: 0.3 })),
  lamp: keep(new THREE.MeshStandardMaterial({ color: 0x5a3008, emissive: 0xff9a2a, emissiveIntensity: 0, roughness: 0.2 })),
};
{
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {                                          // tapered legs with brass ferrules
    const l = mk(lathe([[0, 0], [0.012, 0], [0.012, 0.03], [0.014, 0.032], [0.02, LEG], [0, LEG]], 20), MAT.walnut, hifi, sx * (CW / 2 - 0.08), 0, sz * (CD / 2 - 0.07));
    l.rotation.set(-sz * 0.06, 0, sx * 0.06);
    mk(new THREE.CylinderGeometry(0.0125, 0.0125, 0.03, 20), MATH.brass, hifi, sx * (CW / 2 - 0.08) + sx * 0.0, 0.015, sz * (CD / 2 - 0.07));
  }
  mk(rbox(CW, CH, CD, 0.006, 0.004), MAT.walnut, hifi, 0, LEG + CH / 2, 0);
  mk(rbox(CW + 0.01, 0.022, CD + 0.012, 0.006, 0.006), MAT.walnut, hifi, 0, CTOP - 0.011, 0);
  for (const s of [-1, 1]) {                                                                       // 2 doors and a bay for records
    mk(rbox(0.50, CH - 0.06, 0.014, 0.004, 0.003), MAT.walnut, hifi, s * 0.53, LEG + CH / 2, CD / 2 + 0.004);
    mk(new THREE.BoxGeometry(0.008, 0.08, 0.012), MATH.brass, hifi, s * 0.30, LEG + CH / 2, CD / 2 + 0.017);
  }
  mk(new THREE.BoxGeometry(0.54, CH - 0.06, 0.004), keep(new THREE.MeshStandardMaterial({ color: 0x1c130c, roughness: 0.8 })), hifi, 0, LEG + CH / 2, CD / 2 - 0.30, true);
  const NR = 34, recs = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.0045, 0.31, 0.31)), keep(new THREE.MeshStandardMaterial({ roughness: 0.75 })), NR), cl = new THREE.Color();
  const rc = [0xc8452a, 0x1f5f7a, 0xe0b23a, 0x2a2a2a, 0xe8e2d0, 0x6d8a3c, 0x8a2f4a, 0xd27a2a];
  for (let k = 0; k < NR; k++) { mtx.compose(tv.set(-0.25 + k * 0.0145 + R() * 0.002, LEG + 0.04 + 0.155, 0.05), q0.setFromAxisAngle(V3(0, 0, 1), (R() - 0.5) * 0.04 + (k > 30 ? 0.12 : 0)), sv.set(1, 1, 1)); recs.setMatrixAt(k, mtx); recs.setColorAt(k, cl.setHex(rc[Math.floor(R() * rc.length)]).multiplyScalar(0.7 + R() * 0.3)); }
  recs.receiveShadow = true; hifi.add(recs);
  contactShadow(hifi, 0, 0, CW + 0.25, CD + 0.3, 0.75, true);
  contactShadow(hifi, 0, 0.02, CW - 0.1, CD - 0.05, 0.45, true);
}
/* 2 bookshelf speakers, walnut with a cloth grille, 300 x 480 x 250 mm (GUESS) */
{
  const c = makeCanvas(256, 256), x = c.getContext('2d'), r = rng(SEED * 67);
  x.fillStyle = '#cfc5ad'; x.fillRect(0, 0, 256, 256);
  for (let j = 0; j < 256; j += 2) { x.fillStyle = 'rgba(70,60,40,' + (0.08 + r() * 0.08) + ')'; x.fillRect(0, j, 256, 1); }
  for (let i = 0; i < 256; i += 2) { x.fillStyle = 'rgba(255,250,235,' + (0.05 + r() * 0.06) + ')'; x.fillRect(i, 0, 1, 256); }
  const tc = canvasTex(c, true, true); tc.repeat.set(5, 9);
  MATH.cloth = keep(new THREE.MeshStandardMaterial({ map: tc, roughness: 0.95 }));
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * 0.64, CTOP, -0.03); g.rotation.y = -s * 0.08; hifi.add(g);
    mk(rbox(0.30, 0.48, 0.25, 0.006, 0.004), MAT.walnut, g, 0, 0.24, 0);
    mk(new THREE.PlaneGeometry(0.266, 0.446), MATH.cloth, g, 0, 0.24, 0.1255, true);
    contactShadow(hifi, s * 0.62, -0.03, 0.42, 0.36, 0.6, true, CTOP);
  }
}
/* stereo amplifier: walnut sleeve, brushed metal front, round knobs, a pilot lamp (GUESS) */
{
  const g = new THREE.Group(); g.position.set(0.25, CTOP, 0.02); hifi.add(g);
  mk(rbox(0.38, 0.125, 0.28, 0.005, 0.004), MAT.walnut, g, 0, 0.0625, 0);
  const c = makeCanvas(1024, 320), x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 320); gr.addColorStop(0, '#e2d6b4'); gr.addColorStop(1, '#b9ab86'); x.fillStyle = gr; x.fillRect(0, 0, 1024, 320);
  for (let j = 0; j < 320; j++) { x.fillStyle = 'rgba(255,255,255,' + (R() * 0.06) + ')'; x.fillRect(0, j, 1024, 1); }
  x.fillStyle = '#3a3226'; x.font = 'bold 30px "Century Gothic", Arial, sans-serif'; x.textAlign = 'center'; x.fillText('STEREO  AMPLIFIER', 512, 58);
  x.font = '20px Arial, sans-serif';
  const labs = ['SELECTOR', 'BASS', 'TREBLE', 'BALANCE', 'VOLUME'];
  labs.forEach((l, i) => x.fillText(l, 150 + i * 180, 282));
  x.fillRect(40, 92, 944, 2);
  const front = mk(new THREE.PlaneGeometry(0.36, 0.11), keep(new THREE.MeshStandardMaterial({ map: canvasTex(c, true), metalness: 0.7, roughness: 0.35 })), g, 0, 0.0625, 0.1405, true);
  void front;
  const kg = lathe([[0, 0], [0.013, 0], [0.0135, 0.004], [0.011, 0.016], [0.0105, 0.018], [0, 0.018]], 32).rotateX(Math.PI / 2);
  for (let i = 0; i < 5; i++) { const kx = -0.18 + (150 + i * 180) / 1024 * 0.36; mk(kg, MAT.black, g, kx, 0.055, 0.1405); mk(new THREE.CylinderGeometry(0.0145, 0.0145, 0.002, 32).rotateX(Math.PI / 2), MAT.chrome, g, kx, 0.055, 0.1415); }
  mk(new THREE.SphereGeometry(0.0045, 16, 12), MATH.lamp, g, 0.155, 0.094, 0.141);
  contactShadow(hifi, 0.25, 0.02, 0.46, 0.36, 0.6, true, CTOP);
}
/* the turntable */
const tt = new THREE.Group(); tt.position.set(-0.13, CTOP, 0.03); hifi.add(tt);
const TTO = V3(-0.040, 0, 0.0);                             // platter centre on the plate. GUESS
mk(rbox(0.425, 0.060, 0.324, 0.008, 0.004), MAT.walnut, tt, 0, 0.030, 0);
mk(rbox(0.405, 0.004, 0.304, 0.004, 0.0015), MATH.plate, tt, 0, 0.061, 0);
mk(new THREE.CylinderGeometry(0.052, 0.052, 0.004, 48), MAT.dark, tt, TTO.x, 0.064, TTO.z);
const spin = new THREE.Group(); spin.position.set(TTO.x, 0.066, TTO.z); tt.add(spin);
mk(lathe([[0.0001, 0], [0.144, 0], [0.1475, 0.003], [0.1475, 0.019], [0.145, 0.022], [0.0001, 0.022]], 120), MATH.platter, spin);
mk(new THREE.CylinderGeometry(0.146, 0.146, 0.003, 120), MATH.foam, spin, 0, 0.0235, 0);
const discC = makeCanvas(1024, 1024), discDir = makeCanvas(256, 256);
{
  const x = discC.getContext('2d'), r = rng(SEED * 71);
  x.fillStyle = '#0b0b0b'; x.fillRect(0, 0, 1024, 1024);                                   // black vinyl [S38], palette #0b0b0b
  for (let k = 200; k < 505; k += 1.2) { x.strokeStyle = 'rgba(255,255,255,' + (0.010 + r() * 0.025) + ')'; x.lineWidth = 0.7; x.beginPath(); x.arc(512, 512, k, 0, Math.PI * 2); x.stroke(); }
  for (const k of [262, 318, 372, 430, 484]) { x.strokeStyle = 'rgba(0,0,0,0.9)'; x.lineWidth = 2.5; x.beginPath(); x.arc(512, 512, k, 0, Math.PI * 2); x.stroke(); }   // the gaps between the tracks
  x.strokeStyle = 'rgba(255,255,255,0.05)'; x.lineWidth = 6; x.beginPath(); x.arc(512, 512, 500, 0, Math.PI * 2); x.stroke();
  /* label: 4 in, original design */
  x.fillStyle = '#d9541e'; x.beginPath(); x.arc(512, 512, 168, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#f2eee2'; x.beginPath(); x.arc(512, 512, 168, -0.5, 0.55); x.lineTo(512, 512); x.fill();
  x.fillStyle = '#232323'; x.textAlign = 'center'; x.font = 'bold 30px "Futura", "Century Gothic", Arial, sans-serif'; x.fillText('AFTER FIVE', 512, 440);
  x.font = '20px Arial, sans-serif'; x.fillText('STEREO  ·  33⅓ RPM', 512, 600); x.fillText('SIDE 1', 512, 630);
  x.fillStyle = '#0b0b0b'; x.beginPath(); x.arc(512, 512, 8, 0, Math.PI * 2); x.fill();
  const d = discDir.getContext('2d'), im = d.createImageData(256, 256);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const a = Math.atan2(127.5 - j, i - 127.5), k = (j * 256 + i) * 4;           // tangent direction of the grooves, in UV space
    im.data[k] = (-Math.sin(a) * 0.5 + 0.5) * 255; im.data[k + 1] = (Math.cos(a) * 0.5 + 0.5) * 255; im.data[k + 2] = 255; im.data[k + 3] = 255;
  }
  d.putImageData(im, 0, 0);
}
const discMat = keep(new THREE.MeshPhysicalMaterial({ map: canvasTex(discC, true), roughness: 0.3, anisotropy: 0.85, anisotropyMap: canvasTex(discDir, false), clearcoat: 0.5, clearcoatRoughness: 0.15 }));
const vinylEdge = keep(new THREE.MeshPhysicalMaterial({ color: 0x0b0b0b, roughness: 0.3, clearcoat: 0.6 }));
const lp = mk(new THREE.CylinderGeometry(0.1524, 0.1524, 0.0018, 120), [vinylEdge, discMat, discMat], spin, 0, 0.0259, 0);   // 12 in LP [S38]
lp.rotation.y = 1.0;
mk(new THREE.CylinderGeometry(0.0036, 0.0036, 0.016, 16), MAT.chrome, spin, 0, 0.03, 0);
/* tone arm */
const PIV = V3(0.155, 0.063, -0.105), ARM_L = 0.215;
mk(lathe([[0, 0], [0.019, 0], [0.019, 0.006], [0.012, 0.01], [0.011, 0.034], [0, 0.034]], 40), MAT.dark, tt, PIV.x, PIV.y, PIV.z);
const armYaw = new THREE.Group(); armYaw.position.set(PIV.x, PIV.y + 0.036, PIV.z); tt.add(armYaw);
const armLift = new THREE.Group(); armYaw.add(armLift);
mk(tube([[-0.035, 0.0, 0.0], [0.04, 0.0, 0.0], [0.11, 0.0, -0.006], [0.17, 0.0, 0.002], [ARM_L - 0.026, 0.0, 0.006]], 0.0036, 60), MATH.platter, armLift);   // thin metal tube [S39]
mk(new THREE.CylinderGeometry(0.012, 0.012, 0.022, 28).rotateZ(Math.PI / 2), MAT.black, armLift, -0.047, 0, 0);   // counterweight [S39]
mk(new THREE.CylinderGeometry(0.006, 0.006, 0.012, 16).rotateZ(Math.PI / 2), MAT.chrome, armLift, -0.03, 0, 0);
const shell = new THREE.Group(); shell.position.set(ARM_L - 0.014, -0.004, 0.006); shell.rotation.y = -0.38; armLift.add(shell);   // plastic headshell, tan [S39]
mk(softBox(0.032, 0.005, 0.017, 0.0018, 4, 2, 3), MATH.tan, shell);
mk(new THREE.BoxGeometry(0.014, 0.006, 0.010), MAT.black, shell, 0.004, -0.005, 0);
mk(new THREE.BoxGeometry(0.004, 0.002, 0.014), MATH.tan, shell, 0.016, 0.001, 0.008);
mk(new THREE.CylinderGeometry(0.004, 0.005, 0.034, 16), MAT.black, tt, 0.170, 0.063 + 0.017, 0.105);   // arm rest, black plastic [S42]
mk(rbox(0.026, 0.004, 0.018, 0.003, 0.001), MAT.chrome, tt, -0.175, 0.064, 0.125);                  // on/off switch [S41], position GUESS
const ttSwitch = mk(new THREE.BoxGeometry(0.003, 0.010, 0.003), MAT.chrome, tt, -0.175, 0.069, 0.125);
contactShadow(hifi, tt.position.x, tt.position.z, 0.5, 0.4, 0.75, true, CTOP);
const O2P = Math.atan2(TTO.z - PIV.z, TTO.x - PIV.x), D_OP = Math.hypot(TTO.x - PIV.x, TTO.z - PIV.z);
const armAngleFor = (r) => O2P - Math.acos(clamp((ARM_L * ARM_L + D_OP * D_OP - r * r) / (2 * ARM_L * D_OP), -1, 1));
const ARM_REST = 95 * Math.PI / 180;
let musicOn = false, spinW = 0, armProg = 0, armDown = 0;

/* ============================================ camera and views ============================================ */
const PW = P.clone().add(machine.position);                // the print point in world coordinates (x follows the carrier)
const VIEWS = {
  machine: { tx: 0.0, ty: 0.095, tz: MZ - 0.04, yaw: 0.20, pitch: 0.36, dist: 1.55, fov: 22, halfW: 0.33, narrowHalfW: 0.29, narrowDx: 0 },
  line: { tx: -SHEET_WM / 2 + 0.072, ty: PW.y + 0.004, tz: PW.z + 0.002, yaw: -0.24, pitch: 0.46, dist: 0.40, fov: 12, halfW: 0.082, narrowHalfW: 0.042 },
  room: { tx: 0.72, ty: -0.10, tz: -0.70, yaw: -0.42, pitch: 0.30, dist: 3.0, fov: 34, halfW: 1.0, narrowHalfW: 0.8 }
};
const viewNames = Object.keys(VIEWS);
const cur = Object.assign({}, VIEWS.machine), orb = { yaw: 0, pitch: 0, zoom: 1 };
let from = null, to = null, tView = 1, orbFrom = null, aspect = 1.6, viewName = 'machine';
function applyCam() {
  const yaw = cur.yaw + orb.yaw, pitch = clamp(cur.pitch + orb.pitch, 0.08, 1.25), dist = cur.dist * orb.zoom;
  const tx = cur.tx + (aspect < 1 ? (1 - aspect) * (cur.narrowDx || 0) : 0);
  camera.position.set(tx + dist * Math.sin(yaw) * Math.cos(pitch), cur.ty + dist * Math.sin(pitch), cur.tz + dist * Math.cos(yaw) * Math.cos(pitch));
  camera.position.x = clamp(camera.position.x, WALL_L + 0.15, WALL_R - 0.15);       // the camera stays inside the room
  camera.position.y = clamp(camera.position.y, FLOOR + 0.15, CEIL - 0.15);
  camera.position.z = clamp(camera.position.z, WALL_Z + 0.15, WALL_Z + 4.05);
  camera.lookAt(tx, cur.ty, cur.tz);
  const hw = aspect < 1 ? Math.max(cur.narrowHalfW, cur.halfW * aspect) : cur.halfW;
  const need = 2 * Math.atan(hw / cur.dist / aspect) * 180 / Math.PI;
  const fov = Math.max(cur.fov, need);
  if (Math.abs(fov - camera.fov) > 1e-4 || camera.aspect !== aspect) { camera.fov = fov; camera.aspect = aspect; camera.updateProjectionMatrix(); }
}
function setView(name, now) {
  if (!VIEWS[name]) return;
  viewName = name; to = VIEWS[name];
  if (now) { Object.assign(cur, to); orb.yaw = orb.pitch = 0; orb.zoom = 1; tView = 1; from = null; applyCam(); return; }
  from = Object.assign({}, cur); orbFrom = Object.assign({}, orb); tView = 0;
}

/* ============================================ motion ============================================ */
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
let frameMs = 16.7, renderMs = 0;
const hum = rng(SEED * 83 + 1);
let elTilt = 0, elRot = 0, latchT = 0, latchR = 0, hold = 0, strike = 0, retT = 0, idxT = 0, lfPending = false;
const SETTLE_T = 0.8;
let settleT = SETTLE_T, vibT = 0, vibX = 0, vibY = 0;
const shortArc = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
function update(s, dt) {
  dt = clamp(dt || 0.016, 0, 0.1);
  frameMs += (dt * 1000 - frameMs) * 0.05;
  const flags = s[SNAP.FLAGS] | 0;
  /* motor: a slight hum of the covers and keys (below 0.05 mm, so the text in the close view does not shake) */
  const m = s[SNAP.MOTOR] || 0;
  body.position.set((hum() - 0.5) * 0.00003 * m, (hum() - 0.5) * 0.00004 * m, 0);
  /* motor: the sheet edge and the element shake by 0.7 mm (about 1.4 screen pixels in the machine view at 1280 px) while the motor runs */
  vibT += dt * 2 * Math.PI * 24;
  paper.position.y = Math.sin(vibT) * 0.0007 * m; paper.position.x = Math.sin(vibT * 0.71 + 1) * 0.0004 * m;
  vibX = Math.sin(vibT * 1.13 + 2) * 0.0007 * m; vibY = Math.sin(vibT * 0.87) * 0.0005 * m;
  /* power switch */
  swAng += ((s[SNAP.POWER] > 0.5 ? 0.17 : -0.17) - swAng) * Math.min(1, dt * 30);
  rocker.rotation.x = -swAng;
  /* carrier and platen */
  const cx = colX(s[SNAP.X]);
  carrier.position.x = cx; pointer.position.x = cx;
  const line = s[SNAP.LINE];
  const moving = sheetMotion(dt);
  platen.rotation.x = -(line * LINE_M - feed) / PR;
  if (line !== paperShown || moving) { paperShown = line; placePaper(line); }
  /* element: tilt and turn from the snapshot; at a print, the pose of the print event for 2 frames, on the platen */
  if (hold > 0) { elTilt = latchT; elRot = latchR; hold--; strike = 1; }
  else {
    const k = Math.min(1, dt * 45);
    elTilt += (s[SNAP.TILT] - elTilt) * k;
    elRot += shortArc(elRot, s[SNAP.ROTATION]) * k;
    strike = Math.max(s[SNAP.STRIKE] || 0, strike - dt / 0.035);
  }
  /* switch-on: the drive takes up the slack in the tilt and rotate train, the element shakes and settles to its home pose
   * (a damped swing of up to about 20 degrees for 0.8 s). CHOICE: a visible sign of the motor besides the red band [S21] */
  settleT = Math.min(SETTLE_T, settleT + dt);
  const sw = settleT < SETTLE_T ? Math.exp(-settleT * 6) * Math.sin(settleT * 34) * (1 - settleT / SETTLE_T) : 0;
  tiltG.rotation.x = TILT_RAD(elTilt) + sw * 0.14;
  spinG.rotation.y = elRot * Math.PI / 180 + sw * 0.5;
  tiltG.position.set(vibX, elemY + vibY, BALL_Z + STRIKE_GAP * (1 - smooth(0, 1, strike)));
  /* ribbon */
  if (ribHold > 0) ribHold -= dt;
  ribLift += ((ribHold > 0 ? 1 : 0) - ribLift) * Math.min(1, dt * (ribHold > 0 ? 60 : 25));
  ribG.position.y = -RIB_DROP * (1 - ribLift);
  /* keys */
  if (lfPending) { lfPending = false; if (flags & E.FLAG_RETURN) retT = 0.16; else idxT = 0.16; }
  retT = Math.max(0, retT - dt); idxT = Math.max(0, idxT - dt);
  let kc = false;
  const shk = s[SNAP.SHIFTKEY] | 0;
  const want = (i) => i < NB ? s[SNAP.KEYS + i] > 0 : i === NB + 3 ? (shk & 1) !== 0 : i === NB + 7 ? (shk & 2) !== 0 : i === NB + 4 ? s[SNAP.BACKSPACE] > 0 : i === K_IDX ? idxT > 0 : i === K_RET ? retT > 0 : false;
  for (let i = 0; i < NK; i++) {
    const t = want(i) ? 1 : 0;
    keyDip[i] += (t - keyDip[i]) * Math.min(1, dt * (t ? 45 : 22));
    if (Math.abs(keyDip[i] - keyShown[i]) > 1e-3) { keyShown[i] = keyDip[i]; placeKey(i); kc = true; }
  }
  if (kc) { caps.instanceMatrix.needsUpdate = stems.instanceMatrix.needsUpdate = true; }
  spaceDip += ((s[SNAP.SPACE] > 0 ? 1 : 0) - spaceDip) * Math.min(1, dt * 35);
  spaceBar.position.y = -0.0035 * spaceDip;
  /* music device: 33 1/3 rpm [S46]; 1 turn = 1.8 s */
  const w = musicOn ? 33.333 * Math.PI * 2 / 60 : 0;
  spinW += (w - spinW) * Math.min(1, dt * (musicOn ? 1.6 : 0.8));
  spin.rotation.y -= spinW * dt;
  armDown += ((musicOn ? 1 : 0) - armDown) * Math.min(1, dt * 1.8);
  if (musicOn) armProg = Math.min(1, armProg + dt / (22 * 60));   // one side: about 22 minutes [S38]
  const aPlay = armAngleFor(0.146 - 0.084 * armProg);
  armYaw.rotation.y = -(ARM_REST + (aPlay - ARM_REST) * smooth(0, 0.6, armDown));
  armLift.rotation.z = 0.10 * (1 - smooth(0.55, 1, armDown));
  MATH.lamp.emissiveIntensity = 2.2 * smooth(0, 0.3, armDown);
  ttSwitch.rotation.z = musicOn ? -0.5 : 0.5;
  /* camera. The line view follows the carrier: the print point at the right third of the frame. */
  const lineTx = PW.x + Math.max(cx - (aspect < 1 ? 0.018 : 0.036), -SHEET_WM / 2 + (aspect < 1 ? 0.045 : 0.072));   // near the margin: keep the paper edge at the frame edge
  VIEWS.line.tx += (lineTx - VIEWS.line.tx) * Math.min(1, dt * 2.5);
  if (viewName === 'line' && tView >= 1) cur.tx = VIEWS.line.tx;
  if (tView < 1 && from) {
    tView = Math.min(1, tView + dt / 1.1);
    const k = easeIO(tView);
    for (const n of ['tx', 'ty', 'tz', 'yaw', 'pitch', 'dist', 'fov', 'halfW', 'narrowHalfW', 'narrowDx']) cur[n] = (from[n] || 0) + ((to[n] || 0) - (from[n] || 0)) * k;
    orb.yaw = orbFrom.yaw * (1 - k); orb.pitch = orbFrom.pitch * (1 - k); orb.zoom = orbFrom.zoom + (1 - orbFrom.zoom) * k;
  }
  applyCam();
  const t0 = performance.now();
  renderer.render(scene, camera);
  renderMs += (performance.now() - t0 - renderMs) * 0.05;
}
function event(ev) {
  if (!ev) return;
  if (ev.type === 'print') {
    stamp(ev);
    latchT = typeof ev.tilt === 'number' ? ev.tilt : latchT; latchR = typeof ev.rotation === 'number' ? ev.rotation : latchR;
    hold = 2; ribHold = Math.max(ribHold, 0.035);
  } else if (ev.type === 'cycleStart') ribHold = Math.max(ribHold, 0.07);
  else if (ev.type === 'returnStart') retT = 0.18;
  else if (ev.type === 'linefeed') lfPending = true;
  else if (ev.type === 'motorOn') settleT = 0;
}
function newSheet() {                                     // returns at once; the motion runs in update()
  ghostC.getContext('2d').drawImage(sheet, 0, 0, ghostC.width, ghostC.height); ghostTex.needsUpdate = true;
  for (const k of ['position', 'normal', 'uv']) { ghostGeo.attributes[k].array.set(paperGeo.attributes[k].array); ghostGeo.attributes[k].needsUpdate = true; }
  ghost.position.set(0, 0, 0); ghost.material.opacity = 1; ghost.visible = true; sheetT = 0; feed = FEED_D;
  sc.setTransform(1, 0, 0, 1, 0, 0); sc.globalAlpha = 1; sc.globalCompositeOperation = 'source-over'; sc.filter = 'none';
  sc.drawImage(paperBase, 0, 0);
  if (sheetTex) { sheetTex.needsUpdate = true; uploadsFull++; }
}
function replay(prints) {
  for (const ev of prints || []) if (ev && ev.type === 'print') stamp(ev, sc, true);
  if (sheetTex) { sheetTex.needsUpdate = true; uploadsFull++; }
}
function renderSheet(prints) {
  const out = makeCanvas(SW, SH), oc = out.getContext('2d');
  oc.drawImage(paperBase, 0, 0);
  for (const ev of prints || []) if (ev && ev.type === 'print') stamp(ev, oc, true);
  return out;
}
function pick(x, y) {
  const r = canvas.getBoundingClientRect();
  ndc.set((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([hifi, machine], true);
  for (const h of hits) { let o = h.object; while (o) { if (o.userData.pick) return o.userData.pick; o = o.parent; } }
  return null;
}
function resize(w, h) {
  if (!w || !h) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  aspect = w / h; applyCam();
}
function dispose() {
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
  for (const d of disposables) if (d && d.dispose) d.dispose();
  const gl = renderer.getContext();                       // the next scene on this canvas gets the same context: reset the upload flags
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  renderer.dispose();
}
setView('machine', true);
const api = {
  update, event, setView, resize, pick, dispose, newSheet, replay, renderSheet,
  views: viewNames,
  get view() { return viewName; },
  orbit(dx, dy) { orb.yaw = clamp(orb.yaw - dx * 0.004, -0.6, 0.6); orb.pitch = clamp(orb.pitch + dy * 0.003, -0.3, 0.35); },
  zoom(d) { orb.zoom = clamp(orb.zoom * Math.exp(d * 0.001), 0.65, 1.5); },
  setMusic(on) { musicOn = !!on; },
  setReady() {},
  stats() { const i = renderer.info; return { frameMs, renderMs, calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, sheetFull: uploadsFull, sheetPatches: uploadsPatch }; },
  _debug: { THREE, scene, camera, renderer, VIEWS, cur, orb, key, key2, fill, day, machine, body, carrier, tiltG, spinG, platen, hifi, tt, spin, MAT, MATH, colX }
};
return api;
}

globalThis.buildSceneC = buildSceneC;
})();
