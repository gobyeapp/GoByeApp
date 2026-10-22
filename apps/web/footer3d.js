/* GoBYE footer: a miniature 3D road with cars that drive along it continuously.
   Plain Three.js (vendored, MIT). Loaded on demand by app.js when the footer comes near.
   Everything is procedural: no model files, no textures to download. */
import * as THREE from './vendor/three.module.min.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

export function mountRoad(canvas, opts) {
  const reduce = !!(opts && opts.reduce);
  // theme 'dark' (the app's dark tokens) keeps the road readable on a black screen; the website uses the default light look.
  const dark = !!(opts && opts.theme === 'dark');
  const small = () => canvas.clientWidth < 700;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch (e) {
    return null; // no WebGL: the wordmark stays on its own
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !small(); // phones rely on the soft contact shadows under each car
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, 2, 0.1, 200);

  /* ---------- Light: warm key with soft shadows, a cool rim from behind, gentle fill ---------- */
  scene.add(new THREE.HemisphereLight(0xffffff, 0xf1e7ee, 0.7));
  const sun = new THREE.DirectionalLight(0xffefe0, 1.55);
  sun.position.set(-6, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 8, bottom: -8, near: 1, far: 40 });
  sun.shadow.radius = 10;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xe6ecff, 0.55);
  rim.position.set(4, 6, -10);
  scene.add(rim);

  /* ---------- Path: a long, gentle S that runs off both sides of the view ---------- */
  const pts = [];
  for (let x = -32; x <= 32; x += 4) pts.push(new THREE.Vector3(x, 0, 1.2 * Math.sin(x * 0.2) + 0.45 * Math.sin(x * 0.53 + 1.1)));
  const path = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const LEN = path.getLength();
  const N = 520;
  const frames = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const p = path.getPointAt(u);
    const t = path.getTangentAt(u).setY(0).normalize();
    frames.push({ p, t, n: new THREE.Vector3(t.z, 0, -t.x) });
  }
  const frameAt = (s) => {
    const u = (((s / LEN) % 1) + 1) % 1;
    const f = u * N;
    const i = Math.floor(f);
    const k = f - i;
    const a = frames[i];
    const b = frames[Math.min(i + 1, N)];
    return { p: a.p.clone().lerp(b.p, k), t: a.t.clone().lerp(b.t, k).normalize(), n: a.n.clone().lerp(b.n, k).normalize() };
  };

  /* ---------- Swept slabs: road, kerbs and verge share one generator ---------- */
  // A rounded rectangle cross section (across, up) swept along the path.
  function slab(center, width, top, bottom, r, mat) {
    const prof = [];
    const corner = (cx, cy, a0) => { for (let j = 0; j <= 5; j++) { const a = a0 + (j / 5) * (Math.PI / 2); prof.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
    const hw = width / 2;
    corner(center + hw - r, top - r, 0);
    corner(center - hw + r, top - r, Math.PI / 2);
    corner(center - hw + r, bottom + r, Math.PI);
    corner(center + hw - r, bottom + r, (3 * Math.PI) / 2);
    const M = prof.length;
    const pos = new Float32Array((N + 1) * M * 3);
    for (let i = 0; i <= N; i++) {
      const { p, n } = frames[i];
      for (let j = 0; j < M; j++) {
        const o = (i * M + j) * 3;
        pos[o] = p.x + n.x * prof[j][0];
        pos[o + 1] = prof[j][1];
        pos[o + 2] = p.z + n.z * prof[j][0];
      }
    }
    const idx = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + ((j + 1) % M), c = (i + 1) * M + j, d = (i + 1) * M + ((j + 1) % M);
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = true;
    scene.add(m);
    return m;
  }
  const W = 2.3; // carriageway
  const asphalt = new THREE.MeshStandardMaterial({ color: dark ? 0x262626 : 0x2a262d, roughness: 0.86 });
  const stone = new THREE.MeshStandardMaterial({ color: dark ? 0x3a3a3a : 0xece7e2, roughness: 0.7 });
  slab(0, W + 0.2, 0, -0.3, 0.07, asphalt); // the road (slightly wider, so the kerbs sit on it)
  for (const side of [-1, 1]) slab(side * (W / 2 + 0.05), 0.11, 0.03, -0.045, 0.03, stone); // kerbs: a thin lip on top, the road side below stays dark

  // Painted lines.
  const ribbon = (offset, width) => {
    const v = new Float32Array((N + 1) * 2 * 3);
    for (let i = 0; i <= N; i++) {
      const { p, n } = frames[i];
      for (let side = 0; side < 2; side++) {
        const o = (i * 2 + side) * 3;
        const d = offset + (side ? width / 2 : -width / 2);
        v[o] = p.x + n.x * d; v[o + 1] = 0.003; v[o + 2] = p.z + n.z * d;
      }
    }
    const id = [];
    for (let i = 0; i < N; i++) { const a = i * 2; id.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(v, 3));
    g.setIndex(id);
    g.computeVertexNormals();
    return g;
  };
  const paintLine = new THREE.MeshStandardMaterial({ color: dark ? 0xa3a3a3 : 0xefeae4, roughness: 0.55 });
  [W / 2 - 0.13, -(W / 2 - 0.13)].forEach((off) => { const m = new THREE.Mesh(ribbon(off, 0.03), paintLine); m.receiveShadow = true; scene.add(m); });
  const dashCount = Math.floor(LEN / 0.95);
  const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.006, 0.045), paintLine, dashCount);
  const tmp = new THREE.Object3D();
  for (let i = 0; i < dashCount; i++) {
    const f = frameAt(i * 0.95);
    tmp.position.set(f.p.x, 0.003, f.p.z);
    tmp.rotation.set(0, Math.atan2(-f.t.z, f.t.x), 0);
    tmp.updateMatrix();
    dashes.setMatrixAt(i, tmp.matrix);
  }
  dashes.receiveShadow = true;
  scene.add(dashes);

  // Invisible floor that only catches shadows, so the road appears to float over the wordmark.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), new THREE.ShadowMaterial({ opacity: dark ? 0 : 0.07 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.75;
  floor.receiveShadow = true;
  scene.add(floor);

  /* ---------- Cars: miniature models with real silhouettes ---------- */
  const paint = (hex, metal) => new THREE.MeshPhysicalMaterial({ color: hex, metalness: metal ? 0.6 : 0.15, roughness: metal ? 0.26 : 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
  const PAINTS = [paint(dark ? 0x5a5a5e : 0x0e0e10), paint(0xc8cbd0, true), paint(0x3b3b40, true), paint(0xff751f), paint(0xf3f2ef), paint(0x351a40)];
  const ORDER = [0, 1, 2, 4, 1, 0, 3, 2, 4, 1, 0, 5, 2, 1, 4, 0, 2, 1, 3, 0, 4, 2]; // mostly neutrals, brand colours now and then
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x151820, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.6 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x131313, roughness: 0.78 });
  const hub = new THREE.MeshStandardMaterial({ color: 0xdcdee3, metalness: 0.9, roughness: 0.22 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6e8, emissive: 0xfff0d8, emissiveIntensity: 1.1 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xc81e1e, emissive: 0xc0141d, emissiveIntensity: 0.8 });
  const blob = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    r.addColorStop(0, 'rgba(0,0,0,0.6)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  })();

  // A polygon with rounded corners, as a THREE.Shape (side profile: x along the car, y up).
  function rounded(points, r) {
    const s = new THREE.Shape();
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector2(...points[i]);
      const a = new THREE.Vector2(...points[(i - 1 + n) % n]);
      const b = new THREE.Vector2(...points[(i + 1) % n]);
      const da = a.clone().sub(p), db = b.clone().sub(p);
      const ra = Math.min(r, da.length() / 2), rb = Math.min(r, db.length() / 2);
      const pa = p.clone().add(da.normalize().multiplyScalar(ra));
      const pb = p.clone().add(db.normalize().multiplyScalar(rb));
      if (i === 0) s.moveTo(pa.x, pa.y); else s.lineTo(pa.x, pa.y);
      s.quadraticCurveTo(p.x, p.y, pb.x, pb.y);
    }
    s.closePath();
    return s;
  }
  function extrude(points, r, width, bevel) {
    const depth = Math.max(0.01, width - 2 * bevel);
    const g = new THREE.ExtrudeGeometry(rounded(points, r), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 8 });
    g.translate(0, 0, -depth / 2);
    return g;
  }

  // Side profiles. Body: bumper, hood and boot. Glass: windscreen and rear window slopes. Roof: a thin cap.
  const TYPES = {
    sedan: {
      L: 1.0, Wd: 0.46,
      body: [[-0.5, 0.075], [0.5, 0.075], [0.515, 0.155], [0.46, 0.205], [0.17, 0.228], [-0.3, 0.232], [-0.49, 0.205]],
      glass: [[-0.33, 0.215], [0.18, 0.215], [0.04, 0.35], [-0.22, 0.35]],
      roof: [[-0.225, 0.335], [0.045, 0.335], [0.035, 0.362], [-0.215, 0.362]],
    },
    suv: {
      L: 0.98, Wd: 0.5,
      body: [[-0.49, 0.08], [0.49, 0.08], [0.505, 0.19], [0.46, 0.262], [0.2, 0.282], [-0.47, 0.285], [-0.495, 0.24]],
      glass: [[-0.45, 0.27], [0.21, 0.27], [0.11, 0.415], [-0.43, 0.415]],
      roof: [[-0.435, 0.4], [0.115, 0.4], [0.105, 0.43], [-0.425, 0.43]],
    },
    compact: {
      L: 0.78, Wd: 0.44,
      body: [[-0.39, 0.075], [0.39, 0.075], [0.405, 0.16], [0.355, 0.215], [0.14, 0.236], [-0.37, 0.24], [-0.395, 0.2]],
      glass: [[-0.37, 0.225], [0.15, 0.225], [0.045, 0.365], [-0.34, 0.365]],
      roof: [[-0.345, 0.35], [0.05, 0.35], [0.04, 0.378], [-0.335, 0.378]],
    },
  };
  const GEO = {};
  for (const [k, d] of Object.entries(TYPES)) {
    GEO[k] = {
      body: extrude(d.body, 0.06, d.Wd, 0.035),
      glass: extrude(d.glass, 0.035, d.Wd * 0.84, 0.03),
      roof: extrude(d.roof, 0.012, d.Wd * 0.8, 0.012),
      sill: new RoundedBoxGeometry(d.L * 0.86, 0.035, d.Wd + 0.01, 2, 0.015),
    };
  }
  const WR = 0.1;
  const wheelGeo = new THREE.CylinderGeometry(WR, WR, 0.1, 28);
  const hubGeo = new THREE.CylinderGeometry(WR * 0.58, WR * 0.58, 0.104, 24);
  const spokeGeo = new THREE.BoxGeometry(WR * 1.08, 0.022, 0.106);
  const lampGeo = new RoundedBoxGeometry(0.02, 0.03, 0.09, 2, 0.008);

  function makeCar(type, mat) {
    const d = TYPES[type], G = GEO[type];
    const car = new THREE.Group();
    const body = new THREE.Group();
    car.add(body);
    const shell = new THREE.Mesh(G.body, mat);
    const glassM = new THREE.Mesh(G.glass, glass);
    const roof = new THREE.Mesh(G.roof, mat);
    const sill = new THREE.Mesh(G.sill, trim);
    sill.position.y = 0.085;
    [shell, glassM, roof, sill].forEach((m) => { m.castShadow = true; body.add(m); });
    const front = d.body[2][0], back = d.body[6][0];
    for (const z of [-1, 1]) {
      const hl = new THREE.Mesh(lampGeo, headMat); hl.position.set(front - 0.012, 0.165, z * (d.Wd / 2 - 0.085));
      const tl = new THREE.Mesh(lampGeo, tailMat); tl.position.set(back - 0.02, 0.19, z * (d.Wd / 2 - 0.085));
      body.add(hl, tl);
    }
    const wheels = [];
    for (const x of [d.L / 2 - 0.19, -d.L / 2 + 0.19]) for (const z of [-1, 1]) {
      const w = new THREE.Group();
      const ty = new THREE.Mesh(wheelGeo, tyre); ty.rotation.x = Math.PI / 2; ty.castShadow = true;
      const hb = new THREE.Mesh(hubGeo, hub); hb.rotation.x = Math.PI / 2;
      const sp = new THREE.Mesh(spokeGeo, hub);
      const sp2 = sp.clone(); sp2.rotation.z = Math.PI / 2;
      w.add(ty, hb, sp, sp2);
      w.position.set(x, WR, z * (d.Wd / 2 - 0.02));
      car.add(w);
      wheels.push(w);
    }
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(d.L * 1.3, d.Wd * 1.6), blob);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.006;
    car.add(shadow);
    scene.add(car);
    return { car, body, wheels };
  }

  /* ---------- Traffic: two lanes, opposite directions, keeping a believable gap ---------- */
  const LANE = 0.56;
  const kinds = ['sedan', 'suv', 'compact', 'sedan', 'compact', 'suv', 'sedan'];
  const perLane = small() ? 6 : 11;
  const cars = [];
  for (let lane = 0; lane < 2; lane++) {
    for (let i = 0; i < perLane; i++) {
      const k = lane * perLane + i;
      const m = makeCar(kinds[(k * 3 + lane) % kinds.length], PAINTS[ORDER[k % ORDER.length]]);
      m.lane = lane; // 0: towards +x on the near side; 1: towards -x on the far side
      m.s = (i / perLane) * LEN + (lane ? 3.1 : 0) + Math.sin(k * 12.9) * 1.6;
      m.vBase = 1.0 + ((k * 37) % 10) / 30;
      m.v = m.vBase;
      m.phase = k * 1.7;
      m.spin = 0;
      cars.push(m);
    }
  }

  function step(dt, time) {
    for (const lane of [0, 1]) {
      const list = cars.filter((c) => c.lane === lane).sort((a, b) => ((a.s % LEN) + LEN) % LEN - (((b.s % LEN) + LEN) % LEN));
      list.forEach((c, i) => {
        const ahead = lane === 0 ? list[(i + 1) % list.length] : list[(i - 1 + list.length) % list.length];
        let gap = lane === 0 ? ahead.s - c.s : c.s - ahead.s;
        gap = ((gap % LEN) + LEN) % LEN;
        let target = c.vBase * (1 + 0.14 * Math.sin(time * 0.23 + c.phase));
        if (gap < 2.6) target = Math.min(target, ahead.v * Math.max(0, (gap - 1.25) / 1.35));
        const prev = c.v;
        c.v += (target - c.v) * Math.min(1, dt * 1.2);
        c.accel = (c.v - prev) / Math.max(dt, 1e-3);
      });
    }
    for (const c of cars) {
      const dist = c.v * dt;
      c.s += c.lane === 0 ? dist : -dist;
      c.spin += dist / WR;
    }
  }

  function place(time) {
    for (const c of cars) {
      const f = frameAt(c.s);
      const dir = c.lane === 0 ? f.t : f.t.clone().negate();
      const off = c.lane === 0 ? -LANE : LANE; // drive on the right
      c.car.position.set(f.p.x + f.n.x * off, 0, f.p.z + f.n.z * off);
      c.car.rotation.y = Math.atan2(-dir.z, dir.x);
      c.wheels.forEach((w) => { w.rotation.z = -c.spin; });
      c.body.position.y = Math.sin(time * 6.5 + c.phase) * 0.0035 + Math.sin(time * 11.3 + c.phase * 2) * 0.0015;
      c.body.rotation.z = THREE.MathUtils.clamp(-(c.accel || 0) * 0.03, -0.025, 0.025);
    }
  }

  /* ---------- Camera: slow breathing drift, plus a little follow of the cursor ---------- */
  const look = new THREE.Vector3(0, 0.5, 0.3);
  const aim = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  let dist = 14;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small() ? 1.5 : 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const half = camera.aspect >= 2 ? 8.2 : 3.4;
    dist = half / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    camera.updateProjectionMatrix();
  }
  function aimCamera(time) {
    const el = THREE.MathUtils.degToRad(31 + cur.y * 3 + Math.sin(time * 0.15) * 0.6);
    const az = cur.x * 0.06 + Math.sin(time * 0.11) * 0.012;
    camera.position.set(Math.sin(az) * dist * Math.cos(el), Math.sin(el) * dist, Math.cos(az) * dist * Math.cos(el));
    camera.lookAt(look);
  }
  const onPointer = (e) => {
    const r = canvas.getBoundingClientRect();
    aim.x = THREE.MathUtils.clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
    aim.y = THREE.MathUtils.clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
  };
  if (!reduce && window.matchMedia && window.matchMedia('(pointer: fine)').matches) window.addEventListener('pointermove', onPointer, { passive: true });

  /* ---------- Loop: runs only while the footer is on screen and the tab is visible ---------- */
  let running = false, visible = false, raf = 0, last = 0, time = 0;
  function render() { aimCamera(time); renderer.render(scene, camera); }
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    time += dt;
    cur.x += (aim.x - cur.x) * Math.min(1, dt * 2);
    cur.y += (aim.y - cur.y) * Math.min(1, dt * 2);
    step(dt, time);
    place(time);
    render();
    raf = requestAnimationFrame(frame);
  }
  function sync() {
    const should = visible && !document.hidden && !reduce;
    if (should && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
    if (!should && running) { running = false; cancelAnimationFrame(raf); }
  }
  const ro = new ResizeObserver(() => { resize(); if (!running) render(); });
  ro.observe(canvas);
  resize();
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; sync(); }, { rootMargin: '120px 0px' });
  io.observe(canvas);
  document.addEventListener('visibilitychange', sync);

  // First frame: cars already spread along the road (also the still image under reduced motion).
  for (let i = 0; i < 60; i++) step(1 / 30, i / 30);
  place(2);
  render();

  return {
    get running() { return running; },
    get time() { return time; },
    dispose() { running = false; cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); window.removeEventListener('pointermove', onPointer); renderer.dispose(); },
  };
}
