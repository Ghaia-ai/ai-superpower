// 3D stage for the AI superpower game. Bundled into ../stage.js (three.js included) with:
//   esbuild src/stage.js --bundle --minify --format=iife --target=es2017 --outfile=stage.js
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
/* ===== 3D stage (Three.js) =====
   Reads window.GAME and listens to game:* events from the script above.
   If anything here fails, the game keeps working with the 2D fallback. */
const G = window.GAME;
const HKEYS = G.keys, PERS = G.personas;
const TAU = Math.PI * 2, STEP = TAU / 6;

/* ---------- Helpers: materials, textures, mesh builders ---------- */
let MAT = null;
function initMaterials() {
  MAT = {
    ceramic: new THREE.MeshPhysicalMaterial({ color: 0xd9deea, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.1 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x04050a, metalness: 0.5, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe3ee, metalness: 1, roughness: 0.16 }),
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x2a2f45, metalness: 0.9, roughness: 0.32 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffc46b, metalness: 1, roughness: 0.22 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x141829, metalness: 0.6, roughness: 0.45 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, roughness: 0.05, clearcoat: 1, depthWrite: false }),
    sil: new THREE.MeshStandardMaterial({ color: 0x090b16, metalness: 1, roughness: 0.3 })
  };
}
const shell = (hex) => new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.15, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 });
// k is a relative brightness; the 0.42 keeps lights just above the bloom threshold (soft halo, no white-out).
const glow = (hex, k = 2.5) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k * 0.42) });
const holo = (hex, opacity = 0.5) => new THREE.MeshBasicMaterial({
  color: new THREE.Color(hex), transparent: true, opacity,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
});
const lineMat = (hex, opacity = 0.9) => new THREE.LineBasicMaterial({
  color: new THREE.Color(hex).multiplyScalar(1.15), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false
});
const box = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 4, r);
const sphere = (r, w = 48, h = 32) => new THREE.SphereGeometry(r, w, h);
const FLAT = Math.PI / 2;
/* Small detail parts: a thin horizontal trim ring, and a ring of rivets. */
const trim = (parent, r, y, material, tube = 0.008, o = {}) => add(parent, new THREE.TorusGeometry(r, tube, 6, 48), material, 0, y, 0, { rx: FLAT, ...o });
function rivets(parent, r, y, n, material) {
  const g = new THREE.SphereGeometry(0.011, 8, 6);
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; add(parent, g, material, Math.sin(a) * r, y, Math.cos(a) * r); }
}

/* Adds a mesh. o.glow = emissive part (stays lit, dimmed, as a silhouette);
   o.fx = hologram/effect part (hidden as a silhouette). */
