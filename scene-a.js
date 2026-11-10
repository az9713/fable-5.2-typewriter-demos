/* scene-a.js - the 3D picture of setting A: a news office in 1897, a Remington Standard No. 2 (an understrike
 * "blind writer") and an Edison Home Phonograph with a brown wax cylinder. A classic script (it must work from file://).
 * It defines one global: buildSceneA.
 *
 * The interface is the interface of scene-b.js (see the top comment there). Differences and additions:
 *   options.engine      TypeEngineA (static tables K, KEYS, ROWS, SNAP, FLAG_*). SNAP.LIFT: 0 = carriage down, 1 = up.
 *   scene.pick(x, y)    'player' (the phonograph), 'carriage' (platen, carriage frame, paper shelf: click to lift or lower),
 *                       'sheet', 'bars' (the type basket), 'machine'.
 *   scene.event(ev)     also reads lift, lifted, lower, seated, endstop, bell (small motions). Unknown types are ignored.
 *   scene.setView       views 'machine' | 'line' | 'room'.
 *                       'line' with the carriage down: the front of the platen, where the typed lines come up from under the
 *                       curved paper guide about 6 lines after the print (the current line stays hidden under the platen).
 *                       'line' with the carriage up: the underside of the platen, where the last lines can be read.
 *                       The view follows the lift value continuously.
 *   scene.setMusic(on)  true: the wax cylinder turns at 120 rpm and the speaker arm moves along the feed screw.
 *   scene.setReady(on)  no visible change on this machine (it has no type-bar fan to raise). Kept for the interface.
 *   scene.newSheet(), scene.replay(prints), scene.renderSheet(prints): the sheet methods of scene-b.js, same meaning.
 * Units: metres. The desk top is at y = 0. +z points to the typist, +x to the right. The print point is at x = 0.
 * Values come from reference.md, section A. [Sn] = source number there; GUESS marks values without a source.
 */
(function () {
'use strict';

function buildSceneA(THREE, canvas, options) {
options = options || {};
const E = options.engine, K = E.K, SNAP = E.SNAP, KEYS = E.KEYS, NB = KEYS.length;
const SEED = options.seed || 1;
const LEFT = 6;                                           // columns between the left sheet edge and the margin stop. CHOICE (72 + 6 < 85)

/* ============================================ small tools (same as scene-b.js) ============================================ */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(SEED * 7919 + 17);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeIO = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function makeNoise(r) {
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
const noise = makeNoise(rng(SEED * 37 + 5));

/* ============================================ renderer ============================================ */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;                    // the shadow map is drawn again only when a part moves (see update)
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x040302);
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
function mottle(ctx, w, h, nx, ny, alpha, mode, r) {
  const s = makeCanvas(nx, ny), x = s.getContext('2d'), d = x.createImageData(nx, ny);
  for (let i = 0; i < d.data.length; i += 4) { const v = r() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  x.putImageData(d, 0, 0);
  ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = mode; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(s, 0, 0, w, h); ctx.restore();
}
function grain(ctx, w, h, amp, r) {
  const d = ctx.getImageData(0, 0, w, h), a = d.data;
  for (let i = 0; i < a.length; i += 4) { const g = (r() - 0.5) * amp; a[i] += g; a[i + 1] += g; a[i + 2] += g; }
  ctx.putImageData(d, 0, 0);
}
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
/* A box W x H x D with round vertical corners (radius r) and a round bevel b on all edges. Centred. */
function rbox(w, h, d, r, b) {
  b = Math.min(b === undefined ? r * 0.5 : b, h / 2 - 1e-4, w / 2 - 1e-4, d / 2 - 1e-4);
  const g = new THREE.ExtrudeGeometry(roundRectShape(w - 2 * b, d - 2 * b, Math.max(1e-4, r - b)), {
    depth: Math.max(1e-5, h - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 5 });
  g.rotateX(-Math.PI / 2); g.translate(0, -(h - 2 * b) / 2, 0);
  return smoothNormals(g, 50);
}
/* Extrude a side profile: pts are [z, y] pairs; thickness t along x, centred on x = 0. */
function profileX(pts, t, b) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 8 });
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
/* Merge the static meshes below root that share a material into one mesh each (fewer draw calls).
 * A mesh is left alone if it or a group between it and root has userData.dynamic, userData.pick (other than root), userData.blob
 * or userData.keep, or if its material is transparent or an array. */
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), bins = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.material.transparent) return;
    for (let p = o; p && p !== root; p = p.parent) if (p.userData.dynamic || p.userData.pick || p.userData.blob || p.userData.keep) return;
    const key = o.material.uuid + '|' + o.castShadow + '|' + o.receiveShadow;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(o);
  });
  let n = 0;
  for (const list of bins.values()) {
    if (list.length < 2) continue;
    const geos = list.map((o) => { const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); return g; });
    const m = new THREE.Mesh(keep(merge(geos)), list[0].material);
    m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow;
    geos.forEach((g) => g.dispose());
    for (const o of list) o.parent.remove(o);
    root.add(m); n += list.length;
  }
  return n;
}
/* ============================================ the sheet (owned by the scene) ============================================ */
const IN = 0.0254;
const PX = 200;                           // canvas pixels for one inch. CHOICE
const PXM = PX / IN;
const COLW = PX / 10;                     // one letter space: 10 for each inch. GUESS (reference.md A1, engine-a K.PITCH_M)
const LINEH = PX / 6;                     // "narrow space" line: 4.23 mm. GUESS (reference.md A1: 4.2 mm)
const SW = Math.round(8.5 * PX), SH = 11 * PX;   // newsprint copy paper 8.5 x 11 in. GUESS (reference.md A3)
const TOP_LINES = 5;                      // empty lines above the first typed line. CHOICE
const GW = 64, GH = 80;
const sheet = makeCanvas(SW, SH), sc = sheet.getContext('2d');
(function paper() {                       // cheap newsprint: greyer, more blotchy, with dark specks of wood pulp. GUESS
  const r = rng(SEED * 101 + 9);
  sc.fillStyle = '#e6dbbf'; sc.fillRect(0, 0, SW, SH);    // palette #e3d6b4
  mottle(sc, SW, SH, 26, 34, 0.16, 'soft-light', r);
  mottle(sc, SW, SH, 140, 180, 0.12, 'soft-light', r);
  for (let i = 0; i < 14000; i++) {
    const x = r() * SW, y = r() * SH, a = r() * Math.PI * 2, l = 4 + r() * 22, bend = (r() - 0.5) * 8;
    sc.strokeStyle = r() < 0.6 ? 'rgba(110,88,58,' + (0.04 + r() * 0.06) + ')' : 'rgba(255,250,236,' + (0.07 + r() * 0.09) + ')';
    sc.lineWidth = 0.5 + r() * 0.9;
    sc.beginPath(); sc.moveTo(x, y);
    sc.quadraticCurveTo(x + Math.cos(a) * l / 2 - Math.sin(a) * bend, y + Math.sin(a) * l / 2 + Math.cos(a) * bend, x + Math.cos(a) * l, y + Math.sin(a) * l);
    sc.stroke();
  }
  for (let i = 0; i < 700; i++) {                          // specks of bark and pulp
    sc.fillStyle = 'rgba(60,44,28,' + (0.15 + r() * 0.35) + ')';
    const s = 0.6 + r() * 1.8; sc.fillRect(r() * SW, r() * SH, s, s * (0.5 + r()));
  }
  grain(sc, SW, SH, 12, r);
  const e = sc.createLinearGradient(0, 0, 18, 0); e.addColorStop(0, 'rgba(120,92,52,0.16)'); e.addColorStop(1, 'rgba(120,92,52,0)');
  sc.fillStyle = e; sc.fillRect(0, 0, 18, SH);
  sc.save(); sc.translate(SW, 0); sc.scale(-1, 1); sc.fillRect(0, 0, 18, SH); sc.restore();
})();
const paperBase = makeCanvas(SW, SH); paperBase.getContext('2d').drawImage(sheet, 0, 0);   // the blank paper, for new sheets and flat renders
const glyph = makeCanvas(GW, GH), gc = glyph.getContext('2d');
const patch = makeCanvas(GW, GH), pc = patch.getContext('2d');
const weave = makeCanvas(128, 128);                      // the cloth of the ribbon: coarser than in 1927. GUESS
(function () {
  const x = weave.getContext('2d'), d = x.createImageData(128, 128), r = rng(SEED * 17 + 3);
  for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) {
    const t = 0.5 + 0.5 * Math.sin(i * Math.PI * 2 / 5.0) * Math.sin(j * Math.PI * 2 / 5.0);
    const v = clamp(0.5 + 0.4 * t + (r() - 0.5) * 0.4 + (noise(i * 0.12, j * 0.12) - 0.5) * 0.5, 0.04, 1);
    const k = (j * 128 + i) * 4; d.data[k] = d.data[k + 1] = d.data[k + 2] = 0; d.data[k + 3] = v * 255;
  }
  x.putImageData(d, 0, 0);
})();
const barErr = Array.from({ length: NB }, (_, i) => { const r = rng(SEED * 977 + i * 131 + 7); return { dx: (r() - 0.5) * 2.4, dy: (r() - 0.5) * 3.2, rot: (r() - 0.5) * 0.05, wear: r() * Math.PI * 2, wearAmt: 0.2 + r() * 0.35 }; });
/* Type face: a pica face with bracketed serifs. System fonts only: Courier New is the nearest shape. Bold weight because
 * the 1890s faces were heavier than Courier New. CHOICE. The machine prints both cases through the platen shift. */
const FONT = 'bold 31px "Courier New", Courier, "Nimbus Mono L", monospace';
const SHIFT_PX = 14;                      // px that a character is off its line when the platen is half-way in its shift. GUESS
let sheetTex = null, patchTex = null, uploadsFull = 0, uploadsPatch = 0;
const dstPos = new THREE.Vector2();
function stamp(ev, T, noUpload) {                         // T: the 2D context to draw on (default: the live sheet)
  T = T || sc;
  const r = rng(ev.r >>> 0), be = barErr[ev.bar] || barErr[0];
  const cx = (LEFT + ev.column + 0.5) * COLW + be.dx + (r() - 0.5) * 1.8;
  const sh = ev.shift || 0, off = (sh >= 0.5 ? sh - 1 : sh) * 2 * SHIFT_PX;
  const cy = (TOP_LINES + ev.line) * LINEH + be.dy + (r() - 0.5) * 1.8 + off;
  if (cy - GH > SH || cx < 0 || cx > SW) return;
  const f = clamp(ev.force === undefined ? 0.7 : ev.force, 0, 1);
  const dark = clamp(0.30 + 0.80 * f + (r() - 0.5) * 0.18, 0.26, 1);
  gc.setTransform(1, 0, 0, 1, 0, 0); gc.globalCompositeOperation = 'source-over'; gc.globalAlpha = 1; gc.clearRect(0, 0, GW, GH);
  gc.translate(GW / 2, GH / 2); gc.rotate(be.rot + (r() - 0.5) * 0.016);
  gc.font = FONT; gc.textAlign = 'center'; gc.textBaseline = 'alphabetic';
  gc.fillStyle = '#000'; gc.strokeStyle = '#000'; gc.lineWidth = 0.6 + f * 0.6; gc.lineJoin = 'round';
  gc.fillText(ev.ch, 0, 9); gc.strokeText(ev.ch, 0, 9);
  gc.setTransform(1, 0, 0, 1, 0, 0);
  gc.globalCompositeOperation = 'destination-in';
  gc.drawImage(weave, -Math.floor(r() * 64), -Math.floor(r() * 48));
  const a = be.wear + (r() - 0.5) * 0.8, dx = Math.cos(a) * 18, dy = Math.sin(a) * 18;
  const lg = gc.createLinearGradient(GW / 2 - dx, GH / 2 - dy, GW / 2 + dx, GH / 2 + dy);
  lg.addColorStop(0, 'rgba(0,0,0,1)'); lg.addColorStop(1, 'rgba(0,0,0,' + clamp(1 - be.wearAmt - (1 - f) * 0.35, 0.1, 1) + ')');
  gc.fillStyle = lg; gc.fillRect(0, 0, GW, GH);
  gc.globalCompositeOperation = 'source-in'; gc.fillStyle = '#1d1826'; gc.fillRect(0, 0, GW, GH);   // record ink, black with a violet cast. GUESS
  const x0 = Math.round(cx - GW / 2), y0 = Math.round(cy - GH / 2);
  T.save(); T.globalCompositeOperation = 'multiply';
  T.filter = 'blur(2px)'; T.globalAlpha = 0.24 * dark; T.drawImage(glyph, x0, y0);   // newsprint takes up more ink
  T.filter = 'blur(0.45px)'; T.globalAlpha = dark; T.drawImage(glyph, x0, y0);
  T.restore();
  if (!sheetTex || noUpload || T !== sc) return;
  const px = clamp(x0, 0, SW - GW), py = clamp(y0, 0, SH - GH);
  pc.clearRect(0, 0, GW, GH); pc.drawImage(sheet, px, py, GW, GH, 0, 0, GW, GH);
  patchTex.needsUpdate = true;
  renderer.copyTextureToTexture(patchTex, sheetTex, null, dstPos.set(px, SH - py - GH));   // texSubImage2D of GW x GH px only
  uploadsPatch++;
}

