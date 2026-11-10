/* scene-b.js - the 3D picture of setting B: a writer's room in 1927, a Remington Portable No. 2 and a
 * Victor Orthophonic Victrola "Credenza". A classic script (it must work from file://). It defines one global.
 *
 * ================================ SCENE INTERFACE (settings A, B and C use the same one) ================================
 *   const scene = buildSceneB(THREE, canvas, options)
 *     THREE    the three.js 0.186.1 module namespace. The page loads it and gives it. The scene loads nothing.
 *     canvas   the <canvas> that the scene draws on. The scene makes the WebGLRenderer. It throws if WebGL fails.
 *     options  { engine: the engine class (static tables K, KEYS, ROWS, SNAP, FLAG_JAM, FLAG_LOCK, FLAG_RETURN),
 *                seed: integer (default 1) }
 *   The scene owns the sheet: the 2D canvas of the paper, the ink and the texture upload. The page keeps the text grid.
 *   Required methods:
 *     scene.update(snap, dt)    snap: Float32Array in the layout engine.SNAP. dt: s since the last call.
 *                               Moves all parts, moves the camera, and renders one frame. Call it once per animation frame.
 *     scene.event(ev)           one engine event. The scene reads these fields:
 *                               print   { bar, ch, column, line, shift, force, r }  -> ink on the sheet; the bar is
 *                                       drawn at the print point for at least one frame; the ribbon lifts.
 *                               drive   { bar }  -> no action: the bar and ribbon follow the bar position in snap.
 *                               jam     { bars } -> the bars shake once, then stay stuck.
 *                               release { bars }, space, backspace, bell, returnStart, returnEnd, linefeed -> small motions.
 *                               Unknown types are ignored.
 *     scene.setView(name, now)  name: one of scene.views ('machine' | 'line' | 'room'). Eased move of 1.1 s; now = true jumps.
 *                               'line' follows the typed line as the carriage moves.
 *     scene.resize(w, h)        CSS pixels of the canvas. Pixel ratio = min(devicePixelRatio, 2).
 *     scene.pick(x, y)          CSS pixels from the top-left corner of the canvas. Returns an id or null:
 *                               'player' (the music device), 'bars' (the type bars), 'sheet', 'machine'.
 *     scene.dispose()           frees the GPU objects and the renderer. The canvas can get a new scene after this.
 *   Sheet methods (the page calls each one only if it exists, so a scene without them still runs):
 *     scene.newSheet()          takes the current sheet out and puts a blank one in. The next print is on the new sheet.
 *     scene.replay(prints)      prints: an array of the print events that scene.event(ev) gets. Draws all of them on the
 *                               current sheet at once, with no part motion. The ink is the same as in live typing.
 *     scene.renderSheet(prints) returns a NEW HTMLCanvasElement: the full flat sheet, the paper and these prints.
 *                               It is not connected to the 3D scene and it does not change the live sheet.
 *   Extensions (optional for other settings; the page checks that they exist):
 *     scene.views               array of view names. scene.view = the current name.
 *     scene.orbit(dx, dy)       pointer drag in CSS pixels. Turns the camera around the view target, in limits.
 *     scene.zoom(delta)         wheel deltaY. Changes the camera distance, in limits.
 *     scene.setMusic(on)        true: the disc turns and the tone arm is on the disc. false: they stop.
 *     scene.setReady(on)        true: the machine is ready (the type-bar fan rises). false: the fan goes down flat.
 *     scene.stats()             { frameMs, renderMs, calls, triangles, geometries, textures, sheetFull, sheetPatches }
 *     scene._debug              internal objects for checks in the browser tools. Not part of the interface.
 * ===================================================================================================================
 * Units: metres. The desk top is at y = 0. +z points to the typist, +x to the right. The print point is at x = 0.
 * Values come from reference.md, section B. SOURCED values have the source number; GUESS marks values without a source.
 */
(function () {
'use strict';

function buildSceneB(THREE, canvas, options) {
options = options || {};
const E = options.engine, K = E.K, SNAP = E.SNAP, KEYS = E.KEYS, NB = KEYS.length;
const SEED = options.seed || 1;

/* ============================================ small tools ============================================ */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(SEED * 7919 + 13);
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
const noise = makeNoise(rng(SEED * 31 + 7));
const fbm = (x, y, o) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < (o || 4); i++) { s += a * noise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; };

/* ============================================ renderer ============================================ */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;      // r186: PCFSoftShadowMap was removed; shadow.radius softens PCF
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050403);
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
/* Extrude a side profile: pts are [z, y] pairs; the solid has thickness t along x, centred on x = 0. */
function profileX(pts, t, b) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 8 });
  g.translate(0, 0, -(t - 2 * b) / 2); g.rotateY(Math.PI / 2);
  return smoothNormals(g, 45);
}
function lathe(pts, seg) { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg || 40); return g; }
function tube(points, radius, seg, closed) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => V3(p[0], p[1], p[2])), !!closed, 'centripetal'), seg || 40, radius, 10, !!closed);
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
const COLW = PX / 10;                     // one letter space: pica, 10 for each inch. SOURCED [S14]
const LINEH = PX / 6;                     // one line: 6 lines for each inch (4.23 mm). GUESS (reference.md B1)
const SW = Math.round(8.5 * PX), SH = 11 * PX;   // sheet 8.5 x 11 in. SOURCED as the usual office size [S47]
const TOP_LINES = 6;                      // empty lines above the first typed line. CHOICE
const SHIFT_PX = 16;                      // px that a character is off its line when the shift is half-way. GUESS
const GW = 64, GH = 80;                   // size of the stamp and of the region that goes to the GPU, px
const sheet = makeCanvas(SW, SH), sc = sheet.getContext('2d');
(function paper() {
  const r = rng(SEED * 101 + 3);
  sc.fillStyle = '#efe7d3'; sc.fillRect(0, 0, SW, SH);
  mottle(sc, SW, SH, 34, 44, 0.10, 'soft-light', r);
  mottle(sc, SW, SH, 170, 220, 0.08, 'soft-light', r);
  for (let i = 0; i < 9000; i++) {                       // fibres
    const x = r() * SW, y = r() * SH, a = r() * Math.PI * 2, l = 6 + r() * 26, bend = (r() - 0.5) * 10;
    sc.strokeStyle = r() < 0.55 ? 'rgba(120,98,66,' + (0.035 + r() * 0.05) + ')' : 'rgba(255,253,244,' + (0.08 + r() * 0.1) + ')';
    sc.lineWidth = 0.5 + r() * 0.9;
    sc.beginPath(); sc.moveTo(x, y);
    sc.quadraticCurveTo(x + Math.cos(a) * l / 2 - Math.sin(a) * bend, y + Math.sin(a) * l / 2 + Math.cos(a) * bend, x + Math.cos(a) * l, y + Math.sin(a) * l);
    sc.stroke();
  }
  grain(sc, SW, SH, 9, r);
  const e = sc.createLinearGradient(0, 0, 14, 0); e.addColorStop(0, 'rgba(110,90,60,0.10)'); e.addColorStop(1, 'rgba(110,90,60,0)');
  sc.fillStyle = e; sc.fillRect(0, 0, 14, SH);
  sc.save(); sc.translate(SW, 0); sc.scale(-1, 1); sc.fillRect(0, 0, 14, SH); sc.restore();
})();
const paperBase = makeCanvas(SW, SH); paperBase.getContext('2d').drawImage(sheet, 0, 0);   // the blank paper, kept for new sheets and flat renders
const glyph = makeCanvas(GW, GH), gc = glyph.getContext('2d');
const patch = makeCanvas(GW, GH), pc = patch.getContext('2d');
const weave = makeCanvas(128, 128);                      // the cloth of the ribbon: it decides where the ink is
(function () {
  const x = weave.getContext('2d'), d = x.createImageData(128, 128), r = rng(SEED * 17 + 1);
  for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) {
    const t = 0.5 + 0.5 * Math.sin(i * Math.PI * 2 / 4.0) * Math.sin(j * Math.PI * 2 / 4.0);
    const v = clamp(0.58 + 0.34 * t + (r() - 0.5) * 0.34 + (noise(i * 0.15, j * 0.15) - 0.5) * 0.4, 0.05, 1);
    const k = (j * 128 + i) * 4; d.data[k] = d.data[k + 1] = d.data[k + 2] = 0; d.data[k + 3] = v * 255;
  }
  x.putImageData(d, 0, 0);
})();
const barErr = Array.from({ length: NB }, (_, i) => { const r = rng(SEED * 977 + i * 131 + 5); return { dx: (r() - 0.5) * 1.8, dy: (r() - 0.5) * 2.4, rot: (r() - 0.5) * 0.035, wear: r() * Math.PI * 2, wearAmt: 0.15 + r() * 0.3 }; });
const FONT = '32px "Courier New", Courier, "Nimbus Mono L", monospace';
let sheetTex = null, patchTex = null, uploadsFull = 0, uploadsPatch = 0;
const dstPos = new THREE.Vector2();
function stamp(ev, tc, quiet) {                         // tc: the 2D context to draw on (default: the live sheet). quiet: no texture upload
  tc = tc || sc;
  const r = rng(ev.r >>> 0), be = barErr[ev.bar] || barErr[0];
  const cx = (K.LEFT_STOP + ev.column + 0.5) * COLW + be.dx + (r() - 0.5) * 1.4;
  const off = (ev.shift >= 0.5 ? ev.shift - 1 : ev.shift) * 2 * SHIFT_PX;
  const cy = (TOP_LINES + ev.line) * LINEH + be.dy + (r() - 0.5) * 1.4 + off;
  if (cy - GH > SH) return;
  const dark = clamp(0.55 + 0.6 * ev.force + (r() - 0.5) * 0.12, 0.5, 1);
  gc.setTransform(1, 0, 0, 1, 0, 0); gc.globalCompositeOperation = 'source-over'; gc.globalAlpha = 1; gc.clearRect(0, 0, GW, GH);
  gc.translate(GW / 2, GH / 2); gc.rotate(be.rot + (r() - 0.5) * 0.012);
  gc.font = FONT; gc.textAlign = 'center'; gc.textBaseline = 'alphabetic';
  gc.fillStyle = '#000'; gc.strokeStyle = '#000'; gc.lineWidth = 0.9 + ev.force * 0.5; gc.lineJoin = 'round';
  gc.fillText(ev.ch, 0, 9); gc.strokeText(ev.ch, 0, 9);
  gc.setTransform(1, 0, 0, 1, 0, 0);
  gc.globalCompositeOperation = 'destination-in';                      // the cloth: ink only where the threads touch
  gc.drawImage(weave, -Math.floor(r() * 64), -Math.floor(r() * 48));
  const a = be.wear + (r() - 0.5) * 0.8, dx = Math.cos(a) * 18, dy = Math.sin(a) * 18;   // one side of the slug hits harder
  const lg = gc.createLinearGradient(GW / 2 - dx, GH / 2 - dy, GW / 2 + dx, GH / 2 + dy);
  lg.addColorStop(0, 'rgba(0,0,0,1)'); lg.addColorStop(1, 'rgba(0,0,0,' + (1 - be.wearAmt - (1 - ev.force) * 0.3) + ')');
  gc.fillStyle = lg; gc.fillRect(0, 0, GW, GH);
  gc.globalCompositeOperation = 'source-in'; gc.fillStyle = '#060a2c'; gc.fillRect(0, 0, GW, GH);   // blue-black: under the 2400 K lamp it reads black, not brown
  const x0 = Math.round(cx - GW / 2), y0 = Math.round(cy - GH / 2);
  tc.save(); tc.globalCompositeOperation = 'multiply';
  tc.filter = 'blur(1.6px)'; tc.globalAlpha = 0.20 * dark; tc.drawImage(glyph, x0, y0);   // ink that spreads in the fibres
  tc.filter = 'blur(0.35px)'; tc.globalAlpha = dark; tc.drawImage(glyph, x0, y0);
  tc.restore();
  if (quiet || tc !== sc || !sheetTex) return;
  const px = clamp(x0, 0, SW - GW), py = clamp(y0, 0, SH - GH);
  pc.clearRect(0, 0, GW, GH); pc.drawImage(sheet, px, py, GW, GH, 0, 0, GW, GH);
  patchTex.needsUpdate = true;
  renderer.copyTextureToTexture(patchTex, sheetTex, null, dstPos.set(px, SH - py - GH));   // texSubImage2D of GW x GH px only
  uploadsPatch++;
}