function add(parent, geometry, material, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  if (o.rx) m.rotation.x = o.rx;
  if (o.ry) m.rotation.y = o.ry;
  if (o.rz) m.rotation.z = o.rz;
  if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
  if (o.glow) m.userData.glow = true;
  if (o.fx) m.userData.fx = true;
  parent.add(m);
  return m;
}
function addLines(parent, geometry, material, rx = 0) {
  const l = new THREE.LineSegments(geometry, material);
  l.rotation.x = rx;
  l.userData.fx = true;
  parent.add(l);
  return l;
}
function rod(parent, a, b, r, material) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), 10), material);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  parent.add(m);
  return m;
}
function makeTex(w, h, draw, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const radial = (stops) => (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
};

/* Hover emitter under the body plus a faint anti-gravity beam to the floor. */
function hoverBase(h, c, y = 0.44) {
  add(h.body, new THREE.CylinderGeometry(0.15, 0.19, 0.06, 32), MAT.gunmetal, 0, y + 0.03, 0);
  add(h.body, new THREE.TorusGeometry(0.13, 0.018, 12, 48), glow(c, 3), 0, y, 0, { rx: FLAT, glow: true });
  add(h.root, new THREE.ConeGeometry(0.34, y, 32, 1, true), holo(c, 0.05), 0, y / 2, 0, { fx: true }).userData.hoverBeam = true;
}

/* Silhouette = "mystery" look used during the levels and the spin. */
function setSil(h, on) {
  if (h.isSil === on) return;
  h.isSil = on;
  h.root.traverse((o) => {
    if ((!o.isMesh && !o.isLine) || o === h.shadow) return;
    if (o.userData.orig === undefined) o.userData.orig = o.material;
    if (o.userData.fx) { o.visible = !on; return; }
    o.material = on ? (o.userData.glow ? h.silGlow : MAT.sil) : o.userData.orig;
  });
}

/* Idle motion shared by every hero: hover bob, floating hands, blinking, looking around. */
function animateHero(h, t, dt) {
  h.body.position.y = (h.lift || 0) + Math.sin(t * 1.6 + h.phase) * 0.045 * (h.hover || 1) + h.jump;
  h.hands.forEach((hand, i) => {
    hand.position.y = hand.userData.y0 + Math.sin(t * 1.9 + h.phase + i * 1.4) * 0.035;
    hand.rotation.y = Math.sin(t * 0.8 + i) * 0.4;
  });
  const bt = (t + h.phase * 3) % h.blinkEvery;
  const s = bt < 0.16 ? Math.max(0.08, Math.abs(Math.cos((bt / 0.16) * Math.PI))) : 1;
  h.eyes.forEach((e) => { e.scale.y = e.userData.sy * s; });
  if (h.head) h.head.rotation.y = Math.sin(t * 0.6 + h.phase) * 0.18;
  h.update(t, dt);
}

/* ---------- The six heroes (built from primitives, ~1.9 units tall, facing +z) ---------- */
const BUILD = {
  /* Architect: boxy builder bot projecting a blueprint hologram, with gold modules orbiting its head. */
  ARC(h, c) {
    const b = h.body, sh = shell(c);
    add(b, box(0.7, 0.6, 0.48, 0.18), MAT.ceramic, 0, 0.78, 0);
    add(b, box(0.42, 0.3, 0.06, 0.06), sh, 0, 0.82, 0.235);
    add(b, box(0.26, 0.035, 0.02, 0.015), glow("#9ff4ff", 3), 0, 0.88, 0.27, { glow: true });
    ["#36d6c3", "#ffc93d", "#ff5d7a"].forEach((col, i) => add(b, sphere(0.018, 12, 8), glow(col, 3), (i - 1) * 0.07, 0.78, 0.27, { glow: true }));
    hoverBase(h, c);
    add(b, new THREE.CylinderGeometry(0.09, 0.11, 0.12, 24), MAT.chrome, 0, 1.12, 0);
    const head = new THREE.Group(); head.position.y = 1.44; b.add(head); h.head = head;
    add(head, box(0.8, 0.56, 0.6, 0.2), sh);
    add(head, box(0.64, 0.34, 0.08, 0.1), MAT.visor, 0, -0.01, 0.27);
    [-0.13, 0.13].forEach((x) => h.eyes.push(add(head, box(0.09, 0.13, 0.02, 0.035), glow("#9ff4ff", 3.2), x, 0, 0.315, { glow: true })));
    [-1, 1].forEach((s) => add(head, new THREE.CylinderGeometry(0.075, 0.075, 0.06, 24), MAT.chrome, s * 0.42, 0, 0, { rz: FLAT }));
    h.hands = [-1, 1].map((s) => add(b, box(0.18, 0.18, 0.18, 0.06), MAT.ceramic, s * 0.56, 0.74, 0.06));
    add(b, box(0.47, 0.35, 0.05, 0.07), MAT.gold, 0, 0.82, 0.231);
    add(head, box(0.69, 0.39, 0.07, 0.11), MAT.chrome, 0, -0.01, 0.262);
    [-1, 1].forEach((s) => add(b, sphere(0.06, 20, 14), MAT.chrome, s * 0.37, 0.93, 0));
    rod(head, [0.45, 0, 0], [0.45, 0.3, 0], 0.008, MAT.chrome);
    add(head, sphere(0.02, 12, 8), glow("#ffd36b", 3), 0.45, 0.31, 0, { glow: true });
    trim(b, 0.1, 1.17, MAT.gold, 0.012);

    const holoCube = new THREE.Group(); holoCube.position.set(0.6, 1.12, 0.18); b.add(holoCube);
    addLines(holoCube, new THREE.EdgesGeometry(new THREE.BoxGeometry(0.3, 0.3, 0.3)), lineMat("#8fd0ff"));
    add(holoCube, new THREE.BoxGeometry(0.3, 0.3, 0.3), holo(c, 0.1), 0, 0, 0, { fx: true });
    add(holoCube, new THREE.BoxGeometry(0.11, 0.11, 0.11), holo("#8fd0ff", 0.55), 0, 0, 0, { fx: true });
    const orbit = new THREE.Group(); orbit.position.y = 1.44; b.add(orbit);
    const mods = [0, 1, 2].map((i) => {
      const m = add(orbit, box(0.09, 0.09, 0.09, 0.02), MAT.gold);
      m.userData.ph = i * (TAU / 3);
      return m;
    });
    h.update = (t) => {
      holoCube.rotation.set(t * 0.7, t * 0.9, 0);
      holoCube.position.y = 1.12 + Math.sin(t * 1.6) * 0.04;
      mods.forEach((m) => {
        const a = t * 1.1 + m.userData.ph;
        m.position.set(Math.cos(a) * 0.62, 0.14 + Math.sin(a * 2) * 0.07, Math.sin(a) * 0.62);
        m.rotation.set(t, t * 1.3, 0);
      });
    };
  },

  /* Pattern Hunter: one big scanning lens, antenna, and a ring of data points orbiting it. */
  DAT(h, c) {
    const b = h.body, sh = shell(c);
    add(b, sphere(0.4), MAT.ceramic, 0, 0.8, 0, { s: [1, 1.08, 0.95] });
    add(b, new THREE.TorusGeometry(0.4, 0.03, 16, 64), sh, 0, 0.8, 0, { rx: FLAT });
    hoverBase(h, c, 0.4);
    const head = new THREE.Group(); head.position.y = 1.42; b.add(head); h.head = head;
    add(head, sphere(0.34), sh);
    add(head, new THREE.TorusGeometry(0.205, 0.035, 16, 64), MAT.chrome, 0, 0, 0.275);
    add(head, new THREE.CylinderGeometry(0.2, 0.2, 0.06, 48), MAT.visor, 0, 0, 0.27, { rx: FLAT });
    const iris = new THREE.Group(); iris.position.z = 0.305; head.add(iris);
    add(iris, new THREE.TorusGeometry(0.1, 0.018, 12, 48), glow(c, 3.2), 0, 0, 0, { glow: true });
    add(iris, new THREE.CircleGeometry(0.045, 32), glow("#e9fffd", 3), 0, 0, 0.002, { glow: true });
    h.eyes.push(iris);
    rod(head, [0.09, 0.26, 0], [0.155, 0.5, 0], 0.012, MAT.chrome);
    const tip = add(head, sphere(0.035, 16, 12), glow("#ffd36b", 3), 0.155, 0.5, 0, { glow: true });
    h.hands = [-1, 1].map((s) => add(b, sphere(0.1, 32, 24), MAT.ceramic, s * 0.56, 0.78, 0.05));
    add(head, new THREE.TorusGeometry(0.15, 0.006, 6, 48), MAT.chrome, 0, 0, 0.302);
    add(head, new THREE.TorusGeometry(0.235, 0.01, 6, 48), MAT.gold, 0, 0, 0.262);
    add(head, new THREE.SphereGeometry(0.19, 32, 12, 0, TAU, 0, 0.95), MAT.glass, 0, 0, 0.2, { rx: FLAT, s: [1, 0.55, 1], fx: true });
    [-1, 1].forEach((s) => add(head, new THREE.CylinderGeometry(0.055, 0.055, 0.05, 24), MAT.chrome, s * 0.335, 0, 0, { rz: FLAT }));
    [0.94, 0.66].forEach((y) => trim(b, 0.377, y, MAT.dark, 0.008, { s: [1, 0.95, 1] }));
    [-0.05, 0, 0.05].forEach((x, i) => add(b, sphere(0.013, 10, 8), glow(["#36d6c3", "#ffc93d", "#ff5d7a"][i], 3), x, 0.64, 0.355, { glow: true }));
    trim(b, 0.12, 1.14, MAT.chrome, 0.014);

    const ring = new THREE.Group(); ring.position.y = 1.05; ring.rotation.set(0.35, 0, 0.2); b.add(ring);
    const dotG = sphere(0.022, 10, 8), dotM = glow(c, 3);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      add(ring, dotG, dotM, Math.cos(a) * 0.72, 0, Math.sin(a) * 0.72, { fx: true });
    }
    addLines(ring, new THREE.EdgesGeometry(new THREE.CircleGeometry(0.72, 72)), lineMat(c, 0.25), FLAT);
    h.update = (t) => {
      ring.rotation.y = t * 0.6;
      iris.position.x = Math.sin(t * 1.3) * 0.05;
      tip.visible = Math.sin(t * 5) > -0.3;
    };
  },

  /* Guardian: armored helmet with a visor slit and crest, holding a hexagonal energy shield. */
  GRD(h, c) {
    const b = h.body, sh = shell(c);
    add(b, box(0.76, 0.64, 0.5, 0.2), MAT.ceramic, 0, 0.78, 0);
    [-1, 1].forEach((s) => add(b, sphere(0.17, 32, 24), sh, s * 0.42, 1.0, 0, { s: [1, 0.75, 1.05] }));
    add(b, new THREE.CylinderGeometry(0.09, 0.09, 0.02, 6), glow(c, 3), 0, 0.84, 0.255, { rx: FLAT, glow: true });
    hoverBase(h, c);
    const head = new THREE.Group(); head.position.y = 1.44; b.add(head); h.head = head;
    add(head, sphere(0.33), sh, 0, 0, 0, { s: [1, 1.08, 1] });
    add(head, new THREE.CylinderGeometry(0.338, 0.338, 0.13, 48, 1, true, -Math.PI * 0.32, Math.PI * 0.64), MAT.visor);
    h.eyes.push(add(head, new THREE.CylinderGeometry(0.343, 0.343, 0.03, 48, 1, true, -Math.PI * 0.24, Math.PI * 0.48), glow("#b6ffe0", 3.4), 0, 0, 0, { glow: true }));
    add(head, box(0.05, 0.2, 0.46, 0.022), MAT.chrome, 0, 0.36, -0.02);
    h.hands = [-1, 1].map((s) => add(b, box(0.17, 0.2, 0.17, 0.06), sh, s * 0.58, 0.72, 0.05));
    add(b, new THREE.CylinderGeometry(0.125, 0.125, 0.014, 6), MAT.gold, 0, 0.84, 0.249, { rx: FLAT });
    add(b, new THREE.CylinderGeometry(0.15, 0.2, 0.07, 32), MAT.gunmetal, 0, 1.115, 0);
    trim(b, 0.15, 1.15, MAT.gold, 0.01);
    [-0.075, 0.075].forEach((y) => add(head, new THREE.CylinderGeometry(0.341, 0.341, 0.012, 48, 1, true, -Math.PI * 0.34, Math.PI * 0.68), MAT.gold, 0, y, 0));
    [-1, 1].forEach((s) => add(head, new THREE.CylinderGeometry(0.05, 0.05, 0.03, 20), MAT.gunmetal, s * 0.325, -0.06, 0, { rz: FLAT }));
    [-1, 1].forEach((s) => trim(b, 0.171, 0.985, MAT.gold, 0.008, { s: [1, 1.05, 1] }).position.x = s * 0.42);

    const shield = new THREE.Group(); shield.position.set(-0.7, 0.92, 0.3); shield.rotation.y = 0.45; b.add(shield);
    const spinner = new THREE.Group(); shield.add(spinner);
    const hexG = new THREE.CylinderGeometry(0.36, 0.36, 0.02, 6);
    add(spinner, hexG, holo(c, 0.16), 0, 0, 0, { rx: FLAT, fx: true });
    addLines(spinner, new THREE.EdgesGeometry(hexG), lineMat(c), FLAT);
    add(spinner, new THREE.TorusGeometry(0.2, 0.008, 4, 6), holo(c, 0.7), 0, 0, 0, { fx: true });
    h.update = (t) => {
      shield.position.y = 0.92 + Math.sin(t * 1.4) * 0.04;
      spinner.rotation.z = t * 0.3;
    };
  },

  /* Creator: a liquid, iridescent shape-shifting body with paint orbs and a floating sculpture. */
  CRT(h, c) {
    const b = h.body;
    const iri = new THREE.MeshPhysicalMaterial({
      color: c, metalness: 0.55, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05,
      iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [120, 520]
    });
    let g = new THREE.IcosahedronGeometry(1, 12);
    g.deleteAttribute("normal"); g.deleteAttribute("uv");
    g = mergeVertices(g);
    g.computeVertexNormals();
    const base = g.attributes.position.array.slice();
    add(b, g, iri, 0, 1.0, 0, { s: [0.5, 0.6, 0.47] });
    add(b, sphere(0.2, 40, 24), MAT.visor, 0, 1.18, 0.4, { s: [1.25, 0.72, 0.5] });
    [-0.09, 0.09].forEach((x) => h.eyes.push(add(b, sphere(0.045, 24, 16), glow("#ffe1f0", 3.2), x, 1.19, 0.49, { s: [1, 1.35, 0.5], glow: true })));
    hoverBase(h, c, 0.38);
    h.hands = [-1, 1].map((s) => add(b, sphere(0.095, 32, 24), iri, s * 0.66, 0.86, 0.06));
    trim(b, 0.215, 0.47, MAT.chrome, 0.02);
    add(b, new THREE.TorusGeometry(0.255, 0.012, 8, 48), MAT.chrome, 0, 1.18, 0.4, { s: [1, 0.59, 1] });
    const halo = add(b, new THREE.TorusGeometry(0.64, 0.005, 6, 96), MAT.gold, 0, 1.0, 0, { rx: FLAT + 0.35, rz: 0.2 });

    const orbs = ["#36d6ff", "#ffd23d", "#8b5cff", "#3ddc97", "#ff8a3d"].map((col, i) => {
      const m = add(b, sphere(0.06 + (i % 2) * 0.02, 32, 24), new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.15, clearcoat: 1, metalness: 0.1 }));
      m.userData.o = { r: 0.7 + (i % 3) * 0.08, sp: 0.55 + i * 0.17, ph: i * 1.3, y: 0.72 + i * 0.17 };
      return m;
    });
    const knot = add(b, new THREE.TorusKnotGeometry(0.1, 0.03, 128, 16),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.1, iridescence: 1, iridescenceIOR: 2 }), 0.66, 1.22, 0.12);
    h.update = (t) => {
      const pos = g.attributes.position, arr = pos.array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = base[i], y = base[i + 1], z = base[i + 2];
        const d = 1 + 0.055 * Math.sin(x * 3.1 + t * 1.6) * Math.sin(y * 2.7 + t * 1.2) + 0.035 * Math.sin(z * 3.7 + y * 1.3 + t * 2.1);
        arr[i] = x * d; arr[i + 1] = y * d; arr[i + 2] = z * d;
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      orbs.forEach((m) => {
        const o = m.userData.o, a = t * o.sp + o.ph;
        m.position.set(Math.cos(a) * o.r, o.y + Math.sin(a * 1.7) * 0.06, Math.sin(a) * o.r);
      });
      halo.rotation.z = t * 0.3;
      knot.rotation.set(t * 0.8, t * 0.5, 0);
      knot.position.y = 1.22 + Math.sin(t * 1.5) * 0.04;
    };
  },

  /* Catalyst: rocket-bodied bot hovering on a live thruster flame, pumping its fist. */
  FND(h, c) {
    const b = h.body, sh = shell(c);
    h.lift = 0.12; h.hover = 1.8;
    add(b, new THREE.CapsuleGeometry(0.33, 0.36, 12, 32), MAT.ceramic, 0, 0.86, 0);
    add(b, new THREE.CylinderGeometry(0.338, 0.338, 0.12, 48, 1, true), sh, 0, 0.92, 0);
    for (let i = 0; i < 3; i++) {
      const a = Math.PI + (i - 1) * (TAU / 3);
      add(b, box(0.05, 0.32, 0.24, 0.02), sh, Math.sin(a) * 0.33, 0.62, Math.cos(a) * 0.33, { ry: a });
    }
    add(b, new THREE.CylinderGeometry(0.13, 0.17, 0.12, 32), MAT.gunmetal, 0, 0.42, 0);
    const flame = new THREE.Group(); flame.position.y = 0.36; b.add(flame);
    add(flame, new THREE.ConeGeometry(0.12, 0.5, 24, 1, true), holo("#ff7a2e", 0.75), 0, -0.25, 0, { rx: Math.PI, fx: true });
    add(flame, new THREE.ConeGeometry(0.06, 0.3, 24, 1, true), holo("#fff3c4", 0.95), 0, -0.15, 0, { rx: Math.PI, fx: true });
    const head = new THREE.Group(); head.position.y = 1.46; b.add(head); h.head = head;
    add(head, sphere(0.3), sh, 0, 0, 0, { s: [1, 1.05, 1] });
    add(head, new THREE.CylinderGeometry(0.306, 0.306, 0.15, 48, 1, true, -Math.PI * 0.42, Math.PI * 0.84), MAT.visor);
    [-0.08, 0.08].forEach((x) => h.eyes.push(add(head, box(0.07, 0.05, 0.02, 0.018), glow("#fff1d6", 3.4), x, 0, 0.3, { glow: true })));
    add(head, new THREE.ConeGeometry(0.06, 0.14, 24), MAT.chrome, 0, 0.36, 0);
    h.hands = [-1, 1].map((s) => add(b, box(0.16, 0.16, 0.16, 0.06), sh, s * 0.55, 0.8, 0.06));
    add(b, new THREE.TorusGeometry(0.085, 0.014, 10, 40), MAT.chrome, 0, 0.74, 0.325);
    add(b, new THREE.CircleGeometry(0.08, 32), MAT.visor, 0, 0.74, 0.332);
    rivets(b, 0.341, 0.995, 16, MAT.chrome);
    rivets(b, 0.341, 0.845, 16, MAT.chrome);
    trim(b, 0.335, 0.6, MAT.gold, 0.008);
    trim(b, 0.155, 0.37, MAT.gold, 0.01);
    trim(head, 0.3, -0.1, MAT.dark, 0.008);
    const v = new THREE.Vector3();
    h.update = (t, dt) => {
      flame.scale.set(1, 0.85 + Math.random() * 0.3, 1);
      h.hands[1].position.y = 0.8 + Math.max(0, Math.sin(t * 2.2)) * 0.22;
      if (dt > 0 && FX.emit && !h.isSil && h.vis > 0.5 && Math.random() < 0.6) {
        flame.getWorldPosition(v);
        v.y -= 0.3;
        FX.emit(v, "#ffb35c", 1, 0.5, -1.2);
      }
    };
  },

  /* Bridge Builder: friendly headset bot with a holographic globe and a network linking around it. */
  BRG(h, c) {
    const b = h.body, sh = shell(c);
    add(b, sphere(0.42), MAT.ceramic, 0, 0.8, 0, { s: [1.05, 0.98, 0.95] });
    add(b, new THREE.TorusGeometry(0.2, 0.04, 16, 48), sh, 0, 1.17, 0, { rx: FLAT });
    hoverBase(h, c, 0.4);
    const head = new THREE.Group(); head.position.y = 1.47; b.add(head); h.head = head;
    add(head, box(0.84, 0.54, 0.58, 0.24), sh);
    add(head, box(0.66, 0.32, 0.08, 0.13), MAT.visor, 0, 0, 0.26);
    [-0.14, 0.14].forEach((x) => h.eyes.push(add(head, new THREE.TorusGeometry(0.055, 0.016, 10, 24, Math.PI), glow("#fff1c2", 3.4), x, -0.02, 0.305, { glow: true })));
    [-1, 1].forEach((s) => add(head, new THREE.CylinderGeometry(0.1, 0.1, 0.07, 32), MAT.gunmetal, s * 0.44, 0, 0, { rz: FLAT }));
    add(head, new THREE.TorusGeometry(0.44, 0.022, 12, 64, Math.PI), MAT.gunmetal, 0, 0, 0, { s: [1, 0.72, 1] });
    rod(head, [0.44, -0.08, 0.06], [0.16, -0.2, 0.31], 0.012, MAT.chrome);
    add(head, sphere(0.025, 16, 12), glow(c, 3), 0.16, -0.2, 0.31, { glow: true });
    h.hands = [-1, 1].map((s) => add(b, sphere(0.1, 32, 24), sh, s * 0.58, 0.8, 0.05));
    add(b, new THREE.TorusGeometry(0.085, 0.012, 10, 40), MAT.gold, 0, 0.84, 0.385);
    add(b, sphere(0.03, 16, 12), glow(c, 3), 0, 0.84, 0.395, { s: [1, 1, 0.4], glow: true });
    trim(b, 0.41, 0.66, MAT.dark, 0.008, { s: [1, 0.95, 1] });
    add(head, box(0.69, 0.35, 0.07, 0.14), MAT.chrome, 0, 0, 0.252);
    [-1, 1].forEach((s) => add(head, new THREE.TorusGeometry(0.1, 0.012, 8, 32), MAT.gold, s * 0.478, 0, 0, { ry: FLAT }));

    const globe = new THREE.Group(); globe.position.set(-0.66, 1.18, 0.14); b.add(globe);
    add(globe, new THREE.IcosahedronGeometry(0.17, 2), new THREE.MeshBasicMaterial({
      color: new THREE.Color(c).multiplyScalar(2), wireframe: true, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    }), 0, 0, 0, { fx: true });
    add(globe, sphere(0.12, 24, 16), holo(c, 0.15), 0, 0, 0, { fx: true });
    const N = 6, nodeG = sphere(0.028, 12, 8), nodeM = glow(c, 3);
    const nodes = Array.from({ length: N }, () => add(b, nodeG, nodeM, 0, 0, 0, { fx: true }));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    const net = addLines(b, lg, lineMat(c, 0.45));
    net.frustumCulled = false;
    h.update = (t) => {
      globe.rotation.y = t * 0.8;
      nodes.forEach((n, i) => {
        const a = t * 0.5 + (i / N) * TAU, r = 0.74 + 0.06 * Math.sin(t + i);
        n.position.set(Math.cos(a) * r, 1.0 + Math.sin(a * 2 + i) * 0.25, Math.sin(a) * r);
      });
      const arr = lg.attributes.position.array;
      nodes.forEach((n, i) => {
        const m = nodes[(i + 1) % N];
        arr.set([n.position.x, n.position.y, n.position.z, m.position.x, m.position.y, m.position.z], i * 6);
      });
      lg.attributes.position.needsUpdate = true;
    };
  }
};
const FX = { emit: null };