/* ============================================ other textures ============================================ */
function bumpTex(n, seed, strokes, amp) {
  const c = makeCanvas(n, n), x = c.getContext('2d'), r = rng(seed);
  x.fillStyle = '#808080'; x.fillRect(0, 0, n, n);
  mottle(x, n, n, n / 8, n / 8, 0.35, 'soft-light', r);
  for (let i = 0; i < strokes; i++) {
    const px = r() * n, py = r() * n, a = r() * Math.PI * 2, l = 4 + r() * 18;
    x.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)'; x.lineWidth = 0.6 + r();
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
  }
  grain(x, n, n, amp, r);
  return canvasTex(c, false, true);
}
/* Quarter-sawn golden oak: straight grain, open dark pores in lines, and the pale ray flecks of oak. GUESS colour (palette #9a6a35). */
function oakCanvas(w, h, seed, base, dark, light) {
  /* the grain runs along v (canvas columns). Soft bands of late wood, short dark pores along the grain, pale ray flecks. */
  const c = makeCanvas(w, h), x = c.getContext('2d'), d = x.createImageData(w, h), r = rng(seed), nz = makeNoise(r);
  const cb = new THREE.Color(base), cd = new THREE.Color(dark), cl = new THREE.Color(light), out = new THREE.Color();
  const pore = new Float32Array(w); for (let i = 0; i < w; i++) pore[i] = r();
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = i / w, v = j / h;
    const warp = (nz(u * 3, v * 1.5) - 0.5) * 0.05 + (nz(u * 12, v * 3) - 0.5) * 0.012;
    let band = 0.5 + 0.5 * Math.sin(Math.PI * 2 * ((u + warp) * 30 + 5 * nz(u * 2.5, v * 0.8) + 1.2 * nz(u * 9, v * 2)));
    band = Math.pow(band, 2.6) * (0.6 + 0.4 * nz(u * 5 + 7, v * 1.5));
    const col = (i + Math.round(warp * w) + w * 4) % w;
    const p = pore[col] < 0.2 && nz(u * 64, v * 70) > 0.42 ? 0.72 + 0.2 * nz(u * 300, v * 9) : 1;
    const ray = Math.max(0, nz(u * 70 + 3, v * 7) - 0.7) * 2.2;
    const streak = 0.9 + 0.12 * nz(u * 260, v * 4);
    out.copy(cb).lerp(cd, 0.55 * band).lerp(cl, clamp(ray, 0, 0.35));
    const k = (j * w + i) * 4, m = p * streak;
    d.data[k] = clamp(out.r * 255 * m, 0, 255); d.data[k + 1] = clamp(out.g * 255 * m, 0, 255); d.data[k + 2] = clamp(out.b * 255 * m, 0, 255); d.data[k + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return c;
}
function smudgeTex() {                                     // finger marks, dust and fine scratches (roughness, G channel)
  const c = makeCanvas(512, 512), x = c.getContext('2d'), r = rng(SEED * 13 + 8);
  x.fillStyle = 'rgb(46,46,46)'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 30; i++) {
    const px = r() * 512, py = r() * 512, rad = 12 + r() * 40, g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, 'rgba(150,150,150,' + (0.25 + r() * 0.35) + ')'); g.addColorStop(1, 'rgba(150,150,150,0)');
    x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 220; i++) {
    x.strokeStyle = 'rgba(170,170,170,' + (0.08 + r() * 0.2) + ')'; x.lineWidth = 0.6;
    const px = r() * 512, py = r() * 512, a = r() * Math.PI, l = 10 + r() * 60;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
  }
  grain(x, 512, 512, 22, r);
  return canvasTex(c, false, true);
}
function plasterTex() {                                    // grimy cream plaster [S64b], palette #8a7d66; soot darker at the top. GUESS
  const c = makeCanvas(512, 512), x = c.getContext('2d'), r = rng(SEED * 19 + 5);
  x.fillStyle = '#8f8268'; x.fillRect(0, 0, 512, 512);
  mottle(x, 512, 512, 10, 10, 0.35, 'soft-light', r); mottle(x, 512, 512, 48, 48, 0.22, 'soft-light', r);
  for (let i = 0; i < 40; i++) {                           // streaks of grime that run down
    const px = r() * 512, g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, 'rgba(40,30,20,' + (0.06 + r() * 0.1) + ')'); g.addColorStop(1, 'rgba(40,30,20,0)');
    x.fillStyle = g; x.fillRect(px, 0, 2 + r() * 10, 200 + r() * 312);
  }
  grain(x, 512, 512, 14, r);
  return canvasTex(c, true, true);
}
function blobTex(rect) {
  const c = makeCanvas(128, 128), x = c.getContext('2d');
  if (rect) { x.filter = 'blur(14px)'; x.fillStyle = 'rgba(0,0,0,0.8)'; x.fillRect(26, 26, 76, 76); }
  else { const g = x.createRadialGradient(64, 64, 4, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.45, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); }
  return canvasTex(c, false, false);
}
const tPaperBump = bumpTex(512, SEED * 5 + 2, 3500, 40), tSmudge = smudgeTex(), tPlaster = plasterTex(), tBlob = blobTex(false), tRect = blobTex(true);
const tCast = bumpTex(256, SEED * 7 + 1, 0, 70);          // the fine sand texture of cast iron under the japan
tPaperBump.repeat.set(7, 9); tCast.repeat.set(4, 4);
const oakC = oakCanvas(1024, 1024, SEED * 23 + 1, '#9c7547', '#5f4021', '#c4a275');   // palette #9a6a35, less red under the flame
const tOak = canvasTex(oakC, true, true), tOakBump = canvasTex(oakC, false, true);
/* ============================================ materials ============================================ */
const MAT = {};
MAT.japan = new THREE.MeshPhysicalMaterial({ color: 0x16130f, roughness: 0.38, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.14,
  clearcoatRoughnessMap: tSmudge, bumpMap: tCast, bumpScale: 0.25 });                     // black japanned iron [S7], palette #16130f
MAT.japanMatte = new THREE.MeshStandardMaterial({ color: 0x100e0b, roughness: 0.7 });
MAT.nickel = new THREE.MeshStandardMaterial({ color: 0xcfc6b0, metalness: 1, roughness: 0.24, roughnessMap: tSmudge });   // nickel plate [S7], palette #c9c5b8, aged warm
MAT.steel = new THREE.MeshStandardMaterial({ color: 0xa3a3a0, metalness: 1, roughness: 0.34, roughnessMap: tSmudge });
MAT.blued = new THREE.MeshStandardMaterial({ color: 0x323a4c, metalness: 1, roughness: 0.32 });   // blued steel [S7]
MAT.rubber = new THREE.MeshPhysicalMaterial({ color: 0x191715, roughness: 0.58, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x2c2a26) });
MAT.knob = new THREE.MeshPhysicalMaterial({ color: 0x0f0e0d, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
MAT.brass = new THREE.MeshStandardMaterial({ color: 0xc09a48, metalness: 1, roughness: 0.32, roughnessMap: tSmudge });   // brass [S25], palette #b08d3c
MAT.gold = new THREE.MeshStandardMaterial({ color: 0xc49a45, metalness: 1, roughness: 0.3 });
MAT.oak = new THREE.MeshPhysicalMaterial({ map: tOak, bumpMap: tOakBump, bumpScale: 0.5, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.38 });   // golden oak under shellac. GUESS
MAT.leverWood = new THREE.MeshStandardMaterial({ map: tOak, color: 0x8c6a4a, roughness: 0.6 });   // wood key levers [S7]
MAT.paper = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, bumpMap: tPaperBump, bumpScale: 0.08, side: THREE.DoubleSide });
MAT.plaster = new THREE.MeshStandardMaterial({ map: tPlaster, roughness: 0.96 });
MAT.felt = new THREE.MeshStandardMaterial({ color: 0x2a221a, roughness: 1 });
MAT.nickel.envMapIntensity = 2.4; MAT.steel.envMapIntensity = 2.0; MAT.brass.envMapIntensity = 2.0; MAT.gold.envMapIntensity = 2.0; MAT.blued.envMapIntensity = 1.6;
for (const k in MAT) keep(MAT[k]);
const blobMat = (t, o) => keep(new THREE.MeshBasicMaterial({ transparent: true, opacity: o, depthWrite: false, color: 0x000000, alphaMap: t, polygonOffset: true, polygonOffsetFactor: -2 }));
function contactShadow(parent, x, z, w, d, o, rect, y) {
  const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, d)), blobMat(rect ? tRect : tBlob, o));
  m.rotation.x = -Math.PI / 2; m.position.set(x, (y || 0) + 0.0004, z); m.renderOrder = 1; m.userData.blob = true;
  parent.add(m); return m;
}
/* A japanned panel with hand-painted gold lines and small flowers [S7]; colour of decoration GUESS (palette #b8923a).
 * draw(x, w, h) adds the ornament on a 2D canvas; the result is used as the colour map of a japan material. */
function japanPanel(w, h, draw) {
  const c = makeCanvas(w, h), x = c.getContext('2d'), r = rng(SEED * 211 + w + h);
  x.fillStyle = '#16130f'; x.fillRect(0, 0, w, h);
  mottle(x, w, h, 12, 12, 0.08, 'soft-light', r);
  draw(x, w, h, r);
  return keep(new THREE.MeshPhysicalMaterial({ map: canvasTex(c, true), roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.15,
    clearcoatRoughnessMap: tSmudge, bumpMap: tCast, bumpScale: 0.2, metalness: 0 }));
}
function goldInk(x, y0, y1) { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, '#e6c56e'); g.addColorStop(0.5, '#b8923a'); g.addColorStop(1, '#7d5f22'); return g; }
function flower(x, cx, cy, s, r) {                       // a small painted flower: 5 petals, 2 leaves. GUESS
  x.save(); x.translate(cx, cy); x.rotate(r() * 0.6 - 0.3);
  x.fillStyle = 'rgba(184,146,58,0.9)';
  for (let k = 0; k < 2; k++) { x.save(); x.rotate((k ? 1 : -1) * 1.1); x.beginPath(); x.ellipse(s * 1.4, 0, s * 1.1, s * 0.38, 0, 0, Math.PI * 2); x.fill(); x.restore(); }
  x.fillStyle = 'rgba(214,170,74,0.95)';
  for (let k = 0; k < 5; k++) { x.save(); x.rotate(k * Math.PI * 2 / 5); x.beginPath(); x.ellipse(s * 0.55, 0, s * 0.55, s * 0.3, 0, 0, Math.PI * 2); x.fill(); x.restore(); }
  x.fillStyle = '#7d5f22'; x.beginPath(); x.arc(0, 0, s * 0.22, 0, Math.PI * 2); x.fill();
  x.restore();
}

/* ============================================ light and environment ============================================ */
/* One motivated light: a kerosene desk lamp (1897 office photos show kerosene lamps [S63]; the lamp type is a GUESS from
 * reference.md A3). Flame colour about 2000 K (GUESS between the candle 1850 K and the lamp 2400 K of [S48]);
 * tint #ff9329 is the reference estimate for 2100 K, made a little less saturated here so that the paper stays readable.
 * A flame has no reflector: the opal shade sends most light down in a wide cone with a very soft edge, and a dim glow
 * goes to all sides. The light is weaker than the electric lamp of 1927 and falls off faster (it is nearer to the desk). */
const FLAME = new THREE.Color(0xffb46e);
(function environment() {
  const env = new THREE.Scene(), box = new THREE.BoxGeometry(1, 1, 1);
  const room = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.010, 0.008, 0.006), side: THREE.BackSide })); room.scale.set(8, 3.6, 8); room.position.y = 1.0; env.add(room);
  const add = (w, h, d, x, y, z, c) => { const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: c })); m.scale.set(w, h, d); m.position.set(x, y, z); env.add(m); return m; };
  add(0.2, 0.09, 0.2, -0.60, 0.37, 0.14, new THREE.Color(7, 4.4, 2.2));     // the glowing opal shade of the lamp
  add(0.03, 0.05, 0.03, -0.60, 0.33, 0.14, new THREE.Color(40, 24, 10));   // the flame in its chimney
  add(1.5, 0.02, 0.8, 0, -0.02, 0, new THREE.Color(0.09, 0.05, 0.022));      // the lit desk top
  for (let k = 0; k < 3; k++) add(0.02, 1.2, 0.7, 3.2, 1.2, -1.6 + k * 1.6, new THREE.Color(0.05, 0.065, 0.10));   // tall windows at night, one side [S64]
  add(0.05, 0.05, 0.05, -0.75, 1.16, -1.68, new THREE.Color(5, 2.8, 1.0));    // distant gas jets [S64a]
  add(0.05, 0.05, 0.05, 0.30, 0.73, -1.68, new THREE.Color(5, 2.8, 1.0));
  add(4, 0.1, 6, 0, 2.6, 0, new THREE.Color(0.03, 0.022, 0.015));           // the ceiling with timbers, a little lit
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.03, 0.05, 20);
  scene.environment = rt.texture; scene.environmentIntensity = 0.6;
  keep(rt); pm.dispose(); box.dispose(); env.traverse((o) => o.material && o.material.dispose());
})();
const lamp = new THREE.SpotLight(FLAME, 3.6, 0, 0.9, 1.0, 2);   // the down light under the shade, with shadows
lamp.castShadow = true;
lamp.shadow.mapSize.set(2048, 2048);
lamp.shadow.camera.near = 0.08; lamp.shadow.camera.far = 2.5;
lamp.shadow.bias = -0.0003; lamp.shadow.normalBias = 0; lamp.shadow.radius = 5;
scene.add(lamp, lamp.target);
const glow = new THREE.PointLight(FLAME, 0.5, 0, 2);           // the dim light to all sides, through the opal glass. No shadow
scene.add(glow);
const fill = new THREE.HemisphereLight(0x6f7f9c, 0x1d140c, 0.16); scene.add(fill);
const moon = new THREE.DirectionalLight(0x8396b8, 0.24); moon.position.set(3.0, 2.0, -0.4); scene.add(moon);   // night sky through the windows at the right. GUESS
const rim = new THREE.DirectionalLight(0x8a9cc0, 0.08); rim.position.set(1.0, 1.5, -2.5); scene.add(rim);
/* ============================================ the typewriter: frame ============================================ */
/* Remington Standard No. 2: 390 W x 400 D x 280 H mm [S3][S4][S5] (contradiction 1: the 394 to 406 mm heights of [S1][S2]
 * are not used). An open iron frame: 4 corner posts, a base rectangle and a top plate with a round hole [reference A1].
 * Layout in machine coordinates (all GUESS within the sourced box): base z -0.19 to 0.19, top plate z -0.19 to 0.05 at
 * y 0.165, keyboard in front of the posts, platen above the hole, print point under the platen. */