/* ============================================ other textures ============================================ */
function paperBump() {
  const c = makeCanvas(512, 512), x = c.getContext('2d'), r = rng(SEED * 5 + 2);
  x.fillStyle = '#808080'; x.fillRect(0, 0, 512, 512);
  mottle(x, 512, 512, 64, 64, 0.35, 'soft-light', r);
  for (let i = 0; i < 3500; i++) {
    const px = r() * 512, py = r() * 512, a = r() * Math.PI * 2, l = 4 + r() * 18;
    x.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)'; x.lineWidth = 0.6 + r();
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
  }
  grain(x, 512, 512, 40, r);
  return canvasTex(c, false, true);
}
function woodCanvas(w, h, seed, base, dark, light, rings) {
  const c = makeCanvas(w, h), x = c.getContext('2d'), d = x.createImageData(w, h), r = rng(seed), nz = makeNoise(r);
  const cb = new THREE.Color(base), cd = new THREE.Color(dark), cl = new THREE.Color(light), out = new THREE.Color();
  const pores = new Float32Array(h); for (let j = 0; j < h; j++) pores[j] = r();
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = i / w, v = j / h;
    const warp = (nz(u * 3, v * 5) - 0.5) * 0.9 + (nz(u * 11 + 40, v * 23) - 0.5) * 0.12;
    const t = (v + warp * 0.12) * rings;
    let band = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 + nz(u * 2, v * 40) * 2.5);
    band = Math.pow(band, 1.6);
    const fig = nz(u * 26, v * 3.0);                          // ribbon figure of mahogany across the grain
    const pore = pores[(j + Math.floor(nz(u * 4, v * 2) * 9)) % h] < 0.07 ? 0.78 : 1;
    const streak = 0.80 + 0.22 * nz(u * 60, v * 900) + 0.08 * nz(u * 7, v * 260);
    out.copy(cd).lerp(cb, 0.35 + 0.65 * band).lerp(cl, Math.max(0, fig - 0.62) * 0.9);
    const k = (j * w + i) * 4, m = pore * streak;
    d.data[k] = clamp(out.r * 255 * m, 0, 255); d.data[k + 1] = clamp(out.g * 255 * m, 0, 255); d.data[k + 2] = clamp(out.b * 255 * m, 0, 255); d.data[k + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return c;
}
function leatherBump() {                                   // pebble grain of the leathercloth [S12]
  const c = makeCanvas(256, 256), x = c.getContext('2d'), d = x.createImageData(256, 256), r = rng(SEED * 9 + 4), nz = makeNoise(r);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const v = nz(i * 0.18, j * 0.18), w = nz(i * 0.05 + 9, j * 0.05);
    const cell = Math.pow(Math.abs(Math.sin(v * 9.0)), 0.5);
    const k = (j * 256 + i) * 4; d.data[k] = d.data[k + 1] = d.data[k + 2] = clamp(255 * (0.25 + 0.6 * cell * (0.7 + 0.3 * w)), 0, 255); d.data[k + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return canvasTex(c, false, true);
}
function smudgeTex() {                                     // finger marks, dust and fine scratches on the enamel (roughness, G channel)
  const c = makeCanvas(512, 512), x = c.getContext('2d'), r = rng(SEED * 13 + 8);
  x.fillStyle = 'rgb(40,40,40)'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26; i++) {
    const px = r() * 512, py = r() * 512, rad = 12 + r() * 40, g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, 'rgba(140,140,140,' + (0.25 + r() * 0.35) + ')'); g.addColorStop(1, 'rgba(140,140,140,0)');
    x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 160; i++) {
    x.strokeStyle = 'rgba(160,160,160,' + (0.08 + r() * 0.2) + ')'; x.lineWidth = 0.6;
    const px = r() * 512, py = r() * 512, a = r() * Math.PI, l = 10 + r() * 60;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
  }
  grain(x, 512, 512, 18, r);
  return canvasTex(c, false, true);
}
function plasterTex() {
  const c = makeCanvas(512, 512), x = c.getContext('2d'), r = rng(SEED * 19 + 5);
  x.fillStyle = '#8a866d'; x.fillRect(0, 0, 512, 512);            // warm grey-green plaster. GUESS (reference.md B3)
  mottle(x, 512, 512, 12, 12, 0.25, 'soft-light', r); mottle(x, 512, 512, 60, 60, 0.18, 'soft-light', r);
  grain(x, 512, 512, 10, r);
  return canvasTex(c, true, true);
}
function shadowBlob() {
  const c = makeCanvas(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.45, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return canvasTex(c, false, false);
}
function rectBlob() {                                      // soft rectangle for long objects
  const c = makeCanvas(128, 128), x = c.getContext('2d');
  x.filter = 'blur(14px)'; x.fillStyle = 'rgba(0,0,0,0.8)'; x.fillRect(26, 26, 76, 76);
  return canvasTex(c, false, false);
}

const tPaperBump = paperBump(), tLeather = leatherBump(), tSmudge = smudgeTex(), tPlaster = plasterTex(), tBlob = shadowBlob(), tRect = rectBlob();
tPaperBump.repeat.set(7, 9); tLeather.repeat.set(6, 6);
const woodC = woodCanvas(1024, 1024, SEED * 23 + 1, '#6a3a24', '#2a120a', '#9a6440', 34);   // mahogany [S33] palette B4
const tWood = canvasTex(woodC, true, true);
const tWoodBump = canvasTex(woodC, false, true);

/* ============================================ materials ============================================ */
const MAT = {};
MAT.enamel = new THREE.MeshPhysicalMaterial({ color: 0x121212, roughness: 0.42, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.07,
  clearcoatRoughnessMap: tSmudge });                                       // black gloss enamel [S14], palette #121212
MAT.enamelMatte = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.75 });
MAT.nickel = new THREE.MeshStandardMaterial({ color: 0xc8c8c4, metalness: 1, roughness: 0.2, roughnessMap: tSmudge });   // nickel plate. GUESS [S14]
MAT.steel = new THREE.MeshStandardMaterial({ color: 0x9a9b9c, metalness: 1, roughness: 0.32 });
MAT.rubber = new THREE.MeshPhysicalMaterial({ color: 0x161514, roughness: 0.62, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x30302c) });
MAT.knob = new THREE.MeshPhysicalMaterial({ color: 0x0e0e0e, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
MAT.leather = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.78, bumpMap: tLeather, bumpScale: 1.2 });   // black leathercloth [S12]
MAT.felt = new THREE.MeshStandardMaterial({ color: 0x2b3a2a, roughness: 1 });
MAT.gold = new THREE.MeshStandardMaterial({ color: 0xc9a24b, metalness: 1, roughness: 0.28 });   // gold plate [S33], palette #c9a24b
MAT.brass = new THREE.MeshStandardMaterial({ color: 0xc89b52, metalness: 1, roughness: 0.42, roughnessMap: tSmudge });
MAT.wood = new THREE.MeshPhysicalMaterial({ map: tWood, bumpMap: tWoodBump, bumpScale: 0.6, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.28 });   // satin lacquer [S33]
MAT.paper = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, bumpMap: tPaperBump, bumpScale: 0.07, side: THREE.DoubleSide });
MAT.shellac = new THREE.MeshPhysicalMaterial({ color: 0x0d0d0d, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15 });   // black shellac [S38]
MAT.plaster = new THREE.MeshStandardMaterial({ map: tPlaster, roughness: 0.95 });
MAT.nickel.envMapIntensity = 2.6; MAT.steel.envMapIntensity = 2.2; MAT.gold.envMapIntensity = 2.2; MAT.brass.envMapIntensity = 1.8;
for (const k in MAT) keep(MAT[k]);
const blobMat = (t, o) => keep(new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: o, depthWrite: false, color: 0x000000, alphaMap: t, polygonOffset: true, polygonOffsetFactor: -2 }));
function contactShadow(parent, x, z, w, d, o, rect, y) {     // soft dark patch under an object: the light that the object blocks from the room
  const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, d)), blobMat(rect ? tRect : tBlob, o));
  m.rotation.x = -Math.PI / 2; m.position.set(x, (y || 0) + 0.0004, z); m.renderOrder = 1;
  parent.add(m); return m;
}

/* ============================================ light and environment ============================================ */
/* One motivated light: the desk lamp. Colour of a standard incandescent lamp, 2400 K [S48]; the tint is an estimate.
 * A weak cool fill (a window at night, GUESS) keeps the shapes in shadow readable. */
const LAMP_COLOR = new THREE.Color(0xffbe82);
(function environment() {
  const env = new THREE.Scene(), box = new THREE.BoxGeometry(1, 1, 1), basic = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.BackSide });
  const room = new THREE.Mesh(box, basic(0.012, 0.010, 0.008)); room.scale.set(6, 3.2, 6); room.position.y = 1.0; env.add(room);
  const add = (w, h, d, x, y, z, c) => { const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: c })); m.scale.set(w, h, d); m.position.set(x, y, z); env.add(m); return m; };
  add(0.5, 0.08, 0.3, -0.45, 0.4, 0.02, new THREE.Color(12, 8.0, 4.2));     // the lit inside of the lamp shade
  add(1.4, 0.02, 0.8, 0, -0.02, 0, new THREE.Color(0.10, 0.05, 0.025));     // the lit desk top below
  add(0.02, 0.9, 1.2, -2.9, 1.0, 0.4, new THREE.Color(0.10, 0.13, 0.20));   // a window, cool and dim. GUESS
  add(2.5, 0.02, 1.2, 0.2, 2.5, 0.6, new THREE.Color(0.16, 0.13, 0.10));    // the ceiling over the typist, lit a little by the lamp
  add(0.5, 0.6, 0.02, 0.9, 0.6, -1.1, new THREE.Color(0.05, 0.03, 0.02));   // the cabinet behind
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.025, 0.05, 20);
  scene.environment = rt.texture; scene.environmentIntensity = 0.55;
  keep(rt); pm.dispose(); box.dispose(); env.traverse((o) => o.material && o.material.dispose());
})();
const lamp = new THREE.SpotLight(LAMP_COLOR, 3.4, 0, 0.95, 0.65, 2);       // intensity in candela at 2.0 decay; tuned by eye
lamp.castShadow = true;
lamp.shadow.mapSize.set(2048, 2048);
lamp.shadow.camera.near = 0.1; lamp.shadow.camera.far = 3.0;
lamp.shadow.bias = -0.0004; lamp.shadow.normalBias = 0; lamp.shadow.radius = 4;   // no normal bias: the two-sided sheet would shadow itself
scene.add(lamp, lamp.target);
const fill = new THREE.HemisphereLight(0x7f95b8, 0x1d140d, 0.16); scene.add(fill);
const rim = new THREE.DirectionalLight(0x8aa2c8, 0.10); rim.position.set(-2.5, 1.6, -1.2); scene.add(rim);
const moon = new THREE.DirectionalLight(0x8fa6c8, 0.22); moon.position.set(1.8, 2.4, 2.6); scene.add(moon);   // cool fill from a window behind the typist. GUESS

/* ============================================ the typewriter ============================================ */
/* Remington Portable No. 2 [S11]. Machine 280 W x 280 D x 80 H mm with the type bars down [S14]; on a larger wood
 * baseboard covered with black leathercloth [S12]. The model uses a baseboard of 300 x 330 mm (GUESS, from the 283 x 330 of [S12]). */
const machine = new THREE.Group(); machine.position.set(0, 0, 0.03); machine.userData.pick = 'machine'; scene.add(machine);
const PR = 0.016;                                         // platen radius. GUESS
const PC = V3(0, 0.066, -0.096);                          // platen centre in the carriage, machine coordinates. GUESS
const TH_P = -5 * Math.PI / 180;                          // the print point is 5 degrees below the front of the platen. GUESS
const P = V3(0, PC.y + PR * Math.sin(TH_P), PC.z + PR * Math.cos(TH_P));   // the print point, machine coordinates
const PITCH = 0.00254;                                    // one letter space, m. SOURCED [S14]
const LINE_M = IN / 6;                                    // one line, m. GUESS
const SHIFT_LIFT = 0.0045;                                // the shift lifts the platen this much. GUESS (the No. 2 shift motion has no source [S11])
const SHEET_WM = SW / PXM, SHEET_LM = SH / PXM;

