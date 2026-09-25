import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CarDef } from './cars';

export const WHEEL_KEYS = ['FL', 'FR', 'RL', 'RR'] as const;
export type WheelKey = (typeof WHEEL_KEYS)[number];

export interface PreparedCar {
  template: THREE.Group;
  wheelRadius: number;
  wheelBase: number;
  track: number;
  length: number;
  width: number;
  height: number;
  hasWheels: boolean;
  paintMaterials: THREE.MeshStandardMaterial[];
}

export interface CarInstance {
  root: THREE.Group;
  body: THREE.Group;
  wheels: Record<WheelKey, { steer: THREE.Group; spin: THREE.Group } | null>;
  paint: THREE.MeshStandardMaterial[];
  brakeMats: THREE.MeshStandardMaterial[];
  headMats: THREE.MeshStandardMaterial[];
  info: PreparedCar;
  flipY: number;
}

const cache = new Map<string, PreparedCar>();

function materialNames(m: THREE.Mesh): string[] {
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  return mats.map((x) => x?.name ?? '');
}

function matches(obj: THREE.Object3D, stop: THREE.Object3D, re?: RegExp): boolean {
  if (!re) return false;
  if ((obj as THREE.Mesh).isMesh && materialNames(obj as THREE.Mesh).some((n) => re.test(n))) return true;
  let o: THREE.Object3D | null = obj;
  while (o && o !== stop) {
    if (re.test(o.name)) return true;
    o = o.parent;
  }
  return false;
}

const tmpV = new THREE.Vector3();

/**
 * 把一个原始模型整理为统一格式：
 *  - 车头朝 +Z，车长归一化到真实尺寸，车底贴地
 *  - 轮胎网格按四个象限拆分，挂到 steer/spin 两级 pivot 上，便于转向和滚动
 *  - 材质增强（车漆清漆层、环境反射）
 */
