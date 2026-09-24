import * as THREE from 'three';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function tex(c: HTMLCanvasElement, repeat = true, srgb = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// 可平铺值噪声
function makeNoise(size: number, octaves: number, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = 4 << o;
    const grid = new Float32Array(cells * cells).map(() => rnd());
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells;
        const gy = (y / size) * cells;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const fx = gx - x0;
        const fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const g = (ix: number, iy: number) => grid[((iy % cells) * cells + (ix % cells)) | 0];
        const v = (g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx) * (1 - sy) + (g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx) * sy;
        out[y * size + x] += v * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

const cache: Record<string, THREE.Texture> = {};
const memo = <T extends THREE.Texture>(k: string, f: () => T): T => (cache[k] ??= f()) as T;

/** 沥青：u 横跨路面（0..1），v 沿赛道方向重复 */
export const asphaltTextures = () =>
  memo('asphalt', () => {
    const W = 512;
    const H = 1024;
    const [c, g] = canvas(W, H);
    const n = makeNoise(256, 6, 7);
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const nv = n[((y % 256) * 256 + ((x * 2) % 256)) | 0];
        const grain = Math.random() * 26 - 13;
        // 走线处轮胎橡胶痕迹更深
        const u = x / W;
        const worn = Math.exp(-(((u - 0.5) / 0.18) ** 2)) * 10;
        const v = 58 + nv * 34 + grain - worn;
        const i = (y * W + x) * 4;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v + 3;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // 白色边线
    g.fillStyle = 'rgba(235,235,230,0.92)';
    const lw = W * 0.022;
    g.fillRect(W * 0.025, 0, lw, H);
    g.fillRect(W - W * 0.025 - lw, 0, lw, H);
    // 细小裂缝/补丁
    g.strokeStyle = 'rgba(20,20,20,0.35)';
    for (let i = 0; i < 18; i++) {
      g.lineWidth = 1 + Math.random() * 1.5;
      g.beginPath();
      let x = Math.random() * W;
      let y = Math.random() * H;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (Math.random() - 0.5) * 40;
        y += Math.random() * 30;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(30,30,32,${0.15 + Math.random() * 0.15})`;
      g.fillRect(Math.random() * W, Math.random() * H, 40 + Math.random() * 80, 30 + Math.random() * 90);
    }
    const t = tex(c);
    return t;
  });

export const asphaltRoughness = () =>
  memo('asphaltR', () => {
    const [c, g] = canvas(256, 256);
    const img = g.createImageData(256, 256);
    const n = makeNoise(256, 5, 3);
    for (let i = 0; i < 256 * 256; i++) {
      const v = 150 + n[i] * 80 + Math.random() * 30;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return tex(c, true, false);
  });

export const asphaltNormal = () =>
  memo('asphaltN', () => {
    const S = 256;
    const [c, g] = canvas(S, S);
    const h = new Float32Array(S * S).map(() => Math.random());
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const hx = h[y * S + ((x + 1) % S)] - h[y * S + ((x - 1 + S) % S)];
        const hy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
        const i = (y * S + x) * 4;
        img.data[i] = 128 - hx * 60;
        img.data[i + 1] = 128 - hy * 60;
        img.data[i + 2] = 255;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    return tex(c, true, false);
  });

export const curbTexture = () =>
  memo('curb', () => {
    const [c, g] = canvas(64, 256);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#f2f2f2' : '#d1181f';
      g.fillRect(0, i * 64, 64, 64);
    }
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, 0, 6, 256);
    return tex(c);
  });

export const grassTexture = () =>
  memo('grass', () => {
    const S = 512;
    const [c, g] = canvas(S, S);
    const n = makeNoise(S, 7, 11);
    const img = g.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const v = n[i];
      const r = Math.random() * 0.25;
      img.data[i * 4] = 200 + (v - 0.5) * 90 + r * 40;
      img.data[i * 4 + 1] = 210 + (v - 0.5) * 70 + r * 40;
      img.data[i * 4 + 2] = 190 + (v - 0.5) * 70 + r * 30;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return tex(c);
  });

export const checkerTexture = () =>
  memo('checker', () => {
    const [c, g] = canvas(256, 64);
    const s = 16;
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 16; x++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        g.fillRect(x * s, y * s, s, s);
      }
    return tex(c, false);
  });

export const barrierTexture = () =>
  memo('barrier', () => {
    const [c, g] = canvas(1024, 128);
    const ads = [
      ['#e10600', '#fff', 'APEX'],
      ['#111', '#ffd400', 'VELOCITÀ'],
      ['#0a3cff', '#fff', 'NITRO+'],
      ['#f4f4f4', '#111', 'HORIZON'],
    ];
    ads.forEach(([bg, fg, txt], i) => {
      g.fillStyle = bg;
      g.fillRect(i * 256, 0, 256, 128);
      g.fillStyle = fg;
      g.font = 'italic 900 64px Arial Black, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(txt, i * 256 + 128, 68);
    });
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 118, 1024, 10);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(0, 0, 1024, 4);
    return tex(c);
  });

export const fenceTexture = () =>
  memo('fence', () => {
    const [c, g] = canvas(128, 128);
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(200,205,210,0.9)';
    g.lineWidth = 3;
    for (let i = -128; i < 256; i += 16) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 128, 128);
      g.stroke();
      g.beginPath();
      g.moveTo(i + 128, 0);
      g.lineTo(i, 128);
      g.stroke();
    }
    return tex(c);
  });

export const waterNormal = () =>
  memo('waterN', () => {
    const S = 512;
    const [c, g] = canvas(S, S);
    const h = makeNoise(S, 6, 21);
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const hx = h[y * S + ((x + 1) % S)] - h[y * S + ((x - 1 + S) % S)];
        const hy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
        const i = (y * S + x) * 4;
        img.data[i] = 128 - hx * 900;
        img.data[i + 1] = 128 - hy * 900;
        img.data[i + 2] = 255;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    return tex(c, true, false);
  });

export const smokeTexture = () =>
  memo('smoke', () => {
    const [c, g] = canvas(128, 128);
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return tex(c, false);
  });

export const blobShadowTexture = () =>
  memo('blob', () => {
    const [c, g] = canvas(128, 256);
    // 圆角矩形的柔和阴影（车身接地 AO）
    g.filter = 'blur(14px)';
    g.fillStyle = 'rgba(0,0,0,1)';
    g.beginPath();
    g.roundRect(26, 26, 76, 204, 30);
    g.fill();
    return tex(c, false, false);
  });

export const glowTexture = () =>
  memo('glow', () => {
    const [c, g] = canvas(128, 128);
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return tex(c, false);
  });

export function textTexture(lines: { text: string; color: string; font: string; y: number }[], w: number, h: number, bg: string | null) {
  const [c, g] = canvas(w, h);
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const l of lines) {
    g.fillStyle = l.color;
    g.font = l.font;
    g.fillText(l.text, w / 2, l.y);
  }
  return tex(c, false);
}

export const billboardTextures = () =>
  memo('bb0', () => {
    const [c, g] = canvas(1024, 512);
    const grd = g.createLinearGradient(0, 0, 1024, 512);
    grd.addColorStop(0, '#ff3d00');
    grd.addColorStop(1, '#6a00ff');
    g.fillStyle = grd;
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 12; i++) g.fillRect(i * 110 - 200, 0, 40, 512);
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.font = 'italic 900 150px Arial Black, Arial, sans-serif';
    g.fillText('APEX', 60, 230);
    g.font = 'italic 900 150px Arial Black, Arial, sans-serif';
    g.fillStyle = '#ffd400';
    g.fillText('RUSH', 60, 380);
    g.fillStyle = '#fff';
    g.font = 'bold 42px Arial, sans-serif';
    g.fillText('SUNSET COASTLINE GRAND PRIX', 64, 460);
    return tex(c, false);
  });

export const billboardTexture2 = () =>
  memo('bb1', () => {
    const [c, g] = canvas(1024, 512);
    g.fillStyle = '#0c0f14';
    g.fillRect(0, 0, 1024, 512);
    g.strokeStyle = '#39ff9f';
    g.lineWidth = 14;
    g.strokeRect(24, 24, 976, 464);
    g.fillStyle = '#39ff9f';
    g.font = 'italic 900 170px Arial Black, Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('NITRO+', 512, 280);
    g.fillStyle = '#fff';
    g.font = 'bold 48px Arial, sans-serif';
    g.fillText('HIGH OCTANE RACING FUEL', 512, 380);
    return tex(c, false);
  });

export const windowsTexture = () =>
  memo('windows', () => {
    const [c, g] = canvas(512, 128);
    g.fillStyle = '#1b1f26';
    g.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 16; i++) {
      const lit = Math.random() > 0.3;
      g.fillStyle = lit ? `rgba(255,${200 + Math.random() * 40},${140 + Math.random() * 60},1)` : '#2a3340';
      g.fillRect(i * 32 + 4, 20, 24, 40);
      g.fillStyle = lit ? 'rgba(255,230,180,0.9)' : '#252d38';
      g.fillRect(i * 32 + 4, 74, 24, 40);
    }
    return tex(c);
  });