mk(rbox(0.300, 0.012, 0.330, 0.016, 0.003), MAT.leather, machine, 0, 0.006, 0);                 // baseboard
mk(rbox(0.280, 0.042, 0.062, 0.010, 0.005), MAT.enamel, machine, 0, 0.033, -0.109);              // rear housing under the carriage
for (const s of [-1, 1]) {
  mk(rbox(0.052, 0.042, 0.112, 0.009, 0.005), MAT.enamel, machine, s * 0.114, 0.033, -0.036);     // the side decks for the spools
  mk(profileX([[0.0, 0.012], [0.0, 0.054], [0.045, 0.052], [0.10, 0.042], [0.148, 0.031], [0.153, 0.024], [0.153, 0.012]], 0.022, 0.004),
    MAT.enamel, machine, s * 0.129, 0, 0);                                                         // side cheeks of the keyboard
}
mk(new THREE.BoxGeometry(0.236, 0.003, 0.25), MAT.enamelMatte, machine, 0, 0.0135, 0.025);        // floor of the keyboard well
mk(rbox(0.236, 0.017, 0.012, 0.003, 0.003), MAT.enamel, machine, 0, 0.0205, 0.147);              // front apron
contactShadow(machine, 0, 0, 0.42, 0.46, 0.75, true);

/* ---- keys: 4 rows, 10 / 11 / 11 / 10 (GUESS), circular cream tops with black legends under a nickel rim [S12][S14].
 * Tops 15 mm at 19 mm spacing (GUESS). Back row first. ---- */
const KP = 0.019, KR = 0.0068;
const rowZ = [0.064, 0.083, 0.102, 0.121], rowY = [0.061, 0.055, 0.049, 0.043], rowOff = [0.6, 0, 0.25, 0.75];
const keyPos = [];                                        // [x, y, z] of each key top centre: 42 character keys, then 4 control keys
for (let r = 0, i = 0; r < E.ROWS.length; r++) for (let k = 0; k < E.ROWS[r]; k++, i++) keyPos.push([-0.095 + (k + rowOff[r]) * KP, rowY[r], rowZ[r]]);
const CTRL = [['SHIFT', 'LOCK', 2, -1], ['SHIFT', 'KEY', 3, -1], ['BACK', 'SPACE', 1, 1], ['SHIFT', 'KEY', 3, 1]];   // [S12]: left SHIFT LOCK, SHIFT KEY; right BACK SPACE, SHIFT KEY
for (const [, , r, side] of CTRL) {
  const xs = keyPos.filter((p, i) => keyRow(i) === r).map((p) => p[0]);
  keyPos.push([side < 0 ? Math.min(...xs) - KP * 1.05 : Math.max(...xs) + KP * 1.05, rowY[r], rowZ[r]]);
}
function keyRow(i) { let n = 0; for (let r = 0; r < E.ROWS.length; r++) { n += E.ROWS[r]; if (i < n) return r; } return 3; }
const NK = keyPos.length;
const atlas = makeCanvas(1024, 1024);
(function legends() {
  const x = atlas.getContext('2d'), C = 128, r = rng(SEED * 3 + 11);
  for (let i = 0; i < 64; i++) {
    const cx = (i % 8) * C + C / 2, cy = Math.floor(i / 8) * C + C / 2;
    const g = x.createRadialGradient(cx - 10, cy - 14, 6, cx, cy, C * 0.5);
    g.addColorStop(0, '#f1e8cf'); g.addColorStop(0.8, '#e6dbbd'); g.addColorStop(1, '#cfc29f');     // cream [S12], palette #e9dfc3
    x.fillStyle = g; x.fillRect(cx - C / 2, cy - C / 2, C, C);
    for (let k = 0; k < 40; k++) { x.fillStyle = 'rgba(120,100,60,' + r() * 0.05 + ')'; x.fillRect(cx - 60 + r() * 120, cy - 60 + r() * 120, 1 + r() * 2, 1 + r() * 2); }
  }
  x.fillStyle = '#141210'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const fam = '"Franklin Gothic Medium", "Arial Narrow", Arial, sans-serif';
  for (let i = 0; i < NK; i++) {
    const cx = (i % 8) * C + C / 2, cy = Math.floor(i / 8) * C + C / 2;
    if (i < NB) {
      const lo = KEYS[i][1], up = KEYS[i][2];
      if (/[a-z]/.test(lo)) { x.font = '600 62px ' + fam; x.fillText(up, cx, cy + 3); }
      else if (lo === up) { x.font = '600 60px ' + fam; x.fillText(lo, cx, cy); }
      else { x.font = '600 40px ' + fam; x.fillText(up, cx, cy - 22); x.fillText(lo, cx, cy + 24); }
    } else {
      const c = CTRL[i - NB]; x.font = '600 25px ' + fam; x.fillText(c[0], cx, cy - 14); x.fillText(c[1], cx, cy + 16);
    }
  }
})();
const tAtlas = canvasTex(atlas, true, false);
const capMat = keep(new THREE.MeshPhysicalMaterial({ map: tAtlas, roughness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.12 }));
capMat.onBeforeCompile = (sh) => {                         // each instance reads its own cell of the legend atlas
  sh.vertexShader = 'attribute vec2 aCell;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vMapUv * 0.125 + aCell;\n#endif');
};
const capGeo = merge([new THREE.CircleGeometry(KR, 36).rotateX(-Math.PI / 2), new THREE.CylinderGeometry(KR, KR, 0.0022, 36, 1, true).translate(0, -0.0011, 0)]);
const caps = new THREE.InstancedMesh(keep(capGeo), capMat, NK);
const cells = new Float32Array(NK * 2);
for (let i = 0; i < NK; i++) { cells[i * 2] = (i % 8) / 8; cells[i * 2 + 1] = 1 - (Math.floor(i / 8) + 1) / 8; }
capGeo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
const rimGeo = lathe([[KR - 0.0002, -0.0016], [KR + 0.0009, -0.0016], [KR + 0.0012, 0.0002], [KR + 0.0009, 0.0009], [KR + 0.0002, 0.0009], [KR - 0.0001, 0.0003]], 40);
const rims = new THREE.InstancedMesh(keep(rimGeo), MAT.nickel, NK);
const stemGeo = new THREE.CylinderGeometry(0.0011, 0.0011, 1, 8).translate(0, -0.5, 0);
const stems = new THREE.InstancedMesh(keep(stemGeo), MAT.enamelMatte, NK);
const levers = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.0018, 0.003, 1)), MAT.enamelMatte, NK);
for (const im of [caps, rims, stems, levers]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; machine.add(im); }
const mtx = new THREE.Matrix4(), q0 = new THREE.Quaternion(), sv = V3(1, 1, 1), tv = V3(0, 0, 0);
const keyDip = new Float32Array(NK), keyShown = new Float32Array(NK).fill(-1);
function placeKey(i) {
  const [x, y, z] = keyPos[i], d = keyDip[i] * 0.0065, zz = z + d * 0.12;
  q0.identity();
  mtx.compose(tv.set(x, y - d, zz), q0, sv.set(1, 1, 1)); caps.setMatrixAt(i, mtx); rims.setMatrixAt(i, mtx);
  mtx.compose(tv.set(x, y - d - 0.0022, zz), q0, sv.set(1, Math.max(0.001, y - d - 0.0022 - 0.021), 1)); stems.setMatrixAt(i, mtx);
}
for (let i = 0; i < NK; i++) {
  placeKey(i);
  const [x, , z] = keyPos[i], len = z - 0.02;
  mtx.compose(tv.set(x, 0.0205, 0.02 + len / 2), q0.identity(), sv.set(1, 1, len)); levers.setMatrixAt(i, mtx);
}
const spaceBar = new THREE.Group(); machine.add(spaceBar);                                         // black space bar along the front [S12]
mk(rbox(0.17, 0.0055, 0.010, 0.0025, 0.0018), MAT.knob, spaceBar, 0, 0.034, 0.141);
for (const s of [-1, 1]) mk(new THREE.BoxGeometry(0.003, 0.0025, 0.03), MAT.nickel, spaceBar, s * 0.07, 0.0305, 0.126);
let spaceDip = 0;

/* ---- the type-bar fan: 42 bars [S12] on a segment. The fan rises to about 45 degrees for use [S11][S12]; a wide panel
 * hides the parts below it [S11]. Hooked guards at the left-most and right-most bars [S11]. Geometry: GUESS. ---- */
const BAR_L = 0.060, TH_STRIKE = 30 * Math.PI / 180, TH_REST = 25 * Math.PI / 180, PHI = 50 * Math.PI / 180;
const fan = new THREE.Group(); fan.userData.pick = 'bars';
const FAN_O = V3(0, P.y - BAR_L * Math.sin(TH_STRIKE), P.z);    // fan origin: pivot height, below the print point
fan.position.copy(FAN_O); machine.add(fan);
const PL = P.clone().sub(FAN_O);                                 // the print point in fan coordinates
const order = keyPos.slice(0, NB).map((p, i) => [p[0], i]).sort((a, b) => a[0] - b[0]);
const bars = [];
const yAx = V3(0, 1, 0);
order.forEach(([, i], slot) => {
  const phi = -PHI + 2 * PHI * slot / (NB - 1);
  const u = V3(Math.sin(phi), 0, Math.cos(phi));
  const Q = PL.clone().addScaledVector(u, BAR_L * Math.cos(TH_STRIKE)).addScaledVector(yAx, -BAR_L * Math.sin(TH_STRIKE));
  bars[i] = { u, Q, ax: V3(-Math.cos(phi), 0, Math.sin(phi)), p: -1, hold: 0, jam: 0, shake: 0, side: phi };
});
const barGeo = merge([
  new THREE.BoxGeometry(0.0011, BAR_L - 0.005, 0.0026).translate(0, (BAR_L - 0.005) / 2, 0),
  new THREE.BoxGeometry(0.0024, 0.0075, 0.0034).translate(0, BAR_L - 0.0037, 0.0003),     // the type slug
  new THREE.CylinderGeometry(0.0018, 0.0018, 0.0016, 10).rotateZ(Math.PI / 2)             // pivot
]);
const barMesh = new THREE.InstancedMesh(keep(barGeo), MAT.steel, NB);
barMesh.castShadow = true; barMesh.receiveShadow = true; barMesh.frustumCulled = false; fan.add(barMesh);
const bx = V3(), by = V3(), bz = V3();
function placeBar(i, p, extra) {
  const b = bars[i], th = TH_REST + p * (Math.PI - TH_STRIKE - TH_REST);
  by.copy(b.u).multiplyScalar(Math.cos(th)).addScaledVector(yAx, Math.sin(th));
  bx.copy(b.ax); bz.crossVectors(bx, by);
  mtx.makeBasis(bx, by, bz);
  if (extra) { mtx.premultiply(new THREE.Matrix4().makeRotationAxis(by, extra)); }
  mtx.setPosition(b.Q); barMesh.setMatrixAt(i, mtx);
}
for (let i = 0; i < NB; i++) placeBar(i, 0, 0);
/* A jam must read at first look (CHOICE, no warning colour): the stuck bars lean apart, their polished steel catches the lamp
 * (a copy of each stuck bar with a warm glint in the lamp colour), and their keys stay down with the lamp light on the caps. */