const machine = new THREE.Group(); machine.position.set(0, 0, 0.02); machine.userData.pick = 'machine'; scene.add(machine);
const PR = 0.0185;                                         // platen radius. GUESS
const PC = V3(0, 0.2145, -0.075);                          // platen centre, carriage down. GUESS
const P = V3(0, PC.y - PR, PC.z);                          // the print point: the bottom of the platen [S5][S9]
const PITCH = 0.00254, LINE_M = IN / 6;
const SHIFT_Z = 0.0042;                                    // the platen moves back on the carriage for capitals [S6][S7]; distance GUESS
const TOPY = 0.165, HOLE_R = 0.094, FW = 0.33, ZB = -0.19, ZF = 0.05;
const SHEET_WM = SW / PXM, SHEET_LM = SH / PXM;
const frame = new THREE.Group(); machine.add(frame);
/* top plate with the round hole; gold lines round the edge and the hole */
{
  const s = roundRectShape(FW, ZF - ZB, 0.012); s.holes.push(new THREE.Path().absarc(0, 0, HOLE_R, 0, Math.PI * 2, true));
  // the shape is centred: move the hole to the basket centre after the rotation
  const zc = (ZB + ZF) / 2, hz = P.z - zc;
  s.holes[0] = new THREE.Path().absarc(0, -hz, HOLE_R, 0, Math.PI * 2, true);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 48 });
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv, pos = g.attributes.position;          // map the top face to the decoration canvas
  for (let k = 0; k < uv.count; k++) uv.setXY(k, pos.getX(k) / (FW + 0.01) + 0.5, -pos.getZ(k) / (ZF - ZB + 0.01) + 0.5);
  const mat = japanPanel(1024, 768, (x, w, h, r) => {
    const sx = w / (FW + 0.01), sy = h / (ZF - ZB + 0.01), cx = w / 2, cy = h / 2 + hz * sy;
    x.strokeStyle = goldInk(x, 0, h); x.lineWidth = 3;
    x.strokeRect(0.012 * sx, 0.012 * sy, w - 0.024 * sx, h - 0.024 * sy);
    x.lineWidth = 1.2; x.strokeRect(0.017 * sx, 0.017 * sy, w - 0.034 * sx, h - 0.034 * sy);
    x.lineWidth = 2.5; x.beginPath(); x.ellipse(cx, cy, (HOLE_R + 0.008) * sx, (HOLE_R + 0.008) * sy, 0, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 1; x.beginPath(); x.ellipse(cx, cy, (HOLE_R + 0.012) * sx, (HOLE_R + 0.012) * sy, 0, 0, Math.PI * 2); x.stroke();
    for (const [fx, fy] of [[0.07, 0.12], [0.93, 0.12], [0.07, 0.88], [0.93, 0.88]]) {
      flower(x, fx * w, fy * h, 9, r); flower(x, fx * w + (fx < 0.5 ? 24 : -24), fy * h + 10, 6, r); flower(x, fx * w + (fx < 0.5 ? 10 : -10), fy * h - 18, 5, r);
    }
  });
  mk(smoothNormals(g, 40), mat, frame, 0, TOPY - 0.0095, zc);
}
/* base rectangle: 4 rails on 4 small feet */
const RAIL = 0.016;
for (const s of [-1, 1]) mk(rbox(0.018, RAIL, 0.38, 0.004, 0.003), MAT.japan, frame, s * 0.152, 0.004 + RAIL / 2, 0);
mk(rbox(0.32, RAIL, 0.018, 0.004, 0.003), MAT.japan, frame, 0, 0.004 + RAIL / 2, ZB + 0.009);
{ /* front rail with the inscription "REMINGTON STANDARD TYPEWRITER NO. 2" [S1] in gold */
  const mat = japanPanel(2048, 128, (x, w, h, r) => {
    x.strokeStyle = goldInk(x, 0, h); x.lineWidth = 3; x.strokeRect(8, 10, w - 16, h - 20);
    x.font = 'bold 54px Georgia, "Times New Roman", serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = goldInk(x, 30, 100); x.fillText('REMINGTON  STANDARD  TYPEWRITER  No. 2', w / 2, h / 2 + 3);
    flower(x, 60, h / 2, 12, r); flower(x, w - 60, h / 2, 12, r);
  });
  const g = new THREE.BoxGeometry(0.32, 0.024, 0.014);
  const m = mk(g, [MAT.japan, MAT.japan, MAT.japan, MAT.japan, mat, MAT.japan], frame, 0, 0.016, 0.183);
  m.userData.label = 'front rail';
}
for (const x of [-0.15, 0.15]) for (const z of [ZB + 0.01, 0.18]) mk(new THREE.CylinderGeometry(0.009, 0.011, 0.005, 20), MAT.felt, frame, x, 0.0025, z);
/* 4 corner posts: cast iron with a waist, from the base to the top plate. Shape GUESS */
{
  const g = lathe([[0.0105, 0], [0.0105, 0.006], [0.0075, 0.014], [0.0062, 0.05], [0.0058, 0.09], [0.0066, 0.125], [0.0085, 0.14], [0.0105, 0.146], [0.0105, 0.150]], 20);
  const postMat = japanPanel(64, 512, (x, w, h) => {      // gold rings painted on the posts [S7]; pattern GUESS
    x.fillStyle = goldInk(x, 0, h);
    for (const v of [0.06, 0.09, 0.80, 0.84, 0.95]) x.fillRect(0, (1 - v) * h - 2, w, v === 0.09 || v === 0.84 ? 2 : 4);
  });
  for (const sx of [-1, 1]) for (const z of [ZB + 0.014, ZF - 0.014]) mk(g, postMat, frame, sx * 0.148, 0.006, z);
  /* side braces: an arch at each side between the posts, open below (the frame stays open). GUESS */
  for (const sx of [-1, 1]) {
    const pts = []; for (let k = 0; k <= 20; k++) { const t = k / 20, z = ZB + 0.014 + t * (ZF - ZB - 0.028); pts.push([sx * 0.148, TOPY - 0.012 - 0.035 * Math.sin(t * Math.PI) * 0.0 - 0.03 * (1 - Math.pow(Math.sin(t * Math.PI), 0.4)), z]); }
    mk(tube(pts, 0.0042, 40, false, 8), MAT.japan, frame);
  }
  /* the rear cross bar under the top plate, with the bell */
  mk(rbox(0.29, 0.012, 0.012, 0.003, 0.002), MAT.japan, frame, 0, 0.11, ZB + 0.012);
}
/* front scale (87) on the front edge of the top plate: marks 0 to 80, 10 for each inch [S6]; the pointer (94) is on the carriage */
{
  const c = makeCanvas(2048, 64), x = c.getContext('2d'), w = 0.23;
  const g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, '#dcd5c3'); g.addColorStop(1, '#a29a86'); x.fillStyle = g; x.fillRect(0, 0, 2048, 64);
  x.fillStyle = '#1a1712'; x.font = 'bold 22px Georgia, serif'; x.textAlign = 'center';
  for (let m = 0; m <= 80; m++) {
    const lx = -SHEET_WM / 2 + (m + 0.5) * PITCH + (LEFT - 6) * PITCH, px = (lx + w / 2) / w * 2048;
    const hh = m % 10 === 0 ? 30 : m % 5 === 0 ? 20 : 12; x.fillRect(px - 1.2, 0, 2.4, hh);
    if (m % 10 === 0) x.fillText(String(m), px, 58);
  }
  const sm = mk(new THREE.PlaneGeometry(w, 0.008), keep(new THREE.MeshStandardMaterial({ map: canvasTex(c, true), metalness: 0.8, roughness: 0.32 })), frame, 0, TOPY + 0.0006, ZF - 0.008, true);
  sm.rotation.x = -Math.PI / 2;
}
/* bell (on the rear, below the carriage [S6]; position GUESS) */
const bell = new THREE.Group(); bell.position.set(0.11, 0.122, ZB + 0.02); frame.add(bell);
mk(lathe([[0, 0.016], [0.006, 0.0155], [0.012, 0.012], [0.0155, 0.005], [0.0165, 0], [0.0158, -0.0005], [0.0145, 0.004], [0.011, 0.0105], [0.005, 0.014], [0, 0.0145]], 40), MAT.nickel, bell).rotation.x = Math.PI / 2;
mk(new THREE.CylinderGeometry(0.0018, 0.0018, 0.012, 8).rotateX(Math.PI / 2), MAT.blued, bell, 0, 0, -0.006);
contactShadow(machine, 0, 0, 0.5, 0.52, 0.8, true);
/* ============================================ keyboard ============================================ */
/* 38 keys in 4 rows of 10, 10, 9, 9 (GUESS, engine-a.js); QWERTY [S8]. Round flat white tops with a black letter in a
 * nickel ring (GUESS, reference.md A1). Letter keys show 1 character, other keys 2 [S6]. "UPPER CASE" and "LOWER CASE"
 * keys at the left end of the 2 front rows (position GUESS). Wood key levers [S7]; wood space bar across the front [S6][S7]. */
const KP = 0.0215, KR = 0.0074;
const rowZ = [0.074, 0.099, 0.124, 0.149], rowY = [0.096, 0.083, 0.070, 0.057], rowOff = [0, 0.35, 0.85, 1.25];
const keyPos = [];
for (let r = 0, i = 0; r < E.ROWS.length; r++) for (let k = 0; k < E.ROWS[r]; k++, i++) keyPos.push([-0.105 + (k + rowOff[r]) * KP, rowY[r], rowZ[r]]);
function keyRow(i) { let n = 0; for (let r = 0; r < E.ROWS.length; r++) { n += E.ROWS[r]; if (i < n) return r; } return 3; }
const CTRL = [['LOWER', 'CASE', 2], ['UPPER', 'CASE', 3]];
for (const [, , r] of CTRL) { const xs = keyPos.filter((p, i) => i < NB && keyRow(i) === r).map((p) => p[0]); keyPos.push([Math.min(...xs) - KP * 1.12, rowY[r], rowZ[r]]); }
const NK = keyPos.length;
const atlas = makeCanvas(1024, 1024);
(function legends() {
  const x = atlas.getContext('2d'), C = 128, r = rng(SEED * 3 + 11);
  for (let i = 0; i < 64; i++) {
    const cx = (i % 8) * C + C / 2, cy = Math.floor(i / 8) * C + C / 2;
    const g = x.createRadialGradient(cx - 12, cy - 16, 6, cx, cy, C * 0.5);
    g.addColorStop(0, '#f2eee2'); g.addColorStop(0.75, '#e4ddca'); g.addColorStop(1, '#bdb299');        // white, yellowed. GUESS
    x.fillStyle = g; x.fillRect(cx - C / 2, cy - C / 2, C, C);
    for (let k = 0; k < 50; k++) { x.fillStyle = 'rgba(110,90,60,' + r() * 0.06 + ')'; x.fillRect(cx - 60 + r() * 120, cy - 60 + r() * 120, 1 + r() * 2, 1 + r() * 2); }
  }
  x.fillStyle = '#12100d'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const fam = 'Georgia, "Times New Roman", serif';           // a Roman face for the legends. GUESS
  for (let i = 0; i < NK; i++) {
    const cx = (i % 8) * C + C / 2, cy = Math.floor(i / 8) * C + C / 2;
    if (i < NB) {
      const lo = KEYS[i][1], up = KEYS[i][2];
      if (/[a-z]/.test(lo)) { x.font = 'bold 64px ' + fam; x.fillText(up, cx, cy + 4); }
      else { x.font = 'bold 42px ' + fam; x.fillText(up, cx, cy - 22); x.fillText(lo, cx, cy + 25); }
    } else { const c = CTRL[i - NB]; x.font = 'bold 26px ' + fam; x.fillText(c[0], cx, cy - 14); x.fillText(c[1], cx, cy + 17); }
  }
})();
const tAtlas = canvasTex(atlas, true, false);
const capMat = keep(new THREE.MeshPhysicalMaterial({ map: tAtlas, roughness: 0.5, clearcoat: 0.9, clearcoatRoughness: 0.1 }));
capMat.onBeforeCompile = (sh) => {
  sh.vertexShader = 'attribute vec2 aCell;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vMapUv * 0.125 + aCell;\n#endif');
};
const capGeo = merge([new THREE.CircleGeometry(KR, 36).rotateX(-Math.PI / 2), new THREE.CylinderGeometry(KR, KR, 0.002, 36, 1, true).translate(0, -0.001, 0)]);
const caps = new THREE.InstancedMesh(keep(capGeo), capMat, NK);
const cells = new Float32Array(NK * 2);
for (let i = 0; i < NK; i++) { cells[i * 2] = (i % 8) / 8; cells[i * 2 + 1] = 1 - (Math.floor(i / 8) + 1) / 8; }
capGeo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
const rimGeo = lathe([[KR - 0.0003, -0.0022], [KR + 0.001, -0.0022], [KR + 0.0013, 0.0], [KR + 0.001, 0.0011], [KR + 0.0001, 0.0011], [KR - 0.0003, 0.0004]], 40);
const rims = new THREE.InstancedMesh(keep(rimGeo), MAT.nickel, NK);
const stemGeo = new THREE.CylinderGeometry(0.0013, 0.0013, 1, 8).translate(0, -0.5, 0);
const stems = new THREE.InstancedMesh(keep(stemGeo), MAT.blued, NK);
/* key levers: wood strips from the key back to a fulcrum rod at the rear; the 4 rows lie at 4 heights. GUESS geometry */
const LEV_Z = ZB + 0.02, levY = [0.036, 0.031, 0.026, 0.021];
const levers = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.0034, 0.008, 1)), MAT.leverWood, NK);
for (const im of [caps, rims, stems, levers]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; machine.add(im); }
mk(new THREE.CylinderGeometry(0.003, 0.003, 0.3, 10).rotateZ(Math.PI / 2), MAT.blued, frame, 0, 0.026, LEV_Z);   // fulcrum rod
const mtx = new THREE.Matrix4(), q0 = new THREE.Quaternion(), sv = V3(1, 1, 1), tv = V3(0, 0, 0), ex = V3(1, 0, 0);
const keyDip = new Float32Array(NK), keyShown = new Float32Array(NK).fill(-1);
const KEY_TRAVEL = 0.009;                                  // key travel. GUESS (long throw of the early machines)
function placeKey(i) {
  const [x, y, z] = keyPos[i], r = i < NB ? keyRow(i) : CTRL[i - NB][2], d = keyDip[i] * KEY_TRAVEL;
  const L = z - LEV_Z, a = Math.atan2(d, L);               // the lever turns on the fulcrum: the key end goes down d
  q0.identity();
  mtx.compose(tv.set(x, y - d, z), q0, sv.set(1, 1, 1)); caps.setMatrixAt(i, mtx); rims.setMatrixAt(i, mtx);
  const ly = levY[r] - d;
  mtx.compose(tv.set(x, y - d - 0.0022, z), q0, sv.set(1, Math.max(0.001, y - 0.0022 - levY[r]), 1)); stems.setMatrixAt(i, mtx);
  mtx.compose(tv.set(x, (levY[r] + ly) / 2, (z + 0.006 + LEV_Z) / 2), q0.setFromAxisAngle(ex, a), sv.set(1, 1, L + 0.006)); levers.setMatrixAt(i, mtx);
}
for (let i = 0; i < NK; i++) placeKey(i);
const spaceBar = new THREE.Group(); machine.add(spaceBar);
{
  const sbMat = keep(new THREE.MeshPhysicalMaterial({ map: tOak, color: 0x7a5636, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 }));
  mk(rbox(0.235, 0.008, 0.014, 0.003, 0.0025), sbMat, spaceBar, -0.005, 0.046, 0.172);       // the long wood bar [S6]
  for (const s of [-1, 1]) mk(new THREE.BoxGeometry(0.004, 0.003, 0.2), MAT.blued, spaceBar, s * 0.1, 0.036, 0.075).rotation.x = -0.05;
}
let spaceDip = 0;

/* ============================================ the type basket ============================================ */
/* The type arms hang in a ring under the platen; each swings up to the common print point on the bottom of the platen
 * [S5][S7][S8]. 38 arms (engine), pivots in 2 levels [S7]. Back half of the ring: the 2 back rows; front half: the 2 front
 * rows; left keys at the left (GUESS order). Ring radii, heights and lengths: GUESS. */
