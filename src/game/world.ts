import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from './track';
import { fbm, ridged, smoothstep, mulberry, noise2 } from './noise';
import {
  asphaltTextures,
  asphaltRoughness,
  asphaltNormal,
  curbTexture,
  grassTexture,
  checkerTexture,
  barrierTexture,
  fenceTexture,
  waterNormal,
  textTexture,
  billboardTextures,
  billboardTexture2,
  windowsTexture,
  glowTexture,
  smokeTexture,
} from './textures';

export const WATER_LEVEL = -2;

export interface World {
  group: THREE.Group;
  startLights: THREE.MeshStandardMaterial[];
  water: THREE.Mesh;
  lampMaterials: THREE.MeshStandardMaterial[];
  groundHeight: (x: number, z: number) => number;
  dispose: () => void;
}

/** 远离赛道的天然地形 */
function naturalHeight(x: number, z: number) {
  const hills = (fbm(x * 0.0022 + 3.1, z * 0.0022 + 7.7, 5) - 0.42) * 70;
  const r = Math.hypot(x + 10, (z + 180) * 1.15);
  const mountain = ridged(x * 0.0011 + 11, z * 0.0011 - 3, 5) * 330 * smoothstep(700, 1700, r);
  const coastLine = 110 + (noise2(x * 0.004, 3.3) - 0.5) * 140;
  const coast = smoothstep(coastLine, coastLine + 260, z);
  const land = hills + mountain;
  return land * (1 - coast) + -16 * coast;
}

