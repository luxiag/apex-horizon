// 轻量 2D 值噪声 / FBM，确定性
function hash(x: number, y: number) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h & 0xffffff) / 0xffffff;
}

export function noise2(x: number, y: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash(x0, y0);
  const b = hash(x0 + 1, y0);
  const c = hash(x0, y0 + 1);
  const d = hash(x0 + 1, y0 + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

export function fbm(x: number, y: number, oct = 5) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  let t = 0;
  for (let i = 0; i < oct; i++) {
    v += noise2(x * f, y * f) * a;
    t += a;
    a *= 0.5;
    f *= 2.03;
  }
  return v / t;
}

export function ridged(x: number, y: number, oct = 5) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  let t = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(noise2(x * f, y * f) * 2 - 1);
    v += n * n * a;
    t += a;
    a *= 0.5;
    f *= 2.1;
  }
  return v / t;
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