const PL = P.clone(), yAx = V3(0, 1, 0);
const bars = [];
{
  const back = [], front = [];
  for (let i = 0; i < NB; i++) (keyRow(i) < 2 ? back : front).push(i);
  back.sort((a, b) => keyPos[a][0] - keyPos[b][0]); front.sort((a, b) => keyPos[a][0] - keyPos[b][0]);
  const put = (list, isFront) => list.forEach((i, k) => {
    const t = (k + 0.5) / list.length, psi = isFront ? Math.PI * (1 - t) : Math.PI * (1 + t);
    const lvl = (k & 1), Rr = lvl ? 0.082 : 0.073, yq = lvl ? 0.112 : 0.119;
    const u = V3(Math.cos(psi), 0, Math.sin(psi));
    const Q = V3(PL.x + u.x * Rr, yq, PL.z + u.z * Rr);
    const L = Math.hypot(Rr, PL.y - yq) - 0.0035;            // the face of the type stops 3.5 mm before the axis line (the slug)
    const thS = Math.atan2(PL.y - yq, -Rr);                   // direction at the print, in the plane (u, y)
    bars[i] = { u, Q, L, thS, thR: (262 + (lvl ? -4 : 0)) * Math.PI / 180, ax: V3(-u.z, 0, u.x), p: -1, hold: 0, jam: 0, shake: 0, psi };
  });
  put(back, false); put(front, true);
}
const barGeo = merge([
  new THREE.BoxGeometry(0.0019, 1, 0.0042).translate(0, 0.5, 0),                         // the arm, scaled to its length
]);
const headGeo = new THREE.BoxGeometry(0.0042, 0.009, 0.0048).translate(0, -0.0045, 0.0002);   // the type slug, 2 characters [S7]
const barSteel = keep(new THREE.MeshStandardMaterial({ color: 0xd0ccc4, metalness: 1, roughness: 0.28, envMapIntensity: 4.5 }));   // polished arms: they catch the flame in the dark basket
const barMesh = new THREE.InstancedMesh(keep(barGeo), barSteel, NB);
const headMesh = new THREE.InstancedMesh(keep(headGeo), barSteel, NB);
const pivMesh = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.0024, 0.0024, 0.0034, 12).rotateZ(Math.PI / 2)), MAT.blued, NB);
const wireMesh = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.0005, 0.0005, 1, 5).translate(0, 0.5, 0)), MAT.steel, NB);
for (const im of [barMesh, headMesh, pivMesh, wireMesh]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; machine.add(im); im.userData.pick = 'bars'; }
const bx = V3(), by = V3(), bz = V3(), tip = V3(), heel = V3(), wl = V3(), qa = new THREE.Quaternion(), m2 = new THREE.Matrix4();
function placeBar(i, p, extra) {
  const f = 1 - Math.pow(1 - clamp(p, 0, 1), 1.35);       // swing angle from the travel: faster at the start (key lever ratio). GUESS
  const b = bars[i], th = b.thR + (b.thS - b.thR) * f;
  by.copy(b.u).multiplyScalar(Math.cos(th)).addScaledVector(yAx, Math.sin(th));
  bx.copy(b.ax); bz.crossVectors(bx, by);
  if (extra) { qa.setFromAxisAngle(bz, extra); bx.applyQuaternion(qa); by.applyQuaternion(qa); }   // a jammed arm leans on its neighbour
  mtx.makeBasis(bx, by, bz); mtx.scale(sv.set(1, b.L, 1)); mtx.setPosition(b.Q); barMesh.setMatrixAt(i, mtx);
  tip.copy(b.Q).addScaledVector(by, b.L + 0.0035);
  mtx.makeBasis(bx, by, bz); mtx.setPosition(tip); headMesh.setMatrixAt(i, mtx);
  mtx.makeBasis(bx, by, bz); mtx.setPosition(b.Q); pivMesh.setMatrixAt(i, mtx);
  heel.copy(b.Q).addScaledVector(by, -0.012);              // the heel of the arm: the pull wire from the key lever [S8]
  const k = keyPos[i], r = keyRow(i);
  wl.set(k[0] * 0.92, levY[r] + 0.004, PL.z + (keyRow(i) < 2 ? -0.03 : 0.03));
  by.subVectors(heel, wl); const len = by.length(); by.multiplyScalar(1 / len);
  qa.setFromUnitVectors(yAx, by); mtx.compose(wl, qa, sv.set(1, len, 1)); wireMesh.setMatrixAt(i, mtx);
}
for (let i = 0; i < NB; i++) placeBar(i, 0, 0);
{ /* the pivot ring (2 levels) on 4 hangers from the top plate, and a felt ring where the type heads rest. GUESS */
  const ringG = merge([lathe([[0.066, -0.004], [0.090, -0.004], [0.091, 0.0], [0.090, 0.004], [0.066, 0.004], [0.065, 0]], 64)]);
  const ring = mk(smoothNormals(ringG, 50), MAT.japan, machine, PL.x, 0.1155, PL.z); ring.userData.pick = 'bars';
  mk(new THREE.TorusGeometry(0.0775, 0.0012, 6, 96).rotateX(Math.PI / 2), MAT.nickel, machine, PL.x, 0.1198, PL.z);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, x = PL.x + Math.cos(a) * 0.088, z = PL.z + Math.sin(a) * 0.088;
    mk(new THREE.CylinderGeometry(0.0035, 0.0035, TOPY - 0.12, 10), MAT.japan, machine, x, (TOPY + 0.12) / 2 - 0.004, z);
    mk(new THREE.CylinderGeometry(0.003, 0.003, 0.1, 8), MAT.japan, machine, x * 0.75, 0.065, PL.z + (z - PL.z) * 0.75).rotation.set(0, 0, 0);
  }
  mk(lathe([[0.050, 0.010], [0.072, 0.010], [0.073, 0.016], [0.051, 0.016]], 64), MAT.felt, machine, PL.x, 0.0, PL.z);   // rest pad
  mk(lathe([[0.046, 0.004], [0.077, 0.004], [0.078, 0.011], [0.047, 0.011]], 64), MAT.japan, machine, PL.x, 0.0, PL.z);
}

/* ---- ribbon: 2 spools at the left and the right of the basket, the ribbon winds from one to the other [S6].
 * Spool axes front-to-back (GUESS, reference.md A1). Ribbon path across the top of the basket under the platen (GUESS). ---- */
const SPX = 0.163, SPY = 0.1715, SPZ = P.z, RIB_W = 0.0127, RIB_Y = P.y - 0.0016;
const ribC = makeCanvas(256, 64), rcx = ribC.getContext('2d');
rcx.fillStyle = '#17141c'; rcx.fillRect(0, 0, 256, 64);
for (let j = 0; j < 64; j += 2) { rcx.fillStyle = 'rgba(255,255,255,' + (0.025 + R() * 0.04) + ')'; rcx.fillRect(0, j, 256, 1); }
for (let i = 0; i < 256; i += 2) { rcx.fillStyle = 'rgba(0,0,0,0.1)'; rcx.fillRect(i, 0, 1, 64); }
const tRibbon = canvasTex(ribC, true, true);
const ribbonMat = keep(new THREE.MeshStandardMaterial({ map: tRibbon, roughness: 0.82, side: THREE.DoubleSide }));
const spools = [];
for (const s of [-1, 1]) {
  const g = new THREE.Group(); g.position.set(s * SPX, SPY, SPZ); machine.add(g);
  const flange = lathe([[0.004, 0], [0.0205, 0], [0.021, 0.0007], [0.0205, 0.0014], [0.006, 0.0014]], 48);
  const f1 = mk(flange, MAT.nickel, g, 0, 0, -RIB_W / 2 - 0.0015); f1.rotation.x = Math.PI / 2;
  const f2 = mk(flange, MAT.nickel, g, 0, 0, RIB_W / 2 + 0.0015); f2.rotation.x = -Math.PI / 2;
  const wound = new THREE.CylinderGeometry(0.0155, 0.0155, RIB_W, 48, 1, true); wound.rotateX(Math.PI / 2);
  const uvw = wound.attributes.uv; for (let k = 0; k < uvw.count; k++) uvw.setXY(k, uvw.getX(k) * 8, uvw.getY(k) * 0.25);
  mk(wound, ribbonMat, g);
  mk(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 12).rotateX(Math.PI / 2), MAT.nickel, g);
  for (let k = 0; k < 3; k++) { const sp = mk(new THREE.BoxGeometry(0.03, 0.0022, 0.001), MAT.nickel, g, 0, 0, RIB_W / 2 + 0.0024); sp.rotation.z = k * Math.PI / 3; }
  /* bracket from the top plate */
  mk(rbox(0.012, SPY - TOPY + 0.004, 0.008, 0.002, 0.0015), MAT.japan, machine, s * SPX, (SPY + TOPY) / 2, SPZ - RIB_W / 2 - 0.007);
  mk(rbox(0.03, 0.004, 0.016, 0.003, 0.0015), MAT.japan, machine, s * (SPX - 0.008), TOPY + 0.002, SPZ - RIB_W / 2 - 0.007);
  spools.push(g);
}
for (const s of [-1, 1]) {                                 // ribbon guides: 2 slotted nickel posts near the print point. GUESS
  mk(rbox(0.004, RIB_Y - TOPY + 0.002, 0.018, 0.0015, 0.001), MAT.nickel, machine, s * 0.052, (RIB_Y + TOPY) / 2 - 0.002, SPZ);
}
const RIB_N = 90;
const ribGeo = new THREE.BufferGeometry();
ribGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RIB_N + 1) * 2 * 3), 3));
ribGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((RIB_N + 1) * 2 * 2), 2));
{ const idx = []; for (let k = 0; k < RIB_N; k++) idx.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3); ribGeo.setIndex(idx); }
const ribbon = mk(ribGeo, ribbonMat, machine); ribbon.frustumCulled = false;
let ribLift = 0, ribShown = -1, ribHold = 0, ribTravel = 0;
function ribY(x) {                                         // height of the ribbon along x: from the top of each spool up to the guides, flat between
  const ax = Math.abs(x), yTop = SPY + 0.0155;
  if (ax <= 0.052) return RIB_Y;
  const t = smooth(0.052, SPX, ax);
  return RIB_Y + (yTop - RIB_Y) * t;
}
function placeRibbon(lift) {
  const p = ribGeo.attributes.position.array, uv = ribGeo.attributes.uv.array;
  for (let k = 0; k <= RIB_N; k++) {
    const x = -SPX + 2 * SPX * k / RIB_N, y = ribY(x) + lift * 0.0011 * (1 - smooth(0.002, 0.012, Math.abs(x)));
    p.set([x, y, SPZ - RIB_W / 2, x, y, SPZ + RIB_W / 2], k * 6);
    uv.set([k / RIB_N * 24 + ribTravel, 0, k / RIB_N * 24 + ribTravel, 1], k * 4);
  }
  ribGeo.attributes.position.needsUpdate = true; ribGeo.attributes.uv.needsUpdate = true; ribGeo.computeVertexNormals();
}
/* ============================================ the carriage ============================================ */
/* A long frame that holds the rubber platen, a wood feed roller and a metal paper shelf behind the platen [S6][S8].
 * The carriage lifts on a hinge at its back rail; the typist takes it by the frame [S6] (contradiction 3: [S6] chosen).
 * The platen moves back on the carriage for capitals [S6][S7] (contradiction 4: [S6][S7] chosen, as in engine-a.js).
 * Carriage lever on the right side [S8] (contradiction 2: [S8] chosen; [S7] describes the No. 3). Shapes: GUESS. */
const HINGE = V3(0, 0.198, -0.133);                       // the axis of the hinge: the back rail of the carriage. GUESS
const LIFT_ANG = 80 * Math.PI / 180;                      // angle of the carriage when it is up. GUESS
const carriage = new THREE.Group(); carriage.userData.pick = 'carriage'; machine.add(carriage);
const hingeG = new THREE.Group(); hingeG.position.copy(HINGE); carriage.add(hingeG);
const liftG = new THREE.Group(); liftG.position.copy(HINGE).multiplyScalar(-1); hingeG.add(liftG);
const shiftG = new THREE.Group(); liftG.add(shiftG);
const platen = new THREE.Group(); platen.position.copy(PC); shiftG.add(platen);
/* rails on the frame (fixed): the back rail that carries the hinge and the front rail on which the carriage rests */
mk(new THREE.CylinderGeometry(0.004, 0.004, 0.47, 14).rotateZ(Math.PI / 2), MAT.nickel, frame, 0, HINGE.y - 0.009, HINGE.z);
mk(rbox(0.47, 0.006, 0.012, 0.002, 0.0015), MAT.japan, frame, 0, HINGE.y - 0.016, HINGE.z);
for (const s of [-1, 1]) mk(rbox(0.014, HINGE.y - 0.016 - TOPY, 0.012, 0.002, 0.002), MAT.japan, frame, s * 0.14, (HINGE.y - 0.016 + TOPY) / 2, HINGE.z);
/* carriage parts that do not lift: the hinge tube and its 2 rollers on the back rail */
mk(new THREE.CylinderGeometry(0.0052, 0.0052, 0.27, 16).rotateZ(Math.PI / 2), MAT.nickel, carriage, 0, HINGE.y, HINGE.z);
for (const s of [-1, 1]) mk(new THREE.CylinderGeometry(0.0065, 0.0065, 0.006, 18).rotateZ(Math.PI / 2), MAT.blued, carriage, s * 0.11, HINGE.y - 0.006, HINGE.z);
/* end plates (lift with the carriage) */
{
  const prof = [[HINGE.z - 0.008, HINGE.y - 0.004], [HINGE.z - 0.004, HINGE.y + 0.012], [PC.z - 0.02, PC.y + 0.022], [PC.z + 0.012, PC.y + 0.02], [PC.z + 0.03, PC.y + 0.004],
    [PC.z + 0.034, PC.y - 0.012], [PC.z + 0.026, 0.197], [PC.z - 0.03, 0.197], [HINGE.z + 0.01, HINGE.y - 0.006]];
  const g = profileX(prof, 0.005, 0.0012);
  for (const s of [-1, 1]) { const m = mk(g, MAT.japan, liftG, s * 0.131, 0, 0); m.userData.pick = 'carriage'; }
  /* the pointer (94) is not modelled: a pointer that reaches the front scale would stand up when the carriage lifts. CHOICE */
}
/* platen: hard rubber on a steel axle, knobs at both ends, a ratchet wheel at the left. Length 9.5 in. GUESS */
const PLEN = 0.242;
mk(new THREE.CylinderGeometry(PR, PR, PLEN, 72, 1).rotateZ(Math.PI / 2), MAT.rubber, platen).userData.pick = 'carriage';
mk(new THREE.CylinderGeometry(0.0032, 0.0032, 0.31, 12).rotateZ(Math.PI / 2), MAT.nickel, platen);
{
  const knob = lathe([[0.0001, -0.008], [0.011, -0.008], [0.0145, -0.0066], [0.0155, -0.004], [0.0155, 0.004], [0.0145, 0.0066], [0.011, 0.008], [0.0001, 0.008]], 64);
  const p = knob.attributes.position;
  for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k), z = p.getZ(k), r = Math.hypot(x, z); if (Math.abs(y) < 0.0045 && r > 0.015) { const a = Math.atan2(z, x), d = 0.0006 * Math.cos(a * 36); p.setXYZ(k, x * (r + d) / r, y, z * (r + d) / r); } }
  knob.computeVertexNormals(); knob.rotateZ(Math.PI / 2);
  for (const s of [-1, 1]) {
    mk(knob, MAT.knob, platen, s * 0.150, 0, 0).userData.pick = 'carriage';
    mk(new THREE.CylinderGeometry(0.006, 0.006, 0.005, 24).rotateZ(Math.PI / 2), MAT.nickel, platen, s * 0.1395, 0, 0);
  }
  const rat = new THREE.CylinderGeometry(0.0165, 0.0165, 0.0035, 40, 1).rotateZ(Math.PI / 2);   // ratchet wheel: 40 teeth
  const rp = rat.attributes.position;
  for (let k = 0; k < rp.count; k++) { const x = rp.getX(k), y = rp.getY(k), z = rp.getZ(k), r = Math.hypot(y, z); if (r > 0.016) { const a = Math.atan2(z, y), f = ((a / (Math.PI * 2) * 40) % 1 + 1) % 1, d = -0.0016 * f; rp.setXYZ(k, x, y * (r + d) / r, z * (r + d) / r); } }
  rat.computeVertexNormals();
  mk(rat, MAT.steel, platen, -0.128, 0, 0);
}
/* The paper path. The sheet comes down from the paper shelf behind the platen, goes under the platen past the print
 * point and up the front. Its typed head goes up the front under a curved paper guide, over the top of the platen and
 * lies back on the shelf against the tail. s = m along the sheet from the print line, positive toward the top edge. GUESS. */