const glint = new THREE.InstancedMesh(barGeo, keep(new THREE.MeshStandardMaterial({ color: 0xb0b1b2, metalness: 0.75, roughness: 0.3, emissive: LAMP_COLOR, emissiveIntensity: 0.4 })), 4);
glint.count = 0; glint.frustumCulled = false; glint.raycast = () => {}; fan.add(glint);
const CAP_LIT = new THREE.Color(1.45, 1.38, 1.25), CAP_DIM = new THREE.Color(1, 1, 1);
for (let i = 0; i < NK; i++) caps.setColorAt(i, CAP_DIM);
(function panel() {                                             // the rising panel under the bars, and the felt rest for the heads
  const nP = 40, nT = 8, pos = [], uv = [], idx = [], fpos = [], fidx = [];
  const at = (phi, t, lift) => {
    const u = V3(Math.sin(phi), 0, Math.cos(phi)), d = u.clone().multiplyScalar(Math.cos(TH_REST)).addScaledVector(yAx, Math.sin(TH_REST));
    const n = u.clone().multiplyScalar(-Math.sin(TH_REST)).addScaledVector(yAx, Math.cos(TH_REST));
    return PL.clone().addScaledVector(u, BAR_L * Math.cos(TH_STRIKE)).addScaledVector(yAx, -BAR_L * Math.sin(TH_STRIKE)).addScaledVector(d, t).addScaledVector(n, lift);
  };
  for (let a = 0; a <= nP; a++) for (let b = 0; b <= nT; b++) {
    const phi = (-PHI - 0.12) + (2 * PHI + 0.24) * a / nP, t = -0.012 + (BAR_L + 0.02) * b / nT;
    const v = at(phi, t, -0.0032); pos.push(v.x, v.y, v.z); uv.push(a / nP, b / nT);
    if (a < nP && b < nT) { const k = a * (nT + 1) + b; idx.push(k, k + 1, k + nT + 1, k + 1, k + nT + 2, k + nT + 1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  mk(g, MAT.enamel, fan);
  for (let a = 0; a <= nP; a++) for (let b = 0; b <= 1; b++) {
    const phi = (-PHI - 0.05) + (2 * PHI + 0.1) * a / nP, v = at(phi, BAR_L - 0.013 + b * 0.009, -0.0019); fpos.push(v.x, v.y, v.z);
    if (a < nP && b < 1) { const k = a * 2; fidx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const f = new THREE.BufferGeometry(); f.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3)); f.setIndex(fidx); f.computeVertexNormals();
  mk(f, MAT.felt, fan);
  const seg = new THREE.Shape(), rq = BAR_L * Math.cos(TH_STRIKE), a0 = -Math.PI / 2 - PHI - 0.12, a1 = -Math.PI / 2 + PHI + 0.12;
  seg.absarc(0, 0, rq + 0.006, a0, a1, false); seg.absarc(0, 0, rq - 0.007, a1, a0, true);
  const sg = new THREE.ExtrudeGeometry(seg, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 2, curveSegments: 32 });
  sg.rotateX(-Math.PI / 2); mk(smoothNormals(sg, 40), MAT.nickel, fan, 0, -0.0075, PL.z);
})();
let ready = 0, readyTarget = 0;
/* lift lever: a sliding knob at the right side; to the rear = bars up [S12][S15] */
const liftKnob = mk(lathe([[0, 0], [0.0035, 0], [0.0042, 0.003], [0.0048, 0.007], [0.003, 0.0095], [0, 0.0098]], 24), MAT.nickel, machine, 0.129, 0.052, 0.03);

/* ---- ribbon spools, left and right, flat, axes vertical (GUESS position [S15]); red and black ribbon [S13] ---- */
const ribC = makeCanvas(64, 256), rx = ribC.getContext('2d');
rx.fillStyle = '#141313'; rx.fillRect(0, 0, 64, 128); rx.fillStyle = '#9c2219'; rx.fillRect(0, 128, 64, 128);   // palette #b3261e for the red half
for (let j = 0; j < 256; j += 2) { rx.fillStyle = 'rgba(255,255,255,' + (0.03 + R() * 0.04) + ')'; rx.fillRect(0, j, 64, 1); }
for (let i = 0; i < 64; i += 2) { rx.fillStyle = 'rgba(0,0,0,0.08)'; rx.fillRect(i, 0, 1, 256); }
const tRibbon = canvasTex(ribC, true, true);
const ribbonMat = keep(new THREE.MeshStandardMaterial({ map: tRibbon, roughness: 0.85, side: THREE.DoubleSide }));
const spools = [];
for (const s of [-1, 1]) {
  const g = new THREE.Group(); g.position.set(s * 0.114, 0.054, -0.036); machine.add(g);
  mk(lathe([[0.004, 0], [0.0215, 0], [0.0222, 0.0008], [0.0215, 0.0016], [0.007, 0.0016]], 48), MAT.nickel, g);
  mk(lathe([[0.007, 0.0145], [0.0215, 0.0145], [0.0222, 0.0153], [0.0215, 0.0161], [0.004, 0.0161]], 48), MAT.nickel, g);
  const wound = new THREE.CylinderGeometry(0.0175, 0.0175, 0.0127, 48, 1, true); wound.translate(0, 0.0081, 0);
  const uvw = wound.attributes.uv; for (let k = 0; k < uvw.count; k++) uvw.setXY(k, uvw.getX(k) * 6, uvw.getY(k));
  mk(wound, ribbonMat, g);
  mk(new THREE.CylinderGeometry(0.0035, 0.0035, 0.022, 16).translate(0, 0.008, 0), MAT.nickel, g);
  for (let k = 0; k < 4; k++) { const sp = mk(new THREE.BoxGeometry(0.026, 0.0012, 0.0024), MAT.nickel, g, 0, 0.0163, 0); sp.rotation.y = k * Math.PI / 4; }
  spools.push(g);
}
const RIB_Y = P.y - 0.0094, RIB_W = 0.0127, RIB_Z = P.z + 0.0035;   // ribbon at rest: its top edge 3 mm below the print line. GUESS
const ribPts = [[-0.1, 0.061, -0.052], [-0.083, 0.059, -0.068], [-0.056, RIB_Y, RIB_Z - 0.0003], [-0.025, RIB_Y, RIB_Z], [0, RIB_Y, RIB_Z]];
const ribCurve = new THREE.CatmullRomCurve3(ribPts.concat(ribPts.slice(0, 4).reverse().map((p) => [-p[0], p[1], p[2]])).map((p) => V3(p[0], p[1], p[2])), false, 'centripetal');
const RIB_N = 80, ribBase = ribCurve.getSpacedPoints(RIB_N);
const ribGeo = new THREE.BufferGeometry();
ribGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RIB_N + 1) * 2 * 3), 3));
ribGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((RIB_N + 1) * 2 * 2), 2));
{ const idx = []; for (let k = 0; k < RIB_N; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2); ribGeo.setIndex(idx); }
const ribbon = mk(ribGeo, ribbonMat, machine); ribbon.frustumCulled = false;
let ribLift = 0, ribShown = -1, ribHold = 0, ribTravel = 0;
function placeRibbon(lift) {
  const p = ribGeo.attributes.position.array, uv = ribGeo.attributes.uv.array;
  for (let k = 0; k <= RIB_N; k++) {
    const b = ribBase[k], w = 1 - smooth(0.016, 0.05, Math.abs(b.x)), y = b.y + lift * w * 0.0076;
    p.set([b.x, y - RIB_W / 2, b.z, b.x, y + RIB_W / 2, b.z], k * 6);
    uv.set([k / RIB_N * 18 + ribTravel, 0, k / RIB_N * 18 + ribTravel, 1], k * 4);
  }
  ribGeo.attributes.position.needsUpdate = true; ribGeo.attributes.uv.needsUpdate = true; ribGeo.computeVertexNormals();
}
/* the ribbon vibrator: a thin plate with a window at the print point; it lifts the ribbon (GUESS shape) */
const vib = new THREE.Group(); machine.add(vib);
{
  const s = new THREE.Shape(); s.moveTo(-0.0075, -0.0105); s.lineTo(0.0075, -0.0105); s.lineTo(0.006, 0.0035); s.lineTo(-0.006, 0.0035); s.lineTo(-0.0075, -0.0105);
  const h = new THREE.Path(); h.moveTo(-0.0032, -0.004); h.lineTo(0.0032, -0.004); h.lineTo(0.0028, 0.0035); h.lineTo(-0.0028, 0.0035); h.lineTo(-0.0032, -0.004); s.holes.push(h);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.0005, bevelEnabled: false });
  mk(g, MAT.nickel, vib, 0, RIB_Y + 0.003, RIB_Z + 0.0009);
  mk(new THREE.BoxGeometry(0.0016, 0.022, 0.0008), MAT.nickel, vib, -0.0068, RIB_Y - 0.016, RIB_Z + 0.0012);
}
/* aligning scale: a small triangle piece right of the print point [S11] */
{
  const s = new THREE.Shape(); s.moveTo(0.0012, -0.0016); s.lineTo(0.016, -0.0016); s.lineTo(0.016, 0.0022); s.lineTo(0.0042, 0.0022); s.lineTo(0.0012, -0.0016);
  mk(new THREE.ExtrudeGeometry(s, { depth: 0.0005, bevelEnabled: false }), MAT.nickel, machine, 0, P.y - 0.0036, P.z + 0.0012);
}
/* gold "Remington Portable" on the top right, in front of the right spool [S14] (a No. 2 of 1926/1927). The "Remington" on the
 * paper table [S11] stays too, but the sheet covers it. Script face and size GUESS */
{
  const c = makeCanvas(512, 440), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 40, 0, 400); g.addColorStop(0, '#f6dc8e'); g.addColorStop(0.5, '#cfa64c'); g.addColorStop(1, '#8a6a2a');
  x.fillStyle = g; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'italic 700 132px Georgia, "Times New Roman", serif'; x.fillText('Remington', 256, 130, 500);
  x.font = 'italic 700 124px Georgia, "Times New Roman", serif'; x.fillText('Portable', 256, 310, 480);
  const m = keep(new THREE.MeshStandardMaterial({ map: canvasTex(c, true), transparent: true, metalness: 0.8, roughness: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const d = mk(new THREE.PlaneGeometry(0.052, 0.0447), m, machine, 0.0925, 0.0545, 0.0035, true);
  d.rotation.x = -Math.PI / 2;
}

/* ---- carriage: platen, knobs, paper table with "Remington" [S11], 2 "rabbit ear" paper supports [S11][S12], return lever (left, GUESS [S11]) ---- */
const carriage = new THREE.Group(); machine.add(carriage);
const lift = new THREE.Group(); carriage.add(lift);
mk(rbox(0.31, 0.010, 0.040, 0.004, 0.002), MAT.enamel, carriage, 0, 0.059, -0.114);           // carriage frame on its rail
mk(new THREE.CylinderGeometry(0.0025, 0.0025, 0.34, 12).rotateZ(Math.PI / 2), MAT.nickel, carriage, 0, 0.057, -0.133);   // rear rail
for (const s of [-1, 1]) mk(rbox(0.006, 0.040, 0.050, 0.008, 0.002), MAT.enamel, lift, s * 0.128, 0.069, -0.099);
const platen = new THREE.Group(); platen.position.copy(PC); lift.add(platen);
mk(new THREE.CylinderGeometry(PR, PR, 0.236, 72, 1).rotateZ(Math.PI / 2), MAT.rubber, platen);
mk(new THREE.CylinderGeometry(0.003, 0.003, 0.30, 12).rotateZ(Math.PI / 2), MAT.nickel, platen);
const knurl = (() => {
  const g = lathe([[0.0001, -0.009], [0.012, -0.009], [0.0153, -0.0078], [0.0166, -0.0062], [0.0166, 0.0062], [0.0153, 0.0078], [0.012, 0.009], [0.0001, 0.009]], 96);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k), r = Math.hypot(x, z);
    if (Math.abs(y) < 0.0063 && r > 0.016) { const a = Math.atan2(z, x), d = 0.00055 * Math.cos(a * 48); p.setXYZ(k, x * (r + d) / r, y, z * (r + d) / r); }
  }
  g.computeVertexNormals(); g.rotateZ(Math.PI / 2); return g;
})();
for (const s of [-1, 1]) {
  mk(knurl, MAT.knob, platen, s * 0.1415, 0, 0);
  mk(new THREE.CylinderGeometry(0.0062, 0.0062, 0.004, 24).rotateZ(Math.PI / 2), MAT.nickel, platen, s * 0.1325, 0, 0);
  mk(new THREE.CylinderGeometry(0.0022, 0.003, 0.003, 16).rotateZ(Math.PI / 2), MAT.nickel, platen, s * 0.152, 0, 0);
}
/* The paper path. The sheet comes in from the back, goes round the platen and up the front to the print point.
 * Its lower, untyped part (the tail) stands up behind the platen, against the paper table. Its typed upper part (the head)
 * leaves the platen at the front, goes over the bail and lies back against the tail. s = m along the sheet from the print line,
 * positive toward the top edge of the sheet. Shapes: GUESS. */
