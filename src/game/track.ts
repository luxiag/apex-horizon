import * as THREE from 'three';

export interface TrackDef {
  id: string;
  name: string;
  subtitle: string;
  location: string;
  points: [number, number, number][]; // x, y(高度), z
  width: number;
  runoff: number; // 路缘到护墙的距离
  description: string;
}

export const TRACKS: TrackDef[] = [
  {
    id: 'coastline',
    name: '落日海岸',
    subtitle: 'SUNSET COASTLINE GP',
    location: '太平洋海岸 · 加州',
    width: 15,
    runoff: 9,
    description: '依山傍海的高速赛道。长直道尽头接高速弯，中段的发卡弯和连续 S 弯考验走线，山顶盲弯后一路下坡冲回终点。',
    points: [
      [0, 0, 0],
      [200, 0, 0],
      [370, 0.5, -12],
      [465, 3, -90],
      [482, 6, -200],
      [425, 10, -292],
      [325, 13, -318],
      [258, 14, -258],
      [282, 14, -172],
      [236, 12.5, -108],
      [142, 9.5, -118],
      [62, 7.5, -182],
      [-40, 6.5, -222],
      [-160, 9, -262],
      [-282, 14.5, -302],
      [-402, 18, -282],
      [-472, 15, -202],
      [-438, 10.5, -132],
      [-500, 6, -72],
      [-468, 2, -12],
      [-320, 0, 0],
      [-160, 0, 0],
    ],
  },
];

export const trackById = (id: string) => TRACKS.find((t) => t.id === id) ?? TRACKS[0];

export interface TrackProjection {
  index: number;
  s: number; // 沿赛道距离
  lateral: number; // 左正右负
  height: number;
}

/**
 * 赛道：沿中心线等距采样，提供投影、高度、曲率、AI 目标速度等查询
 */
export class Track {
  def: TrackDef;
  curve: THREE.CatmullRomCurve3;
  length: number;
  count: number;
  step: number;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  tx: Float32Array; // 水平切线
  tz: Float32Array;
  ty: Float32Array; // 坡度（dy/ds）
  curv: Float32Array; // 带符号曲率（左弯为正）
  aiSpeed: Float32Array; // AI 最大速度 m/s
  racingLine: Float32Array; // 走线横向偏移
  halfWidth: number;
  wallOffset: number;
  private grid = new Map<number, number[]>();
  private cell = 24;

  constructor(def: TrackDef) {
    this.def = def;
    const pts = def.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.length = this.curve.getLength();
    this.count = Math.round(this.length / 1.5);
    this.step = this.length / this.count;
    const n = this.count;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.ty = new Float32Array(n);
    this.curv = new Float32Array(n);
    this.aiSpeed = new Float32Array(n);
    this.racingLine = new Float32Array(n);
    this.halfWidth = def.width / 2;
    this.wallOffset = this.halfWidth + def.runoff;

    const sp = this.curve.getSpacedPoints(n);
    for (let i = 0; i < n; i++) {
      this.px[i] = sp[i].x;
      this.py[i] = sp[i].y;
      this.pz[i] = sp[i].z;
    }
    // 高度平滑
    const smooth = (arr: Float32Array, r: number, passes: number) => {
      for (let p = 0; p < passes; p++) {
        const copy = arr.slice();
        for (let i = 0; i < n; i++) {
          let s = 0;
          for (let k = -r; k <= r; k++) s += copy[(i + k + n) % n];
          arr[i] = s / (2 * r + 1);
        }
      }
    };
    smooth(this.py, 6, 3);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      let dx = this.px[b] - this.px[a];
      let dz = this.pz[b] - this.pz[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      this.tx[i] = dx;
      this.tz[i] = dz;
      this.ty[i] = (this.py[b] - this.py[a]) / (2 * this.step);
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n;
      const b = (i + 2) % n;
      const a1 = Math.atan2(this.tx[a], this.tz[a]);
      const a2 = Math.atan2(this.tx[b], this.tz[b]);
      let d = a2 - a1;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.curv[i] = d / (4 * this.step);
    }
    smooth(this.curv, 4, 2);

    // 走线：弯心内切，入弯前外侧
    const look = Math.round(40 / this.step);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      let w = 0;
      for (let k = -look; k <= look; k++) {
        const wt = 1 - Math.abs(k) / (look + 1);
        acc += this.curv[(i + k + n) % n] * wt;
        w += wt;
      }
      const c = acc / w;
      this.racingLine[i] = THREE.MathUtils.clamp(c * 900, -1, 1) * (this.halfWidth - 2.6);
    }
    smooth(this.racingLine, 10, 3);

    // AI 速度曲线
    const mu = 1.25;
    const g = 9.81;
    for (let i = 0; i < n; i++) {
      const k = Math.abs(this.curv[i]);
      this.aiSpeed[i] = Math.min(95, Math.sqrt((mu * g) / Math.max(k, 1e-4)));
    }
    const decel = 11;
    for (let pass = 0; pass < 2; pass++) {
      for (let j = n * 2; j >= 0; j--) {
        const i = j % n;
        const nx = (i + 1) % n;
        const lim = Math.sqrt(this.aiSpeed[nx] ** 2 + 2 * decel * this.step);
        if (this.aiSpeed[i] > lim) this.aiSpeed[i] = lim;
      }
    }