export function prepareCar(def: CarDef, source: THREE.Object3D): PreparedCar {
  const hit = cache.get(def.id);
  if (hit) return hit;
  const t0 = performance.now();

  const scene = skeletonClone(source) as THREE.Object3D;
  const root = new THREE.Group();
  root.name = 'car-root';
  const body = new THREE.Group();
  body.name = 'car-body';
  root.add(body);
  body.add(scene);

  // 删除需要隐藏的网格
  scene.updateMatrixWorld(true);
  const toRemove: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && matches(o, scene, def.hideMatch)) toRemove.push(o);
  });
  toRemove.forEach((o) => o.removeFromParent());

  if (def.flip) body.rotation.y = Math.PI;
  root.updateMatrixWorld(true);
  // 只做一次逐顶点精确包围盒，后续尺寸直接换算
  const box0 = new THREE.Box3().setFromObject(root, true);
  const size0 = box0.getSize(new THREE.Vector3());
  const s = def.length / size0.z;
  body.scale.setScalar(s);
  const c0 = box0.getCenter(new THREE.Vector3());
  scene.position.set(def.flip ? c0.x : -c0.x, -c0.y, def.flip ? c0.z : -c0.z);
  body.position.set(0, (c0.y - box0.min.y) * s, 0);
  root.updateMatrixWorld(true);
  let box = new THREE.Box3(new THREE.Vector3(-size0.x * s * 0.5, 0, -size0.z * s * 0.5), new THREE.Vector3(size0.x * s * 0.5, size0.y * s, size0.z * s * 0.5));

  // ---------- 拆分轮子 ----------
  const wheelMeshes: THREE.Mesh[] = [];
  const hubMeshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (matches(m, root, def.wheelMatch)) wheelMeshes.push(m);
    else if (matches(m, root, def.hubMatch)) hubMeshes.push(m);
  });

  type Part = { mesh: THREE.Mesh; quad: number; index: number[] };
  const parts: Part[] = [];
  const quadBoxes = [0, 1, 2, 3].map(() => new THREE.Box3());
  const all = new THREE.Box3();
  wheelMeshes.forEach((m) => all.expandByObject(m, true));
  const midZ = (all.min.z + all.max.z) / 2;
  const quadOf = (x: number, z: number) => (z > midZ ? 0 : 2) + (x > 0 ? 0 : 1); // 0 FL(+x) ... 模型坐标 +X 为车辆左侧

  const splitMesh = (m: THREE.Mesh, out: Part[], boxes?: THREE.Box3[]) => {
    const g = m.geometry as THREE.BufferGeometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const mw = m.matrixWorld;
    const world: THREE.Vector3[] = new Array(pos.count);
    for (let i = 0; i < pos.count; i++) world[i] = tmpV.fromBufferAttribute(pos, i).applyMatrix4(mw).clone();
    const lists: number[][] = [[], [], [], []];
    for (let t = 0; t < triCount; t++) {
      const a = idx ? idx.getX(t * 3) : t * 3;
      const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const cc = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const cx = (world[a].x + world[b].x + world[cc].x) / 3;
      const cz = (world[a].z + world[b].z + world[cc].z) / 3;
      const q = quadOf(cx, cz);
      lists[q].push(a, b, cc);
      if (boxes) {
        boxes[q].expandByPoint(world[a]);
        boxes[q].expandByPoint(world[b]);
        boxes[q].expandByPoint(world[cc]);
      }
    }
    lists.forEach((l, q) => l.length && out.push({ mesh: m, quad: q, index: l }));
  };

  wheelMeshes.forEach((m) => splitMesh(m, parts, quadBoxes));
  const hubParts: Part[] = [];
  hubMeshes.forEach((m) => splitMesh(m, hubParts));

  const hasWheels = parts.length > 0 && quadBoxes.every((b) => !b.isEmpty());
  let wheelRadius = 0.34;
  let wheelBase = 2.6;
  let trackW = 1.6;
  if (hasWheels) {
    const centers = quadBoxes.map((b) => b.getCenter(new THREE.Vector3()));
    // 半径取轮胎高度的一半
    wheelRadius = quadBoxes.reduce((acc, b) => acc + (b.max.y - b.min.y) / 2, 0) / 4;
    wheelBase = (centers[0].z + centers[1].z) / 2 - (centers[2].z + centers[3].z) / 2;
    trackW = (centers[0].x - centers[1].x + centers[2].x - centers[3].x) / 2;

    const pivots = centers.map((cc, q) => {
      const steer = new THREE.Group();
      steer.name = `wheel_${WHEEL_KEYS[q]}`;
      steer.position.copy(cc);
      const spin = new THREE.Group();
      spin.name = 'spin';
      steer.add(spin);
      root.add(steer);
      return { steer, spin, center: cc };
    });
    const attach = (list: Part[], spinning: boolean) => {
      for (const p of list) {
        const pv = pivots[p.quad];
        const g = new THREE.BufferGeometry();
        const src = p.mesh.geometry as THREE.BufferGeometry;
        for (const k of Object.keys(src.attributes)) g.setAttribute(k, src.attributes[k]);
        g.setIndex(p.index);
        g.computeBoundingSphere();
        g.computeBoundingBox();
        const nm = new THREE.Mesh(g, p.mesh.material);
        nm.matrixAutoUpdate = false;
        nm.matrix.makeTranslation(-pv.center.x, -pv.center.y, -pv.center.z).multiply(p.mesh.matrixWorld);
        nm.castShadow = true;
        (spinning ? pv.spin : pv.steer).add(nm);
      }
    };
    attach(parts, true);
    attach(hubParts, false);
    [...wheelMeshes, ...hubMeshes].forEach((m) => m.removeFromParent());
  }

  // ---------- 材质增强 ----------
  const paintMaterials: THREE.MeshStandardMaterial[] = [];
  const seen = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = false;
    m.frustumCulled = !(m as THREE.SkinnedMesh).isSkinnedMesh;
    const upgrade = (mat: THREE.Material): THREE.Material => {
      const cached = seen.get(mat);
      if (cached) return cached;
      let out = mat;
      const std = mat as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial) {
        const isPaint = def.paintMatch ? def.paintMatch.test(mat.name) : false;
        if (isPaint && !(std as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
          const phys = new THREE.MeshPhysicalMaterial();
          THREE.MeshStandardMaterial.prototype.copy.call(phys, std);
          phys.clearcoat = 1;
          phys.clearcoatRoughness = 0.04;
          phys.roughness = Math.min(phys.roughness, 0.35);
          phys.metalness = Math.max(phys.metalness, 0.55);
          out = phys;
        } else if (isPaint) {
          const phys = std as THREE.MeshPhysicalMaterial;
          phys.clearcoat = Math.max(phys.clearcoat, 1);
          phys.clearcoatRoughness = 0.04;
        }
        if (isPaint) paintMaterials.push(out as THREE.MeshStandardMaterial);
        (out as THREE.MeshStandardMaterial).envMapIntensity = 1.15;
      }
      seen.set(mat, out);
      return out;
    };
    m.material = Array.isArray(m.material) ? m.material.map(upgrade) : upgrade(m.material);
  });

  const sz = box.getSize(new THREE.Vector3());
  const prepared: PreparedCar = {
    template: root,
    wheelRadius,
    wheelBase,
    track: trackW,
    length: sz.z,
    width: sz.x,
    height: sz.y,
    hasWheels,
    paintMaterials,
  };
  cache.set(def.id, prepared);
  if (import.meta.env.DEV) console.info(`[car] ${def.id} prepared in ${(performance.now() - t0).toFixed(0)}ms`, prepared);
  return prepared;
}