const TH_D = 30 * Math.PI / 180, TH_T = -150 * Math.PI / 180, PE = PR + 0.0004, EL0 = Math.PI / 2 - TH_D;
const DS = 0.0005, S_MIN = -0.30, S_MAX = 0.30, TJ = 0.055, OFF = 0.0016;
const S_TE = (TH_T - TH_P) * PE, S_HD = (TH_D - TH_P) * PE;          // tail exit and head departure on the platen
const tailTab = [];                                                    // [y, z, ny, nz] at t = k * DS, normal to the front
{
  let y = PC.y + PE * Math.sin(TH_T), z = PC.z + PE * Math.cos(TH_T), el = EL0;
  for (let k = 0; k * DS <= 0.32; k++) {
    tailTab.push([y, z, Math.cos(el), Math.sin(el)]);
    if (k * DS > 0.11) el = Math.max(0.5, el - DS / 0.3);               // high up, the sheet bends back over the supports
    y += Math.sin(el) * DS; z -= Math.cos(el) * DS;
  }
}
function tailAt(t, out) {
  const f = clamp(t / DS, 0, tailTab.length - 1.001), k = Math.floor(f), u = f - k, a = tailTab[k], b = tailTab[k + 1];
  for (let i = 0; i < 4; i++) out[i] = a[i] + (b[i] - a[i]) * u;
  return out;
}
const blend = [];                                                      // the head from the platen to the tail: a cubic curve, by arc length
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
    const dz = 6 * u2 * P0[1] - 6 * u * P0[1] + (3 * u2 - 4 * u + 1) * D0[1] * L + (-6 * u2 + 6 * u) * P1[1] + (3 * u2 - 2 * u) * D1[1] * L;
    const n = Math.hypot(dy, dz) || 1;
    blend.push([BL, y, z, -dz / n, dy / n]);
  }
}
function pathAt(s, out) {                                              // point and outward normal of the sheet at s
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
  const tbl = mk(rbox(0.235, 0.0015, 0.056, 0.006, 0.0006), MAT.enamel, lift);                     // paper table
  const c = tailAt(0.036, [0, 0, 0, 0]);
  tbl.position.set(0, c[0] - c[2] * 0.0022, c[1] - c[3] * 0.0022); tbl.rotation.x = -(Math.PI / 2 + TH_D);
  const dc = makeCanvas(1024, 256), dx = dc.getContext('2d');
  dx.font = 'italic 700 150px Georgia, "Times New Roman", serif'; dx.textAlign = 'center'; dx.textBaseline = 'middle';
  const gg = dx.createLinearGradient(0, 40, 0, 210); gg.addColorStop(0, '#f3d98a'); gg.addColorStop(0.5, '#c9a24b'); gg.addColorStop(1, '#8a6a2a');
  dx.fillStyle = gg; dx.fillText('Remington', 512, 128);
  const decal = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.11, 0.0275)), keep(new THREE.MeshStandardMaterial({ map: canvasTex(dc, true), transparent: true, metalness: 0.7, roughness: 0.3, depthWrite: false })));
  const c2 = tailAt(0.05, [0, 0, 0, 0]);
  decal.position.set(0, c2[0] - c2[2] * 0.0012, c2[1] - c2[3] * 0.0012); decal.rotation.x = -TH_D; lift.add(decal);
  for (const s of [-1, 1]) {                                                                        // rabbit ears
    const a = tailAt(0.055, [0, 0, 0, 0]), b = tailAt(0.12, [0, 0, 0, 0]);
    const x0 = s * 0.062, x1 = s * 0.092, off = -0.004;
    mk(tube([[x0, a[0] + a[2] * off, a[1] + a[3] * off], [x0 + s * 0.004, b[0] + b[2] * off - 0.01, b[1] + b[3] * off], [(x0 + x1) / 2, b[0] + b[2] * off + 0.004, b[1] + b[3] * off - 0.004],
      [x1 - s * 0.004, b[0] + b[2] * off - 0.01, b[1] + b[3] * off], [x1, a[0] + a[2] * off, a[1] + a[3] * off]], 0.0011, 40), MAT.nickel, lift);
  }
  const bl = pathAt(S_HD + 0.006, [0, 0, 0, 0]), by0 = bl[0] + bl[2] * 0.0024, bz0 = bl[1] + bl[3] * 0.0024;   // paper bail with 2 rollers. GUESS
  mk(new THREE.CylinderGeometry(0.0011, 0.0011, 0.236, 12).rotateZ(Math.PI / 2), MAT.nickel, lift, 0, by0, bz0);
  for (const s of [-1, 1]) {
    mk(new THREE.CylinderGeometry(0.0028, 0.0028, 0.008, 20).rotateZ(Math.PI / 2), MAT.rubber, lift, s * 0.055, by0, bz0);
    mk(tube([[s * 0.118, by0, bz0], [s * 0.124, by0 - 0.004, bz0 - 0.004], [s * 0.125, PC.y + 0.004, PC.z - 0.002]], 0.0011, 12), MAT.nickel, lift);
  }
}
/* margin scale on the front of the carriage: marks 0 to 84 [K.SCALE_MAX], 10 for each inch */
{
  const c = makeCanvas(2048, 64), x = c.getContext('2d'), w = 0.226;
  const g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, '#d9d9d4'); g.addColorStop(1, '#9d9d98'); x.fillStyle = g; x.fillRect(0, 0, 2048, 64);
  x.fillStyle = '#1a1a1a'; x.font = 'bold 22px Arial, sans-serif'; x.textAlign = 'center';
  for (let m = 0; m <= K.SCALE_MAX; m++) {
    const lx = -SHEET_WM / 2 + (m + 0.5) * PITCH, px = (lx + w / 2) / w * 2048;
    const h = m % 10 === 0 ? 30 : m % 5 === 0 ? 20 : 12; x.fillRect(px - 1.2, 0, 2.4, h);
    if (m % 10 === 0) x.fillText(String(m), px, 58);
  }
  const sm = mk(new THREE.PlaneGeometry(w, 0.0062), keep(new THREE.MeshStandardMaterial({ map: canvasTex(c, true), metalness: 0.85, roughness: 0.3 })), carriage, 0, PC.y - PR - 0.0045, PC.z + PR * 0.55);
  sm.rotation.x = -0.75;
}
const lever = new THREE.Group(); lever.position.set(-0.133, 0.086, -0.084); carriage.add(lever);
mk(tube([[0, 0, 0], [-0.003, 0.02, 0.004], [-0.012, 0.04, 0.016], [-0.02, 0.05, 0.03]], 0.0022, 30), MAT.nickel, lever);
mk(rbox(0.012, 0.004, 0.024, 0.004, 0.0015), MAT.nickel, lever, -0.021, 0.051, 0.034).rotation.x = 0.3;
mk(new THREE.CylinderGeometry(0.004, 0.004, 0.006, 20).rotateZ(Math.PI / 2), MAT.nickel, lever, 0.002, 0, 0);
mk(lathe([[0, 0], [0.0045, 0], [0.005, 0.004], [0.004, 0.007], [0, 0.0075]], 24).rotateZ(Math.PI / 2), MAT.knob, carriage, -0.134, 0.093, -0.112);   // line-space selector [S11]
mk(tube([[0.131, 0.084, -0.11], [0.137, 0.092, -0.122], [0.138, 0.112, -0.132]], 0.0016, 16), MAT.nickel, carriage);   // paper release lever, right [S11]
mk(new THREE.SphereGeometry(0.003, 16, 12), MAT.knob, carriage, 0.138, 0.113, -0.132);

/* ---- the paper: a strip mesh along the path; the sheet canvas is its texture ---- */
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
const paper = mk(paperGeo, MAT.paper, lift); paper.frustumCulled = false; paper.userData.pick = 'sheet';
let paperShown = -1;
const pa = [0, 0, 0, 0];
function placePaper(line) {
  const yPrint = (TOP_LINES + line) * LINEH, sTop = yPrint / PXM, sLo = Math.max(S_MIN, sTop - SHEET_LM);
  const p = paperGeo.attributes.position.array, n = paperGeo.attributes.normal.array, uv = paperGeo.attributes.uv.array;
  for (let r = 0; r < PROWS; r++) {
    const f = r / (PROWS - 1), s0 = sLo + (sTop - sLo) * Math.pow(f, 1.0), s = s0 - feed;   // feed: the part of a new sheet not yet fed in
    pathAt(s, pa);
    const v = 1 - (yPrint - s0 * PXM) / SH, flat = Math.max(smooth(0.012, 0.06, s), smooth(0.01, 0.06, S_TE - s));
    for (let c = 0; c < PCOLS; c++) {
      const u = c / (PCOLS - 1), x = -SHEET_WM / 2 + u * SHEET_WM;
      const wav = flat * (0.0006 * Math.sin(u * 9.0 + s * 30) + 0.0022 * Math.sin(u * Math.PI) * smooth(0.04, 0.2, Math.abs(s)) - 0.004 * smooth(0.14, 0.24, -s) * (1 - 0.6 * Math.sin(u * Math.PI)));
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
const ghost = new THREE.Mesh(ghostGeo, keep(new THREE.MeshStandardMaterial({ map: ghostTex, roughness: 0.92, side: THREE.DoubleSide, transparent: true })));
ghost.visible = false; ghost.frustumCulled = false; ghost.raycast = () => {}; lift.add(ghost);
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
/* Desk: flat-top writing desk, mahogany, 1400 x 750 x 760 mm, dark red-brown. GUESS (reference.md B3). */
const room = new THREE.Group(); scene.add(room);
const FLOOR = -0.76;
mk(rbox(1.40, 0.032, 0.76, 0.012, 0.007), MAT.wood, room, 0, -0.016, -0.08);
mk(rbox(1.34, 0.085, 0.022, 0.004, 0.003), MAT.wood, room, 0, -0.075, 0.28, true);
for (const s of [-1, 1]) mk(rbox(0.42, 0.69, 0.70, 0.006, 0.004), MAT.wood, room, s * 0.47, FLOOR + 0.345, -0.09, true);
{
  const tf = tWood.clone(); tf.repeat.set(5, 9); tf.rotation = Math.PI / 2; tf.needsUpdate = true; keep(tf);
  const fl = mk(new THREE.PlaneGeometry(6, 6), keep(new THREE.MeshStandardMaterial({ map: tf, color: 0x6e6058, roughness: 0.55 })), room, 0, FLOOR, 0, true);
  fl.rotation.x = -Math.PI / 2;
  tPlaster.repeat.set(3, 2);
  mk(new THREE.PlaneGeometry(6, 3.4), MAT.plaster, room, 0, FLOOR + 1.7, -1.25, true);                          // plaster wall. GUESS
  const trim = keep(new THREE.MeshStandardMaterial({ color: 0x2a160d, roughness: 0.45 }));                    // dark wood trim. GUESS
  mk(new THREE.BoxGeometry(6, 0.16, 0.02), trim, room, 0, FLOOR + 0.08, -1.24, true);
  mk(new THREE.BoxGeometry(6, 0.035, 0.03), trim, room, 0, FLOOR + 2.2, -1.235, true);
  /* bookcase at the left wall. GUESS (reference.md B3) */
  const bc = new THREE.Group(); bc.position.set(-1.25, FLOOR, -1.06); room.add(bc);
  mk(rbox(1.0, 1.9, 0.34, 0.004, 0.004), keep(new THREE.MeshStandardMaterial({ color: 0x1a0d07, roughness: 0.6 })), bc, 0, 0.95, 0, true);
  const nb = 150, books = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1, 1, 1)), keep(new THREE.MeshStandardMaterial({ roughness: 0.7 })), nb), col = new THREE.Color();
  const bookCols = [0x4a1712, 0x1d2c22, 0x2a2016, 0x5a4022, 0x16182a, 0x3a0f0c, 0x433b2c];
  for (let i = 0, sh = 0, x = -0.46; i < nb; i++) {
    const w = 0.022 + R() * 0.025, h = 0.2 + R() * 0.08;
    if (x + w > 0.46) { sh++; x = -0.46; }
    if (sh > 4) { mtx.makeScale(0.0001, 0.0001, 0.0001); books.setMatrixAt(i, mtx); continue; }
    mtx.compose(tv.set(x + w / 2, 0.08 + sh * 0.36 + h / 2, 0.175), q0.setFromAxisAngle(V3(0, 0, 1), (R() - 0.5) * 0.04), sv.set(w, h, 0.22 + R() * 0.03));
    books.setMatrixAt(i, mtx); books.setColorAt(i, col.setHex(bookCols[Math.floor(R() * bookCols.length)]).multiplyScalar(0.7 + R() * 0.5)); x += w + 0.001;
  }
  books.receiveShadow = true; bc.add(books);
}