const TH_P = -Math.PI / 2, TH_T = -165 * Math.PI / 180, TH_D = 62 * Math.PI / 180, PE = PR + 0.0004;
const DS = 0.0005, TJ = 0.05, OFF = 0.0016;
const S_TE = (TH_T - TH_P) * PE, S_HD = (TH_D - TH_P) * PE;
const tailTab = [];
{
  let y = PC.y + PE * Math.sin(TH_T), z = PC.z + PE * Math.cos(TH_T), el = -TH_T - Math.PI / 2;
  for (let k = 0; k * DS <= 0.32; k++) {
    tailTab.push([y, z, Math.cos(el), Math.sin(el)]);
    if (k * DS > 0.012) el = Math.max(48 * Math.PI / 180, el - DS / 0.05);   // the sheet lies on the shelf, about 48 degrees. GUESS
    if (k * DS > 0.1) el = Math.max(0.5, el - DS / 0.4);
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
  const EL0 = Math.PI / 2 - TH_D;
  const P0 = [PC.y + PE * Math.sin(TH_D), PC.z + PE * Math.cos(TH_D)], D0 = [Math.sin(EL0), -Math.cos(EL0)];
  const T1 = tailAt(TJ, [0, 0, 0, 0]), P1 = [T1[0] + OFF * T1[2], T1[1] + OFF * T1[3]], D1 = [T1[3], -T1[2]];
  const L = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]) * 1.2;
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
{ /* paper shelf (F) behind the platen [S6][S8]; the texts of [S2][S5][S8] on its back face, which faces up when the carriage is lifted */
  const t0 = 0.008, t1 = 0.085, n = 16, W = 0.262, pos = [], uv = [], idx = [], o = [0, 0, 0, 0];
  for (let k = 0; k <= n; k++) {
    tailAt(t0 + (t1 - t0) * k / n, o);
    const y = o[0] - o[2] * 0.0024, z = o[1] - o[3] * 0.0024;
    pos.push(-W / 2, y, z, W / 2, y, z); uv.push(0, 1 - k / n, 1, 1 - k / n);
    if (k < n) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const back = japanPanel(1024, 320, (x, w, h, r) => {
    x.strokeStyle = goldInk(x, 0, h); x.lineWidth = 3; x.strokeRect(14, 14, w - 28, h - 28); x.lineWidth = 1; x.strokeRect(22, 22, w - 44, h - 44);
    x.fillStyle = goldInk(x, 40, h - 40); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'bold 30px Georgia, serif'; x.fillText('KEEP THE MACHINE FREE FROM DUST.', w / 2, 70);
    x.font = 'bold 21px Georgia, serif'; x.fillText('CLEAN ALL THE TOP RODS — ESPECIALLY THE SHIFTING ROD —', w / 2, 120); x.fillText('WITH A GREASY CLOTH EVERY DAY.', w / 2, 152);
    x.font = 'italic bold 34px Georgia, serif'; x.fillText('To Save Time is to Lengthen Life.', w / 2, 230);
    flower(x, 70, h / 2, 12, r); flower(x, w - 70, h / 2, 12, r);
  });
  back.side = THREE.BackSide;
  const front = mk(g, MAT.japan, liftG); front.material = keep(MAT.japan.clone()); front.material.side = THREE.FrontSide; front.userData.pick = 'carriage';
  const bk = new THREE.Mesh(g, back); bk.castShadow = true; bk.receiveShadow = true; bk.userData.pick = 'carriage'; liftG.add(bk);
  for (const s of [-1, 1]) { const a = tailAt(t0, [0, 0, 0, 0]), b = tailAt(t1, [0, 0, 0, 0]);
    mk(tube([[s * 0.131, PC.y + 0.006, PC.z - 0.02], [s * 0.131, a[0] - 0.002, a[1] - 0.004], [s * W / 2, b[0] - b[2] * 0.004, b[1] - b[3] * 0.004]], 0.0016, 16), MAT.japan, liftG); }
}
const PG_A = -70 * Math.PI / 180, PG_B = -10 * Math.PI / 180, PG_R = PE + 0.0032, PG_W = 0.226;
{ /* the curved paper guide at the front of the platen; its lower edge is the cylinder scale (its edge = the bottom of the letters [S6]) */
  const c = makeCanvas(2048, 256), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#cdc6b2'); g.addColorStop(1, '#a8a08c'); x.fillStyle = g; x.fillRect(0, 0, 2048, 256);
  x.fillStyle = '#1a1712'; x.font = 'bold 26px Georgia, serif'; x.textAlign = 'center';
  for (let m = 0; m <= 80; m++) {
    const lx = -SHEET_WM / 2 + (LEFT + m + 0.5) * PITCH, px = (lx + PG_W / 2) / PG_W * 2048;
    const hh = m % 10 === 0 ? 40 : m % 5 === 0 ? 28 : 16; x.fillRect(px - 1.4, 256 - hh, 2.8, hh);
    if (m % 10 === 0) x.fillText(String(m), px, 256 - 50);
  }
  const n = 28, pos = [], uv = [], idx = [];
  for (let k = 0; k <= n; k++) {
    const th = PG_A + (PG_B - PG_A) * k / n, y = PG_R * Math.sin(th), z = PG_R * Math.cos(th);
    pos.push(-PG_W / 2, y, z, PG_W / 2, y, z); uv.push(0, k / n, 1, k / n);
    if (k < n) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
  geo.computeVertexNormals();
  const guide = new THREE.Mesh(keep(geo), keep(new THREE.MeshStandardMaterial({ map: canvasTex(c, true), metalness: 0.85, roughness: 0.28, side: THREE.DoubleSide })));
  guide.castShadow = guide.receiveShadow = true; guide.userData.pick = 'carriage'; guide.userData.guide = true;
  guide.position.copy(PC); shiftG.add(guide);
}
/* wood feed roller [S8]: presses the paper on the back of the platen. Position GUESS */
const FR_TH = -136 * Math.PI / 180, FR_R = 0.0048;
const feedRoller = new THREE.Group(); feedRoller.position.set(0, PC.y + (PE + FR_R + 0.0002) * Math.sin(FR_TH), PC.z + (PE + FR_R + 0.0002) * Math.cos(FR_TH)); shiftG.add(feedRoller);
mk(new THREE.CylinderGeometry(FR_R, FR_R, 0.22, 24).rotateZ(Math.PI / 2), keep(new THREE.MeshStandardMaterial({ map: tOak, color: 0x8c7a66, roughness: 0.66 })), feedRoller);
mk(new THREE.CylinderGeometry(0.0016, 0.0016, 0.262, 8).rotateZ(Math.PI / 2), MAT.nickel, feedRoller);
/* carriage lever (170): long, curved, on the right side, over the keyboard [S8]. It turns toward the typist for the line feed. GUESS shape */
const lever = new THREE.Group(); lever.position.set(0.137, PC.y + 0.004, PC.z + 0.012); liftG.add(lever);
mk(tube([[0, 0, 0], [0.006, 0.012, 0.03], [0.014, 0.008, 0.075], [0.02, -0.018, 0.115], [0.022, -0.05, 0.135]], 0.0024, 40), MAT.nickel, lever).userData.pick = 'carriage';
mk(new THREE.CylinderGeometry(0.0055, 0.0055, 0.03, 20), keep(new THREE.MeshPhysicalMaterial({ map: tOak, color: 0x4a2c16, roughness: 0.4, clearcoat: 0.6 })), lever, 0.022, -0.062, 0.137);   // wood handle. GUESS
mk(new THREE.CylinderGeometry(0.005, 0.005, 0.007, 20).rotateZ(Math.PI / 2), MAT.nickel, lever, -0.002, 0, 0);
/* cylinder-shifter (149) and line-space gauge (95) on the left end; carriage release key (140 1/2). Positions GUESS [S6] */
mk(tube([[-0.134, PC.y + 0.012, PC.z - 0.01], [-0.142, PC.y + 0.03, PC.z + 0.004], [-0.142, PC.y + 0.034, PC.z + 0.02]], 0.0018, 16), MAT.nickel, liftG);
mk(new THREE.SphereGeometry(0.0038, 16, 12), MAT.knob, liftG, -0.142, PC.y + 0.034, PC.z + 0.022);
mk(new THREE.BoxGeometry(0.003, 0.012, 0.006), MAT.nickel, liftG, -0.136, PC.y + 0.024, PC.z - 0.028).rotation.x = 0.3;
mk(new THREE.CylinderGeometry(0.0042, 0.0042, 0.004, 18), MAT.knob, liftG, -0.12, TOPY + 0.03, PC.z + 0.04);
/* stop-collar (N) on the back rail at the left margin [S6] */
mk(new THREE.CylinderGeometry(0.007, 0.007, 0.01, 18).rotateZ(Math.PI / 2), MAT.nickel, frame, -0.215, HINGE.y - 0.009, HINGE.z);

/* ---- the paper: a strip mesh along the path; the sheet canvas is its texture ---- */
const PROWS = 150, PCOLS = 9;
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
const paper = mk(paperGeo, MAT.paper, shiftG); paper.frustumCulled = false; paper.userData.pick = 'sheet';
let paperShown = -1;
const pa = [0, 0, 0, 0];
function placePaper(line) {
  const yPrint = (TOP_LINES + line) * LINEH, sTop = yPrint / PXM, sLo = sTop - SHEET_LM;
  const p = paperGeo.attributes.position.array, n = paperGeo.attributes.normal.array, uv = paperGeo.attributes.uv.array;
  for (let r = 0; r < PROWS; r++) {
    const f = r / (PROWS - 1), s0 = sLo + (sTop - sLo) * f, s = s0 - feed;   // feed: the part of a new sheet not yet fed in
    pathAt(s, pa);
    const v = 1 - (yPrint - s0 * PXM) / SH, flat = Math.max(smooth(0.03, 0.08, s - S_HD), smooth(0.01, 0.05, S_TE - s));
    for (let c = 0; c < PCOLS; c++) {
      const u = c / (PCOLS - 1), x = -SHEET_WM / 2 + u * SHEET_WM;
      const wav = flat * (0.0006 * Math.sin(u * 9.0 + s * 30) + 0.0025 * Math.sin(u * Math.PI) * smooth(0.04, 0.2, Math.abs(s)));
      const k = r * PCOLS + c;
      p[k * 3] = x; p[k * 3 + 1] = pa[0] + pa[2] * wav; p[k * 3 + 2] = pa[1] + pa[3] * wav;
      n[k * 3] = 0; n[k * 3 + 1] = -pa[2]; n[k * 3 + 2] = -pa[3];
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
const ghost = new THREE.Mesh(ghostGeo, keep(new THREE.MeshStandardMaterial({ map: ghostTex, roughness: 0.93, side: THREE.DoubleSide, transparent: true })));
ghost.visible = false; ghost.frustumCulled = false; ghost.raycast = () => {}; shiftG.add(ghost);
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
/* A long, barnlike city room [S64]; walls grimy [S64b]; windows on one side; rubber matting on the floor [S64a]; rolltop desks
 * [S64b][S50]. The desk: a plain flat-top oak table desk, 1500 x 800 x 760 mm (GUESS, reference.md A3). */
const room = new THREE.Group(); scene.add(room);
const FLOOR = -0.76, DZ = -0.10;
mk(rbox(1.50, 0.034, 0.80, 0.006, 0.004), MAT.oak, room, 0, -0.017, DZ);
mk(rbox(1.44, 0.07, 0.024, 0.003, 0.002), MAT.oak, room, 0, -0.07, DZ + 0.37, true);            // front apron with a drawer
mk(rbox(0.5, 0.05, 0.004, 0.002, 0.0015), MAT.oak, room, 0, -0.07, DZ + 0.383, true);
mk(new THREE.SphereGeometry(0.008, 12, 10), MAT.brass, room, 0, -0.07, DZ + 0.39, true);
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  mk(lathe([[0, 0], [0.024, 0], [0.026, 0.02], [0.02, 0.08], [0.028, 0.5], [0.032, 0.62], [0.036, 0.66], [0.036, 0.726], [0, 0.726]], 24), MAT.oak, room, sx * 0.69, FLOOR, DZ + sz * 0.35, true);
}
{
  /* floor: black rubber matting with ribs [S64a]. GUESS colour and rib size */
  const c = makeCanvas(256, 256), x = c.getContext('2d'), r = rng(SEED * 29);
  x.fillStyle = '#7f7f7f'; x.fillRect(0, 0, 256, 256);
  for (let j = 0; j < 256; j += 16) { x.fillStyle = '#d0d0d0'; x.fillRect(0, j + 2, 256, 8); x.fillStyle = '#404040'; x.fillRect(0, j + 11, 256, 3); }
  grain(x, 256, 256, 30, r);
  const tb = canvasTex(c, false, true); tb.repeat.set(30, 30);
  const fl = mk(new THREE.PlaneGeometry(9, 9), keep(new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 0.82, bumpMap: tb, bumpScale: 1.5 })), room, 0, FLOOR, 0, true);
  fl.rotation.x = -Math.PI / 2;
  /* back wall: plaster above a dark wood board [reference A3, GUESS] */
  tPlaster.repeat.set(4, 2);
  mk(new THREE.PlaneGeometry(9, 3.6), MAT.plaster, room, 0, FLOOR + 1.8, -1.9, true);
  const board = keep(new THREE.MeshStandardMaterial({ map: tOak, color: 0x3a2412, roughness: 0.55 }));
  mk(new THREE.BoxGeometry(9, 1.0, 0.03), board, room, 0, FLOOR + 0.5, -1.885, true);
  mk(new THREE.BoxGeometry(9, 0.05, 0.05), board, room, 0, FLOOR + 1.01, -1.87, true);
  /* right wall with 3 tall windows at night [S64] */
  const rw = mk(new THREE.PlaneGeometry(6, 3.6), MAT.plaster, room, 2.8, FLOOR + 1.8, 0, true); rw.rotation.y = -Math.PI / 2;
  const night = keep(new THREE.MeshStandardMaterial({ color: 0x05070c, emissive: 0x18233a, emissiveIntensity: 0.5, roughness: 0.08, metalness: 0.3 }));
  for (let k = 0; k < 3; k++) {
    const w = new THREE.Group(); w.position.set(2.79, FLOOR + 1.55, -1.3 + k * 1.5); w.rotation.y = -Math.PI / 2; room.add(w);
    mk(new THREE.PlaneGeometry(0.9, 1.8), night, w, 0, 0, 0.002, true);
    for (const yy of [-0.3, 0.3]) mk(new THREE.BoxGeometry(0.9, 0.03, 0.04), board, w, 0, yy, 0.01, true);
    mk(new THREE.BoxGeometry(0.03, 1.8, 0.04), board, w, 0, 0, 0.01, true);
    mk(new THREE.BoxGeometry(1.0, 0.08, 0.08), board, w, 0, -0.94, 0.03, true);
  }
  /* bare timbers of the ceiling [S64a] */
  for (let k = 0; k < 5; k++) mk(new THREE.BoxGeometry(9, 0.22, 0.16), board, room, 0, FLOOR + 3.3, -1.6 + k * 1.1, true);
  /* 2 rolltop desks in the dark behind [S50][S64b]: oak, tambour of wood slats. GUESS size 1.5 x 0.8 x 1.2 m */
  const slatC = makeCanvas(16, 256), slx = slatC.getContext('2d');
  slx.fillStyle = '#9a9a9a'; slx.fillRect(0, 0, 16, 256); for (let j = 0; j < 256; j += 16) { slx.fillStyle = '#303030'; slx.fillRect(0, j, 16, 2); }
  const tSlat = canvasTex(slatC, false, true); tSlat.repeat.set(1, 3);
  const slatMat = keep(new THREE.MeshPhysicalMaterial({ map: tOak, bumpMap: tSlat, bumpScale: 3, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 }));
  const roll = (x, z, ry) => {                             // pedestal rolltop desk with a tambour of wood slats [S50]. Size GUESS
    const g = new THREE.Group(); g.position.set(x, FLOOR, z); g.rotation.y = ry; room.add(g);
    for (const sx of [-1, 1]) {
      mk(rbox(0.42, 0.72, 0.76, 0.004, 0.003), MAT.oak, g, sx * 0.53, 0.36, 0, true);
      for (let k = 0; k < 4; k++) { mk(rbox(0.36, 0.15, 0.012, 0.003, 0.003), MAT.oak, g, sx * 0.53, 0.1 + k * 0.17, 0.385, true); mk(new THREE.SphereGeometry(0.009, 10, 8), MAT.brass, g, sx * 0.53, 0.1 + k * 0.17, 0.395, true); }
      mk(profileX([[-0.38, 0], [0.34, 0], [0.34, 0.03], [0.22, 0.12], [0.02, 0.3], [-0.2, 0.44], [-0.38, 0.46]], 0.022, 0.003), MAT.oak, g, sx * 0.74, 0.755, 0, true);
    }
    mk(rbox(1.52, 0.035, 0.8, 0.004, 0.003), MAT.oak, g, 0, 0.738, 0, true);
    mk(rbox(1.46, 0.46, 0.18, 0.004, 0.003), MAT.oak, g, 0, 0.985, -0.29, true);
    const tam = new THREE.CylinderGeometry(0.36, 0.36, 1.46, 24, 1, true, 0, Math.PI / 2); tam.rotateZ(Math.PI / 2);
    const tm = mk(tam, slatMat, g, 0, 0.755, -0.2, true); tm.rotation.x = -Math.PI / 2;
    mk(rbox(1.5, 0.03, 0.4, 0.004, 0.003), MAT.oak, g, 0, 1.23, -0.2, true);
    return g;
  };
  roll(-1.25, -1.45, 0); roll(0.30, -1.45, 0);            // the second desk behind the typist's right, under a gas jet: the right half of the 'room' view
}
/* gas jets on the back wall, far away [S64a]: small flames, a little light on the wall. No shadow */
const jets = [];
for (const [x, z, h] of [[-0.75, -1.88, 1.85], [0.30, -1.88, 1.42]]) {   // the right jet low over the second rolltop desk. Place GUESS
  const g = new THREE.Group(); g.position.set(x, FLOOR + h, z); room.add(g);
  mk(tube([[0, 0, 0], [0, 0.0, 0.12], [0, 0.04, 0.2]], 0.008, 12), MAT.brass, g, 0, 0, 0, true);
  const f = new THREE.Mesh(keep(new THREE.SphereGeometry(0.014, 12, 10)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.6, 0.9) })));
  f.scale.set(1, 1.8, 1); f.position.set(0, 0.07, 0.2); g.add(f);
  const l = new THREE.PointLight(FLAME, 0.5, 3.0, 2); l.position.set(0, 0.07, 0.25); g.add(l);
  jets.push(l);
}