export function buildWorld(track: Track, opts: { night: boolean; quality: 'high' | 'medium' }): World {
  const group = new THREE.Group();
  group.name = 'world';
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const n = track.count;
  const hw = track.halfWidth;
  const wall = track.wallOffset;
  const night = opts.night;

  // 赛道包围盒
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, track.px[i]);
    maxX = Math.max(maxX, track.px[i]);
    minZ = Math.min(minZ, track.pz[i]);
    maxZ = Math.max(maxZ, track.pz[i]);
  }
  const PAD = 190;

  const groundHeight = (x: number, z: number) => {
    const nat = naturalHeight(x, z);
    if (x < minX - PAD || x > maxX + PAD || z < minZ - PAD || z > maxZ + PAD) return nat;
    const d = track.distanceInfo(x, z);
    if (!isFinite(d.dist)) return nat;
    const t = smoothstep(wall + 5, wall + 75, d.dist);
    const shaped = d.height - 0.45;
    return shaped + (nat - shaped) * t;
  };

  // ======================= 地形 =======================
  {
    const xs: number[] = [];
    const zs: number[] = [];
    const dense = 5;
    const sparse = 45;
    const X0 = minX - PAD - 20;
    const X1 = maxX + PAD + 20;
    const Z0 = minZ - PAD - 20;
    const Z1 = maxZ + PAD + 20;
    const FAR = 3200;
    for (let x = -FAR; x < X0; x += sparse) xs.push(x);
    for (let x = X0; x < X1; x += dense) xs.push(x);
    for (let x = X1; x <= FAR; x += sparse) xs.push(x);
    for (let z = -FAR; z < Z0; z += sparse) zs.push(z);
    for (let z = Z0; z < Z1; z += dense) zs.push(z);
    for (let z = Z1; z <= FAR; z += sparse) zs.push(z);
    const W = xs.length;
    const H = zs.length;
    const pos = new Float32Array(W * H * 3);
    const uv = new Float32Array(W * H * 2);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        const x = xs[i];
        const z = zs[j];
        pos[k * 3] = x;
        pos[k * 3 + 1] = groundHeight(x, z);
        pos[k * 3 + 2] = z;
        uv[k * 2] = x / 9;
        uv[k * 2 + 1] = z / 9;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < H - 1; j++)
      for (let i = 0; i < W - 1; i++) {
        const a = j * W + i;
        const b = a + 1;
        const c = a + W;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    const col = new Float32Array(W * H * 3);
    const cGrassA = new THREE.Color(night ? '#2c4a2a' : '#5f7d34');
    const cGrassB = new THREE.Color(night ? '#3b5530' : '#8a8f3e');
    const cForest = new THREE.Color('#2f4a24');
    const cRock = new THREE.Color('#7a6f63');
    const cSand = new THREE.Color('#d8c29a');
    const cSnow = new THREE.Color('#eef2f6');
    const cTmp = new THREE.Color();
    for (let k = 0; k < W * H; k++) {
      const x = pos[k * 3];
      const y = pos[k * 3 + 1];
      const z = pos[k * 3 + 2];
      const ny = nrm.getY(k);
      const v = fbm(x * 0.01, z * 0.01, 3);
      cTmp.copy(cGrassA).lerp(cGrassB, smoothstep(0.35, 0.7, v));
      cTmp.lerp(cForest, smoothstep(0.55, 0.8, fbm(x * 0.004 + 9, z * 0.004, 3)) * 0.7);
      cTmp.lerp(cRock, smoothstep(0.88, 0.7, ny));
      cTmp.lerp(cRock, smoothstep(60, 140, y) * 0.8);
      cTmp.lerp(cSnow, smoothstep(190, 250, y + v * 40) * smoothstep(0.6, 0.8, ny));
      cTmp.lerp(cSand, smoothstep(2.2, 0.4, y) * smoothstep(40, 110, z));
      col[k * 3] = cTmp.r;
      col[k * 3 + 1] = cTmp.g;
      col[k * 3 + 2] = cTmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    keep(g);
    const gt = grassTexture();
    gt.repeat.set(1, 1);
    const mat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, map: gt, roughness: 0.95, metalness: 0 }));
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    group.add(mesh);
  }

  // ======================= 海面 =======================
  const wn = waterNormal();
  wn.repeat.set(90, 90);
  const waterMat = keep(
    new THREE.MeshPhysicalMaterial({
      color: night ? '#0a1a2a' : '#1d5673',
      roughness: 0.06,
      metalness: 0.1,
      normalMap: wn,
      normalScale: new THREE.Vector2(0.35, 0.35),
      envMapIntensity: 1.3,
      clearcoat: 0.6,
      clearcoatRoughness: 0.1,
    }),
  );
  const water = new THREE.Mesh(keep(new THREE.PlaneGeometry(9000, 9000)), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_LEVEL;
  water.name = 'water';
  group.add(water);

  // ======================= 路面相关的条带构建 =======================
  type Ribbon = { pos: number[]; uv: number[]; idx: number[] };
  const ribbon = (): Ribbon => ({ pos: [], uv: [], idx: [] });
  const leftX = (i: number) => track.tz[i];
  const leftZ = (i: number) => -track.tx[i];
  const cumulative = (i: number) => i * track.step;

  /** 在两条横向偏移之间生成条带；range: [start, end) 采样索引，可跨越终点 */
  function strip(r: Ribbon, a: number, b: number, yA: number, yB: number, vScale: number, start = 0, end = n, uA = 0, uB = 1) {
    const base = r.pos.length / 3;
    let count = 0;
    for (let k = start; k <= end; k++) {
      const i = ((k % n) + n) % n;
      const px = track.px[i];
      const pz = track.pz[i];
      const py = track.py[i];
      r.pos.push(px + leftX(i) * a, py + yA, pz + leftZ(i) * a);
      r.pos.push(px + leftX(i) * b, py + yB, pz + leftZ(i) * b);
      const v = (cumulative(k)) / vScale;
      r.uv.push(uA, v, uB, v);
      count++;
    }
    for (let k = 0; k < count - 1; k++) {
      const p = base + k * 2;
      r.idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
    }
  }
  function toGeom(r: Ribbon) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(r.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(r.uv, 2));
    g.setIndex(r.idx);
    g.computeVertexNormals();
    return keep(g);
  }

  // 路面：左侧 +hw 到右侧 -hw
  {
    const r = ribbon();
    strip(r, hw, -hw, 0.02, 0.02, 30, 0, n, 0, 1);
    const at = asphaltTextures();
    const ar = asphaltRoughness();
    ar.repeat.set(4, 4);
    const an = asphaltNormal();
    an.repeat.set(6, 6);
    const mat = keep(
      new THREE.MeshStandardMaterial({ map: at, roughnessMap: ar, roughness: night ? 0.75 : 0.88, normalMap: an, normalScale: new THREE.Vector2(0.4, 0.4), metalness: 0.0, envMapIntensity: 0.6 }),
    );
    const m = new THREE.Mesh(toGeom(r), mat);
    m.receiveShadow = true;
    m.name = 'road';
    group.add(m);
  }

  // 路肩草地（路面边缘到护墙外）
  {
    const r = ribbon();
    strip(r, wall + 7, hw - 0.1, -0.06, -0.01, 9, 0, n, 0, (wall + 7 - hw) / 9);
    strip(r, -hw + 0.1, -wall - 7, -0.01, -0.06, 9, 0, n, 0, (wall + 7 - hw) / 9);
    const gt = grassTexture().clone();
    gt.needsUpdate = true;
    const mat = keep(new THREE.MeshStandardMaterial({ color: night ? '#2c4a2a' : '#627f37', map: gt, roughness: 0.95 }));
    const m = new THREE.Mesh(toGeom(r), mat);
    m.receiveShadow = true;
    group.add(m);
    // 路边碎石带
    const r2 = ribbon();
    strip(r2, hw + 2.6, hw + 0.9, 0.0, 0.0, 6, 0, n, 0, 0.3);
    strip(r2, -hw - 0.9, -hw - 2.6, 0.0, 0.0, 6, 0, n, 0, 0.3);
    const ar = asphaltRoughness();
    const mat2 = keep(new THREE.MeshStandardMaterial({ color: '#8d8274', map: ar, roughness: 1 }));
    const m2 = new THREE.Mesh(toGeom(r2), mat2);
    m2.receiveShadow = true;
    group.add(m2);
  }

  // 路缘石（弯道处）
  {
    const r = ribbon();
    const isCorner = (i: number) => Math.abs(track.curv[i]) > 0.0042;
    let k = 0;
    while (k < n) {
      if (!isCorner(k)) {
        k++;
        continue;
      }
      let e = k;
      while (e < n + k && isCorner(e % n)) e++;
      const s = k - 6;
      const en = e + 6;
      strip(r, hw + 1.3, hw - 0.25, 0.03, 0.07, 8, s, en, 0, 1);
      strip(r, -hw + 0.25, -hw - 1.3, 0.07, 0.03, 8, s, en, 0, 1);
      k = e + 1;
    }
    const mat = keep(new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: 0.6 }));
    const m = new THREE.Mesh(toGeom(r), mat);
    m.receiveShadow = true;
    group.add(m);
  }

  // 护墙 + 防护网
  {
    const r = ribbon();
    const inner = (side: number) => {
      const base = r.pos.length / 3;
      let count = 0;
      for (let k = 0; k <= n; k++) {
        const i = k % n;
        const off = wall * side;
        const x = track.px[i] + leftX(i) * off;
        const z = track.pz[i] + leftZ(i) * off;
        const y = track.py[i];
        r.pos.push(x, y - 0.4, z, x, y + 1.05, z);
        // 右侧护墙从赛道内看是反向的，翻转 u 让文字正向
        const v = (cumulative(k) / 16) * side;
        r.uv.push(v, 0, v, 1);
        count++;
      }
      for (let k = 0; k < count - 1; k++) {
        const p = base + k * 2;
        if (side > 0) r.idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
        else r.idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
      }
    };
    inner(1);
    inner(-1);
    const bt = barrierTexture();
    const mat = keep(new THREE.MeshStandardMaterial({ map: bt, roughness: 0.55, side: THREE.DoubleSide, emissive: night ? '#ffffff' : '#000000', emissiveMap: night ? bt : null, emissiveIntensity: night ? 0.25 : 0 }));
    const m = new THREE.Mesh(toGeom(r), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);

    const f = ribbon();
    const fenceRow = (side: number) => {
      const base = f.pos.length / 3;
      let count = 0;
      for (let k = 0; k <= n; k++) {
        const i = k % n;
        const off = (wall + 0.15) * side;
        const x = track.px[i] + leftX(i) * off;
        const z = track.pz[i] + leftZ(i) * off;
        const y = track.py[i];
        f.pos.push(x, y + 1.05, z, x, y + 3.6, z);
        const v = cumulative(k) / 2.5;
        f.uv.push(v, 0, v, 1);
        count++;
      }
      for (let k = 0; k < count - 1; k++) {
        const p = base + k * 2;
        f.idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
      }
    };
    fenceRow(1);
    fenceRow(-1);
    const ft = fenceTexture();
    ft.repeat.set(1, 1);
    const fg = toGeom(f);
    // 纵向 uv：高度 2.55m -> 1 个重复
    const fmat = keep(new THREE.MeshStandardMaterial({ map: ft, alphaTest: 0.4, transparent: false, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4, color: '#c8ccd2' }));
    const fm = new THREE.Mesh(fg, fmat);
    group.add(fm);

    // 立柱（实例化）
    const postGeo = keep(new THREE.CylinderGeometry(0.05, 0.05, 2.7, 6));
    postGeo.translate(0, 1.35, 0);
    const postMat = keep(new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.8, roughness: 0.35 }));
    const every = Math.round(6 / track.step);
    const cnt = Math.ceil(n / every) * 2;
    const posts = new THREE.InstancedMesh(postGeo, postMat, cnt);
    const mtx = new THREE.Matrix4();
    let pi = 0;
    for (let i = 0; i < n; i += every) {
      for (const side of [1, -1]) {
        const off = (wall + 0.2) * side;
        mtx.makeTranslation(track.px[i] + leftX(i) * off, track.py[i] + 1.0, track.pz[i] + leftZ(i) * off);
        posts.setMatrixAt(pi++, mtx);
      }
    }
    posts.count = pi;
    group.add(posts);
  }

  // 起跑线（s=0）+ 发车格
  {
    const ct = checkerTexture();
    const g = keep(new THREE.PlaneGeometry(track.def.width, 1.6));
    const mat = keep(new THREE.MeshStandardMaterial({ map: ct, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    const m = new THREE.Mesh(g, mat);
    const p = track.pointAt(0, 0);
    m.position.set(p.x, p.y + 0.035, p.z);
    m.rotation.order = 'YXZ';
    m.rotation.set(-Math.PI / 2, track.headingAt(0), 0);
    m.receiveShadow = true;
    group.add(m);

    const gridMat = keep(new THREE.MeshBasicMaterial({ color: '#f2f2f2', transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }));
    const lineGeo = keep(new THREE.PlaneGeometry(3.2, 0.25));
    for (let slot = 0; slot < 8; slot++) {
      const s = -12 - slot * 9;
      const lat = slot % 2 === 0 ? 3.2 : -3.2;
      const q = track.pointAt(s + 2.6, lat);
      const l = new THREE.Mesh(lineGeo, gridMat);
      l.position.set(q.x, q.y + 0.03, q.z);
      l.rotation.order = 'YXZ';
      l.rotation.set(-Math.PI / 2, track.headingAt(s), 0);
      group.add(l);
    }
  }

  // ======================= 结构物 =======================
  const concrete = keep(new THREE.MeshStandardMaterial({ color: '#b9b6b0', roughness: 0.85 }));
  const darkMetal = keep(new THREE.MeshStandardMaterial({ color: '#2a2d33', metalness: 0.7, roughness: 0.4 }));
  const steel = keep(new THREE.MeshStandardMaterial({ color: '#d7dade', metalness: 0.85, roughness: 0.3 }));
  const lampMaterials: THREE.MeshStandardMaterial[] = [];

  /** 放置在赛道一侧的局部坐标系：local X 沿赛道方向，local Z 远离赛道 */
  function placeSide(obj: THREE.Object3D, s: number, lateral: number, yOffset = 0) {
    const p = track.pointAt(s, lateral);
    const psi = track.headingAt(s);
    obj.position.set(p.x, p.y + yOffset, p.z);
    obj.rotation.y = lateral < 0 ? psi - Math.PI / 2 : psi + Math.PI / 2;
    return obj;
  }

  // ---- 看台 ----
  const crowdColors = ['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#ffb703', '#fb8500', '#8ecae6', '#2a9d8f', '#e9c46a', '#ffffff', '#111111', '#d62828'].map((c) => new THREE.Color(c));
  function grandstand(len: number, rows: number, seed: number) {
    const gs = new THREE.Group();
    const rnd = mulberry(seed);
    const geos: THREE.BufferGeometry[] = [];
    for (let r = 0; r < rows; r++) {
      const b = new THREE.BoxGeometry(len, 0.5 * (r + 1), 0.9);
      b.translate(0, 0.25 * (r + 1), 1.5 + r * 0.9);
      geos.push(b);
    }
    const back = new THREE.BoxGeometry(len, rows * 0.5 + 4.5, 0.4);
    back.translate(0, (rows * 0.5 + 4.5) / 2, 1.5 + rows * 0.9 + 0.2);
    geos.push(back);
    const front = new THREE.BoxGeometry(len, 1.2, 0.3);
    front.translate(0, 0.6, 1.0);
    geos.push(front);
    const seatGeo = mergeGeometries(geos)!;
    geos.forEach((g) => g.dispose());
    const seats = new THREE.Mesh(keep(seatGeo), keep(new THREE.MeshStandardMaterial({ color: '#3b4452', roughness: 0.8 })));
    seats.castShadow = true;
    seats.receiveShadow = true;
    gs.add(seats);
    // 顶棚
    const roofGeo = keep(new THREE.BoxGeometry(len + 2, 0.3, rows * 0.9 + 3));
    const roof = new THREE.Mesh(roofGeo, keep(new THREE.MeshStandardMaterial({ color: '#e8e8ea', roughness: 0.4, metalness: 0.3 })));
    roof.position.set(0, rows * 0.5 + 4.6, 1.2 + (rows * 0.9) / 2);
    roof.rotation.x = -0.06;
    roof.castShadow = true;
    gs.add(roof);
    const colGeo = keep(new THREE.CylinderGeometry(0.18, 0.18, rows * 0.5 + 4.6, 8));
    for (let x = -len / 2 + 2; x <= len / 2 - 2; x += 12) {
      const c = new THREE.Mesh(colGeo, steel);
      c.position.set(x, (rows * 0.5 + 4.6) / 2, 1.5 + rows * 0.9);
      gs.add(c);
    }
    // 观众
    const person = keep(new THREE.BoxGeometry(0.46, 0.85, 0.32));
    person.translate(0, 0.42, 0);
    const perRow = Math.floor(len / 0.62);
    const crowd = new THREE.InstancedMesh(person, keep(new THREE.MeshStandardMaterial({ roughness: 0.9 })), perRow * rows);
    const m = new THREE.Matrix4();
    let c = 0;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < perRow; k++) {
        if (rnd() < 0.18) continue;
        const x = -len / 2 + 0.4 + k * 0.62 + (rnd() - 0.5) * 0.12;
        const h = 0.85 + rnd() * 0.3;
        m.makeScale(1, h, 1).setPosition(x, 0.5 * (r + 1), 1.5 + r * 0.9 + 0.1);
        crowd.setMatrixAt(c, m);
        crowd.setColorAt(c, crowdColors[Math.floor(rnd() * crowdColors.length)]);
        c++;
      }
    }
    crowd.count = c;
    crowd.castShadow = false;
    gs.add(crowd);
    // 顶棚广告
    const bannerTex = textTexture(
      [
        { text: 'APEX RUSH  ·  SUNSET COASTLINE GRAND PRIX', color: '#ffffff', font: 'italic 900 70px Arial Black, Arial', y: 64 },
      ],
      2048,
      128,
      '#c1121f',
    );
    keep(bannerTex);
    const banner = new THREE.Mesh(keep(new THREE.PlaneGeometry(len, 1.6)), keep(new THREE.MeshStandardMaterial({ map: bannerTex, emissive: '#ffffff', emissiveMap: bannerTex, emissiveIntensity: night ? 0.8 : 0.15 })));
    banner.position.set(0, rows * 0.5 + 4.0, 0.4 + 0.2);
    banner.rotation.y = Math.PI;
    gs.add(banner);
    return gs;
  }

  const L = track.length;
  group.add(placeSide(grandstand(130, 12, 3), 60, -(wall + 1.2)));
  group.add(placeSide(grandstand(110, 10, 5), L - 110, -(wall + 1.2)));

  // ---- 维修区大楼 ----
  {
    const pit = new THREE.Group();
    const len = 180;
    const body = new THREE.Mesh(keep(new THREE.BoxGeometry(len, 10, 18)), keep(new THREE.MeshStandardMaterial({ color: '#dfe3e8', roughness: 0.5, metalness: 0.2 })));
    body.position.set(0, 5, 11);
    body.castShadow = true;
    body.receiveShadow = true;
    pit.add(body);
    const wt = windowsTexture();
    wt.repeat.set(len / 32, 1);
    const glass = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(len - 4, 3.2)),
      keep(new THREE.MeshStandardMaterial({ map: wt, emissive: '#ffffff', emissiveMap: wt, emissiveIntensity: night ? 1.1 : 0.05, roughness: 0.15, metalness: 0.6 })),
    );
    glass.position.set(0, 7.2, 1.99);
    glass.rotation.y = Math.PI;
    pit.add(glass);
    // 车库门
    const doorMat = keep(new THREE.MeshStandardMaterial({ color: '#1c2129', emissive: '#ffe2b0', emissiveIntensity: night ? 0.35 : 0.0, roughness: 0.6 }));
    const doorGeo = keep(new THREE.PlaneGeometry(7, 4.2));
    for (let x = -len / 2 + 8; x < len / 2 - 4; x += 10) {
      const d = new THREE.Mesh(doorGeo, doorMat);
      d.position.set(x, 2.2, 1.98);
      d.rotation.y = Math.PI;
      pit.add(d);
    }
    const signTex = textTexture([{ text: 'APEX  RUSH', color: '#ffffff', font: 'italic 900 120px Arial Black, Arial', y: 96 }], 1024, 192, '#0d1117');
    keep(signTex);
    const sign = new THREE.Mesh(keep(new THREE.PlaneGeometry(40, 7.5)), keep(new THREE.MeshStandardMaterial({ map: signTex, emissive: '#ffffff', emissiveMap: signTex, emissiveIntensity: night ? 1.4 : 0.3 })));
    sign.position.set(0, 13.5, 3);
    sign.rotation.y = Math.PI;
    pit.add(sign);
    const signPole = new THREE.Mesh(keep(new THREE.BoxGeometry(40.5, 8, 0.5)), darkMetal);
    signPole.position.set(0, 13.5, 3.3);
    pit.add(signPole);
    group.add(placeSide(pit, 20, wall + 5));
  }

  // ---- 起跑龙门架 + 起跑灯 ----
  const startLights: THREE.MeshStandardMaterial[] = [];
  {
    const g = new THREE.Group();
    const span = track.def.width + 5;
    const pillarGeo = keep(new THREE.BoxGeometry(0.9, 8.5, 0.9));
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(pillarGeo, darkMetal);
      p.position.set(side * (span / 2), 4.25, 0);
      p.castShadow = true;
      g.add(p);
    }
    const beam = new THREE.Mesh(keep(new THREE.BoxGeometry(span + 1, 2.2, 1.2)), darkMetal);
    beam.position.set(0, 7.6, 0);
    beam.castShadow = true;
    g.add(beam);
    const ledTex = textTexture([{ text: 'START  ·  FINISH', color: '#ffffff', font: 'italic 900 110px Arial Black, Arial', y: 80 }], 1024, 160, '#000000');
    keep(ledTex);
    const ledMat = keep(new THREE.MeshStandardMaterial({ map: ledTex, emissive: '#ffffff', emissiveMap: ledTex, emissiveIntensity: 1.2 }));
    for (const dir of [1, -1]) {
      const led = new THREE.Mesh(keep(new THREE.PlaneGeometry(span - 2, 1.7)), ledMat);
      led.position.set(0, 7.6, dir * 0.61);
      if (dir < 0) led.rotation.y = Math.PI;
      g.add(led);
    }
    // 起跑灯：5 组，面向发车格（-Z 方向）
    const lightGeo = keep(new THREE.SphereGeometry(0.32, 16, 12));
    const housing = keep(new THREE.BoxGeometry(0.9, 1.9, 0.5));
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 1.3;
      const h = new THREE.Mesh(housing, darkMetal);
      h.position.set(x, 5.3, -0.4);
      g.add(h);
      const mat = keep(new THREE.MeshStandardMaterial({ color: '#220000', emissive: '#ff1a1a', emissiveIntensity: 0 }));
      startLights.push(mat);
      for (const y of [4.85, 5.75]) {
        const l = new THREE.Mesh(lightGeo, mat);
        l.position.set(x, y, -0.68);
        g.add(l);
      }
    }
    const p = track.pointAt(0, 0);
    g.position.set(p.x, p.y, p.z);
    // local X 为横跨赛道方向（左侧为正）；local Z 沿赛道前进方向
    g.rotation.y = track.headingAt(0);
    group.add(g);
  }

  // ---- 人行天桥（邓禄普桥风格） ----
  {
    let bestS = L * 0.62;
    let best = Infinity;
    for (let s = L * 0.55; s < L * 0.75; s += 5) {
      const c = Math.abs(track.curv[track.indexAt(s)]);
      if (c < best) {
        best = c;
        bestS = s;
      }
    }
    const g = new THREE.Group();
    const span = wall * 2 + 4;
    const archTex = textTexture([{ text: 'NITRO+  HIGH OCTANE', color: '#111111', font: 'italic 900 120px Arial Black, Arial', y: 96 }], 1536, 192, '#ffd400');
    keep(archTex);
    const deck = new THREE.Mesh(keep(new THREE.BoxGeometry(span, 2.6, 3.2)), [
      darkMetal,
      darkMetal,
      darkMetal,
      darkMetal,
      keep(new THREE.MeshStandardMaterial({ map: archTex, emissive: '#ffffff', emissiveMap: archTex, emissiveIntensity: night ? 0.7 : 0.05 })),
      keep(new THREE.MeshStandardMaterial({ map: archTex, emissive: '#ffffff', emissiveMap: archTex, emissiveIntensity: night ? 0.7 : 0.05 })),
    ]);
    deck.position.y = 8.2;
    deck.castShadow = true;
    g.add(deck);
    const legGeo = keep(new THREE.BoxGeometry(2.2, 8.2, 3.2));
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, concrete);
      leg.position.set(side * (span / 2 - 1.1), 4.1, 0);
      leg.castShadow = true;
      g.add(leg);
    }
    const p = track.pointAt(bestS, 0);
    g.position.set(p.x, p.y - 0.4, p.z);
    g.rotation.y = track.headingAt(bestS);
    group.add(g);
  }

  // ---- 灯塔 ----
  {
    const poleGeo = keep(new THREE.CylinderGeometry(0.18, 0.28, 16, 8));
    poleGeo.translate(0, 8, 0);
    const headGeo = keep(new THREE.BoxGeometry(3.2, 1.4, 0.5));
    const headMat = keep(new THREE.MeshStandardMaterial({ color: '#fdf6e3', emissive: '#fff4d6', emissiveIntensity: night ? 6 : 0.2 }));
    lampMaterials.push(headMat);
    const count = Math.floor(L / 85);
    const poles = new THREE.InstancedMesh(poleGeo, steel, count);
    const heads = new THREE.InstancedMesh(headGeo, headMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const glowPos: number[] = [];
    for (let k = 0; k < count; k++) {
      const s = k * 85 + 30;
      const side = k % 2 ? 1 : -1;
      const p = track.pointAt(s, side * (wall + 2.5));
      const psi = track.headingAt(s);
      m.makeTranslation(p.x, p.y, p.z);
      poles.setMatrixAt(k, m);
      e.set(side > 0 ? 0.35 : -0.35, psi + Math.PI / 2, 0, 'YXZ');
      e.set(0, psi, side > 0 ? -0.35 : 0.35, 'YXZ');
      q.setFromEuler(e);
      const hp = track.pointAt(s, side * (wall + 1.6));
      m.compose(new THREE.Vector3(hp.x, p.y + 16, hp.z), q, new THREE.Vector3(1, 1, 1));
      heads.setMatrixAt(k, m);
      glowPos.push(hp.x, p.y + 15.8, hp.z);
    }
    poles.castShadow = true;
    group.add(poles, heads);
    if (night) {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
      const pm = keep(new THREE.PointsMaterial({ map: glowTexture(), color: '#ffe9c4', size: 22, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
      group.add(new THREE.Points(keep(gg), pm));
    }
  }

  // ---- 广告牌 ----
  {
    const tA = billboardTextures();
    const tB = billboardTexture2();
    const legGeo = keep(new THREE.BoxGeometry(0.4, 6, 0.4));
    const boardGeo = keep(new THREE.PlaneGeometry(14, 7));
    const mats = [tA, tB].map((t) => keep(new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: night ? 0.9 : 0.12, roughness: 0.5 })));
    // 找到弯道入口，放在弯道外侧面向来车
    let placed = 0;
    let lastS = -1e9;
    for (let i = 0; i < n && placed < 10; i++) {
      const c = track.curv[i];
      const s = i * track.step;
      if (Math.abs(c) > 0.008 && s - lastS > 220) {
        const sb = s - 40;
        const side = c > 0 ? -1 : 1; // 弯道外侧
        const g = new THREE.Group();
        for (const x of [-5, 5]) {
          const leg = new THREE.Mesh(legGeo, darkMetal);
          leg.position.set(x, 3, 0);
          g.add(leg);
        }
        const b = new THREE.Mesh(boardGeo, mats[placed % 2]);
        b.position.set(0, 8.5, 0.25);
        const back = new THREE.Mesh(boardGeo, darkMetal);
        back.position.set(0, 8.5, 0.2);
        back.rotation.y = Math.PI;
        g.add(b, back);
        b.castShadow = true;
        const p = track.pointAt(sb, side * (wall + 12));
        g.position.set(p.x, groundHeight(p.x, p.z) - 0.5, p.z);
        // 面向来车方向（-切线）并稍微朝向赛道
        g.rotation.y = track.headingAt(sb) + Math.PI + side * 0.5;
        group.add(g);
        placed++;
        lastS = s;
      }
    }
  }

  // ======================= 树木 =======================
  {
    const rnd = mulberry(1234);
    const pine = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const trunk = new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6);
      trunk.translate(0, 1.2, 0);
      paint(trunk, '#5a3d2b');
      parts.push(trunk);
      for (let k = 0; k < 4; k++) {
        const r = 2.3 - k * 0.45;
        const cone = new THREE.ConeGeometry(r, 3.2 - k * 0.3, 8);
        cone.translate(0, 2.6 + k * 1.55, 0);
        paint(cone, k % 2 ? '#2f5d3a' : '#284f31');
        parts.push(cone);
      }
      const merged = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      return keep(merged);
    })();
    const broad = (() => {
      const trunk = new THREE.CylinderGeometry(0.2, 0.32, 2.8, 6);
      trunk.translate(0, 1.4, 0);
      paint(trunk, '#5b4331');
      const crown = new THREE.IcosahedronGeometry(2.4, 1);
      const p = crown.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const f = 0.8 + noise2(x * 1.3 + 5, z * 1.3 + y) * 0.45;
        p.setXYZ(i, x * f, y * f * 0.85, z * f);
      }
      crown.translate(0, 4.2, 0);
      const crownNI = crown.toNonIndexed();
      paint(crownNI, '#4d6e2e');
      const trunkNI = trunk.toNonIndexed();
      paint(trunkNI, '#5b4331');
      const merged = mergeGeometries([trunkNI, crownNI])!;
      merged.computeVertexNormals();
      return keep(merged);
    })();
    function paint(g: THREE.BufferGeometry, color: string) {
      const c = new THREE.Color(color);
      const cnt = g.attributes.position.count;
      const arr = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) {
        arr[i * 3] = c.r;
        arr[i * 3 + 1] = c.g;
        arr[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    const treeMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
    const target = opts.quality === 'high' ? 5200 : 2600;
    const pines: THREE.Matrix4[] = [];
    const broads: THREE.Matrix4[] = [];
    const colorsP: THREE.Color[] = [];
    const colorsB: THREE.Color[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let tries = 0;
    while (pines.length + broads.length < target && tries < target * 12) {
      tries++;
      const x = (rnd() * 2 - 1) * 1500;
      const z = -1500 + rnd() * 1700;
      const dens = fbm(x * 0.006 + 40, z * 0.006 - 13, 4);
      if (rnd() > smoothstep(0.38, 0.62, dens)) continue;
      // 远离赛道/建筑
      if (x > minX - PAD && x < maxX + PAD && z > minZ - PAD && z < maxZ + PAD) {
        const d = track.distanceInfo(x, z);
        if (d.dist < wall + 14) continue;
      }
      if (Math.abs(x) < 240 && z > -60 && z < 90) continue;
      const y = groundHeight(x, z);
      if (y < 1.5 || y > 170) continue;
      const s = 0.8 + rnd() * 0.9;
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      m.compose(new THREE.Vector3(x, y - 0.2, z), q, new THREE.Vector3(s, s * (0.85 + rnd() * 0.4), s));
      const tint = new THREE.Color().setHSL(0.22 + rnd() * 0.12, 0.35 + rnd() * 0.2, 0.62 + rnd() * 0.3);
      if (y > 40 || rnd() < 0.55) {
        pines.push(m.clone());
        colorsP.push(tint);
      } else {
        broads.push(m.clone());
        colorsB.push(tint);
      }
    }
    const mk = (geo: THREE.BufferGeometry, list: THREE.Matrix4[], cols: THREE.Color[]) => {
      const im = new THREE.InstancedMesh(geo, treeMat, list.length);
      list.forEach((mm, i) => {
        im.setMatrixAt(i, mm);
        im.setColorAt(i, cols[i]);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      return im;
    };
    group.add(mk(pine, pines, colorsP), mk(broad, broads, colorsB));
  }

  // ---- 云 ----
  if (!night) {
    const st = smokeTexture();
    const rnd = mulberry(99);
    for (let i = 0; i < 26; i++) {
      const mat = keep(new THREE.SpriteMaterial({ map: st, color: '#ffffff', transparent: true, opacity: 0.35 + rnd() * 0.3, depthWrite: false, fog: false }));
      const s = new THREE.Sprite(mat);
      const a = rnd() * Math.PI * 2;
      const r = 2200 + rnd() * 1400;
      s.position.set(Math.cos(a) * r, 380 + rnd() * 500, Math.sin(a) * r - 300);
      const sc = 600 + rnd() * 900;
      s.scale.set(sc, sc * 0.35, 1);
      s.renderOrder = -1;
      group.add(s);
    }
  }

  return {
    group,
    startLights,
    water,
    lampMaterials,
    groundHeight,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