/* Lamp: "Emeralite" banker's lamp [S51]: green glass shade, white inside, brass stand, pull chain. Shape and size GUESS (350 mm high). */
const lampG = new THREE.Group(); lampG.position.set(-0.34, 0, -0.05); lampG.rotation.y = Math.atan2(0.46, -0.06); room.add(lampG);   // place CHOICE: the shade is whole in the 'machine' view
mk(lathe([[0, 0], [0.072, 0], [0.076, 0.004], [0.074, 0.012], [0.062, 0.02], [0.034, 0.027], [0.016, 0.031], [0.013, 0.042], [0, 0.042]], 64), MAT.brass, lampG);
mk(tube([[0, 0.04, -0.036], [0, 0.19, -0.042], [0, 0.305, -0.032], [0, 0.334, -0.004], [0, 0.327, 0.022]], 0.0055, 40), MAT.brass, lampG);   // lamp 330 mm high (GUESS, reference 350 mm)
contactShadow(room, lampG.position.x, lampG.position.z, 0.2, 0.2, 0.8);
const shade = new THREE.Group(); shade.position.set(0, 0.268, 0.03); shade.rotation.x = -0.2; lampG.add(shade);
{
  const g = new THREE.CylinderGeometry(0.058, 0.058, 0.25, 48, 1, true, 0, Math.PI); g.rotateZ(Math.PI / 2); keep(g);
  const gc3 = makeCanvas(256, 64), gx = gc3.getContext('2d'), gl = gx.createLinearGradient(0, 0, 256, 0);   // light through the glass: bright at the lower edges
  gl.addColorStop(0, '#9fe0b0'); gl.addColorStop(0.18, '#2f8a55'); gl.addColorStop(0.5, '#0e3a22'); gl.addColorStop(0.82, '#2f8a55'); gl.addColorStop(1, '#9fe0b0');
  gx.fillStyle = gl; gx.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 64; i += 4) { gx.fillStyle = 'rgba(0,0,0,0.05)'; gx.fillRect(0, i, 256, 1); }
  const outer = new THREE.Mesh(g, keep(new THREE.MeshPhysicalMaterial({ color: 0x1f6b45, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02,
    emissive: 0xffffff, emissiveMap: canvasTex(gc3, true), emissiveIntensity: 0.55, envMapIntensity: 3, side: THREE.FrontSide })));   // green glass [S51], palette #1f6b45
  const inner = new THREE.Mesh(g, keep(new THREE.MeshStandardMaterial({ color: 0xfff4e4, emissive: 0xffd7a0, emissiveIntensity: 1.6, side: THREE.BackSide })));
  shade.add(outer, inner);
  for (const s of [-1, 1]) {
    const c = new THREE.CircleGeometry(0.058, 24, 0, Math.PI); c.rotateY(Math.PI / 2); keep(c);
    const m = new THREE.Mesh(c, outer.material); m.position.x = s * 0.125; m.material.side = THREE.DoubleSide; shade.add(m);
  }
  mk(new THREE.TorusGeometry(0.058, 0.0022, 8, 48, Math.PI).rotateY(Math.PI / 2), MAT.brass, shade, 0.125, 0, 0, true);
  mk(new THREE.TorusGeometry(0.058, 0.0022, 8, 48, Math.PI).rotateY(Math.PI / 2), MAT.brass, shade, -0.125, 0, 0, true);
  const bulb = new THREE.Mesh(keep(new THREE.SphereGeometry(0.013, 20, 14)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.2, 2.4) })));
  bulb.position.set(0, 0.004, 0.0); bulb.scale.set(1.5, 1, 1); shade.add(bulb);
  const beads = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.0016, 8, 6)), MAT.brass, 22);
  for (let k = 0; k < 22; k++) { mtx.makeTranslation(0.08, -0.03 - k * 0.0034, 0.035); beads.setMatrixAt(k, mtx); }
  mk(new THREE.CylinderGeometry(0.003, 0.004, 0.012, 12), MAT.brass, shade, 0.08, -0.112, 0.035);
  shade.add(beads);
  shade.traverse((o) => { o.castShadow = false; });
}
scene.updateMatrixWorld(true);
lamp.position.copy(shade.localToWorld(V3(0, -0.02, 0.0)));
lamp.target.position.set(0.06, 0.10, -0.06);
const spill = new THREE.SpotLight(LAMP_COLOR, 0.8, 0, 1.35, 1, 2);   // the same lamp: the wide, weak part of its light (no shadow)
spill.position.copy(lamp.position); spill.target.position.set(0.1, -0.2, 0.1); scene.add(spill, spill.target);