/* ---- the kerosene desk lamp: brass base, oil font, burner, glass chimney, white opal dome shade. GUESS dimensions (flame 330 mm above the desk) ---- */
const lampG = new THREE.Group(); lampG.position.set(-0.60, 0, 0.12); room.add(lampG);
const FLAME_Y = 0.33;
{
  mk(lathe([[0, 0], [0.075, 0], [0.078, 0.006], [0.07, 0.016], [0.04, 0.026], [0.018, 0.034], [0.014, 0.05], [0.017, 0.11], [0.013, 0.16], [0.022, 0.175], [0, 0.175]], 56), MAT.brass, lampG);
  mk(lathe([[0, 0.17], [0.03, 0.172], [0.062, 0.195], [0.07, 0.215], [0.066, 0.24], [0.045, 0.258], [0.02, 0.268], [0, 0.27]], 56), MAT.brass, lampG);   // the oil font
  mk(lathe([[0, 0.268], [0.022, 0.268], [0.024, 0.28], [0.028, 0.29], [0.03, 0.305], [0.026, 0.31], [0, 0.31]], 32), MAT.brass, lampG);    // burner with its gallery
  mk(new THREE.CylinderGeometry(0.004, 0.004, 0.012, 12).rotateZ(Math.PI / 2), MAT.brass, lampG, 0.032, 0.284, 0);   // wick key
  const chim = lathe([[0.024, 0.305], [0.034, 0.33], [0.035, 0.35], [0.02, 0.385], [0.017, 0.40], [0.017, 0.5], [0.0185, 0.505]], 40);
  const glass = keep(new THREE.MeshBasicMaterial({ color: 0xffc888, transparent: true, opacity: 0.045, depthWrite: false, blending: THREE.AdditiveBlending }));   // unlit: the flame is inside it
  const ch = mk(chim, glass, lampG, 0, 0, 0, true); ch.renderOrder = 3;
  const flame = new THREE.Mesh(keep(new THREE.SphereGeometry(0.009, 16, 12)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 3.6, 1.2) })));
  flame.scale.set(1.6, 2.3, 0.7); flame.position.y = FLAME_Y + 0.004; lampG.add(flame); lampG.userData.flame = flame;
  const core = new THREE.Mesh(keep(new THREE.SphereGeometry(0.004, 12, 10)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 8, 4) })));
  core.scale.set(1.8, 1.5, 0.7); core.position.y = FLAME_Y; lampG.add(core);
  /* the opal shade: a dome, its rim a little below the flame; white glass that glows with the flame */
  const sc2 = makeCanvas(32, 256), sx = sc2.getContext('2d'), sg = sx.createLinearGradient(0, 0, 0, 256);
  sg.addColorStop(0, '#9a6a3a'); sg.addColorStop(0.55, '#e8b47a'); sg.addColorStop(1, '#ffe2b8');
  sx.fillStyle = sg; sx.fillRect(0, 0, 32, 256);
  const dome = lathe([[0.102, 0.0], [0.098, 0.012], [0.086, 0.034], [0.066, 0.058], [0.047, 0.074], [0.036, 0.081], [0.036, 0.085]], 64);
  const shadeMat = keep(new THREE.MeshBasicMaterial({ map: canvasTex(sc2, true), color: new THREE.Color(1.15, 1.05, 0.95), side: THREE.DoubleSide }));   // opal glass lit from inside: unlit material
  const shade = mk(dome, shadeMat, lampG, 0, FLAME_Y - 0.012, 0, true); shade.castShadow = false;
  mk(new THREE.TorusGeometry(0.036, 0.003, 8, 40).rotateX(Math.PI / 2), MAT.brass, lampG, 0, FLAME_Y + 0.073, 0, true);
  for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; mk(tube([[Math.cos(a) * 0.028, 0.3, Math.sin(a) * 0.028], [Math.cos(a) * 0.036, FLAME_Y + 0.04, Math.sin(a) * 0.036], [Math.cos(a) * 0.036, FLAME_Y + 0.073, Math.sin(a) * 0.036]], 0.0018, 12), MAT.brass, lampG, 0, 0, 0, true); }
  lampG.traverse((o) => { if (o.isMesh && o !== lampG.children[0] && o !== lampG.children[1]) o.castShadow = false; });
  contactShadow(room, lampG.position.x, lampG.position.z, 0.22, 0.22, 0.8);
}
scene.updateMatrixWorld(true);
lamp.position.set(lampG.position.x, FLAME_Y, lampG.position.z);
lamp.target.position.set(0.05, 0.12, -0.04);
glow.position.set(lampG.position.x, FLAME_Y + 0.03, lampG.position.z);
/* The flame light that comes in through the open frame and falls back off the desk and the felt ring: a weak warm bounce
 * under the top plate, in front of the basket, so a swinging arm and the type heads catch light. No shadow. Amount GUESS */
