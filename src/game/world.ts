import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from './track';
import { getBiome } from './biome';
import { fbm, smoothstep, mulberry } from './noise';
import {
  asphaltTextures,
  asphaltRoughness,
  asphaltNormal,
  curbTexture,
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

export interface BiomeParticleAnim {
  points: THREE.Points;
  type: string;
  speed: number;
  drift: number;
  heightMin: number;
  heightMax: number;
  scatterRange: number;
}

export interface EruptionSystem {
  particles: THREE.Points;
  smoke: THREE.Points;
  bombs: THREE.Points;
  peak: THREE.Vector3;
}

export interface World {
  group: THREE.Group;
  startLights: THREE.MeshStandardMaterial[];
  water: THREE.Mesh;
  lampMaterials: THREE.MeshStandardMaterial[];
  groundHeight: (x: number, z: number) => number;
  biomeParticles: BiomeParticleAnim[];
  eruption: EruptionSystem | null;
  dispose: () => void;
}

export function buildWorld(track: Track, opts: { night: boolean; quality: 'high' | 'medium'; timeOfDay?: string }): World {
  const group = new THREE.Group();
  group.name = 'world';
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const n = track.count;
  const hw = track.halfWidth;
  const wall = track.wallOffset;
  const night = opts.night;
  const biome = getBiome(track.def.biome);

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

  const naturalHeight = biome.naturalHeight;

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
    const colors = biome.terrainColor(night);
    const cTmp = new THREE.Color();
    for (let k = 0; k < W * H; k++) {
      const x = pos[k * 3];
      const y = pos[k * 3 + 1];
      const z = pos[k * 3 + 2];
      const ny = nrm.getY(k);
      const v = fbm(x * 0.01, z * 0.01, 3);
      biome.paintTerrainVertex(cTmp, colors, x, y, z, ny, v);
      col[k * 3] = cTmp.r;
      col[k * 3 + 1] = cTmp.g;
      col[k * 3 + 2] = cTmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    keep(g);
    const gt = biome.terrainTexture();
    gt.repeat.set(1, 1);
    const mat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, map: gt, roughness: biome.terrainRoughness, metalness: 0 }));
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
      color: biome.waterColor(night),
      roughness: biome.waterRoughness,
      metalness: biome.waterMetalness,
      normalMap: biome.waterNormalMap ? wn : null,
      normalScale: biome.waterNormalMap ? new THREE.Vector2(0.35, 0.35) : new THREE.Vector2(0, 0),
      envMapIntensity: biome.waterEnvIntensity,
      clearcoat: biome.waterClearcoat,
      clearcoatRoughness: biome.waterClearcoat > 0 ? 0.1 : 1,
    }),
  );
  const water = new THREE.Mesh(keep(new THREE.PlaneGeometry(9000, 9000)), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = biome.waterLevel;
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
      new THREE.MeshPhysicalMaterial({
        map: at,
        roughnessMap: ar,
        roughness: night ? 0.58 : 0.8,
        normalMap: an,
        normalScale: new THREE.Vector2(0.55, 0.55),
        metalness: 0.04,
        clearcoat: night ? 0.32 : 0.18,
        clearcoatRoughness: 0.22,
        envMapIntensity: night ? 0.9 : 0.72,
      }),
    );
    const m = new THREE.Mesh(toGeom(r), mat);
    m.receiveShadow = true;
    m.name = 'road';
    group.add(m);

    if (biome.roadOverlay) {
      const overlay = biome.roadOverlay();
      const overlayTex = overlay.texture;
      overlayTex.repeat.set(4, 4);
      const overlayMat = keep(
        new THREE.MeshStandardMaterial({
          map: overlayTex,
          color: overlay.color,
          transparent: true,
          opacity: overlay.opacity,
          roughness: 0.85,
          metalness: 0,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        }),
      );
      const om = new THREE.Mesh(toGeom(r), overlayMat);
      om.name = 'road-overlay';
      group.add(om);
    }
  }

  // 路肩草地（路面边缘到护墙外）
  {
    const r = ribbon();
    strip(r, wall + 7, hw - 0.1, -0.06, -0.01, 9, 0, n, 0, (wall + 7 - hw) / 9);
    strip(r, -hw + 0.1, -wall - 7, -0.01, -0.06, 9, 0, n, 0, (wall + 7 - hw) / 9);
    const gt = biome.shoulderTexture();
    gt.needsUpdate = true;
    const mat = keep(new THREE.MeshStandardMaterial({ color: biome.shoulderColor(night), map: gt, roughness: 0.95 }));
    const m = new THREE.Mesh(toGeom(r), mat);
    m.receiveShadow = true;
    group.add(m);
    // 路边碎石带
    const r2 = ribbon();
    strip(r2, hw + 2.6, hw + 0.9, 0.0, 0.0, 6, 0, n, 0, 0.3);
    strip(r2, -hw - 0.9, -hw - 2.6, 0.0, 0.0, 6, 0, n, 0, 0.3);
    const ar = asphaltRoughness();
    const mat2 = keep(new THREE.MeshStandardMaterial({ color: biome.gravelColor, map: ar, roughness: 1 }));
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
    m.castShadow = false;
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
    obj.position.set(p.x, groundHeight(p.x, p.z) + yOffset, p.z);
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
    seats.castShadow = false;
    seats.receiveShadow = true;
    gs.add(seats);
    const roofGeo = keep(new THREE.BoxGeometry(len + 2, 0.3, rows * 0.9 + 3));
    const roof = new THREE.Mesh(roofGeo, keep(new THREE.MeshStandardMaterial({ color: '#e8e8ea', roughness: 0.4, metalness: 0.3 })));
    roof.position.set(0, rows * 0.5 + 4.6, 1.2 + (rows * 0.9) / 2);
    roof.rotation.x = -0.06;
    roof.castShadow = false;
    gs.add(roof);
    const colGeo = keep(new THREE.CylinderGeometry(0.18, 0.18, rows * 0.5 + 4.6, 8));
    for (let x = -len / 2 + 2; x <= len / 2 - 2; x += 12) {
      const c = new THREE.Mesh(colGeo, steel);
      c.position.set(x, (rows * 0.5 + 4.6) / 2, 1.5 + rows * 0.9);
      gs.add(c);
    }
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
    const bannerTex = textTexture(
      [
        { text: biome.bannerText, color: '#ffffff', font: 'italic 900 70px Arial Black, Arial', y: 64 },
      ],
      2048,
      128,
      biome.bannerBg,
    );
    keep(bannerTex);
    const banner = new THREE.Mesh(keep(new THREE.PlaneGeometry(len, 1.6)), keep(new THREE.MeshStandardMaterial({ map: bannerTex, emissive: '#ffffff', emissiveMap: bannerTex, emissiveIntensity: night ? 0.8 : 0.15 })));
    banner.position.set(0, rows * 0.5 + 4.0, 0.4 + 0.2);
    banner.rotation.y = Math.PI;
    gs.add(banner);
    return gs;
  }

  const L = track.length;
  const gsDefs = track.def.grandstands ?? [
    { s: 60, lateral: -1, len: 130, rows: 12, seed: 3 },
    { s: 0.9, lateral: -1, len: 110, rows: 10, seed: 5 },
  ];
  for (const gsd of gsDefs) {
    const gsS = gsd.s < 1 ? gsd.s * L : gsd.s;
    const gsLat = gsd.lateral * (wall + 8);
    group.add(placeSide(grandstand(gsd.len, gsd.rows, gsd.seed), gsS, gsLat));
  }

  // ---- 维修区大楼 ----
  {
    const pit = new THREE.Group();
    const len = 180;
    const body = new THREE.Mesh(keep(new THREE.BoxGeometry(len, 10, 18)), keep(new THREE.MeshStandardMaterial({ color: '#dfe3e8', roughness: 0.5, metalness: 0.2 })));
    body.position.set(0, 5, 11);
    body.castShadow = false;
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
    const pitDef = track.def.pit ?? { s: 20, lateral: 1 };
    const pitS = pitDef.s < 1 ? pitDef.s * L : pitDef.s;
    const pitLat = pitDef.lateral * (wall + 5);
    group.add(placeSide(pit, pitS, pitLat));
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
      p.castShadow = false;
      g.add(p);
    }
    const beam = new THREE.Mesh(keep(new THREE.BoxGeometry(span + 1, 2.2, 1.2)), darkMetal);
    beam.position.set(0, 7.6, 0);
    beam.castShadow = false;
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
    deck.castShadow = false;
    g.add(deck);
    const legGeo = keep(new THREE.BoxGeometry(2.2, 8.2, 3.2));
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, concrete);
      leg.position.set(side * (span / 2 - 1.1), 4.1, 0);
      leg.castShadow = false;
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
    const headMat = keep(new THREE.MeshStandardMaterial({ color: biome.lampColor, emissive: biome.lampEmissive, emissiveIntensity: biome.lampIntensity(night) }));
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
    poles.castShadow = false;
    group.add(poles, heads);
    if (night) {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
      const pm = keep(new THREE.PointsMaterial({ map: glowTexture(), color: biome.lampEmissive, size: 22, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
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
    let placed = 0;
    let lastS = -1e9;
    for (let i = 0; i < n && placed < 10; i++) {
      const c = track.curv[i];
      const s = i * track.step;
      if (Math.abs(c) > 0.008 && s - lastS > 220) {
        const sb = s - 40;
        const side = c > 0 ? -1 : 1;
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
        b.castShadow = false;
        const p = track.pointAt(sb, side * (wall + 12));
        g.position.set(p.x, groundHeight(p.x, p.z) - 0.5, p.z);
        g.rotation.y = track.headingAt(sb) + Math.PI + side * 0.5;
        group.add(g);
        placed++;
        lastS = s;
      }
    }
  }

  // ======================= 植被 =======================
  {
    const veg = biome.vegetation(night);
    const rnd = mulberry(1234);
    const treeMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
    const target = opts.quality === 'high' ? veg.density.high : veg.density.medium;
    const lists = veg.geos.map(() => [] as THREE.Matrix4[]);
    const colorLists = veg.geos.map(() => [] as THREE.Color[]);
    const m = new THREE.Matrix4();
    const q2 = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let tries = 0;
    const totalTarget = target;
    const totalCount = () => lists.reduce((s, l) => s + l.length, 0);
    while (totalCount() < totalTarget && tries < totalTarget * 14) {
      tries++;
      const x = (rnd() * 2 - 1) * veg.scatterRange;
      const z = veg.scatterZBase + rnd() * veg.scatterZRange;
      const dens = fbm(x * veg.densityNoiseScale + veg.densityNoiseOffset, z * veg.densityNoiseScale - 13, 4);
      if (rnd() > smoothstep(0.32 + veg.densityThreshold, 0.62 + veg.densityThreshold, dens)) continue;
      if (x > minX - PAD && x < maxX + PAD && z > minZ - PAD && z < maxZ + PAD) {
        const d = track.distanceInfo(x, z);
        if (d.dist < wall + 14) continue;
      }
      if (veg.placementSkip && veg.placementSkip(x, z)) continue;
      const y = groundHeight(x, z);
      if (y < veg.heightRange[0] || y > veg.heightRange[1]) continue;
      const s = 0.7 + rnd() * 1.1;
      q2.setFromAxisAngle(up, rnd() * Math.PI * 2);
      m.compose(new THREE.Vector3(x, y + veg.groundOffset, z), q2, new THREE.Vector3(s, s * (0.8 + rnd() * 0.5), s));
      const tint = new THREE.Color().setHSL(
        veg.colorHue + rnd() * veg.colorHueVar,
        veg.colorSat + rnd() * veg.colorSatVar,
        veg.colorLgt + rnd() * veg.colorLgtVar,
      );
      const idx = rnd() < 0.6 ? 0 : Math.min(1, veg.geos.length - 1);
      lists[idx].push(m.clone());
      colorLists[idx].push(tint);
    }
    const mk = (geoIdx: number) => {
      const geo = veg.geos[geoIdx];
      const list = lists[geoIdx];
      const cols = colorLists[geoIdx];
      if (list.length === 0) return null;
      const im = new THREE.InstancedMesh(geo, treeMat, list.length);
      list.forEach((mm, i) => {
        im.setMatrixAt(i, mm);
        im.setColorAt(i, cols[i]);
      });
      im.castShadow = false;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      return im;
    };
    for (let i = 0; i < veg.geos.length; i++) {
      const im = mk(i);
      if (im) group.add(im);
    }
  }

  // ---- 群系粒子 ----
  const biomeParticles: BiomeParticleAnim[] = [];
  const particleDefs = typeof biome.particles === 'function' ? biome.particles(opts.timeOfDay ?? 'sunset') : biome.particles;
  const isBlizzard = opts.timeOfDay === 'blizzard';
  const isVolcanic = opts.timeOfDay === 'volcanic';
  if (particleDefs && particleDefs.length > 0) {
    const rnd = mulberry(777);
    const scatterR = isBlizzard ? 120 : isVolcanic ? 200 : 300;
    for (const pd of particleDefs) {
      const count = pd.count;
      const positions = new Float32Array(count * 3);
      const aPhase = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = (rnd() * 2 - 1) * scatterR;
        positions[i * 3 + 1] = pd.heightMin + rnd() * (pd.heightMax - pd.heightMin);
        positions[i * 3 + 2] = (rnd() * 2 - 1) * scatterR;
        aPhase[i] = rnd() * 6.28;
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      pg.setAttribute('aPhase', new THREE.Float32BufferAttribute(aPhase, 1));
      const pm = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSpeed: { value: pd.speed },
          uDrift: { value: pd.drift },
          uHMin: { value: pd.heightMin },
          uHMax: { value: pd.heightMax },
          uColor: { value: new THREE.Color(pd.color) },
          uSize: { value: pd.size },
          uOpacity: { value: pd.opacity },
          uRange: { value: scatterR },
          uPlayerX: { value: 0 },
          uPlayerZ: { value: 0 },
          uWindX: { value: 0 },
          uWindZ: { value: 0 },
          uRising: { value: pd.type === 'ember' ? 1.0 : 0.0 },
          uGlow: { value: pd.type === 'ember' ? 1.0 : 0.0 },
        },
        vertexShader: `
          attribute float aPhase;
          uniform float uTime;
          uniform float uSpeed;
          uniform float uDrift;
          uniform float uHMin;
          uniform float uHMax;
          uniform float uSize;
          uniform float uRange;
          uniform float uPlayerX;
          uniform float uPlayerZ;
          varying float vAlpha;
          uniform float uWindX;
          uniform float uWindZ;
          uniform float uRising;
          varying float vAlpha;
          varying float vGlow;
          uniform float uGlow;
          void main() {
            vec3 pos = position;
            float h = uHMax - uHMin;
            float r2 = uRange * 2.0;
            float seed = fract(aPhase * 0.1591);
            float spd = uSpeed * (0.5 + seed * 1.0);
            float drft = uDrift * (0.3 + fract(aPhase * 0.2917) * 1.4);
            float t = uTime + aPhase * 6.0;
            float isBlizzard = step(8.0, uDrift);
            float fall = mod(t * spd * 0.3, h);
            pos.y = uRising > 0.5 ? uHMin + fall : uHMax - fall;
            pos.x += uWindX * mod(t * spd, r2) * isBlizzard + sin(t * 0.6 + aPhase * 3.0) * drft * (1.0 - isBlizzard);
            pos.z += uWindZ * mod(t * spd * 0.7, r2) * isBlizzard + cos(t * 0.4 + aPhase * 2.0) * drft * 0.7 * (1.0 - isBlizzard);
            pos.x = uPlayerX + mod(pos.x - uPlayerX + uRange, uRange * 2.0) - uRange;
            pos.z = uPlayerZ + mod(pos.z - uPlayerZ + uRange, uRange * 2.0) - uRange;
            vAlpha = smoothstep(uHMin, uHMin + 3.0, pos.y) * smoothstep(uHMax, uHMax - 2.0, pos.y);
            vGlow = uGlow;
            vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPos;
            float dist = -mvPos.z;
            float sizeVar = 0.6 + seed * 0.8;
            gl_PointSize = uSize * sizeVar * (200.0 / max(dist, 1.0));
            gl_PointSize = clamp(gl_PointSize, 1.0, 60.0);
            float fogFade = 1.0 - smoothstep(40.0, 200.0, dist);
            vAlpha *= fogFade;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vAlpha;
          varying float vGlow;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            if (d > 1.0) discard;
            float a = (1.0 - d * d) * vAlpha;
            vec3 col = uColor;
            if (vGlow > 0.5) {
              float core = 1.0 - d * d;
              col = mix(col, vec3(1.0, 0.85, 0.4), core * 0.6);
            }
            gl_FragColor = vec4(col, a * uOpacity);
          }
        `,
        transparent: true,
        depthWrite: false,
      });
      const pts = new THREE.Points(keep(pg), pm);
      pts.name = `particles-${pd.type}`;
      pts.frustumCulled = false;
      group.add(pts);
      biomeParticles.push({
        points: pts,
        type: pd.type,
        speed: pd.speed,
        drift: pd.drift,
        heightMin: pd.heightMin,
        heightMax: pd.heightMax,
        scatterRange: scatterR,
      });
    }
  }

  // ---- 群系地标 ----
  if (biome.landmarks) {
    const lmDefs = biome.landmarks(night);
    const rnd = mulberry(42);
    for (const lm of lmDefs) {
      const im = new THREE.InstancedMesh(lm.geo, lm.mat, lm.count);
      const mtx = new THREE.Matrix4();
      const up = new THREE.Vector3(0, 1, 0);
      const q2 = new THREE.Quaternion();
      let placed = 0;
      let tries = 0;
      while (placed < lm.count && tries < lm.count * 50) {
        tries++;
        const s = rnd() * L;
        const side = rnd() < 0.5 ? 1 : -1;
        const latDist = wall + lm.minDistFromWall + rnd() * (lm.maxDistFromWall - lm.minDistFromWall);
        const p = track.pointAt(s, side * latDist);
        const y = groundHeight(p.x, p.z);
        if (!isFinite(y)) continue;
        const psi = track.headingAt(s);
        q2.setFromAxisAngle(up, psi + (rnd() - 0.5) * 0.8);
        const sc = 0.8 + rnd() * 0.6;
        mtx.compose(
          new THREE.Vector3(p.x, y + lm.yOffset, p.z),
          q2,
          new THREE.Vector3(sc, sc * lm.scaleY, sc),
        );
        im.setMatrixAt(placed, mtx);
        placed++;
      }
      im.count = placed;
      im.castShadow = false;
      group.add(im);
    }
  }

  // ---- 火山 + 喷发 ----
  let eruption: EruptionSystem | null = null;
  const vDef = biome.volcano;
  if (vDef) {
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      const p = track.pointAt((i / n) * L, 0);
      cx += p.x; cz += p.z;
    }
    cx /= n; cz /= n;
    const vx = cx + vDef.offsetX;
    const vz = cz + vDef.offsetZ;
    const peakY = groundHeight(vx, vz) + vDef.height;
    const peak = new THREE.Vector3(vx, peakY, vz);

    // 火山体 — 程序化山体，不对称轮廓 + 冲沟 + 熔岩流
    const h = vDef.height;
    const br = vDef.baseRadius;
    const cr = vDef.craterRadius;
    const segments = 64;
    const rings = 28;

    const ridgeNoise = (angle: number, hn: number) => {
      const ridge1 = Math.abs(Math.sin(angle * 3 + 0.7)) * 0.12;
      const ridge2 = Math.abs(Math.sin(angle * 7 + 2.1)) * 0.04;
      const gully = -Math.pow(Math.abs(Math.sin(angle * 5 + 1.3)), 8) * 0.15;
      const fbmVal = fbm(Math.cos(angle) * 3 + 5.3, Math.sin(angle) * 3 + 8.1, 3) * 0.1;
      return (ridge1 + ridge2 + gully + fbmVal) * (1 - hn * 0.6);
    };

    const profile = (hn: number) => {
      return 1 - Math.pow(hn, 0.7);
    };

    const asymmetry = (angle: number) => {
      return 1 + Math.sin(angle + 0.5) * 0.2 + Math.cos(angle * 2 + 1.2) * 0.08;
    };

    // 火山口缺口方向 — 一侧低，熔岩从那里流出
    const breachAngle = 0.8;
    const breachWidth = 0.6;
    const breachDepth = 0.18;
    const rimJagged = (angle: number) => {
      const j1 = fbm(Math.cos(angle) * 8 + 1.1, Math.sin(angle) * 8 + 3.7, 3) * 0.08;
      const j2 = Math.abs(Math.sin(angle * 11 + 0.3)) * 0.04;
      return j1 + j2;
    };
    const breachFactor = (angle: number) => {
      const d = Math.abs(((angle - breachAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
      return smoothstep(breachWidth, 0, d);
    };

    const volcanoVerts: number[] = [];
    const volcanoCols: number[] = [];
    const cBase = new THREE.Color(night ? '#1a1008' : '#3a2818');
    const cMid = new THREE.Color(night ? '#0a0604' : '#2a1a0e');
    const cUpper = new THREE.Color(night ? '#1a0e06' : '#4a2a14');
    const cRim = new THREE.Color(night ? '#2a0a04' : '#5a2a10');
    const cLava = new THREE.Color(night ? '#3a0800' : '#6a2a08');
    const cInner = new THREE.Color(night ? '#1a0a04' : '#3a1a0a');
    const cScorch = new THREE.Color(night ? '#0e0604' : '#2a1810');
    const tmpC = new THREE.Color();

    for (let ring = 0; ring <= rings; ring++) {
      const hn = ring / rings;

      for (let seg = 0; seg <= segments; seg++) {
        const angle = (seg / segments) * Math.PI * 2;
        const rn = ridgeNoise(angle, hn);
        const asymR = asymmetry(angle);
        const bf = breachFactor(angle);

        let r: number;
        let vertY: number;

        if (hn < 0.78) {
          // 山坡
          r = profile(hn) * br * asymR * (1 + rn);
          vertY = hn * h;
        } else if (hn < 0.86) {
          // 上部过渡 — 略微内收，形成肩部
          const t = (hn - 0.78) / 0.08;
          const shoulderR = profile(0.78) * br * asymR * (1 + rn);
          const rimR = cr * (1.6 + rimJagged(angle)) * asymR;
          r = shoulderR * (1 - t) + rimR * t;
          vertY = hn * h;
          // 缺口处压低
          vertY -= bf * breachDepth * h * t;
        } else if (hn < 0.90) {
          // 火山口缘 — 锯齿状起伏
          const t = (hn - 0.86) / 0.04;
          const rimR = cr * (1.6 + rimJagged(angle)) * asymR;
          const innerR = cr * (1.0 + fbm(Math.cos(angle) * 6 + 2.2, Math.sin(angle) * 6 + 4.1, 2) * 0.15) * asymR;
          r = rimR * (1 - t) + innerR * t;
          vertY = 0.86 * h + (1 - t) * h * 0.05 * (1 + rimJagged(angle) * 3);
          // 缺口处大幅压低，形成豁口
          vertY -= bf * breachDepth * h * 1.5;
          // 缺口处半径扩大
          r += bf * cr * 0.5;
        } else if (hn < 0.96) {
          // 火山口内壁 — 粗糙阶梯状
          const t = (hn - 0.90) / 0.06;
          const innerR = cr * (1.0 + fbm(Math.cos(angle) * 6 + 2.2, Math.sin(angle) * 6 + 4.1, 2) * 0.15) * asymR;
          const floorR = cr * (0.2 + fbm(Math.cos(angle) * 4 + 7.7, Math.sin(angle) * 4 + 1.3, 2) * 0.15) * asymR;
          // 内壁台阶 — 不均匀收缩
          const stepNoise = fbm(Math.cos(angle) * 10 + 5.5, t * 3 + 2.2, 2) * 0.2;
          r = innerR * (1 - t) + floorR * t + stepNoise * cr;
          // 内壁深度 — 不规则凹陷
          const wallDepth = 0.90 * h - t * h * 0.1;
          const wallNoise = fbm(Math.cos(angle) * 5 + 3.3, t * 5 + 1.1, 2) * h * 0.03;
          vertY = wallDepth + wallNoise;
          // 缺口方向内壁更浅
          vertY += bf * h * 0.06 * (1 - t);
        } else {
          // 火山口底 — 不平坦，有高低
          const t = (hn - 0.96) / 0.04;
          const floorR = cr * (0.2 + fbm(Math.cos(angle) * 4 + 7.7, Math.sin(angle) * 4 + 1.3, 2) * 0.15) * asymR;
          r = floorR * (1 - t * 0.3);
          const floorBase = 0.80 * h;
          const floorNoise = fbm(Math.cos(angle) * 3 + 1.1, Math.sin(angle) * 3 + 6.6, 2) * h * 0.02;
          vertY = floorBase + floorNoise;
          // 缺口侧更低，熔岩池偏向
          vertY -= bf * h * 0.03;
        }

        r = Math.max(0.1, r);
        const vx2 = Math.cos(angle) * r;
        const vz2 = Math.sin(angle) * r;
        volcanoVerts.push(vx2, vertY, vz2);

        // 上色
        if (hn < 0.78) {
          tmpC.copy(cBase);
          tmpC.lerp(cMid, smoothstep(0.2, 0.5, hn));
          tmpC.lerp(cUpper, smoothstep(0.5, 0.75, hn));
          const lavaStreak = fbm(Math.cos(angle) * 2 + 9.1, hn * 5 + 3.3, 2);
          if (lavaStreak > 0.15 && hn > 0.5) {
            tmpC.lerp(cLava, smoothstep(0.15, 0.45, lavaStreak) * smoothstep(0.5, 0.85, hn) * 0.7);
          }
          const gullyFactor = Math.pow(Math.abs(Math.sin(angle * 5 + 1.3)), 4);
          if (gullyFactor > 0.3 && hn < 0.7) {
            tmpC.lerp(cLava, gullyFactor * 0.4 * smoothstep(0.8, 0.3, hn));
          }
        } else if (hn < 0.86) {
          tmpC.copy(cUpper);
          tmpC.lerp(cRim, smoothstep(0.78, 0.86, hn));
          const scorch = bf * 0.8;
          tmpC.lerp(cScorch, scorch);
        } else if (hn < 0.90) {
          tmpC.copy(cRim);
          tmpC.lerp(cInner, 0.3);
          const rimGlow = rimJagged(angle) * 3;
          tmpC.lerp(cLava, Math.min(1, rimGlow) * 0.4);
          tmpC.lerp(cScorch, bf * 0.6);
        } else if (hn < 0.96) {
          tmpC.copy(cInner);
          const lavaPatch = fbm(Math.cos(angle) * 4 + 2.7, Math.sin(angle) * 4 + 5.3, 2);
          tmpC.lerp(cLava, smoothstep(0.2, 0.5, lavaPatch) * 0.6);
          // 缺口方向内壁更多熔岩痕迹
          tmpC.lerp(cLava, bf * 0.3);
        } else {
          tmpC.copy(cLava);
          // 缺口侧更深色（更厚的熔岩）
          const depth = bf * 0.4;
          const darkLava = new THREE.Color(night ? '#2a0500' : '#551a04');
          tmpC.lerp(darkLava, depth);
        }
        volcanoCols.push(tmpC.r, tmpC.g, tmpC.b);
      }
    }

    const indices: number[] = [];
    for (let ring = 0; ring < rings; ring++) {
      for (let seg = 0; seg < segments; seg++) {
        const a = ring * (segments + 1) + seg;
        const b = a + 1;
        const c2 = a + segments + 1;
        const d = c2 + 1;
        indices.push(a, c2, b, b, c2, d);
      }
    }

    const volcanoGeo = new THREE.BufferGeometry();
    volcanoGeo.setAttribute('position', new THREE.Float32BufferAttribute(volcanoVerts, 3));
    volcanoGeo.setAttribute('color', new THREE.Float32BufferAttribute(volcanoCols, 3));
    volcanoGeo.setIndex(indices);
    volcanoGeo.computeVertexNormals();
    const volcanoGeoNI = volcanoGeo.toNonIndexed();
    volcanoGeo.dispose();

    const volcanoMat = keep(new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.05,
    }));
    const volcanoMesh = new THREE.Mesh(keep(volcanoGeoNI), volcanoMat);
    volcanoMesh.position.set(vx, groundHeight(vx, vz), vz);
    volcanoMesh.castShadow = false;
    group.add(volcanoMesh);

    // 火山口熔岩池
    const lavaDisc = new THREE.CircleGeometry(cr * 0.5, 24);
    lavaDisc.rotateX(-Math.PI / 2);
    lavaDisc.translate(0, h * 0.79, 0);
    const lavaDiscNI = lavaDisc.toNonIndexed();
    lavaDisc.dispose();
    const lavaGlowMat = keep(new THREE.MeshStandardMaterial({
      color: night ? '#ff2a00' : '#ff4a10',
      emissive: '#ff2a00',
      emissiveIntensity: night ? 4 : 1.5,
      roughness: 0.6,
    }));
    const lavaGlowMesh = new THREE.Mesh(keep(lavaDiscNI), lavaGlowMat);
    lavaGlowMesh.position.set(vx, groundHeight(vx, vz), vz);
    group.add(lavaGlowMesh);

    // ---- 喷发粒子 ----
    const eruptCount = 2500;
    const eruptPos = new Float32Array(eruptCount * 3);
    const eruptPhase = new Float32Array(eruptCount);
    const eruptSpeed = new Float32Array(eruptCount);
    const eruptAngle = new Float32Array(eruptCount);
    const eruptLife = new Float32Array(eruptCount);
    const eRnd = mulberry(321);
    for (let i = 0; i < eruptCount; i++) {
      eruptPos[i * 3] = 0;
      eruptPos[i * 3 + 1] = 0;
      eruptPos[i * 3 + 2] = 0;
      eruptPhase[i] = eRnd();
      eruptSpeed[i] = 15 + eRnd() * 25;
      eruptAngle[i] = eRnd() * Math.PI * 2;
      eruptLife[i] = 3 + eRnd() * 4;
    }
    const eruptGeo = new THREE.BufferGeometry();
    eruptGeo.setAttribute('position', new THREE.Float32BufferAttribute(eruptPos, 3));
    eruptGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(eruptPhase, 1));
    eruptGeo.setAttribute('aSpeed', new THREE.Float32BufferAttribute(eruptSpeed, 1));
    eruptGeo.setAttribute('aAngle', new THREE.Float32BufferAttribute(eruptAngle, 1));
    eruptGeo.setAttribute('aLife', new THREE.Float32BufferAttribute(eruptLife, 1));
    const eruptMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOrigin: { value: peak },
        uGravity: { value: 9.8 },
        uSize: { value: 2.5 },
        uOpacity: { value: 0.7 },
      },
      vertexShader: `
        attribute float aPhase;
        attribute float aSpeed;
        attribute float aAngle;
        attribute float aLife;
        uniform float uTime;
        uniform vec3 uOrigin;
        uniform float uGravity;
        uniform float uSize;
        varying float vAge;
        varying float vAlpha;
        void main() {
          float t = mod(uTime + aPhase * aLife, aLife);
          float age = t / aLife;
          vAge = age;
          float hSpread = 0.35;
          vec3 vel = vec3(cos(aAngle) * aSpeed * hSpread, aSpeed, sin(aAngle) * aSpeed * hSpread);
          vec3 pos = uOrigin + vel * t;
          pos.y -= uGravity * t * t * 0.5;
          if (pos.y < uOrigin.y - 5.0) pos.y = uOrigin.y - 5.0;
          vAlpha = smoothstep(0.0, 0.04, age) * smoothstep(1.0, 0.65, age);
          vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPos;
          float dist = -mvPos.z;
          float sizeVar = 0.5 + aPhase * 1.0;
          gl_PointSize = uSize * sizeVar * (300.0 / max(dist, 1.0));
          gl_PointSize = clamp(gl_PointSize, 1.0, 80.0);
          float fogFade = 1.0 - smoothstep(80.0, 400.0, dist);
          vAlpha *= fogFade;
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying float vAge;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          vec3 hotColor = vec3(1.0, 0.9, 0.4);
          vec3 warmColor = vec3(1.0, 0.4, 0.05);
          vec3 coolColor = vec3(0.35, 0.12, 0.05);
          vec3 darkColor = vec3(0.15, 0.1, 0.08);
          vec3 col;
          float a1 = smoothstep(0.0, 0.15, vAge);
          float a2 = smoothstep(0.15, 0.4, vAge);
          float a3 = smoothstep(0.4, 1.0, vAge);
          col = mix(hotColor, warmColor, a1);
          col = mix(col, coolColor, a2);
          col = mix(col, darkColor, a3);
          float core = 1.0 - d * d;
          col = mix(col, hotColor, core * 0.4 * (1.0 - vAge));
          float a = (1.0 - d * d) * vAlpha * uOpacity;
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    const eruptPts = new THREE.Points(keep(eruptGeo), eruptMat);
    eruptPts.name = 'eruption-particles';
    eruptPts.frustumCulled = false;
    group.add(eruptPts);

    // ---- 浓烟柱（三层：口缘黑烟 + 中层灰烟翻滚 + 高空白云扩散）----
    const smokeCount = 1200;
    const smokePos = new Float32Array(smokeCount * 3);
    const smokePhase = new Float32Array(smokeCount);
    const smokeSpeed = new Float32Array(smokeCount);
    const smokeAngle = new Float32Array(smokeCount);
    const smokeLife = new Float32Array(smokeCount);
    const smokeLayer = new Float32Array(smokeCount);
    const sRnd = mulberry(654);
    for (let i = 0; i < smokeCount; i++) {
      smokePos[i * 3] = 0;
      smokePos[i * 3 + 1] = 0;
      smokePos[i * 3 + 2] = 0;
      const layer = i < 400 ? 0 : i < 800 ? 1 : 2;
      smokePhase[i] = sRnd();
      if (layer === 0) {
        smokeSpeed[i] = 12 + sRnd() * 10;
        smokeLife[i] = 3 + sRnd() * 3;
      } else if (layer === 1) {
        smokeSpeed[i] = 6 + sRnd() * 6;
        smokeLife[i] = 5 + sRnd() * 5;
      } else {
        smokeSpeed[i] = 3 + sRnd() * 4;
        smokeLife[i] = 8 + sRnd() * 6;
      }
      smokeAngle[i] = sRnd() * Math.PI * 2;
      smokeLayer[i] = layer;
    }
    const smokeGeo = new THREE.BufferGeometry();
    smokeGeo.setAttribute('position', new THREE.Float32BufferAttribute(smokePos, 3));
    smokeGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(smokePhase, 1));
    smokeGeo.setAttribute('aSpeed', new THREE.Float32BufferAttribute(smokeSpeed, 1));
    smokeGeo.setAttribute('aAngle', new THREE.Float32BufferAttribute(smokeAngle, 1));
    smokeGeo.setAttribute('aLife', new THREE.Float32BufferAttribute(smokeLife, 1));
    smokeGeo.setAttribute('aLayer', new THREE.Float32BufferAttribute(smokeLayer, 1));
    const smokeOrigin = peak.clone().add(new THREE.Vector3(0, 5, 0));
    const smokeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOrigin: { value: smokeOrigin },
        uWindX: { value: 2.0 },
        uWindZ: { value: 1.0 },
        uSize: { value: 40.0 },
        uOpacity: { value: 0.55 },
      },
      vertexShader: `
        attribute float aPhase;
        attribute float aSpeed;
        attribute float aAngle;
        attribute float aLife;
        attribute float aLayer;
        uniform float uTime;
        uniform vec3 uOrigin;
        uniform float uWindX;
        uniform float uWindZ;
        uniform float uSize;
        varying float vAge;
        varying float vAlpha;
        varying float vLayer;
        void main() {
          float t = mod(uTime + aPhase * aLife, aLife);
          float age = t / aLife;
          vAge = age;
          vLayer = aLayer;
          vec3 pos = uOrigin;
          float rise = aSpeed * t;
          pos.y += rise;
          float drift = aSpeed * 0.3;
          float windDrift = uWindX * t * 0.5;
          if (aLayer < 0.5) {
            // 层0：口缘黑烟柱 — 紧凑上升，小扩散
            float spread = 1.0 + age * 1.2;
            pos.x += cos(aAngle) * drift * t * 0.3 * spread;
            pos.z += sin(aAngle) * drift * t * 0.3 * spread;
            pos.x += windDrift * 0.2;
            pos.z += uWindZ * t * 0.5 * 0.2;
            vAlpha = smoothstep(0.0, 0.03, age) * smoothstep(1.0, 0.3, age) * 1.0;
          } else if (aLayer < 1.5) {
            // 层1：中层灰烟 — 翻滚扩散
            float expand = 1.0 + age * 3.5;
            float tumble = sin(t * 2.0 + aPhase * 12.0) * age * 8.0;
            pos.x += cos(aAngle) * drift * t * expand + tumble * cos(aAngle + 1.57);
            pos.z += sin(aAngle) * drift * t * expand + tumble * sin(aAngle + 1.57);
            pos.x += windDrift * 0.6;
            pos.z += uWindZ * t * 0.5 * 0.6;
            vAlpha = smoothstep(0.0, 0.08, age) * smoothstep(1.0, 0.45, age) * 0.7;
          } else {
            // 层2：高空白云 — 大范围飘散
            float expand = 1.0 + age * 6.0;
            float meander = sin(t * 0.8 + aPhase * 8.0) * age * 15.0;
            pos.x += cos(aAngle) * drift * t * expand * 2.0 + meander;
            pos.z += sin(aAngle) * drift * t * expand * 2.0 + cos(aPhase * 5.0) * age * 10.0;
            pos.x += windDrift * 1.2;
            pos.z += uWindZ * t * 0.5 * 1.2;
            vAlpha = smoothstep(0.0, 0.12, age) * smoothstep(1.0, 0.5, age) * 0.4;
          }
          vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPos;
          float dist = -mvPos.z;
          float sizeVar;
          if (aLayer < 0.5) {
            sizeVar = 0.8 + aPhase * 0.6;
          } else if (aLayer < 1.5) {
            sizeVar = 1.0 + aPhase * 1.2;
          } else {
            sizeVar = 1.5 + aPhase * 2.0;
          }
          float expandScale = aLayer < 0.5 ? 1.0 + age * 1.5 : aLayer < 1.5 ? 1.0 + age * 3.5 : 1.0 + age * 6.0;
          gl_PointSize = uSize * sizeVar * expandScale * (300.0 / max(dist, 1.0));
          gl_PointSize = clamp(gl_PointSize, 2.0, 300.0);
          float fogFade = 1.0 - smoothstep(120.0, 600.0, dist);
          vAlpha *= fogFade;
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying float vAge;
        varying float vAlpha;
        varying float vLayer;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float soft = 1.0 - d * d;
          vec3 col;
          if (vLayer < 0.5) {
            // 黑烟 — 深灰棕，口缘强烈橙红内发光
            col = mix(vec3(0.10, 0.06, 0.04), vec3(0.22, 0.14, 0.09), vAge * 0.6);
            float innerGlow = (1.0 - vAge) * 0.7;
            col += vec3(0.8, 0.25, 0.03) * innerGlow;
          } else if (vLayer < 1.5) {
            // 灰烟翻滚
            col = mix(vec3(0.18, 0.12, 0.08), vec3(0.35, 0.28, 0.22), vAge * 0.5);
            col += vec3(0.3, 0.08, 0.02) * (1.0 - vAge) * 0.25;
          } else {
            // 高空白云
            col = mix(vec3(0.30, 0.24, 0.20), vec3(0.50, 0.44, 0.40), vAge * 0.4);
          }
          float a = soft * vAlpha * uOpacity;
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    const smokePts = new THREE.Points(keep(smokeGeo), smokeMat);
    smokePts.name = 'eruption-smoke';
    smokePts.frustumCulled = false;
    smokePts.renderOrder = -1;
    group.add(smokePts);

    // ---- 火山弹 ----
    const bombCount = 25;
    const bombPos = new Float32Array(bombCount * 3);
    const bombPhase = new Float32Array(bombCount);
    const bombSpeed = new Float32Array(bombCount);
    const bombAngle = new Float32Array(bombCount);
    const bombLife = new Float32Array(bombCount);
    const bRnd = mulberry(987);
    for (let i = 0; i < bombCount; i++) {
      bombPos[i * 3] = 0;
      bombPos[i * 3 + 1] = 0;
      bombPos[i * 3 + 2] = 0;
      bombPhase[i] = bRnd();
      bombSpeed[i] = 25 + bRnd() * 20;
      bombAngle[i] = bRnd() * Math.PI * 2;
      bombLife[i] = 4 + bRnd() * 3;
    }
    const bombGeo = new THREE.BufferGeometry();
    bombGeo.setAttribute('position', new THREE.Float32BufferAttribute(bombPos, 3));
    bombGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(bombPhase, 1));
    bombGeo.setAttribute('aSpeed', new THREE.Float32BufferAttribute(bombSpeed, 1));
    bombGeo.setAttribute('aAngle', new THREE.Float32BufferAttribute(bombAngle, 1));
    bombGeo.setAttribute('aLife', new THREE.Float32BufferAttribute(bombLife, 1));
    const bombMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOrigin: { value: peak },
        uGravity: { value: 9.8 },
        uSize: { value: 8.0 },
        uOpacity: { value: 0.9 },
      },
      vertexShader: `
        attribute float aPhase;
        attribute float aSpeed;
        attribute float aAngle;
        attribute float aLife;
        uniform float uTime;
        uniform vec3 uOrigin;
        uniform float uGravity;
        uniform float uSize;
        varying float vAge;
        varying float vAlpha;
        void main() {
          float t = mod(uTime + aPhase * aLife, aLife);
          float age = t / aLife;
          vAge = age;
          float hSpread = 0.6;
          vec3 vel = vec3(cos(aAngle) * aSpeed * hSpread, aSpeed * 0.8, sin(aAngle) * aSpeed * hSpread);
          vec3 pos = uOrigin + vel * t;
          pos.y -= uGravity * t * t * 0.5;
          if (pos.y < uOrigin.y - 5.0) pos.y = uOrigin.y - 5.0;
          vAlpha = smoothstep(0.0, 0.03, age) * smoothstep(1.0, 0.7, age);
          vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPos;
          float dist = -mvPos.z;
          gl_PointSize = uSize * (300.0 / max(dist, 1.0));
          gl_PointSize = clamp(gl_PointSize, 2.0, 100.0);
          float fogFade = 1.0 - smoothstep(80.0, 400.0, dist);
          vAlpha *= fogFade;
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying float vAge;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          vec3 hotColor = vec3(1.0, 0.85, 0.3);
          vec3 warmColor = vec3(1.0, 0.35, 0.05);
          vec3 col = mix(hotColor, warmColor, smoothstep(0.0, 0.5, vAge));
          float core = 1.0 - d * d;
          col = mix(col, vec3(1.0, 1.0, 0.8), core * 0.5 * (1.0 - vAge));
          float a = (1.0 - d * d) * vAlpha * uOpacity;
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    const bombPts = new THREE.Points(keep(bombGeo), bombMat);
    bombPts.name = 'volcanic-bombs';
    bombPts.frustumCulled = false;
    group.add(bombPts);

    eruption = { particles: eruptPts, smoke: smokePts, bombs: bombPts, peak };
  }

  // ---- 云 ----
  if (!night) {
    const st = smokeTexture();
    const rnd = mulberry(99);
    for (let i = 0; i < biome.cloudCount; i++) {
      const mat = keep(new THREE.SpriteMaterial({ map: st, color: biome.cloudColor(night), transparent: true, opacity: 0.35 + rnd() * 0.3, depthWrite: false, fog: false }));
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
    biomeParticles,
    eruption,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