/* ---- small objects on the desk: 6 items from reference.md B3 ---- */
const MATX = {
  red: keep(new THREE.MeshPhysicalMaterial({ color: 0xc8452a, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.08 })),   // red hard rubber [S56]
  yellow: keep(new THREE.MeshPhysicalMaterial({ color: 0xe0ad22, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2 })),   // yellow pencil [S57]
  bronze: keep(new THREE.MeshStandardMaterial({ color: 0x4a3a26, metalness: 1, roughness: 0.42, roughnessMap: tSmudge })),
  cord: keep(new THREE.MeshStandardMaterial({ color: 0x1c1610, roughness: 0.9 })),
  pink: keep(new THREE.MeshStandardMaterial({ color: 0xd98a86, roughness: 0.8 })),
  cedar: keep(new THREE.MeshStandardMaterial({ color: 0xc89a6a, roughness: 0.8 })),
  glass: keep(new THREE.MeshPhysicalMaterial({ color: 0xc8d8d2, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.5, depthWrite: false })),
  ink: keep(new THREE.MeshStandardMaterial({ color: 0x0a0d26, roughness: 0.08 })),
  blot: keep(new THREE.MeshStandardMaterial({ color: 0x3c6650, roughness: 1 })),
  sleeve: keep(new THREE.MeshStandardMaterial({ roughness: 0.9 })),
};
/* 1. candlestick telephone: upright tube up to 254 mm, transmitter on top, receiver on a side hook [S53]; black (GUESS) */
{
  const t = new THREE.Group(); t.position.set(0.36, 0, -0.40); t.rotation.y = -0.5; room.add(t);
  mk(lathe([[0, 0], [0.056, 0], [0.057, 0.006], [0.05, 0.014], [0.03, 0.022], [0.013, 0.031], [0.0, 0.031]], 64), MAT.enamel, t);
  mk(new THREE.CylinderGeometry(0.0085, 0.0095, 0.225, 32), MAT.enamel, t, 0, 0.142, 0);
  mk(new THREE.CylinderGeometry(0.0105, 0.0105, 0.01, 32), MAT.nickel, t, 0, 0.255, 0);
  const head = new THREE.Group(); head.position.set(0, 0.268, 0.012); head.rotation.x = 1.25; t.add(head);
  mk(lathe([[0, -0.012], [0.03, -0.012], [0.032, -0.006], [0.032, 0.006], [0.026, 0.012], [0.014, 0.014], [0.0, 0.014]], 48), MAT.enamel, head);
  mk(lathe([[0.012, 0.012], [0.016, 0.03], [0.024, 0.05], [0.026, 0.055], [0.022, 0.055], [0.012, 0.035], [0.008, 0.014]], 40), MAT.enamel, head);
  mk(new THREE.BoxGeometry(0.03, 0.004, 0.006), MAT.nickel, t, 0.022, 0.215, 0);                             // switch hook
  const rc = new THREE.Group(); rc.position.set(0.04, 0.215, 0); t.add(rc);
  mk(lathe([[0, -0.11], [0.019, -0.11], [0.02, -0.104], [0.014, -0.09], [0.009, -0.075], [0.009, 0.0], [0.012, 0.004], [0.012, 0.012], [0, 0.014]], 40), MAT.enamel, rc);
  mk(tube([[0.0, -0.11, 0], [0.03, -0.17, 0.02], [0.04, -0.205, 0.0], [0.0, -0.212, -0.03], [-0.03, -0.21, -0.02]], 0.0024, 40), MATX.cord, t, 0.04, 0.215, 0);
  mk(tube([[-0.04, 0.004, -0.02], [-0.1, 0.003, -0.08], [-0.12, 0.003, -0.2]], 0.0026, 20), MATX.cord, t);
  contactShadow(room, 0.36, -0.40, 0.16, 0.16, 0.8);
}
/* 2-3. pen rack and paper weight (heavy metal block with 3 grooves, GUESS shape [S60]); Parker Duofold pen, red, 140 mm capped [S56];
 * yellow 6-sided pencil with metal ferrule and pink eraser [S57] */
{
  const g = new THREE.Group(); g.position.set(0.27, 0, 0.17); g.rotation.y = -0.18; room.add(g);
  mk(rbox(0.13, 0.016, 0.052, 0.005, 0.003), MATX.bronze, g, 0, 0.008, 0);
  for (let k = 0; k < 4; k++) mk(rbox(0.13, 0.008, 0.006, 0.002, 0.0025), MATX.bronze, g, 0, 0.019, -0.022 + k * 0.0147);
  const pen = new THREE.Group(); pen.position.set(0.0, 0.0215, -0.0147); pen.rotation.z = Math.PI / 2; g.add(pen);
  mk(lathe([[0, -0.07], [0.0045, -0.069], [0.0058, -0.064], [0.0062, -0.01], [0.0064, 0.0], [0.0066, 0.004], [0.0066, 0.058], [0.0058, 0.066], [0.003, 0.07], [0, 0.07]], 32), MATX.red, pen);
  for (const y of [-0.064, 0.066]) mk(new THREE.CylinderGeometry(0.0059, 0.0059, 0.008, 32), MAT.knob, pen, 0, y, 0);   // black ends (GUESS)
  mk(new THREE.CylinderGeometry(0.0068, 0.0068, 0.003, 32), MAT.gold, pen, 0, 0.006, 0);
  mk(new THREE.BoxGeometry(0.0016, 0.042, 0.002), MAT.gold, pen, 0.0068, 0.04, 0);
  const pc2 = new THREE.Group(); pc2.position.set(0.012, 0.0205, 0.0147); pc2.rotation.z = Math.PI / 2; pc2.rotation.x = 0.03; g.add(pc2);
  mk(new THREE.CylinderGeometry(0.0037, 0.0037, 0.13, 6), MATX.yellow, pc2, 0, 0, 0);
  mk(new THREE.CylinderGeometry(0.0038, 0.0038, 0.011, 20), MAT.brass, pc2, 0, 0.07, 0);
  mk(new THREE.CylinderGeometry(0.0034, 0.0034, 0.008, 20), MATX.pink, pc2, 0, 0.0795, 0);
  mk(new THREE.ConeGeometry(0.0037, 0.018, 6), MATX.cedar, pc2, 0, -0.074, 0).rotation.x = Math.PI;
  mk(new THREE.ConeGeometry(0.001, 0.004, 12), MAT.knob, pc2, 0, -0.0815, 0).rotation.x = Math.PI;
  contactShadow(room, 0.27, 0.17, 0.17, 0.09, 0.7, true);
}
/* 4. ink bottle, square glass 60 mm, blue-black ink, paper label (GUESS [S60]) */
{
  const g = new THREE.Group(); g.position.set(0.22, 0, -0.21); g.rotation.y = 0.3; room.add(g);
  const glass = mk(rbox(0.06, 0.055, 0.06, 0.008, 0.004), MATX.glass, g, 0, 0.0275, 0, true); glass.renderOrder = 2;
  mk(rbox(0.052, 0.034, 0.052, 0.006, 0.003), MATX.ink, g, 0, 0.02, 0);
  mk(new THREE.CylinderGeometry(0.012, 0.014, 0.008, 24), MATX.glass, g, 0, 0.059, 0, true).renderOrder = 2;
  mk(new THREE.CylinderGeometry(0.0145, 0.0145, 0.014, 32), MAT.knob, g, 0, 0.067, 0);
  const lc = makeCanvas(256, 192), lx = lc.getContext('2d');
  lx.fillStyle = '#e6dcc0'; lx.fillRect(0, 0, 256, 192); lx.strokeStyle = '#6a2a1e'; lx.lineWidth = 6; lx.strokeRect(10, 10, 236, 172);
  lx.fillStyle = '#2a1e18'; lx.textAlign = 'center'; lx.font = 'bold 40px Georgia, serif'; lx.fillText('WRITING', 128, 78); lx.fillText('FLUID', 128, 120);
  lx.font = '22px Georgia, serif'; lx.fillText('BLUE-BLACK', 128, 160);
  mk(new THREE.PlaneGeometry(0.042, 0.03), keep(new THREE.MeshStandardMaterial({ map: canvasTex(lc, true), roughness: 0.9 })), g, 0, 0.026, 0.0302, true);
  contactShadow(room, 0.22, -0.21, 0.11, 0.11, 0.6);
}
/* 5. rocker blotter: curved base with blotting paper, wood top, knob (GUESS shape [S60]) */
{
  const g = new THREE.Group(); g.position.set(-0.25, 0, -0.33); g.rotation.y = 0.2; room.add(g);
  const pts = []; for (let k = 0; k <= 16; k++) { const a = -0.5 + k / 16; pts.push([a * 0.075, 0.004 + 0.012 * a * a * 4]); }
  const prof = pts.map(([z, y]) => [z, y]).concat([[0.0375, 0.026], [-0.0375, 0.026]]);
  mk(profileX(prof, 0.15, 0.002), MAT.wood, g);
  const bl = pts.map(([z, y]) => [z, y - 0.003]).concat(pts.slice().reverse().map(([z, y]) => [z, y]));
  mk(profileX(bl, 0.152, 0.0004), MATX.blot, g);
  mk(lathe([[0, 0], [0.008, 0], [0.006, 0.01], [0.012, 0.02], [0.01, 0.028], [0, 0.03]], 32), MAT.brass, g, 0, 0.026, 0);
  contactShadow(room, -0.25, -0.33, 0.2, 0.11, 0.6, true);
}
/* 6. 10 in records in paper sleeves [S38]: tan sleeve with a round hole (GUESS) */
const labelC = makeCanvas(512, 512);
{
  const x = labelC.getContext('2d');
  x.fillStyle = '#7e1a14'; x.beginPath(); x.arc(256, 256, 254, 0, Math.PI * 2); x.fill();          // red label with gold print. GUESS [S38]
  x.strokeStyle = '#d8b65a'; x.lineWidth = 5; x.beginPath(); x.arc(256, 256, 236, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#e2c46c'; x.textAlign = 'center'; x.font = 'bold 34px Georgia, serif';
  x.fillText('DANCE ORCHESTRA', 256, 360); x.font = 'italic 30px Georgia, serif'; x.fillText('Fox Trot', 256, 402); x.font = '24px Georgia, serif'; x.fillText('ELECTRICAL PROCESS', 256, 150); x.fillText('78', 256, 450);
  x.font = 'bold 44px Georgia, serif'; x.fillText('Evening Desk', 256, 205);
  x.fillStyle = '#0d0d0d'; x.beginPath(); x.arc(256, 256, 9, 0, Math.PI * 2); x.fill();
}
const tLabel = canvasTex(labelC, true);
{
  const sc2 = makeCanvas(512, 512), x = sc2.getContext('2d'), r = rng(SEED * 41);
  x.fillStyle = '#b89a6c'; x.fillRect(0, 0, 512, 512); mottle(x, 512, 512, 20, 20, 0.2, 'soft-light', r);
  x.drawImage(labelC, 256 - 92, 256 - 92, 184, 184);
  x.strokeStyle = 'rgba(70,50,25,0.5)'; x.lineWidth = 3; x.beginPath(); x.arc(256, 256, 94, 0, Math.PI * 2); x.stroke();
  x.fillStyle = 'rgba(70,50,25,0.75)'; x.font = '22px Georgia, serif'; x.textAlign = 'center'; x.fillText('TALKING MACHINE RECORD', 256, 470);
  grain(x, 512, 512, 14, r);
  MATX.sleeve.map = canvasTex(sc2, true);
  const g = new THREE.Group(); g.position.set(0.55, 0, 0.02); room.add(g);
  for (let k = 0; k < 3; k++) {
    const m = mk(new THREE.BoxGeometry(0.262, 0.0022, 0.262), MATX.sleeve, g, (R() - 0.5) * 0.01, 0.0011 + k * 0.0024, (R() - 0.5) * 0.01);
    m.rotation.y = (R() - 0.5) * 0.25;
  }
  contactShadow(room, 0.55, 0.02, 0.34, 0.34, 0.5, true);
}
/* 7. blank sheets, 8.5 x 11 in [S47] */
{
  const g = new THREE.Group(); g.position.set(-0.58, 0, -0.24); g.rotation.y = 0.32; room.add(g);
  const pm = keep(new THREE.MeshStandardMaterial({ color: 0xd9d1bd, roughness: 0.9, bumpMap: tPaperBump, bumpScale: 0.3 }));
  for (let k = 0; k < 6; k++) mk(new THREE.BoxGeometry(0.216, 0.0009, 0.279), pm, g, (R() - 0.5) * 0.004, 0.00045 + k * 0.001, (R() - 0.5) * 0.004).rotation.y = (R() - 0.5) * 0.03;
  contactShadow(room, -0.58, -0.24, 0.26, 0.32, 0.45, true);
}

/* ============================================ the music device ============================================ */
/* Victor Orthophonic Victrola "Credenza": 46 in high, 31.25 in wide, 22 in deep [S36] = 1168 x 794 x 559 mm. Four doors [S33][S35],
 * grille with cloth [S34], gold-plated hardware [S33], turntable at the far right of the motorboard and a padded record rest at the left [S33],
 * swan's neck tone arm [S35], crank at the right side (GUESS [S33]), 4 turned legs 250 mm high with a stretcher (GUESS). */
const VW = 0.794, VD = 0.559, VH = 1.168;
const vic = new THREE.Group(); vic.position.set(0.98, FLOOR, -0.93); vic.rotation.y = -0.42; vic.userData.pick = 'player'; scene.add(vic);
const veneer = keep(new THREE.MeshPhysicalMaterial({ map: tWood, bumpMap: tWoodBump, bumpScale: 0.5, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.32, color: 0xffffff }));   // satin lacquer [S33]
const legGeo = lathe([[0, 0], [0.024, 0], [0.028, 0.018], [0.019, 0.05], [0.031, 0.09], [0.036, 0.125], [0.021, 0.165], [0.026, 0.205], [0.036, 0.228], [0.036, 0.25], [0, 0.25]], 32);
for (const sx of [-1, 1]) for (const sz of [-1, 1]) mk(legGeo, veneer, vic, sx * 0.35, 0, sz * 0.235);
for (const sx of [-1, 1]) mk(rbox(0.03, 0.022, 0.47, 0.004, 0.003), veneer, vic, sx * 0.35, 0.05, 0);
mk(rbox(0.70, 0.022, 0.03, 0.004, 0.003), veneer, vic, 0, 0.05, 0);
const VTOP = 1.12;
mk(rbox(VW - 0.02, 0.80, VD - 0.02, 0.008, 0.006), veneer, vic, 0, 0.25 + 0.40, 0);
mk(rbox(VW, 0.04, VD, 0.01, 0.008), veneer, vic, 0, 0.27, 0);                                         // base moulding
for (const [w, d, x, z] of [[VW + 0.012, 0.04, 0, VD / 2 - 0.014], [VW + 0.012, 0.04, 0, -VD / 2 + 0.014], [0.04, VD + 0.012, VW / 2 - 0.014, 0], [0.04, VD + 0.012, -VW / 2 + 0.014, 0]])
  mk(rbox(w, 0.035, d, 0.006, 0.008), veneer, vic, x, VTOP - 0.0175, z);                            // top moulding, a frame round the open top
for (const [w, d, x, z] of [[VW, 0.02, 0, VD / 2 - 0.01], [VW, 0.02, 0, -VD / 2 + 0.01], [0.02, VD, VW / 2 - 0.01, 0], [0.02, VD, -VW / 2 + 0.01, 0]])
  mk(new THREE.BoxGeometry(w, 0.09, d), veneer, vic, x, VTOP - 0.045, z);                           // walls round the motorboard
mk(new THREE.BoxGeometry(VW - 0.04, 0.012, VD - 0.04), keep(new THREE.MeshStandardMaterial({ color: 0x2a1610, roughness: 0.7 })), vic, 0, VTOP - 0.07, 0);
const vfront = VD / 2;
{ /* doors: 2 small side doors for records, 2 large middle doors open for full sound [S33] */
  const dh = 0.66, dy = 0.30 + dh / 2 + 0.03;
  for (const s of [-1, 1]) {
    const sd = new THREE.Group(); sd.position.set(s * (VW / 2 - 0.095), dy, vfront + 0.006); vic.add(sd);
    mk(rbox(0.17, dh, 0.016, 0.004, 0.003), veneer, sd);
    mk(rbox(0.12, dh - 0.09, 0.006, 0.01, 0.0025), veneer, sd, 0, 0, 0.009);
    mk(new THREE.SphereGeometry(0.008, 16, 12), MAT.gold, sd, -s * 0.07, 0, 0.012);
    const hinge = new THREE.Group(); hinge.position.set(s * (VW / 2 - 0.18 - 0.215), dy, vfront + 0.006); hinge.rotation.y = s * 1.95; vic.add(hinge);
    const door = new THREE.Group(); door.position.set(-s * 0.1075, 0, 0); hinge.add(door);
    mk(rbox(0.215, dh, 0.016, 0.004, 0.003), veneer, door);
    mk(rbox(0.16, dh - 0.09, 0.006, 0.012, 0.0025), veneer, door, 0, 0, 0.009);
    mk(new THREE.SphereGeometry(0.008, 16, 12), MAT.gold, door, -s * 0.09, 0, 0.012);
  }
  const gc2 = makeCanvas(512, 768), x = gc2.getContext('2d'), r = rng(SEED * 61);
  x.fillStyle = '#6b5236'; x.fillRect(0, 0, 512, 768);                                              // the cloth behind the grille [S34]
  for (let j = 0; j < 768; j += 3) { x.fillStyle = 'rgba(0,0,0,' + (0.08 + r() * 0.08) + ')'; x.fillRect(0, j, 512, 1); }
  for (let i = 0; i < 512; i += 3) { x.fillStyle = 'rgba(255,230,190,' + (0.03 + r() * 0.04) + ')'; x.fillRect(i, 0, 1, 768); }
  x.fillStyle = '#2b160c';                                                                          // fretwork. GUESS
  for (let c = 0; c < 5; c++) { x.fillRect(c * 128 - 10, 0, 20, 768); }
  x.fillRect(0, 0, 512, 40); x.fillRect(0, 728, 512, 40);
  for (let c = 0; c < 4; c++) { x.beginPath(); x.lineWidth = 16; x.strokeStyle = '#2b160c'; x.arc(c * 128 + 64, 140, 54, Math.PI, 0); x.stroke(); }
  const grille = mk(new THREE.PlaneGeometry(0.43, 0.64), keep(new THREE.MeshStandardMaterial({ map: canvasTex(gc2, true), roughness: 0.9 })), vic, 0, dy, vfront + 0.002, true);
}
const lid = new THREE.Group(); lid.position.set(0, VTOP, -VD / 2); lid.rotation.x = -1.32; vic.add(lid);   // lid open, hinged at the back (GUESS)
mk(rbox(VW + 0.01, 0.03, VD + 0.006, 0.01, 0.008), veneer, lid, 0, 0.015, VD / 2);
for (const s of [-1, 1]) mk(new THREE.CylinderGeometry(0.004, 0.004, 0.32, 10), MAT.gold, vic, s * (VW / 2 - 0.04), VTOP + 0.11, -VD / 2 + 0.1).rotation.x = -0.75;   // 2 air dashpots [S33][S34]
const MB = VTOP - 0.064;                                                                            // motorboard top
mk(rbox(0.30, 0.02, 0.32, 0.01, 0.006), MAT.felt, vic, -0.2, MB + 0.01, 0.0);                     // padded record rest
const turn = new THREE.Group(); turn.position.set(0.19, MB + 0.008, 0.02); vic.add(turn);         // turntable, 12 in (GUESS)
mk(new THREE.CylinderGeometry(0.152, 0.152, 0.012, 96), keep(new THREE.MeshStandardMaterial({ color: 0x24402a, roughness: 1 })), turn, 0, 0.006, 0);   // green felt (GUESS)
const discC = makeCanvas(1024, 1024), discDir = makeCanvas(256, 256);
{
  const x = discC.getContext('2d'), r = rng(SEED * 71);
  x.fillStyle = '#0b0b0b'; x.fillRect(0, 0, 1024, 1024);
  for (let k = 180; k < 510; k += 1.5) { x.strokeStyle = 'rgba(255,255,255,' + (0.012 + r() * 0.03) + ')'; x.lineWidth = 0.7; x.beginPath(); x.arc(512, 512, k, 0, Math.PI * 2); x.stroke(); }
  for (const k of [270, 340, 410]) { x.strokeStyle = 'rgba(0,0,0,0.9)'; x.lineWidth = 3; x.beginPath(); x.arc(512, 512, k, 0, Math.PI * 2); x.stroke(); }
  x.drawImage(labelC, 512 - 178, 512 - 178, 356, 356);
  const d = discDir.getContext('2d'), im = d.createImageData(256, 256);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const a = Math.atan2(127.5 - j, i - 127.5), k = (j * 256 + i) * 4;           // tangent direction of the grooves, in UV space
    im.data[k] = (-Math.sin(a) * 0.5 + 0.5) * 255; im.data[k + 1] = (Math.cos(a) * 0.5 + 0.5) * 255; im.data[k + 2] = 255; im.data[k + 3] = 255;
  }
  d.putImageData(im, 0, 0);
}
const discMat = keep(new THREE.MeshPhysicalMaterial({ map: canvasTex(discC, true), roughness: 0.32, anisotropy: 0.85, anisotropyMap: canvasTex(discDir, false), clearcoat: 0.5, clearcoatRoughness: 0.2 }));
const disc = mk(new THREE.CylinderGeometry(0.127, 0.127, 0.0022, 96), [MAT.shellac, discMat, MAT.shellac], turn, 0, 0.0135, 0);   // 10 in disc [S38]
disc.material = [MAT.shellac, discMat, discMat];
mk(new THREE.CylinderGeometry(0.0035, 0.0035, 0.022, 16), MAT.gold, turn, 0, 0.02, 0);
const arm = new THREE.Group(); arm.position.set(0.19 - 0.02, MB + 0.0, -0.22); vic.add(arm);       // swan's neck tone arm [S35], gold [S33]
mk(lathe([[0, 0], [0.03, 0], [0.03, 0.01], [0.018, 0.016], [0.014, 0.05], [0, 0.05]], 40), MAT.gold, vic, arm.position.x, MB, arm.position.z);
const armSwing = new THREE.Group(); armSwing.position.y = 0.05; arm.add(armSwing);
const armLift = new THREE.Group(); armSwing.add(armLift);
mk(tube([[0, 0, 0], [0, 0.03, 0.02], [0, 0.04, 0.08], [0, 0.034, 0.16], [0, 0.02, 0.2]], 0.0075, 48), MAT.gold, armLift);
const sbox = new THREE.Group(); sbox.position.set(0, 0.0136, 0.215); armLift.add(sbox);               // reproducer: gold plated, aluminium diaphragm [S34][S35]
mk(new THREE.CylinderGeometry(0.031, 0.031, 0.014, 40).rotateZ(Math.PI / 2), MAT.gold, sbox);
mk(new THREE.CylinderGeometry(0.025, 0.025, 0.0152, 40).rotateZ(Math.PI / 2), keep(new THREE.MeshStandardMaterial({ color: 0xbfc3c6, metalness: 1, roughness: 0.25 })), sbox);
mk(new THREE.CylinderGeometry(0.0012, 0.0005, 0.012, 8), MAT.steel, sbox, 0, -0.035, 0);
mk(new THREE.BoxGeometry(0.004, 0.01, 0.004), MAT.gold, sbox, 0, -0.027, 0);
const crank = new THREE.Group(); crank.position.set(VW / 2 + 0.002, 0.95, 0.06); vic.add(crank);  // winding crank [S33][S37], right side (GUESS)
mk(lathe([[0, 0], [0.018, 0], [0.018, 0.006], [0.006, 0.01], [0, 0.01]], 24).rotateZ(-Math.PI / 2), MAT.gold, crank);
mk(new THREE.CylinderGeometry(0.004, 0.004, 0.11, 10).rotateZ(-Math.PI / 2), MAT.gold, crank, 0.055, 0, 0);
mk(new THREE.BoxGeometry(0.008, 0.11, 0.008), MAT.gold, crank, 0.11, -0.05, 0);
mk(new THREE.CylinderGeometry(0.008, 0.009, 0.05, 16).rotateZ(-Math.PI / 2), keep(new THREE.MeshStandardMaterial({ color: 0x2a140a, roughness: 0.5 })), crank, 0.135, -0.1, 0);
mk(new THREE.BoxGeometry(0.014, 0.004, 0.03), MAT.gold, vic, 0.19 + 0.17, MB + 0.006, 0.12);      // brake tab [S37]
mk(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 20), MAT.gold, vic, 0.19 - 0.17, MB + 0.006, 0.17);   // speed knob [S37]
for (const sx of [-1, 1]) for (const sz of [-1, 1]) contactShadow(vic, sx * 0.35, sz * 0.235, 0.12, 0.12, 0.8);
contactShadow(vic, 0, 0, VW * 1.3, VD * 1.4, 0.45, true);
let musicOn = false, spin = 0, armProg = 0, armDown = 0;