const bounce = new THREE.PointLight(FLAME, 0.17, 0.2, 2);
bounce.position.set(PL.x + 0.03, 0.10, PL.z + 0.055).add(machine.position); scene.add(bounce);
/* ---- objects on the desk, from reference.md A3 (shapes GUESS unless marked) ---- */
const MATX = {
  iron: keep(new THREE.MeshStandardMaterial({ color: 0x1a1816, metalness: 0.6, roughness: 0.55, roughnessMap: tSmudge })),
  glass: keep(new THREE.MeshPhysicalMaterial({ color: 0xd8e2dc, roughness: 0.04, transparent: true, opacity: 0.12, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 0.9, depthWrite: false })),
  ink: keep(new THREE.MeshStandardMaterial({ color: 0x07060a, roughness: 0.05 })),
  holder: keep(new THREE.MeshPhysicalMaterial({ map: tOak, color: 0x5a3418, roughness: 0.4, clearcoat: 0.5 })),
  blot: keep(new THREE.MeshStandardMaterial({ color: 0x8a2e2a, roughness: 1 })),
  cord: keep(new THREE.MeshStandardMaterial({ color: 0x241c14, roughness: 0.9 })),
  sheets: keep(new THREE.MeshStandardMaterial({ color: 0xd6cbad, roughness: 0.92, bumpMap: tPaperBump, bumpScale: 0.3 })),
};
/* 1. inkstand: square clear glass well on a black cast-iron base, pen rack, steel dip pen in a wood holder [S60] */
{
  const g = new THREE.Group(); g.position.set(0.36, 0, 0.07); g.rotation.y = -0.4; room.add(g);
  mk(rbox(0.16, 0.012, 0.1, 0.008, 0.003), MATX.iron, g, 0, 0.006, 0);
  for (const sx of [-1, 1]) mk(rbox(0.012, 0.006, 0.09, 0.003, 0.002), MATX.iron, g, sx * 0.072, 0.003, 0);
  const gl = mk(rbox(0.05, 0.045, 0.05, 0.004, 0.003), MATX.glass, g, -0.035, 0.0345, 0.0, true); gl.renderOrder = 2;
  mk(rbox(0.04, 0.026, 0.04, 0.003, 0.002), MATX.ink, g, -0.035, 0.026, 0.0);
  mk(new THREE.CylinderGeometry(0.019, 0.02, 0.008, 28), MAT.brass, g, -0.035, 0.061, 0.0);     // hinged brass cap, open. GUESS
  const cap = mk(new THREE.CylinderGeometry(0.02, 0.02, 0.004, 28), MAT.brass, g, -0.035, 0.068, -0.02); cap.rotation.x = -1.2;
  for (const z of [-0.03, 0.03]) mk(tube([[0.015, 0.012, z], [0.02, 0.03, z], [0.045, 0.03, z], [0.05, 0.012, z]], 0.0018, 12), MATX.iron, g);   // pen rack
  const pen = new THREE.Group(); pen.position.set(0.035, 0.033, 0); pen.rotation.set(0, 0.15, Math.PI / 2 - 0.08); g.add(pen);
  mk(lathe([[0, -0.075], [0.003, -0.074], [0.0042, -0.06], [0.0045, 0.03], [0.0038, 0.07], [0, 0.075]], 20), MATX.holder, pen);
  mk(new THREE.CylinderGeometry(0.0046, 0.0046, 0.014, 20), MAT.brass, pen, 0, -0.068, 0);
  mk(new THREE.ConeGeometry(0.003, 0.02, 4).scale(1, 1, 0.25), MAT.steel, pen, 0, -0.085, 0).rotation.x = Math.PI;
  contactShadow(room, 0.36, 0.07, 0.22, 0.15, 0.7, true);
}
/* 2. rocker blotter: wood half-cylinder with a knob, blotting paper below [S60]; shape GUESS */
{
  const g = new THREE.Group(); g.position.set(-0.43, 0, 0.27); g.rotation.y = 0.35; room.add(g);
  const pts = []; for (let k = 0; k <= 16; k++) { const a = -0.5 + k / 16; pts.push([a * 0.08, 0.004 + 0.013 * a * a * 4]); }
  mk(profileX(pts.concat([[0.04, 0.03], [-0.04, 0.03]]), 0.145, 0.002), MAT.oak, g);
  mk(profileX(pts.map(([z, y]) => [z, y - 0.003]).concat(pts.slice().reverse()), 0.147, 0.0004), MATX.blot, g);
  mk(lathe([[0, 0], [0.009, 0], [0.006, 0.01], [0.012, 0.02], [0.01, 0.028], [0, 0.03]], 32), MAT.brass, g, 0, 0.03, 0);
  contactShadow(room, -0.43, 0.27, 0.2, 0.12, 0.6, true);
}
/* 3. bill file: vertical steel wire 150 mm on a round iron base [S61], with copy slips on it */
{
  const g = new THREE.Group(); g.position.set(0.50, 0, 0.18); room.add(g);
  mk(lathe([[0, 0], [0.045, 0], [0.046, 0.004], [0.038, 0.012], [0.008, 0.016], [0, 0.016]], 40), MATX.iron, g);
  mk(new THREE.CylinderGeometry(0.0011, 0.0016, 0.15, 8), MAT.steel, g, 0, 0.09, 0);
  const slip = keep(new THREE.MeshStandardMaterial({ color: 0xd9ceb0, roughness: 0.92, bumpMap: tPaperBump, bumpScale: 0.3, side: THREE.DoubleSide }));
  const sg = new THREE.PlaneGeometry(0.11, 0.07, 6, 4); { const p = sg.attributes.position; for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k); p.setZ(k, 0.004 * Math.sin(x * 40) + 0.006 * (x * x * 60)); } sg.computeVertexNormals(); }
  for (let k = 0; k < 9; k++) { const m = mk(sg, slip, g, 0.0, 0.02 + k * 0.0035, 0); m.rotation.set(-Math.PI / 2 + (R() - 0.5) * 0.08, 0, R() * Math.PI * 2); }
  contactShadow(room, 0.50, 0.18, 0.15, 0.15, 0.7);
}
/* 4. wire letter tray [S61] with copy sheets and a glass dome paperweight [S63]; tray 250 x 350 mm (GUESS) */
{
  const g = new THREE.Group(); g.position.set(0.61, 0, -0.2); g.rotation.y = -0.12; room.add(g);
  const wires = [];
  for (let k = 0; k <= 10; k++) { const x = -0.125 + k * 0.025; wires.push(new THREE.CylinderGeometry(0.0012, 0.0012, 0.35, 6).rotateX(Math.PI / 2).translate(x, 0.004, 0)); }
  for (let k = 0; k <= 7; k++) { const z = -0.175 + k * 0.05; wires.push(new THREE.CylinderGeometry(0.0012, 0.0012, 0.25, 6).rotateZ(Math.PI / 2).translate(0, 0.003, z)); }
  for (const y of [0.02, 0.045]) for (const [w, d] of [[0.25, 0], [0, 0.35]]) for (const s of [-1, 1]) {
    wires.push(w ? new THREE.CylinderGeometry(0.0016, 0.0016, w, 6).rotateZ(Math.PI / 2).translate(0, y, s * 0.175) : new THREE.CylinderGeometry(0.0016, 0.0016, d, 6).rotateX(Math.PI / 2).translate(s * 0.125, y, 0));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wires.push(new THREE.CylinderGeometry(0.0016, 0.0016, 0.045, 6).translate(sx * 0.125, 0.0225, sz * 0.175));
  mk(merge(wires), MAT.steel, g);
  for (let k = 0; k < 14; k++) mk(new THREE.BoxGeometry(0.212, 0.0009, 0.274), MATX.sheets, g, (R() - 0.5) * 0.008, 0.006 + k * 0.001, (R() - 0.5) * 0.008).rotation.y = (R() - 0.5) * 0.04;
  const dome = mk(new THREE.SphereGeometry(0.035, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), keep(new THREE.MeshPhysicalMaterial({ color: 0xe8efe8, roughness: 0.02, transparent: true, opacity: 0.22, depthWrite: false, clearcoat: 1, envMapIntensity: 2.5 })), g, 0.03, 0.02, 0.05);
  dome.castShadow = false;
  mk(new THREE.CircleGeometry(0.026, 24).rotateX(-Math.PI / 2), keep(new THREE.MeshStandardMaterial({ color: 0x6b1f1a, roughness: 0.5 })), g, 0.03, 0.0205, 0.05);   // a red paper picture inside. GUESS
  contactShadow(room, 0.61, -0.2, 0.32, 0.42, 0.55, true);
}
/* 5. Gem paper clips: steel wire, one and a half loops, oblong [S54] */
{
  const pts = [], L = 0.032, W = 0.008;
  const seg = [[0, 0], [0, L], [W, L], [W, 0.006], [0.002, 0.006], [0.002, L - 0.005], [W - 0.002, L - 0.005]];
  for (let k = 0; k < seg.length; k++) pts.push([seg[k][0] - W / 2, 0.0006, seg[k][1] - L / 2]);
  const clip = tube(pts, 0.00045, 80, false, 5);
  for (let k = 0; k < 4; k++) { const m = mk(clip, MAT.steel, room, -0.14 + R() * 0.06, 0, 0.26 + R() * 0.03); m.rotation.y = R() * Math.PI; }
}
/* 6. candlestick telephone: upright tube 254 mm, transmitter on top, receiver on a side hook [S53]; nickel finish (GUESS) */
{
  const t = new THREE.Group(); t.position.set(0.30, 0, -0.40); t.rotation.y = -0.4; room.add(t);
  mk(lathe([[0, 0], [0.055, 0], [0.056, 0.006], [0.048, 0.014], [0.028, 0.022], [0.012, 0.031], [0, 0.031]], 48), MAT.nickel, t);
  mk(new THREE.CylinderGeometry(0.0085, 0.0095, 0.225, 28), MAT.nickel, t, 0, 0.142, 0);
  const head = new THREE.Group(); head.position.set(0, 0.268, 0.012); head.rotation.x = 1.25; t.add(head);
  mk(lathe([[0, -0.012], [0.03, -0.012], [0.032, -0.006], [0.032, 0.006], [0.026, 0.012], [0.014, 0.014], [0, 0.014]], 40), MAT.nickel, head);
  mk(lathe([[0.012, 0.012], [0.016, 0.03], [0.024, 0.05], [0.026, 0.055], [0.022, 0.055], [0.012, 0.035], [0.008, 0.014]], 32), MAT.japan, head);
  mk(new THREE.BoxGeometry(0.03, 0.004, 0.006), MAT.nickel, t, 0.022, 0.215, 0);
  const rc = new THREE.Group(); rc.position.set(0.04, 0.215, 0); t.add(rc);
  mk(lathe([[0, -0.11], [0.019, -0.11], [0.02, -0.104], [0.014, -0.09], [0.009, -0.075], [0.009, 0.0], [0.012, 0.004], [0.012, 0.012], [0, 0.014]], 32), MAT.japan, rc);
  mk(tube([[0.0, -0.11, 0], [0.03, -0.17, 0.02], [0.04, -0.205, 0.0], [0.0, -0.212, -0.03], [-0.03, -0.21, -0.02]], 0.0024, 40), MATX.cord, t, 0.04, 0.215, 0);
  mk(tube([[-0.04, 0.004, -0.02], [-0.1, 0.003, -0.08], [-0.16, 0.003, -0.25]], 0.0026, 20), MATX.cord, t);
  contactShadow(room, 0.30, -0.40, 0.16, 0.16, 0.8);
}
/* ============================================ the music device ============================================ */
/* Edison Home Phonograph, Model A, "suitcase" case: 16.5 W x 8.5 D x 11.5 H in = 419 x 216 x 292 mm [S24]. Oak box with square
 * corners, top plate to the edges, black and gold [S23][S24]. Brass mandrel [S25][S26]; feed screw on the mandrel axis [S26][S30];
 * speaker arm on a back rod, resting on a straight edge at the front [S27]; round reproducer with a small tube on top [S30];
 * swing arm (end gate) at the right [S27]; 14 in brass horn [S23]; slotted black cast-iron crank [S23][S24], right side (GUESS);
 * leather belt from the motor to the mandrel pulley [S27][S28]. Lid removed (contradiction 5: [S23][S31a] chosen), it lies on the
 * desk with its banner decal "EDISON HOME PHONOGRAPH", red letters on gold [S23][S32]. Brown wax cylinder 4 x 2 1/4 in [S29][S30].
 * Speed 120 rpm (contradiction 6: [S28][S29] chosen). Governor not visible (GUESS). Heights of the parts: GUESS. */
const phono = new THREE.Group(); phono.position.set(-0.415, 0, -0.31); phono.rotation.y = 0.55; phono.userData.pick = 'player'; scene.add(phono);   // place CHOICE: whole in the 'machine' view
const BW = 0.419, BD = 0.216, BH = 0.165, TP = BH + 0.006, MY = TP + 0.062, MZ = 0.004;
mk(rbox(BW - 0.006, BH - 0.02, BD - 0.006, 0.002, 0.0015), MAT.oak, phono, 0, BH / 2, 0);
mk(rbox(BW, 0.022, BD, 0.003, 0.002), MAT.oak, phono, 0, 0.011, 0);
mk(rbox(BW, 0.018, BD, 0.003, 0.002), MAT.oak, phono, 0, BH - 0.009, 0);
for (const sz of [-1, 1]) for (const sx of [-1, 1]) {                                   // 4 suitcase clips: 2 front, 2 back [S23]
  const c = new THREE.Group(); c.position.set(sx * 0.13, BH - 0.03, sz * (BD / 2 + 0.002)); c.rotation.y = sz > 0 ? 0 : Math.PI; phono.add(c);
  mk(rbox(0.022, 0.03, 0.004, 0.002, 0.001), MAT.nickel, c, 0, 0, 0.002);
  mk(new THREE.CylinderGeometry(0.003, 0.003, 0.024, 10).rotateZ(Math.PI / 2), MAT.nickel, c, 0, 0.016, 0.004);
}
const plateMat = japanPanel(1024, 512, (x, w, h) => {
  x.strokeStyle = goldInk(x, 0, h); x.lineWidth = 5; x.strokeRect(14, 14, w - 28, h - 28); x.lineWidth = 2; x.strokeRect(28, 28, w - 56, h - 56);
  for (const [cx, cy] of [[28, 28], [w - 28, 28], [28, h - 28], [w - 28, h - 28]]) { x.beginPath(); x.arc(cx, cy, 10, 0, Math.PI * 2); x.stroke(); }
});
{ const g = new THREE.BoxGeometry(BW - 0.002, 0.006, BD - 0.002); mk(g, [MAT.japan, MAT.japan, plateMat, MAT.japan, MAT.japan, MAT.japan], phono, 0, BH + 0.003, 0); }
/* the left casting (the body): bearing of the shaft and of the back rod */
mk(rbox(0.026, 0.115, 0.13, 0.006, 0.003), MAT.japan, phono, -0.163, TP + 0.0575, -0.012);
mk(rbox(0.02, 0.03, 0.03, 0.004, 0.002), MAT.japan, phono, 0.125, TP + 0.015, -0.055);            // right post of the back rod
mk(new THREE.CylinderGeometry(0.0045, 0.0045, 0.3, 12).rotateZ(Math.PI / 2), MAT.nickel, phono, -0.02, TP + 0.105, -0.055);   // back rod
mk(new THREE.CylinderGeometry(0.004, 0.004, 0.075, 10), MAT.japan, phono, 0.125, TP + 0.068, -0.055);
mk(rbox(0.27, 0.005, 0.008, 0.0015, 0.001), MAT.nickel, phono, -0.015, TP + 0.074, 0.058);       // straight edge at the front
for (const x of [-0.13, 0.11]) mk(new THREE.CylinderGeometry(0.003, 0.0035, 0.072, 10), MAT.japan, phono, x, TP + 0.036, 0.058);
/* shaft with the feed screw, the mandrel and the pulley */
mk(new THREE.CylinderGeometry(0.0035, 0.0035, 0.32, 12).rotateZ(Math.PI / 2), MAT.steel, phono, -0.025, MY, MZ);
const screwC = makeCanvas(256, 16), scx = screwC.getContext('2d');
for (let i = 0; i < 256; i += 4) { scx.fillStyle = '#ffffff'; scx.fillRect(i, 0, 2, 16); scx.fillStyle = '#000000'; scx.fillRect(i + 2, 0, 2, 16); }
const tScrew = canvasTex(screwC, false, true);
const drum = new THREE.Group(); drum.position.set(0, MY, MZ); phono.add(drum);
mk(new THREE.CylinderGeometry(0.0062, 0.0062, 0.07, 20).rotateZ(Math.PI / 2), keep(new THREE.MeshStandardMaterial({ color: 0x9a9a96, metalness: 1, roughness: 0.3, bumpMap: tScrew, bumpScale: 2 })), drum, -0.11, 0, 0);   // feed screw
mk(lathe([[0.0035, -0.06], [0.0262, -0.06], [0.0268, -0.057], [0.0279, 0.055], [0.0272, 0.06], [0.0035, 0.06]], 64).rotateZ(Math.PI / 2), MAT.brass, drum, 0.0, 0, 0);   // tapered brass mandrel
const waxC = makeCanvas(1024, 64), wx = waxC.getContext('2d'), wr = rng(SEED * 83);
wx.fillStyle = '#5c3b22'; wx.fillRect(0, 0, 1024, 64);                                             // palette #5a3a22 [S30]
for (let i = 0; i < 1024; i += 2) { wx.fillStyle = 'rgba(0,0,0,' + (0.06 + wr() * 0.06) + ')'; wx.fillRect(i, 0, 1, 64); }
for (let k = 0; k < 30; k++) { wx.fillStyle = 'rgba(140,96,60,' + wr() * 0.12 + ')'; wx.fillRect(wr() * 1024, 0, 20 + wr() * 60, 64); }
const groove = makeCanvas(512, 8), gx = groove.getContext('2d');
for (let i = 0; i < 512; i += 2) { gx.fillStyle = '#ffffff'; gx.fillRect(i, 0, 1, 8); gx.fillStyle = '#202020'; gx.fillRect(i + 1, 0, 1, 8); }
const waxMat = keep(new THREE.MeshPhysicalMaterial({ map: canvasTex(waxC, true), roughness: 0.34, bumpMap: canvasTex(groove, false, true), bumpScale: 0.6, clearcoat: 0.35, clearcoatRoughness: 0.25, sheen: 0.3, sheenColor: new THREE.Color(0x6a4a30) }));
{ const w = lathe([[0.0272, -0.051], [0.0285, -0.051], [0.0287, -0.047], [0.0287, 0.049], [0.0279, 0.051], [0.0272, 0.051]], 72).rotateZ(Math.PI / 2);   // bevelled end at the left
  const uvw = w.attributes.uv; for (let k = 0; k < uvw.count; k++) uvw.setXY(k, uvw.getY(k) * 18, uvw.getX(k)); mk(w, waxMat, drum, 0.004, 0, 0); }
const pulley = mk(lathe([[0.0035, -0.006], [0.026, -0.006], [0.0275, -0.004], [0.0245, 0], [0.0275, 0.004], [0.026, 0.006], [0.0035, 0.006]], 48).rotateZ(Math.PI / 2), MATX.iron, drum, -0.185, 0, 0);
for (let k = 0; k < 4; k++) { const sp = mk(new THREE.BoxGeometry(0.004, 0.044, 0.003), MATX.iron, pulley, 0.0, 0, 0); sp.rotation.x = k * Math.PI / 4; }
{ /* leather belt: from the pulley down through a slot in the top plate */
  const bc = makeCanvas(64, 256), bx2 = bc.getContext('2d'); bx2.fillStyle = '#5a3218'; bx2.fillRect(0, 0, 64, 256);
  for (let j = 0; j < 256; j += 8) { bx2.fillStyle = 'rgba(0,0,0,0.25)'; bx2.fillRect(0, j, 64, 2); }
  const tBelt = canvasTex(bc, true, true); MATX.belt = keep(new THREE.MeshStandardMaterial({ map: tBelt, roughness: 0.7 }));
  const pts = [[0, -0.12, 0.016], [0, -0.04, 0.022], [0, 0.0, 0.0245], [0, 0.0245, 0.0], [0, 0.0, -0.0245], [0, -0.04, -0.022], [0, -0.12, -0.016]];
  const belt = mk(tube(pts, 0.0022, 60, false, 6).scale(2.2, 1, 1), MATX.belt, phono, -0.185, MY, MZ);
  belt.userData.belt = tBelt;
  MATX.beltTex = tBelt;
}
/* swing arm (end gate) at the right end with its lock bolt [S27] */
const gate = new THREE.Group(); gate.position.set(0.105, TP, -0.045); phono.add(gate);
mk(new THREE.CylinderGeometry(0.006, 0.007, 0.02, 14), MAT.japan, gate, 0, 0.01, 0);
mk(tube([[0, 0.02, 0], [0.002, 0.045, 0.02], [0, MY - TP, MZ + 0.045]], 0.0045, 20), MAT.japan, gate);
mk(new THREE.CylinderGeometry(0.0065, 0.0065, 0.012, 16).rotateZ(Math.PI / 2), MAT.nickel, gate, -0.004, MY - TP, MZ + 0.045);
mk(new THREE.SphereGeometry(0.004, 12, 10), MAT.nickel, gate, 0.008, MY - TP + 0.012, MZ + 0.045);
/* speaker arm with the reproducer and the horn; it moves left to right along the feed screw [S30] */
const spk = new THREE.Group(); spk.position.set(-0.03, TP + 0.105, -0.055); phono.add(spk);
const spkLift = new THREE.Group(); spk.add(spkLift);
mk(new THREE.CylinderGeometry(0.0085, 0.0085, 0.04, 18).rotateZ(Math.PI / 2), MAT.japan, spkLift);
mk(rbox(0.02, 0.012, 0.075, 0.004, 0.002), MAT.japan, spkLift, 0, 0.0, 0.04);
mk(rbox(0.016, 0.03, 0.01, 0.003, 0.002), MAT.japan, spkLift, 0, -0.022, 0.111);                  // the foot on the straight edge
const repro = new THREE.Group(); repro.position.set(0, -0.012, 0.059); spkLift.add(repro);
mk(new THREE.CylinderGeometry(0.0235, 0.0235, 0.012, 40), MAT.nickel, repro, 0, -0.008, 0);
mk(new THREE.CylinderGeometry(0.019, 0.019, 0.0125, 40), keep(new THREE.MeshStandardMaterial({ color: 0x2a2620, metalness: 0.4, roughness: 0.5 })), repro, 0, -0.0078, 0);
mk(new THREE.CylinderGeometry(0.0055, 0.0055, 0.022, 16), MAT.nickel, repro, 0, 0.008, 0);           // the small tube on top [S30]
mk(new THREE.CylinderGeometry(0.0006, 0.0004, 0.008, 6), MAT.steel, repro, 0, -0.017, 0.002);
const horn = new THREE.Group(); horn.position.set(0, 0.018, 0); repro.add(horn);
{
  const prof = []; for (let k = 0; k <= 30; k++) { const t = k / 30; prof.push([0.0068 + 0.054 * Math.pow(t, 2.4) + (t > 0.97 ? (t - 0.97) * 0.25 : 0), t * 0.356]); }
  const hg = lathe(prof, 56); hg.rotateZ(-Math.PI / 2);                                        // the horn axis is +x
  const hornMat = keep(new THREE.MeshPhysicalMaterial({ color: 0xc8a050, metalness: 1, roughness: 0.22, roughnessMap: tSmudge, side: THREE.DoubleSide, envMapIntensity: 2.2 }));
  const hm = mk(hg, hornMat, horn); hm.userData.pick = 'player';
  mk(new THREE.TorusGeometry(0.0615, 0.0018, 8, 56).rotateZ(Math.PI / 2), MAT.brass, horn, 0.356, 0, 0);
  horn.rotation.set(0, 1.8, -0.03);                                                            // about level, to the back and a little left, clear of the lamp. GUESS
}
/* crank at the right side: black cast iron with slots [S23][S24] */
const crank = new THREE.Group(); crank.position.set(BW / 2 + 0.003, 0.085, 0.0); phono.add(crank);
{
  const s = new THREE.Shape(); s.moveTo(-0.008, -0.008); s.lineTo(0.008, -0.008); s.lineTo(0.006, 0.085); s.lineTo(-0.006, 0.085); s.lineTo(-0.008, -0.008);
  for (const y of [0.012, 0.042]) { const h = new THREE.Path(); h.moveTo(-0.0025, y); h.lineTo(0.0025, y); h.lineTo(0.0022, y + 0.022); h.lineTo(-0.0022, y + 0.022); h.lineTo(-0.0025, y); s.holes.push(h); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 2 });
  g.rotateY(Math.PI / 2); mk(g, MATX.iron, crank, 0.012, 0, 0);
  mk(new THREE.CylinderGeometry(0.006, 0.006, 0.014, 16).rotateZ(Math.PI / 2), MATX.iron, crank, 0.006, 0, 0);
  mk(new THREE.CylinderGeometry(0.0055, 0.0065, 0.03, 16).rotateZ(Math.PI / 2), MATX.holder, crank, 0.033, 0.08, 0);
}
/* start and stop switch and speed screw on the top plate [S23][S28] */
mk(new THREE.BoxGeometry(0.004, 0.003, 0.03), MAT.nickel, phono, -0.12, TP + 0.002, 0.075).rotation.y = 0.4;
mk(new THREE.CylinderGeometry(0.004, 0.004, 0.008, 16), MAT.nickel, phono, -0.1, TP + 0.004, 0.08);
contactShadow(phono, 0, 0, BW * 1.25, BD * 1.5, 0.75, true);
/* the removed lid with its banner decal */
{
  const lid = new THREE.Group(); lid.position.set(-0.98, FLOOR, 0.02); lid.rotation.y = 0.6; room.add(lid); lid.userData.pick = 'player';
  const prof = [[-BD / 2, 0], [BD / 2, 0], [BD / 2, 0.06], [BD / 2 - 0.02, 0.088], [BD / 2 - 0.05, 0.1], [-BD / 2 + 0.05, 0.1], [-BD / 2 + 0.02, 0.088], [-BD / 2, 0.06]];
  const g = profileX(prof.map(([z, y]) => [z, y]), BW + 0.008, 0.003);
  mk(g, MAT.oak, lid);
  const dc = makeCanvas(1024, 160), dx = dc.getContext('2d');
  dx.fillStyle = '#c69a3c'; dx.beginPath(); dx.moveTo(20, 30); dx.lineTo(1004, 30); dx.lineTo(980, 80); dx.lineTo(1004, 130); dx.lineTo(20, 130); dx.lineTo(44, 80); dx.closePath(); dx.fill();
  dx.strokeStyle = '#6b4a14'; dx.lineWidth = 4; dx.stroke();
  dx.fillStyle = '#a3241c'; dx.font = 'bold 66px Georgia, "Times New Roman", serif'; dx.textAlign = 'center'; dx.textBaseline = 'middle';
  dx.fillText('EDISON HOME PHONOGRAPH', 512, 84);
  const decal = mk(new THREE.PlaneGeometry(0.26, 0.04), keep(new THREE.MeshStandardMaterial({ map: canvasTex(dc, true), transparent: true, roughness: 0.4, metalness: 0.2, depthWrite: false })), lid, 0, 0.034, BD / 2 + 0.0035, true);
  void decal;
  contactShadow(room, -0.98, 0.02, 0.52, 0.3, 0.6, true, FLOOR);
}
let musicOn = false, spin = 0, spkProg = 0, spkDown = 0;
/* ---- fewer draw calls: merge the static parts ---- */
for (const o of [bell, spaceBar, ribbon, hingeG, lever, shiftG, drum, spk, gate, crank]) o.userData.dynamic = true;
for (const g of spools) g.userData.dynamic = true;
const merged = [frame, machine, liftG, room, phono].reduce((a, g) => a + mergeStatic(g), 0);