    for (let i = 0; i < n; i++) {
      const key = this.key(this.px[i], this.pz[i]);
      let arr = this.grid.get(key);
      if (!arr) this.grid.set(key, (arr = []));
      arr.push(i);
    }
  }

  private key(x: number, z: number) {
    const cx = Math.floor(x / this.cell) + 1000;
    const cz = Math.floor(z / this.cell) + 1000;
    return cx * 4096 + cz;
  }

  /** 最近采样点（全局搜索，使用网格加速） */
  nearestIndex(x: number, z: number, maxRadiusCells = 6): number {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = -1;
    let bd = Infinity;
    for (let r = 0; r <= maxRadiusCells; r++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        for (let iz = cz - r; iz <= cz + r; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue;
          const arr = this.grid.get((ix + 1000) * 4096 + (iz + 1000));
          if (!arr) continue;
          for (const i of arr) {
            const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
        }
      }
      if (best >= 0 && r >= 1) break;
    }
    if (best < 0) {
      for (let i = 0; i < this.count; i++) {
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    }
    return best;
  }

  /** 以 hint 为起点的局部搜索 */
  localIndex(x: number, z: number, hint: number, range = 24): number {
    const n = this.count;
    let best = hint;
    let bd = Infinity;
    for (let k = -range; k <= range; k++) {
      const i = (hint + k + n) % n;
      const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  project(x: number, z: number, hint = -1, out?: TrackProjection): TrackProjection {
    const i = hint < 0 ? this.nearestIndex(x, z) : this.localIndex(x, z, hint);
    const n = this.count;
    const dx = x - this.px[i];
    const dz = z - this.pz[i];
    const along = dx * this.tx[i] + dz * this.tz[i];
    // 车头朝 +Z 时左侧为 +X，因此左法线 = (tz, -tx)
    const lateral = dx * this.tz[i] - dz * this.tx[i];
    const j = along >= 0 ? (i + 1) % n : (i - 1 + n) % n;
    const f = Math.min(1, Math.abs(along) / this.step);
    const height = this.py[i] + (this.py[j] - this.py[i]) * f;
    let s = i * this.step + along;
    if (s < 0) s += this.length;
    if (s >= this.length) s -= this.length;
    const o = out ?? { index: 0, s: 0, lateral: 0, height: 0 };
    o.index = i;
    o.s = s;
    o.lateral = lateral;
    o.height = height;
    return o;
  }

  /** 按沿线距离与横向偏移取世界坐标 */
  pointAt(s: number, lateral = 0, out = new THREE.Vector3()) {
    const n = this.count;
    let u = (((s % this.length) + this.length) % this.length) / this.step;
    const i = Math.floor(u) % n;
    const j = (i + 1) % n;
    u -= Math.floor(u);
    const x = this.px[i] + (this.px[j] - this.px[i]) * u;
    const z = this.pz[i] + (this.pz[j] - this.pz[i]) * u;
    const y = this.py[i] + (this.py[j] - this.py[i]) * u;
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * u;
    const tz = this.tz[i] + (this.tz[j] - this.tz[i]) * u;
    const l = Math.hypot(tx, tz) || 1;
    out.set(x + (tz / l) * lateral, y, z - (tx / l) * lateral);
    return out;
  }

  headingAt(s: number) {
    const i = Math.floor((((s % this.length) + this.length) % this.length) / this.step) % this.count;
    return Math.atan2(this.tx[i], this.tz[i]);
  }

  indexAt(s: number) {
    return Math.floor((((s % this.length) + this.length) % this.length) / this.step) % this.count;
  }

  /** 距离赛道中心线的水平距离（用于地形），附近没有赛道时 dist = Infinity */
  distanceInfo(x: number, z: number) {
    const i = this.nearestIndexNoFallback(x, z, 8);
    if (i < 0) return { index: -1, dist: Infinity, height: 0 };
    const dx = x - this.px[i];
    const dz = z - this.pz[i];
    return { index: i, dist: Math.hypot(dx, dz), height: this.py[i] };
  }

  private nearestIndexNoFallback(x: number, z: number, maxR: number) {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = -1;
    let bd = Infinity;
    for (let r = 0; r <= maxR; r++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        for (let iz = cz - r; iz <= cz + r; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue;
          const arr = this.grid.get((ix + 1000) * 4096 + (iz + 1000));
          if (!arr) continue;
          for (const i of arr) {
            const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
        }
      }
      // 找到后再多扩一圈确保正确
      if (best >= 0 && r * this.cell > Math.sqrt(bd) + this.cell) break;
    }
    return best;
  }
}

const trackCache = new Map<string, Track>();
export function getTrack(id: string) {
  let t = trackCache.get(id);
  if (!t) {
    t = new Track(trackById(id));
    trackCache.set(id, t);
  }
  return t;
}