/** 基于已整理模板创建一个实例（共享几何体，车漆/车灯材质按需复制） */
export function instantiateCar(def: CarDef, prep: PreparedCar, opts: { paint?: string } = {}): CarInstance {
  const root = skeletonClone(prep.template) as THREE.Group;
  const body = root.getObjectByName('car-body') as THREE.Group;
  const paint: THREE.MeshStandardMaterial[] = [];
  const brakeMats: THREE.MeshStandardMaterial[] = [];
  const headMats: THREE.MeshStandardMaterial[] = [];
  const map = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const isRear = matches(m, root, def.rearLightMatch);
    const isHead = matches(m, root, def.headLightMatch);
    const swap = (mat: THREE.Material) => {
      const isPaint = opts.paint && prep.paintMaterials.includes(mat as THREE.MeshStandardMaterial);
      if (!isPaint && !isRear && !isHead) return mat;
      let c = map.get(mat) as THREE.MeshStandardMaterial | undefined;
      if (!c) {
        c = mat.clone() as THREE.MeshStandardMaterial;
        map.set(mat, c);
        if (isPaint) paint.push(c);
        if (isRear && c.isMeshStandardMaterial) {
          if (!c.emissiveMap) c.emissive.set('#ff1010');
          c.userData.baseEmissive = c.emissiveIntensity;
          brakeMats.push(c);
        }
        if (isHead && c.isMeshStandardMaterial) {
          if (!c.emissiveMap) c.emissive.set('#fff3dd');
          c.userData.baseEmissive = c.emissiveIntensity;
          headMats.push(c);
        }
      }
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
  });
  if (opts.paint) paint.forEach((p) => p.color.set(opts.paint!));
  const wheels = {} as CarInstance['wheels'];
  WHEEL_KEYS.forEach((k) => {
    const steer = root.getObjectByName(`wheel_${k}`) as THREE.Group | undefined;
    wheels[k] = steer ? { steer, spin: steer.getObjectByName('spin') as THREE.Group } : null;
  });
  return { root, body, wheels, paint, brakeMats, headMats, info: prep, flipY: def.flip ? Math.PI : 0 };
}

/** 设置车灯亮度：brake 0~1，head 0~1 */
export function setCarLights(inst: CarInstance, brake: number, tail: number, head: number) {
  for (const m of inst.brakeMats) m.emissiveIntensity = tail * 1.2 + brake * 5;
  for (const m of inst.headMats) m.emissiveIntensity = head * 6;
}