/* ============================================ camera and views ============================================ */
const MW = machine.position;
const VIEWS = {
  machine: { tx: 0.05, ty: 0.18, tz: -0.06, yaw: 0.40, pitch: 0.28, dist: 2.5, fov: 13.5, halfW: 0.36, narrowHalfW: 0.3, narrowDx: -0.07 },
  line: { tx: 0, ty: PC.y + MW.y, tz: PC.z + MW.z, yaw: 0.04, pitch: 0.3, dist: 0.55, fov: 12, halfW: 0.075, narrowHalfW: 0.045 },
  room: { tx: -0.2, ty: 0.16, tz: -0.22, yaw: 0.55, pitch: 0.30, dist: 2.0, fov: 30, halfW: 0.75, narrowHalfW: 0.7 }
};
const viewNames = Object.keys(VIEWS);
const cur = Object.assign({}, VIEWS.machine), orb = { yaw: 0, pitch: 0, zoom: 1 };
let from = null, to = null, tView = 1, orbFrom = null, aspect = 1.6, viewName = 'machine';
function applyCam() {
  const yaw = cur.yaw + orb.yaw, pitch = clamp(cur.pitch + orb.pitch, 0.04, 1.25), dist = cur.dist * orb.zoom;
  const tx = cur.tx + (aspect < 1 ? (1 - aspect) * (cur.narrowDx || 0) : 0);
  camera.position.set(tx + dist * Math.sin(yaw) * Math.cos(pitch), cur.ty + dist * Math.sin(pitch), cur.tz + dist * Math.cos(yaw) * Math.cos(pitch));
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
scene.traverse((o) => { if (o.userData.blob) o.raycast = () => {}; });
let shadowSig = 1, shadowClock = 0, needShadow = true;
let frameMs = 16.7, renderMs = 0, leverRot = 0, needBars = true, bellRing = 0, seatBump = 0, liftShown = -1, clock = 0, liftE = 0;
const jamFlag = E.FLAG_JAM, ZONE = K.ZONE;
const lineDown = { ty: 0, tz: 0, pitch: 0.3 }, lineUp = { ty: 0, tz: 0, pitch: 0.12 }, tmpV = V3(0, 0, 0);
function update(s, dt) {
  dt = clamp(dt || 0.016, 0, 0.1);
  clock += dt;
  frameMs += (dt * 1000 - frameMs) * 0.05;
  /* carriage: column, shift, line, lift */
  carriage.position.x = SHEET_WM / 2 - (LEFT + s[SNAP.X] + 0.5) * PITCH;
  shiftG.position.z = -SHIFT_Z * s[SNAP.SHIFT];
  const line = s[SNAP.LINE];
  const moving = sheetMotion(dt);
  platen.rotation.x = -(line * LINE_M - feed) / PR;
  feedRoller.rotation.x = (line * LINE_M - feed) / FR_R;
  if (line !== paperShown || moving) { paperShown = line; placePaper(line); if (moving) needShadow = true; }
  const lp = clamp(s[SNAP.LIFT] || 0, 0, 1);
  liftE = lp * lp * (3 - 2 * lp);
  seatBump = Math.max(0, seatBump - dt * 5);
  const bump = seatBump > 0 ? Math.sin(seatBump * 18) * 0.006 * seatBump : 0;
  if (liftE + bump !== liftShown) { liftShown = liftE + bump; hingeG.rotation.x = -LIFT_ANG * liftE + bump; }
  leverRot += ((s[SNAP.LEVER] ? 0.5 : 0) - leverRot) * Math.min(1, dt * 16);
  lever.rotation.x = leverRot;
  /* type bars */
  const jam = (s[SNAP.FLAGS] & jamFlag) !== 0;
  let lifted = 0, changed = false;
  for (let i = 0; i < NB; i++) {
    const b = bars[i];
    let p = s[SNAP.BARS + i];
    if (b.hold > 0) { p = 1; b.hold--; }
    const j = jam && p >= ZONE - 0.001;
    if (b.shake > 0) { b.shake = Math.max(0, b.shake - dt * 2.0); needShadow = true; }
    const extra = j ? (b.side || 0.07) + Math.sin(b.shake * 38) * 0.08 * b.shake : 0;
    if (p !== b.p || extra !== b.jam) { b.p = p; b.jam = extra; placeBar(i, p, extra); changed = true; }
    if (p > 0.85) lifted = Math.max(lifted, smooth(0.85, 1, p));
  }
  if (changed || needBars) { needShadow = true; barMesh.instanceMatrix.needsUpdate = headMesh.instanceMatrix.needsUpdate = pivMesh.instanceMatrix.needsUpdate = wireMesh.instanceMatrix.needsUpdate = true; needBars = false; }
  if (ribHold > 0) { ribHold -= dt; lifted = 1; }
  ribLift += (lifted - ribLift) * Math.min(1, dt * (lifted > ribLift ? 70 : 22));
  if (Math.abs(ribLift - ribShown) > 2e-4) { ribShown = ribLift; placeRibbon(ribLift); }
  /* keys */
  let kc = false;
  const want = (i) => i < NB ? s[SNAP.KEYS + i] > 0 || (jam && s[SNAP.BARS + i] >= ZONE - 0.001) : i === NB + 1 ? s[SNAP.SHIFTKEY] > 0 : false;   // a stuck arm holds its key down
  for (let i = 0; i < NK; i++) {
    const t = want(i) ? 1 : 0;
    keyDip[i] += (t - keyDip[i]) * Math.min(1, dt * (t ? 45 : 22));
    if (Math.abs(keyDip[i] - keyShown[i]) > 1e-3) { keyShown[i] = keyDip[i]; placeKey(i); kc = true; }
  }
  if (kc) { needShadow = true; caps.instanceMatrix.needsUpdate = rims.instanceMatrix.needsUpdate = stems.instanceMatrix.needsUpdate = levers.instanceMatrix.needsUpdate = true; }
  spaceDip += ((s[SNAP.SPACE] > 0 ? 1 : 0) - spaceDip) * Math.min(1, dt * 35);
  spaceBar.position.y = -0.006 * spaceDip;
  /* bell */
  if (bellRing > 0) { bellRing = Math.max(0, bellRing - dt * 3); bell.rotation.z = Math.sin(clock * 90) * 0.04 * bellRing; }
  /* the flame: a slow, small flicker (GUESS amount: 3 %) */
  const fl = 1 + 0.022 * (noise(clock * 5.0, 3.1) - 0.5) * 2 + 0.01 * (noise(clock * 17.0, 7.7) - 0.5) * 2;
  lamp.intensity = 3.6 * fl; glow.intensity = 0.5 * fl; bounce.intensity = 0.17 * fl;
  /* music device: 120 rpm [S28][S29]; the arm goes about 60 mm in the 2 minutes of a record (GUESS [reference A2]) */
  const w = musicOn ? 120 * Math.PI * 2 / 60 : 0;
  spin += (w - spin) * Math.min(1, dt * (musicOn ? 1.5 : 1.1));
  drum.rotation.x -= spin * dt;
  if (MATX.beltTex) MATX.beltTex.offset.y -= spin * dt * 0.0255 / 0.1;
  spkDown += ((musicOn ? 1 : 0) - spkDown) * Math.min(1, dt * 2.5);
  if (musicOn) spkProg = (spkProg + dt / 120) % 1;
  spk.position.x = -0.03 + 0.06 * spkProg;
  spkLift.rotation.x = -0.09 * (1 - spkDown);
  /* camera. The line view: the front of the platen when the carriage is down, its underside when it is up. */
  carriage.updateMatrixWorld(true);
  const lineTx = (aspect < 1 ? 0.45 : 0.6) * carriage.position.x - 0.006 + MW.x;
  tmpV.set(0, PC.y + PE * Math.sin(0.25), PC.z + PE * Math.cos(0.25)); liftG.localToWorld(tmpV); lineDown.ty = tmpV.y; lineDown.tz = tmpV.z;
  tmpV.set(0, P.y, P.z); liftG.localToWorld(tmpV); lineUp.ty = tmpV.y + 0.004; lineUp.tz = tmpV.z;
  const L = VIEWS.line, k = liftE;
  L.tx += (lineTx - L.tx) * Math.min(1, dt * 2.5);
  L.ty = lineDown.ty + (lineUp.ty - lineDown.ty) * k; L.tz = lineDown.tz + (lineUp.tz - lineDown.tz) * k; L.pitch = 0.42 + (0.1 - 0.42) * k;
  if (viewName === 'line' && tView >= 1) { cur.tx = L.tx; cur.ty = L.ty; cur.tz = L.tz; cur.pitch = L.pitch; }
  if (tView < 1 && from) {
    tView = Math.min(1, tView + dt / 1.1);
    const e = easeIO(tView);
    for (const n of ['tx', 'ty', 'tz', 'yaw', 'pitch', 'dist', 'fov', 'halfW', 'narrowHalfW', 'narrowDx']) cur[n] = (from[n] || 0) + ((to[n] || 0) - (from[n] || 0)) * e;
    orb.yaw = orbFrom.yaw * (1 - e); orb.pitch = orbFrom.pitch * (1 - e); orb.zoom = orbFrom.zoom + (1 - orbFrom.zoom) * e;
  }
  applyCam();
  /* shadows: draw the shadow map again only when a part moved (bars, keys, carriage, lever) or, with music, 5 times a second */
  let sig = 0;
  for (let i = 1; i < s.length; i++) if (i !== SNAP.T) sig = (sig * 31 + Math.round(s[i] * 4096)) | 0;
  sig = (sig * 31 + Math.round(ribLift * 1000) + Math.round(leverRot * 1000) + Math.round(bellRing * 100) + Math.round(seatBump * 100)) | 0;
  shadowClock += dt;
  if (sig !== shadowSig || needShadow || (spin > 0.01 && shadowClock > 0.2) || spkDown % 1 > 0.001 && spkDown < 0.999) { renderer.shadowMap.needsUpdate = true; shadowSig = sig; shadowClock = 0; needShadow = false; }
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
    for (const sp of spools) sp.rotation.z -= 0.03;
  } else if (ev.type === 'space') { for (const sp of spools) sp.rotation.z -= 0.03; ribTravel += 0.004; }
  else if (ev.type === 'jam') {                           // the arms lean toward each other: the one on the left leans right
    const l = (ev.bars || []).filter((i) => bars[i]).sort((a, b) => keyPos[a][0] - keyPos[b][0]);
    l.forEach((i, k) => { bars[i].shake = 1; bars[i].side = (k < l.length / 2 ? 1 : -1) * 0.07 * (bars[i].psi > Math.PI ? -1 : 1); });
  }
  else if (ev.type === 'bell') bellRing = 1;
  else if (ev.type === 'seated') seatBump = 1;
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
  const hits = raycaster.intersectObjects([phono, machine, room], true);
  for (const h of hits) { let o = h.object; while (o) { if (o.userData.pick) return o.userData.pick; o = o.parent; } if (h.object.parent === room || h.object.parent && h.object.parent.parent === room) return null; }
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
  const gl = renderer.getContext();
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  renderer.dispose();
}
setView('machine', true);
placeRibbon(0);
const api = {
  update, event, setView, resize, pick, dispose, newSheet, replay, renderSheet,
  views: viewNames,
  get view() { return viewName; },
  orbit(dx, dy) { orb.yaw = clamp(orb.yaw - dx * 0.004, -0.6, 0.6); orb.pitch = clamp(orb.pitch + dy * 0.003, -0.18, 0.35); },   // the pitch limit keeps the lines under the guide out of sight
  zoom(d) { orb.zoom = clamp(orb.zoom * Math.exp(d * 0.001), 0.65, 1.5); },
  setMusic(on) { musicOn = !!on; },
  setReady() {},
  stats() { const i = renderer.info; return { frameMs, renderMs, calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, sheetFull: uploadsFull, sheetPatches: uploadsPatch }; },
  _debug: { THREE, scene, camera, renderer, bars, VIEWS, cur, orb, lamp, glow, lampG, phono, drum, spk, horn, hingeG, carriage, machine, liftG, paper, placeBar }
};
return api;
}

globalThis.buildSceneA = buildSceneA;
})();