/* ============================================ camera and views ============================================ */
const PW = P.clone().add(machine.position);               // the print point in world coordinates
const VIEWS = {
  machine: { tx: -0.07, ty: 0.13, tz: -0.05, yaw: 0.16, pitch: 0.30, dist: 1.22, fov: 24, halfW: 0.27, narrowHalfW: 0.27, narrowDx: 0.09 },
  line: { tx: PW.x, ty: PW.y + 0.005, tz: PW.z - 0.006, yaw: 0.02, pitch: 0.55, dist: 0.5, fov: 13, halfW: 0.095, narrowHalfW: 0.045 },
  room: { tx: 0.62, ty: 0.12, tz: -0.72, yaw: -0.62, pitch: 0.40, dist: 2.25, fov: 30, halfW: 0.7, narrowHalfW: 0.7 }
};
const viewNames = Object.keys(VIEWS);
const cur = Object.assign({}, VIEWS.machine), orb = { yaw: 0, pitch: 0, zoom: 1 };
let from = null, to = null, tView = 1, orbFrom = null, aspect = 1.6, viewName = 'machine';
function applyCam() {
  const yaw = cur.yaw + orb.yaw, pitch = clamp(cur.pitch + orb.pitch, 0.1, 1.25), dist = cur.dist * orb.zoom;
  const tx = cur.tx + (aspect < 1 ? (1 - aspect) * (cur.narrowDx || 0) : 0);    // a narrow screen: centre the machine and the sheet
  camera.position.set(tx + dist * Math.sin(yaw) * Math.cos(pitch), cur.ty + dist * Math.sin(pitch), cur.tz + dist * Math.cos(yaw) * Math.cos(pitch));
  camera.lookAt(tx, cur.ty, cur.tz);
  const hw = aspect < 1 ? Math.max(cur.narrowHalfW, cur.halfW * aspect) : cur.halfW;   // a narrow screen shows fewer letters of the line, larger
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
scene.traverse((o) => { if (o.material && o.material.alphaMap === tBlob || (o.material && o.material.alphaMap === tRect)) o.raycast = () => {}; });
let frameMs = 16.7, renderMs = 0, leverRot = 0, needBars = true;
const jamFlag = E.FLAG_JAM;
function update(s, dt) {
  dt = clamp(dt || 0.016, 0, 0.1);
  frameMs += (dt * 1000 - frameMs) * 0.05;
  /* ready: the fan rises */
  if (ready !== readyTarget) { ready = readyTarget > ready ? Math.min(1, ready + dt / 0.9) : Math.max(0, ready - dt / 0.9); }
  const e = easeIO(ready);
  fan.rotation.x = 0.30 * (1 - e); fan.position.y = FAN_O.y - 0.004 * (1 - e);
  liftKnob.position.z = 0.03 - 0.032 * e;
  /* carriage, shift, line */
  carriage.position.x = SHEET_WM / 2 - (K.LEFT_STOP + s[SNAP.X] + 0.5) * PITCH;
  lift.position.y = SHIFT_LIFT * s[SNAP.SHIFT];
  const line = s[SNAP.LINE];
  const moving = sheetMotion(dt);
  platen.rotation.x = -(line * LINE_M - feed) / PR;
  if (line !== paperShown || moving) { paperShown = line; placePaper(line); }
  leverRot += ((s[SNAP.LEVER] ? -0.42 : 0) - leverRot) * Math.min(1, dt * 18);
  lever.rotation.z = leverRot;
  /* type bars */
  const jam = (s[SNAP.FLAGS] & jamFlag) !== 0;
  let lifted = 0, changed = false, nGlint = 0;
  for (let i = 0; i < NB; i++) {
    const b = bars[i];
    let p = s[SNAP.BARS + i];
    if (b.hold > 0) { p = 1; b.hold--; }
    const j = jam && p >= K.ZONE - 0.001;
    if (b.shake > 0) b.shake = Math.max(0, b.shake - dt * 2.5);
    const extra = j ? Math.sign(b.side || 1) * -0.10 + Math.sin(b.shake * 40) * 0.05 * b.shake : 0;   // the stuck bars lean apart, clear to see
    if (p !== b.p || extra !== b.jam) { b.p = p; b.jam = extra; placeBar(i, p, extra); changed = true; }
    if (j !== !!b.lit) { b.lit = j; caps.setColorAt(i, j ? CAP_LIT : CAP_DIM); caps.instanceColor.needsUpdate = true; changed = true; }
    if (j && nGlint < glint.instanceMatrix.count) { barMesh.getMatrixAt(i, mtx); glint.setMatrixAt(nGlint++, mtx); }
    if (p > 0) lifted = Math.max(lifted, smooth(0.3, 0.9, p));
  }
  if (changed || needBars) { barMesh.instanceMatrix.needsUpdate = true; needBars = false; }
  if (nGlint !== glint.count || (nGlint && changed)) { glint.count = nGlint; glint.instanceMatrix.needsUpdate = true; }
  /* ribbon */
  if (ribHold > 0) { ribHold -= dt; lifted = 1; }
  ribLift += (lifted - ribLift) * Math.min(1, dt * (lifted > ribLift ? 70 : 22));
  if (Math.abs(ribLift - ribShown) > 2e-4) { ribShown = ribLift; placeRibbon(ribLift); vib.position.y = ribLift * 0.0076; }
  /* keys */
  let kc = false;
  const want = (i) => i < NB ? s[SNAP.KEYS + i] > 0 || (jam && s[SNAP.BARS + i] >= K.ZONE - 0.001) : i === NB + 1 ? (s[SNAP.SHIFTKEY] & 1) !== 0 : i === NB + 2 ? s[SNAP.BACKSPACE] > 0 : i === NB + 3 ? (s[SNAP.SHIFTKEY] & 2) !== 0 : false;
  for (let i = 0; i < NK; i++) {
    const t = want(i) ? 1 : 0;
    keyDip[i] += (t - keyDip[i]) * Math.min(1, dt * (t ? 45 : 22));
    if (Math.abs(keyDip[i] - keyShown[i]) > 1e-3) { keyShown[i] = keyDip[i]; placeKey(i); kc = true; }
  }
  if (kc) { caps.instanceMatrix.needsUpdate = rims.instanceMatrix.needsUpdate = stems.instanceMatrix.needsUpdate = true; }
  spaceDip += ((s[SNAP.SPACE] > 0 ? 1 : 0) - spaceDip) * Math.min(1, dt * 35);
  spaceBar.position.y = -0.004 * spaceDip;
  /* music device */
  const w = musicOn ? 78 * Math.PI * 2 / 60 : 0;          // 78 rpm [S37]
  spin += (w - spin) * Math.min(1, dt * (musicOn ? 1.2 : 0.9));
  turn.rotation.y -= spin * dt;
  armDown += ((musicOn ? 1 : 0) - armDown) * Math.min(1, dt * 2.2);
  if (musicOn) armProg = (armProg + dt / 210) % 1;        // the groove leads the arm slowly to the centre [S38]
  armSwing.rotation.y = 0.80 + (0.604 - 0.335 * armProg - 0.80) * smooth(0, 0.6, armDown);
  armLift.rotation.x = -0.14 * (1 - smooth(0.5, 1, armDown));
  /* camera. The line view follows the typed line: half-way between the print point and the middle of the sheet. */
  const lineTx = PW.x + (aspect < 1 ? 0.45 : 0.6) * carriage.position.x - 0.006;
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
    if (bars[ev.bar]) bars[ev.bar].hold = 2;
    ribHold = 0.035; ribTravel += 0.004;
    for (const sp of spools) sp.rotation.y -= 0.02;
  } else if (ev.type === 'jam') { for (const i of ev.bars || []) if (bars[i]) bars[i].shake = 1; }
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
  const hits = raycaster.intersectObjects([vic, machine], true);
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
placeRibbon(0);
const api = {
  update, event, setView, resize, pick, dispose, newSheet, replay, renderSheet,
  views: viewNames,
  get view() { return viewName; },
  orbit(dx, dy) { orb.yaw = clamp(orb.yaw - dx * 0.004, -0.6, 0.6); orb.pitch = clamp(orb.pitch + dy * 0.003, -0.3, 0.35); },
  zoom(d) { orb.zoom = clamp(orb.zoom * Math.exp(d * 0.001), 0.65, 1.5); },
  setMusic(on) { musicOn = !!on; },
  setReady(on) { readyTarget = on ? 1 : 0; },
  stats() { const i = renderer.info; return { frameMs, renderMs, calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, sheetFull: uploadsFull, sheetPatches: uploadsPatch }; },
  _debug: { THREE, scene, camera, renderer, bars, VIEWS, cur, orb, lamp, lampG, spill, turn, sbox, vic }
};
return api;
}

globalThis.buildSceneB = buildSceneB;
})();