/* ---------- Scene ---------- */
function start() {
  const canvas = document.getElementById("gl");
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" }); }
  catch (e) { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true }); }
  const coarse = matchMedia("(pointer: coarse)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  initMaterials();

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(0, 3, 16);

  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: coarse ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.3, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let useComposer = true;

  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  addEventListener("resize", resize);
  resize();

  /* Lights: soft studio key + colored rims for that product-shot look. */
  scene.add(new THREE.HemisphereLight(0x9aa8ff, 0x080810, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2.5, 6, 7); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9db4ff, 0.6); fill.position.set(-5, 2, 4); scene.add(fill);
  const rimA = new THREE.PointLight(0x8b6cff, 22, 25, 2); rimA.position.set(-3.5, 3.2, -3); scene.add(rimA);
  const rimB = new THREE.PointLight(0x2ee6d0, 16, 25, 2); rimB.position.set(3.5, 2.6, -3); scene.add(rimB);

  /* World: sky dome, reflective floor, light grid, carousel track, spotlight beam. */
  const world = new THREE.Group(); scene.add(world);
  const heroLayer = new THREE.Group(); scene.add(heroLayer);
  const skyTex = makeTex(8, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    [[0, "#03040a"], [0.32, "#06091a"], [0.46, "#111133"], [0.5, "#191642"], [0.54, "#0a0d1e"], [1, "#020309"]].forEach(([o, c]) => gr.addColorStop(o, c));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  world.add(new THREE.Mesh(new THREE.SphereGeometry(80, 32, 24), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false })));
  const alphaTex = makeTex(256, 256, radial([[0, "#fff"], [0.45, "#fff"], [1, "#000"]]), false);
  const floor = add(world, new THREE.CircleGeometry(16, 96), new THREE.MeshStandardMaterial({
    color: 0x0b0e1e, metalness: 0, roughness: 0.9, transparent: true, alphaMap: alphaTex, depthWrite: false
  }), 0, 0, 0, { rx: -FLAT });
  floor.renderOrder = -2;
  const gridTex = makeTex(1024, 1024, (g, s) => {
    const cx = s / 2;
    g.strokeStyle = "rgba(150,140,255,0.6)"; g.lineWidth = 2;
    for (let r = 64; r < cx; r += 64) { g.beginPath(); g.arc(cx, cx, r, 0, TAU); g.stroke(); }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * 64, cx + Math.sin(a) * 64); g.lineTo(cx + Math.cos(a) * cx, cx + Math.sin(a) * cx); g.stroke();
    }
    g.globalCompositeOperation = "destination-in";
    radial([[0, "rgba(0,0,0,1)"], [0.55, "rgba(0,0,0,.55)"], [1, "rgba(0,0,0,0)"]])(g, s, s);
  });
  const grid = add(world, new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({
    map: gridTex, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false
  }), 0, 0.002, 0, { rx: -FLAT });
  grid.renderOrder = -1;
  const track = add(world, new THREE.RingGeometry(0.994, 1.006, 160), new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x8b7bff).multiplyScalar(1.4), transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  }), 0, 0.004, 0, { rx: -FLAT });

  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xc8d8ff) }, uI: { value: 0 } },
    vertexShader: `varying float vH; varying float vF;
      void main() {
        vH = position.y / 6.0 + 0.5;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vF = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uI; varying float vH; varying float vF;
      void main() { float a = uI * pow(1.0 - vH, 1.6) * pow(vF, 2.0) * 0.35; gl_FragColor = vec4(uColor, a); }`,
    // Back faces only: the light column sits behind the hero instead of fogging over it.
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide
  });
  const beam = add(world, new THREE.CylinderGeometry(0.2, 0.95, 6, 48, 1, true), beamMat, 0, 3, 0);
  const spotTex = makeTex(128, 128, radial([[0, "rgba(255,255,255,1)"], [0.4, "rgba(255,255,255,.35)"], [1, "rgba(255,255,255,0)"]]));
  const spotMat = new THREE.MeshBasicMaterial({ map: spotTex, color: 0x9fb4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const spot = add(world, new THREE.PlaneGeometry(2.6, 2.6), spotMat, 0, 0.006, 0, { rx: -FLAT });

  /* Particles: bursts, thruster sparks, and ambient dust. */
  const dotTex = makeTex(64, 64, radial([[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,.6)"], [1, "rgba(255,255,255,0)"]]));
  const MAXP = 700;
  const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3), pVel = new Float32Array(MAXP * 3);
  const pBase = new Float32Array(MAXP * 3), pLife = new Float32Array(MAXP), pMax = new Float32Array(MAXP).fill(1);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.07, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false;
  world.add(pts);
  let pHead = 0;
  const tmpC = new THREE.Color();
  function emit(pos, color, n, speed = 2.2, up = 1.2) {
    tmpC.set(color);
    for (let k = 0; k < n; k++) {
      const i = pHead; pHead = (pHead + 1) % MAXP;
      const u = Math.random() * TAU, w = Math.random() * 2 - 1, s = speed * (0.35 + Math.random() * 0.65), r = Math.sqrt(1 - w * w);
      pPos.set([pos.x, pos.y, pos.z], i * 3);
      pVel.set([Math.cos(u) * r * s, w * s + up, Math.sin(u) * r * s], i * 3);
      pLife[i] = pMax[i] = 0.7 + Math.random() * 0.9;
      const bright = 0.9 + Math.random() * 0.8;
      pBase.set([tmpC.r * bright, tmpC.g * bright, tmpC.b * bright], i * 3);
    }
  }
  FX.emit = emit;
  function updateParticles(dt) {
    const drag = 1 - 1.2 * dt;
    for (let i = 0; i < MAXP; i++) {
      const j = i * 3;
      if (pLife[i] <= 0) { pCol[j] = pCol[j + 1] = pCol[j + 2] = 0; continue; }
      pLife[i] -= dt;
      pVel[j + 1] -= 3.2 * dt;
      pVel[j] *= drag; pVel[j + 1] *= drag; pVel[j + 2] *= drag;
      pPos[j] += pVel[j] * dt; pPos[j + 1] += pVel[j + 1] * dt; pPos[j + 2] += pVel[j + 2] * dt;
      if (pPos[j + 1] < 0.02) { pPos[j + 1] = 0.02; pVel[j + 1] *= -0.4; }
      const k = Math.max(0, pLife[i] / pMax[i]);
      pCol[j] = pBase[j] * k; pCol[j + 1] = pBase[j + 1] * k; pCol[j + 2] = pBase[j + 2] * k;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }
  const DN = 220, dPos = new Float32Array(DN * 3);
  for (let i = 0; i < DN; i++) dPos.set([(Math.random() - 0.5) * 16, Math.random() * 6, (Math.random() - 0.5) * 12 - 1], i * 3);
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
  world.add(new THREE.Points(dGeo, new THREE.PointsMaterial({
    size: 0.035, map: dotTex, color: 0x8f9fe6, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending
  })));

  /* Heroes on hexagonal pillars. */
  const pillarGeo = new THREE.CylinderGeometry(0.5, 0.56, 1, 6, 1); pillarGeo.translate(0, 0.5, 0);
  const pillarMat = new THREE.MeshPhysicalMaterial({ color: 0x0d1022, metalness: 0.85, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const hexRingGeo = new THREE.TorusGeometry(0.5, 0.009, 6, 6);
  const shadowTex = makeTex(128, 128, radial([[0, "rgba(0,0,0,.8)"], [0.5, "rgba(0,0,0,.35)"], [1, "rgba(0,0,0,0)"]]));
  const shadowGeo = new THREE.PlaneGeometry(1.5, 1.5);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const heroes = HKEYS.map((k, i) => {
    const h = {
      key: k, i, col: new THREE.Color(PERS[k].color), root: new THREE.Group(), body: new THREE.Group(),
      eyes: [], hands: [], head: null, phase: i * 1.7, blinkEvery: 3.2 + (i % 3) * 0.9,
      jump: 0, jumpV: 0, flash: 0, vis: 1, pillarH: 0.12, isSil: null, update: () => {}
    };
    h.root.add(h.body);
    BUILD[k](h, PERS[k].color);
    h.eyes.forEach((e) => { e.userData.sy = e.scale.y; });
    h.hands.forEach((e) => { e.userData.y0 = e.position.y; });
    h.silGlow = new THREE.MeshBasicMaterial({ color: h.col.clone().multiplyScalar(0.9) });
    h.shadow = add(h.root, shadowGeo, shadowMat, 0, 0.004, 0, { rx: -FLAT });
    h.pillar = new THREE.Group(); world.add(h.pillar);
    h.column = add(h.pillar, pillarGeo, pillarMat);
    h.ringMat = new THREE.MeshBasicMaterial({ color: h.col.clone() });
    h.ring = add(h.pillar, hexRingGeo, h.ringMat);
    h.ring.rotation.set(FLAT, 0, Math.PI / 6);
    heroLayer.add(h.root);
    return h;
  });
  const byKey = Object.fromEntries(heroes.map((h) => [h.key, h]));

  /* ---------- Motion state ---------- */
  const S = { R: 1.6, phi: 0, introIdx: 0, introT: 0, dragT: -10, spin: null, landed: false, kick: 0, beam: 0, beamKick: 0, selfRot: 0, userRot: 0, faceK: 0.35, selfDragT: -10, front: -1, tickIdx: 0 };
  const cam = { pos: new THREE.Vector3(0, 3, 16), look: new THREE.Vector3(0, 1, 0), ox: 0, oy: 0, ready: false };
  const tPos = new THREE.Vector3(), tLook = new THREE.Vector3(), tmp = new THREE.Vector3();
  const beamBase = new THREE.Color(0xc8d8ff), beamTint = new THREE.Color();
  const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
  const easeOutQuart = (x) => 1 - Math.pow(1 - x, 4);
  const frontIndex = (phi) => ((Math.round(-phi / STEP) % 6) + 6) % 6;
  const phiFor = (idx, near) => { const base = -idx * STEP; return base + TAU * Math.round((near - base) / TAU); };
  let clock = 0;

  window.addEventListener("game:gain", (e) => e.detail.forEach((k) => {
    const h = byKey[k];
    if (!h) return;
    h.jumpV = 2.4; h.flash = 1;
    tmp.copy(h.root.position); tmp.y += 1.2;
    emit(tmp, PERS[k].color, 26, 2.0, 1.0);
  }));
  /* Spin the carousel at least 3 full turns and stop exactly on the winner at the end of the duration. */
  window.addEventListener("game:spin", (e) => {
    const { target, duration, start } = e.detail;
    const phi0 = S.phi, base = -HKEYS.indexOf(target) * STEP;
    const turns = Math.ceil((phi0 + 3 * TAU - base) / TAU);
    S.spin = { phi0, phi1: base + turns * TAU, start, duration, target };
    S.landed = false;
    S.tickIdx = Math.round(phi0 / STEP);
  });
  window.addEventListener("game:drag", (e) => {
    if (G.mode === "result") { S.userRot += e.detail * 0.012; S.selfDragT = clock; }
    else if (G.mode === "intro") { S.phi += e.detail * 0.006; S.dragT = clock; }
  });
  window.addEventListener("game:mode", (e) => {
    if (e.detail !== "reveal" && e.detail !== "result") { S.spin = null; S.landed = false; }
  });

  function land() {
    S.landed = true; S.kick = 0.45; S.beamKick = 1.0;
    const h = byKey[S.spin.target];
    tmp.copy(h.root.position); tmp.y += 1.0;
    emit(tmp, PERS[h.key].color, 120, 3.4, 1.4);
    emit(tmp, "#ffffff", 40, 2.4, 1.0);
  }

  /* Each screen has a [data-zone] box; the camera frames its subject inside that box on any screen size. */
  function rigFor(mode) {
    const R = S.R;
    if (mode === "quiz") return { cx: 0, cy: 1.45, cz: 0, hw: R + 0.75, hh: 1.65, elev: 0.26, fill: 0.95 };
    if (mode === "reveal") return { cx: 0, cy: 1.0, cz: R, hw: 1.55, hh: 1.1, elev: 0.12, fill: 0.95 };
    if (mode === "result") return { cx: 0, cy: 0.98, cz: R, hw: 1.0, hh: 1.14, elev: 0.08, fill: 0.95 };
    return { cx: 0, cy: 1.0, cz: R, hw: 1.25, hh: 1.05, elev: 0.1, fill: 1 };
  }
  function updateCamera(mode, dt) {
    let zx = innerWidth / 2, zy = innerHeight / 2, zw = innerWidth, zh = innerHeight;
    const zone = document.querySelector(".screen.active [data-zone]");
    if (zone) {
      const r = zone.getBoundingClientRect();
      if (r.height > 20 && r.width > 20) { zx = r.left + r.width / 2; zy = r.top + r.height / 2; zw = r.width; zh = r.height; }
    }
    const rg = rigFor(mode);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = Math.max(rg.hh * innerHeight / (zh * rg.fill * tanV), rg.hw * innerHeight / (zw * rg.fill * tanV));
    tLook.set(rg.cx, rg.cy, rg.cz);
    tPos.set(rg.cx, rg.cy + Math.sin(rg.elev) * d, rg.cz + Math.cos(rg.elev) * d);
    const k = cam.ready ? 1 - Math.exp(-3 * dt) : 1;
    cam.pos.lerp(tPos, k);
    cam.look.lerp(tLook, k);
    const ko = cam.ready ? 1 - Math.exp(-14 * dt) : 1;
    cam.ox += (innerWidth / 2 - zx - cam.ox) * ko;
    cam.oy += (innerHeight / 2 - zy - cam.oy) * ko;
    cam.ready = true;
    camera.position.copy(cam.pos);
    camera.lookAt(cam.look);
    camera.setViewOffset(innerWidth, innerHeight, cam.ox, cam.oy, innerWidth, innerHeight);
  }

  function step(dt) {
    const mode = G.mode;
    clock += dt;
    S.R = damp(S.R, mode === "quiz" ? 2.0 : mode === "intro" ? 2.1 : 1.75, 3, dt);

    if (mode === "intro") {
      if (clock - S.dragT < 1.0) { S.introT = 0; S.introIdx = frontIndex(S.phi); }
      else {
        S.introT += dt;
        if (S.introT > 2.8) { S.introT = 0; S.introIdx = (S.introIdx + 1) % 6; }
        S.phi = damp(S.phi, phiFor(S.introIdx, S.phi), 4, dt);
      }
    } else if (mode === "quiz") {
      S.phi += dt * 0.22;
    } else if (mode === "reveal" && S.spin) {
      const x = Math.min(1, (performance.now() - S.spin.start) / S.spin.duration);
      S.phi = S.spin.phi0 + (S.spin.phi1 - S.spin.phi0) * easeOutQuart(x);
      const ti = Math.round(S.phi / STEP);
      if (ti !== S.tickIdx) { S.tickIdx = ti; window.dispatchEvent(new Event("stage:tick")); }
      if (x >= 1 && !S.landed) land();
    }
    S.faceK = damp(S.faceK, mode === "intro" ? 0.35 : 1, 4, dt);
    const f = frontIndex(S.phi);
    if (f !== S.front) { S.front = f; window.dispatchEvent(new CustomEvent("stage:front", { detail: HKEYS[f] })); }
    // Result: the hero sways to show it's 3D but mostly faces the camera, so screenshots look good.
    if (mode !== "result" || clock - S.selfDragT > 1.5) S.userRot = damp(S.userRot, Math.round(S.userRot / TAU) * TAU, 2, dt);
    S.selfRot = S.userRot + (mode === "result" ? Math.sin(clock * 0.5) * 0.45 : 0);

    heroes.forEach((h) => {
      const theta = h.i * STEP + S.phi;
      const x = Math.sin(theta) * S.R, z = Math.cos(theta) * S.R;
      const score = G.totals[h.key] || 0;
      h.pillarH = damp(h.pillarH, mode === "quiz" ? 0.12 + (score / 10) * 1.3 : 0.12, 4, dt);
      const shown = mode === "result" ? h.key === G.winner : mode === "intro" ? Math.cos(theta) > 0.2 : true;
      h.vis = damp(h.vis, shown ? 1 : 0, 6, dt);
      const on = h.vis > 0.01;
      h.root.visible = h.pillar.visible = on;
      if (h.jumpV !== 0 || h.jump > 0) {
        h.jump += h.jumpV * dt; h.jumpV -= 9.8 * dt;
        if (h.jump <= 0) { h.jump = 0; h.jumpV = 0; }
      }
      h.flash = damp(h.flash, 0, 3, dt);
      h.pillar.position.set(x, 0, z);
      h.pillar.rotation.y = theta;
      h.pillar.scale.set(h.vis, 1, h.vis);
      h.column.scale.y = h.pillarH;
      h.ring.position.y = h.pillarH + 0.004;
      h.root.position.set(x, h.pillarH, z);
      h.root.scale.setScalar(Math.max(0.001, h.vis));
      const facing = Math.atan2(Math.sin(theta), Math.cos(theta)) * S.faceK;
      h.root.rotation.y = facing + (mode === "result" && h.key === G.winner ? S.selfRot : 0);
      setSil(h, mode === "quiz" || (mode === "reveal" && !(S.landed && h.key === G.winner)));
      const ringI = mode === "quiz" ? 0.4 + (score / 10) * 1.0 : mode === "result" ? 1.3 : 0.9;
      h.ringMat.color.copy(h.col).multiplyScalar(ringI + h.flash * 1.5);
      if (on) animateHero(h, clock, dt);
    });

    const beamTarget = mode === "intro" ? 0.18 : mode === "quiz" ? 0 : mode === "reveal" ? (S.landed ? 0.9 : 0.5) : 0.5;
    S.beam = damp(S.beam, beamTarget, 3, dt);
    S.beamKick = damp(S.beamKick, 0, 2, dt);
    S.kick = damp(S.kick, 0, 2.5, dt);
    beamTint.copy(beamBase);
    if (G.winner && S.landed) beamTint.copy(byKey[G.winner].col).lerp(beamBase, 0.45);
    beamMat.uniforms.uColor.value.lerp(beamTint, 1 - Math.exp(-3 * dt));
    beamMat.uniforms.uI.value = S.beam + S.beamKick;
    spotMat.color.copy(beamMat.uniforms.uColor.value);
    spotMat.opacity = Math.min(0.8, (S.beam + S.beamKick) * 0.2);
    beam.position.set(0, 3, S.R);
    spot.position.set(0, 0.006, S.R);
    track.scale.set(S.R, S.R, 1);

    const dp = dGeo.attributes.position.array;
    for (let i = 1; i < dp.length; i += 3) { dp[i] += dt * 0.12; if (dp[i] > 6) dp[i] = 0; }
    dGeo.attributes.position.needsUpdate = true;
    updateParticles(dt);
  }

  /* ---------- Hero thumbnails for the collection (rendered once, transparent PNGs) ---------- */
  function makeThumbs() {
    const out = {}, size = 192;
    const px = Math.floor(size * renderer.getPixelRatio());
    const W = renderer.domElement.width, H = renderer.domElement.height;
    if (px > W || px > H) return out;
    const c2 = document.createElement("canvas"); c2.width = c2.height = size;
    const g2 = c2.getContext("2d");
    const tcam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    tcam.position.set(0, 1.3, 4.6); tcam.lookAt(0, 1.0, 0);
    world.visible = false;
    heroes.forEach((h) => { h.root.visible = false; });
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, size, size);
    renderer.setScissor(0, 0, size, size);
    for (const h of heroes) {
      h.root.visible = true; h.root.position.set(0, 0, 0); h.root.rotation.y = -0.35; h.root.scale.setScalar(1);
      h.shadow.visible = false;
      setSil(h, false);
      animateHero(h, 0.8, 0);
      const beams = [];
      h.root.traverse((o) => { if (o.userData.hoverBeam) { o.visible = false; beams.push(o); } });
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, tcam);
      g2.clearRect(0, 0, size, size);
      g2.drawImage(renderer.domElement, 0, H - px, px, px, 0, 0, size, size);
      out[h.key] = c2.toDataURL("image/png");
      beams.forEach((o) => { o.visible = true; });
      h.root.visible = false; h.shadow.visible = true;
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
    world.visible = true;
    heroes.forEach((h) => { h.root.visible = true; });
    return out;
  }

  /* ---------- Render loop (drops bloom and resolution on slow phones) ---------- */
  let last = 0, perfN = 0, perfT = 0, lowQuality = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    step(dt);
    updateCamera(G.mode, dt);
    bloom.strength = 0.22 + S.kick;
    if (useComposer) composer.render(dt); else renderer.render(scene, camera);
    if (!lowQuality && clock > 1.5 && perfN < 90) {
      perfN++; perfT += dt;
      if (perfN === 90 && perfN / perfT < 38) {
        lowQuality = true; useComposer = false;
        renderer.setPixelRatio(1);
        resize();
      }
    }
  }

  // Compile both looks up front so the first silhouette switch doesn't stutter.
  heroes.forEach((h) => setSil(h, true)); renderer.compile(scene, camera);
  heroes.forEach((h) => setSil(h, false)); renderer.compile(scene, camera);
  try { window.HERO_THUMBS = makeThumbs(); } catch (e) { console.warn("[3D stage] thumbnails skipped", e); }
  step(0);
  updateCamera(G.mode, 0);
  composer.render(0);
  window.dispatchEvent(new Event("stage:ready"));
  requestAnimationFrame((t) => { last = t; frame(t); });
}

try { start(); } catch (err) {
  console.error("[3D stage] failed to start", err);
  window.dispatchEvent(new CustomEvent("stage:failed", { detail: "start: " + (err && err.message ? err.message : err) }));
}
