import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm, ridged, smoothstep, noise2 } from './noise';
import { asphaltRoughness, grassTexture, snowRoadTexture, lavaRoadTexture } from './textures';

export interface TerrainColorSet {
  baseA: THREE.Color;
  baseB: THREE.Color;
  rock: THREE.Color;
  extra1: THREE.Color;
  extra2: THREE.Color;
}

export interface VegetationDef {
  geos: THREE.BufferGeometry[];
  density: { high: number; medium: number };
  heightRange: [number, number];
  scatterRange: number;
  scatterZBase: number;
  scatterZRange: number;
  densityNoiseScale: number;
  densityNoiseOffset: number;
  densityThreshold: number;
  colorHue: number;
  colorHueVar: number;
  colorSat: number;
  colorSatVar: number;
  colorLgt: number;
  colorLgtVar: number;
  groundOffset: number;
  placementSkip?: (x: number, z: number) => boolean;
}

export interface ParticleDef {
  type: 'dust' | 'snow' | 'ash';
  color: string;
  count: number;
  size: number;
  heightMin: number;
  heightMax: number;
  speed: number;
  drift: number;
  opacity: number;
}

export interface LandmarkDef {
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
  minDistFromWall: number;
  maxDistFromWall: number;
  count: number;
  scaleY: number;
  yOffset: number;
}

export interface TrackBiome {
  naturalHeight: (x: number, z: number) => number;
  terrainColor: (night: boolean) => TerrainColorSet;
  paintTerrainVertex: (
    cTmp: THREE.Color,
    colors: TerrainColorSet,
    x: number, y: number, z: number,
    ny: number, v: number,
  ) => void;
  terrainTexture: () => THREE.Texture;
  terrainRoughness: number;
  waterLevel: number;
  waterColor: (night: boolean) => string;
  waterRoughness: number;
  waterMetalness: number;
  waterNormalMap: boolean;
  waterClearcoat: number;
  waterEnvIntensity: number;
  shoulderTexture: () => THREE.Texture;
  shoulderColor: (night: boolean) => string;
  gravelColor: string;
  bannerText: string;
  bannerBg: string;
  vegetation: (night: boolean) => VegetationDef;
  cloudCount: number;
  cloudColor: (night: boolean) => string;
  particles?: ParticleDef[]; // DEPRECATED - do not use
  landmarks?: (night: boolean) => LandmarkDef[];
  roadOverlay?: () => { texture: THREE.Texture; opacity: number; color: string };
  lampColor: string;
  lampEmissive: string;
  lampIntensity: (night: boolean) => number;
}

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

export const coastBiome: TrackBiome = {
  naturalHeight(x: number, z: number) {
    const hills = (fbm(x * 0.0022 + 3.1, z * 0.0022 + 7.7, 5) - 0.42) * 70;
    const r = Math.hypot(x + 10, (z + 180) * 1.15);
    const mountain = ridged(x * 0.0011 + 11, z * 0.0011 - 3, 5) * 330 * smoothstep(700, 1700, r);
    const coastLine = 110 + (noise2(x * 0.004, 3.3) - 0.5) * 140;
    const coast = smoothstep(coastLine, coastLine + 260, z);
    const land = hills + mountain;
    return land * (1 - coast) + -16 * coast;
  },

  terrainColor(night: boolean): TerrainColorSet {
    return {
      baseA: new THREE.Color(night ? '#2c4a2a' : '#5f7d34'),
      baseB: new THREE.Color(night ? '#3b5530' : '#8a8f3e'),
      rock: new THREE.Color('#7a6f63'),
      extra1: new THREE.Color('#2f4a24'),
      extra2: new THREE.Color('#d8c29a'),
    };
  },

  paintTerrainVertex(cTmp, colors, x, y, z, ny, v) {
    const cSnow = new THREE.Color('#eef2f6');
    cTmp.copy(colors.baseA).lerp(colors.baseB, smoothstep(0.35, 0.7, v));
    cTmp.lerp(colors.extra1, smoothstep(0.55, 0.8, fbm(x * 0.004 + 9, z * 0.004, 3)) * 0.7);
    cTmp.lerp(colors.rock, smoothstep(0.88, 0.7, ny));
    cTmp.lerp(colors.rock, smoothstep(60, 140, y) * 0.8);
    cTmp.lerp(cSnow, smoothstep(190, 250, y + v * 40) * smoothstep(0.6, 0.8, ny));
    cTmp.lerp(colors.extra2, smoothstep(2.2, 0.4, y) * smoothstep(40, 110, z));
  },

  terrainTexture: grassTexture,
  terrainRoughness: 0.95,

  waterLevel: -2,
  waterColor: (night) => night ? '#0a1a2a' : '#1d5673',
  waterRoughness: 0.06,
  waterMetalness: 0.1,
  waterNormalMap: true,
  waterClearcoat: 0.6,
  waterEnvIntensity: 1.3,

  shoulderTexture: grassTexture,
  shoulderColor: (night) => night ? '#2c4a2a' : '#627f37',
  gravelColor: '#8d8274',

  bannerText: 'APEX RUSH  ·  SUNSET COASTLINE GRAND PRIX',
  bannerBg: '#c1121f',

  vegetation(night: boolean): VegetationDef {
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
      return merged;
    })();
    const broad = (() => {
      const trunk = new THREE.CylinderGeometry(0.2, 0.32, 2.8, 6);
      trunk.translate(0, 1.4, 0);
      const trunkNI = trunk.toNonIndexed();
      trunk.dispose();
      paint(trunkNI, '#5b4331');
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
      paint(crown, '#4d6e2e');
      const merged = mergeGeometries([trunkNI, crown])!;
      trunkNI.dispose();
      crown.dispose();
      merged.computeVertexNormals();
      return merged;
    })();
    return {
      geos: [pine, broad],
      density: { high: 3200, medium: 1600 },
      heightRange: [1.5, 170],
      scatterRange: 1500,
      scatterZBase: -1500,
      scatterZRange: 1700,
      densityNoiseScale: 0.006,
      densityNoiseOffset: 40,
      densityThreshold: 0,
      colorHue: 0.22,
      colorHueVar: 0.12,
      colorSat: 0.35,
      colorSatVar: 0.2,
      colorLgt: 0.62,
      colorLgtVar: 0.3,
      groundOffset: -0.2,
      placementSkip(x, z) {
        return Math.abs(x) < 240 && z > -60 && z < 90;
      },
    };
  },

  cloudCount: 26,
  cloudColor: () => '#ffffff',

  lampColor: '#fdf6e3',
  lampEmissive: '#fff4d6',
  lampIntensity: (night) => night ? 6 : 0.2,
};

export const desertBiome: TrackBiome = {
  naturalHeight(x: number, z: number) {
    const dunes = (fbm(x * 0.0018 + 7.3, z * 0.0018 - 4.5, 5) - 0.4) * 55;
    const ridge = ridged(x * 0.0008 + 2, z * 0.0008 + 9, 5) * 180 * smoothstep(800, 2000, Math.hypot(x, z));
    const plateau = smoothstep(0.42, 0.55, fbm(x * 0.001 + 15, z * 0.001 + 20, 4)) * 40;
    return dunes + ridge + plateau;
  },

  terrainColor(night: boolean): TerrainColorSet {
    return {
      baseA: new THREE.Color(night ? '#4a3d28' : '#d4b87a'),
      baseB: new THREE.Color(night ? '#5a4c30' : '#c4a060'),
      rock: new THREE.Color('#8b6e4e'),
      extra1: new THREE.Color(night ? '#3d3220' : '#e8d0a0'),
      extra2: new THREE.Color('#7a6f63'),
    };
  },

  paintTerrainVertex(cTmp, colors, x, y, z, ny, v) {
    cTmp.copy(colors.baseA).lerp(colors.baseB, smoothstep(0.3, 0.7, v));
    cTmp.lerp(colors.extra1, smoothstep(0.6, 0.85, fbm(x * 0.003 + 20, z * 0.003 + 15, 3)) * 0.6);
    cTmp.lerp(colors.rock, smoothstep(0.88, 0.7, ny));
    cTmp.lerp(colors.rock, smoothstep(50, 120, y) * 0.7);
    cTmp.lerp(colors.extra2, smoothstep(140, 200, y) * 0.5);
  },

  terrainTexture: asphaltRoughness,
  terrainRoughness: 1,

  waterLevel: -28,
  waterColor: (night) => night ? '#1a1408' : '#8b7355',
  waterRoughness: 0.95,
  waterMetalness: 0,
  waterNormalMap: false,
  waterClearcoat: 0,
  waterEnvIntensity: 0.3,

  shoulderTexture: asphaltRoughness,
  shoulderColor: (night) => night ? '#3d3220' : '#c4a060',
  gravelColor: '#b89e6e',

  bannerText: 'APEX RUSH  ·  SCORCHED DUNES GRAND PRIX',
  bannerBg: '#b8721a',

  vegetation(night: boolean): VegetationDef {
    const cactusA = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const trunk = new THREE.CylinderGeometry(0.3, 0.35, 4, 8);
      trunk.translate(0, 2, 0);
      paint(trunk, '#2d6b3a');
      parts.push(trunk);
      const arm1 = new THREE.CylinderGeometry(0.2, 0.22, 1.8, 8);
      arm1.translate(0, 0.9, 0);
      const arm1b = arm1.clone();
      arm1.rotateZ(Math.PI / 2);
      arm1.translate(0.6, 2.8, 0.18);
      arm1b.rotateZ(-Math.PI / 2);
      arm1b.translate(-0.6, 3.2, -0.18);
      paint(arm1, '#357a42');
      paint(arm1b, '#2d6b3a');
      parts.push(arm1, arm1b);
      const cap = new THREE.SphereGeometry(0.32, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.translate(0, 4, 0);
      paint(cap, '#357a42');
      parts.push(cap);
      const merged = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      return merged;
    })();
    const cactusB = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const trunk = new THREE.CylinderGeometry(0.22, 0.26, 2.5, 8);
      trunk.translate(0, 1.25, 0);
      paint(trunk, '#3a7844');
      parts.push(trunk);
      for (let side = -1; side <= 1; side += 2) {
        const arm = new THREE.CylinderGeometry(0.14, 0.16, 1.2, 6);
        arm.translate(0, 0.6, 0);
        arm.rotateZ(side * Math.PI / 2.5);
        arm.translate(side * 0.5, 1.6, 0);
        paint(arm, '#3a7844');
        parts.push(arm);
      }
      const cap = new THREE.SphereGeometry(0.24, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.translate(0, 2.5, 0);
      paint(cap, '#428a50');
      parts.push(cap);
      const merged = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      return merged;
    })();
    return {
      geos: [cactusA, cactusB],
      density: { high: 1800, medium: 900 },
      heightRange: [-2, 160],
      scatterRange: 1800,
      scatterZBase: -1800,
      scatterZRange: 2200,
      densityNoiseScale: 0.005,
      densityNoiseOffset: 40,
      densityThreshold: -0.3,
      colorHue: 0.28,
      colorHueVar: 0.08,
      colorSat: 0.3,
      colorSatVar: 0.25,
      colorLgt: 0.3,
      colorLgtVar: 0.2,
      groundOffset: -0.1,
    };
  },

  cloudCount: 8,
  cloudColor: (night) => night ? '#3d3220' : '#e8d0a0',

  particles: undefined,

  landmarks(night): LandmarkDef[] {
    const archGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const base1 = new THREE.BoxGeometry(3.5, 9, 3);
      base1.translate(-3.2, 4.5, 0);
      parts.push(base1);
      const base2 = new THREE.BoxGeometry(3.5, 9, 3);
      base2.translate(3.2, 4.5, 0);
      parts.push(base2);
      const arch = new THREE.TorusGeometry(3.5, 1.8, 6, 8, Math.PI);
      arch.translate(0, 9, 0);
      parts.push(arch);
      const merged = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      return merged;
    })();
    const wellGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const wall = new THREE.TorusGeometry(2.2, 0.5, 6, 12);
      wall.translate(0, 0.5, 0);
      parts.push(wall);
      const base = new THREE.CylinderGeometry(2.5, 2.8, 0.6, 12);
      base.translate(0, 0.3, 0);
      parts.push(base);
      const post1 = new THREE.CylinderGeometry(0.12, 0.12, 3.5, 6);
      post1.translate(-1.8, 2.3, 0);
      parts.push(post1);
      const post2 = new THREE.CylinderGeometry(0.12, 0.12, 3.5, 6);
      post2.translate(1.8, 2.3, 0);
      parts.push(post2);
      const beam = new THREE.BoxGeometry(4, 0.2, 0.2);
      beam.translate(0, 4, 0);
      parts.push(beam);
      const merged = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      return merged;
    })();
    return [
      { geo: archGeo, mat: new THREE.MeshStandardMaterial({ color: night ? '#6a5538' : '#b89e6e', roughness: 0.95 }), minDistFromWall: 30, maxDistFromWall: 280, count: 8, scaleY: 1, yOffset: 0 },
      { geo: wellGeo, mat: new THREE.MeshStandardMaterial({ color: night ? '#5a4830' : '#8b7355', roughness: 0.9 }), minDistFromWall: 20, maxDistFromWall: 150, count: 6, scaleY: 1, yOffset: 0 },
    ];
  },

  lampColor: '#ffe0a0',
  lampEmissive: '#ffe0a0',
  lampIntensity: (night) => night ? 5 : 0.15,
};

export const snowBiome: TrackBiome = {
  naturalHeight(x, z) {
    const mountains = ridged(x * 0.001 + 5, z * 0.001 - 8, 5) * 280 * smoothstep(500, 1600, Math.hypot(x, z));
    const foothills = (fbm(x * 0.0025 + 3, z * 0.0025 + 7, 5) - 0.45) * 55;
    const valley = smoothstep(0.5, 0.65, fbm(x * 0.0015 + 12, z * 0.0015 + 18, 4)) * 30;
    return foothills + mountains - valley;
  },

  terrainColor(night): TerrainColorSet {
    return {
      baseA: new THREE.Color(night ? '#8ba4b8' : '#e8f0f8'),
      baseB: new THREE.Color(night ? '#7a94a8' : '#d0e0f0'),
      rock: new THREE.Color('#6b7280'),
      extra1: new THREE.Color(night ? '#5a7088' : '#a0c8e8'),
      extra2: new THREE.Color('#4a5568'),
    };
  },

  paintTerrainVertex(cTmp, colors, x, y, z, ny, v) {
    cTmp.copy(colors.baseA).lerp(colors.baseB, smoothstep(0.3, 0.7, v));
    cTmp.lerp(colors.extra1, smoothstep(0.5, 0.8, fbm(x * 0.003 + 8, z * 0.003 + 3, 3)) * 0.4);
    cTmp.lerp(colors.rock, smoothstep(0.85, 0.65, ny));
    cTmp.lerp(colors.extra2, smoothstep(80, 180, y) * 0.6);
    cTmp.lerp(colors.rock, smoothstep(50, 100, y) * smoothstep(0.9, 0.7, ny) * 0.8);
  },

  terrainTexture: grassTexture,
  terrainRoughness: 0.92,

  waterLevel: -4,
  waterColor: (night) => night ? '#0a1520' : '#3a7ca5',
  waterRoughness: 0.7,
  waterMetalness: 0.05,
  waterNormalMap: true,
  waterClearcoat: 0.3,
  waterEnvIntensity: 0.8,

  shoulderTexture: grassTexture,
  shoulderColor: (night) => night ? '#5a7080' : '#c8d8e8',
  gravelColor: '#8898a8',

  bannerText: 'APEX RUSH  ·  FROZEN PEAKS GRAND PRIX',
  bannerBg: '#2a5a8a',

  vegetation(night): VegetationDef {
    const snowPine = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const trunk = new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6);
      trunk.translate(0, 1.2, 0);
      paint(trunk, '#4a3d30');
      parts.push(trunk);
      for (let k = 0; k < 4; k++) {
        const r = 2.3 - k * 0.45;
        const cone = new THREE.ConeGeometry(r, 3.2 - k * 0.3, 8);
        cone.translate(0, 2.6 + k * 1.55, 0);
        paint(cone, ['#2a4a3a', '#4a6a5a', '#8aaa98', '#c8d8d0'][k]);
        parts.push(cone);
      }
      const cap = new THREE.ConeGeometry(0.7, 1.0, 8);
      cap.translate(0, 8.9, 0);
      paint(cap, '#e8f0f8');
      parts.push(cap);
      const merged = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      return merged;
    })();
    const bareTree = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const trunk = new THREE.CylinderGeometry(0.1, 0.18, 3, 6);
      trunk.translate(0, 1.5, 0);
      paint(trunk, '#5a4a3a');
      parts.push(trunk);
      const snow = new THREE.SphereGeometry(0.6, 6, 4);
      snow.translate(0, 3.2, 0);
      paint(snow, '#d8e8f0');
      parts.push(snow);
      const merged = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      return merged;
    })();
    return {
      geos: [snowPine, bareTree],
      density: { high: 2000, medium: 1000 },
      heightRange: [0, 200],
      scatterRange: 1600,
      scatterZBase: -1400,
      scatterZRange: 2000,
      densityNoiseScale: 0.005,
      densityNoiseOffset: 30,
      densityThreshold: -0.1,
      colorHue: 0.5,
      colorHueVar: 0.08,
      colorSat: 0.12,
      colorSatVar: 0.1,
      colorLgt: 0.72,
      colorLgtVar: 0.18,
      groundOffset: -0.15,
    };
  },

  cloudCount: 32,
  cloudColor: (night) => night ? '#2a3a4a' : '#c8d8e8',

  particles: undefined,

  landmarks(night): LandmarkDef[] {
    const icefallGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const cliff = new THREE.BoxGeometry(6, 14, 2.5);
      cliff.translate(0, 7, 0);
      parts.push(cliff);
      for (let i = 0; i < 8; i++) {
        const icicle = new THREE.ConeGeometry(0.3 + Math.random() * 0.4, 2 + Math.random() * 3, 5);
        icicle.translate(-2.5 + i * 0.7, 14 - Math.random() * 0.5, 1.3);
        parts.push(icicle);
      }
      const pool = new THREE.CylinderGeometry(4, 4, 0.3, 12);
      pool.translate(0, 0.15, 2.5);
      parts.push(pool);
      const merged = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      return merged;
    })();
    const snowmanGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const body = new THREE.SphereGeometry(1.2, 10, 8);
      body.translate(0, 1.2, 0);
      parts.push(body);
      const mid = new THREE.SphereGeometry(0.9, 10, 8);
      mid.translate(0, 2.9, 0);
      parts.push(mid);
      const head = new THREE.SphereGeometry(0.6, 10, 8);
      head.translate(0, 4.1, 0);
      parts.push(head);
      const nose = new THREE.ConeGeometry(0.12, 0.5, 6);
      nose.rotateX(Math.PI / 2);
      nose.translate(0, 4.1, 0.6);
      parts.push(nose);
      const merged = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      return merged;
    })();
    return [
      { geo: icefallGeo, mat: new THREE.MeshStandardMaterial({ color: night ? '#4a6a8a' : '#a0d0f0', roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.85 }), minDistFromWall: 25, maxDistFromWall: 200, count: 6, scaleY: 1, yOffset: 0 },
      { geo: snowmanGeo, mat: new THREE.MeshStandardMaterial({ color: night ? '#c0d0e0' : '#f0f4f8', roughness: 0.8 }), minDistFromWall: 15, maxDistFromWall: 100, count: 10, scaleY: 1, yOffset: 0 },
    ];
  },

  roadOverlay: () => ({ texture: snowRoadTexture(), opacity: 0.55, color: '#e0eaf4' }),

  lampColor: '#a0d0ff',
  lampEmissive: '#a0d0ff',
  lampIntensity: (night) => night ? 4 : 0.3,
};

export const volcanoBiome: TrackBiome = {
  naturalHeight(x, z) {
    const r = Math.hypot(x, z);
    const caldera = -smoothstep(180, 350, r) * smoothstep(800, 500, r) * 80;
    const ridges = ridged(x * 0.002 + 10, z * 0.002 - 5, 5) * 120 * smoothstep(400, 1400, r);
    const lavaFlows = (fbm(x * 0.004 + 3, z * 0.004 + 7, 4) - 0.5) * 30 * smoothstep(200, 600, r);
    const base = (fbm(x * 0.001 + 20, z * 0.001 + 15, 5) - 0.4) * 40;
    return base + ridges + caldera + lavaFlows;
  },

  terrainColor(night): TerrainColorSet {
    return {
      baseA: new THREE.Color(night ? '#1a1412' : '#3a3028'),
      baseB: new THREE.Color(night ? '#2a1e18' : '#4a3a2e'),
      rock: new THREE.Color(night ? '#1c1816' : '#2a2420'),
      extra1: new THREE.Color(night ? '#3a1a0a' : '#6a3a1a'),
      extra2: new THREE.Color(night ? '#1a0e08' : '#1a1008'),
    };
  },

  paintTerrainVertex(cTmp, colors, x, y, z, ny, v) {
    cTmp.copy(colors.baseA).lerp(colors.baseB, smoothstep(0.3, 0.7, v));
    const lavaNoise = fbm(x * 0.005 + 25, z * 0.005 + 30, 3);
    cTmp.lerp(colors.extra1, smoothstep(0.55, 0.75, lavaNoise) * 0.5);
    cTmp.lerp(colors.rock, smoothstep(0.85, 0.65, ny));
    cTmp.lerp(colors.extra2, smoothstep(20, -5, y) * 0.6);
    cTmp.lerp(colors.extra1, smoothstep(0.65, 0.8, lavaNoise) * smoothstep(-3, 15, y) * 0.35);
  },

  terrainTexture: asphaltRoughness,
  terrainRoughness: 0.98,

  waterLevel: -12,
  waterColor: (night) => night ? '#2a0a04' : '#6a2a10',
  waterRoughness: 0.85,
  waterMetalness: 0,
  waterNormalMap: false,
  waterClearcoat: 0,
  waterEnvIntensity: 0.4,

  shoulderTexture: asphaltRoughness,
  shoulderColor: (night) => night ? '#2a1e18' : '#4a3828',
  gravelColor: '#3a2e24',

  bannerText: 'APEX RUSH  ·  INFERNO RING GRAND PRIX',
  bannerBg: '#8a1a0a',

  vegetation(night): VegetationDef {
    const deadTree = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const trunk = new THREE.CylinderGeometry(0.12, 0.22, 3.5, 5);
      trunk.translate(0, 1.75, 0);
      paint(trunk, '#2a2018');
      parts.push(trunk);
      for (let i = 0; i < 3; i++) {
        const branch = new THREE.CylinderGeometry(0.04, 0.08, 1.5, 4);
        branch.translate(0, 0.75, 0);
        const angle = (i * Math.PI * 2) / 3 + 0.3;
        branch.rotateZ(0.6 + i * 0.2);
        branch.rotateY(angle);
        branch.translate(Math.sin(angle) * 0.3, 2.5 + i * 0.4, Math.cos(angle) * 0.3);
        paint(branch, '#2a2018');
        parts.push(branch);
      }
      const merged = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      return merged;
    })();
    const lavaRock = (() => {
      const rock = new THREE.DodecahedronGeometry(1.2, 0);
      const p = rock.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const f = 0.7 + noise2(p.getX(i) * 2, p.getZ(i) * 2) * 0.4;
        p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.65, p.getZ(i) * f);
      }
      rock.translate(0, 0.6, 0);
      const rockNI = rock.toNonIndexed();
      paint(rockNI, '#2a2420');
      rock.dispose();
      return rockNI;
    })();
    return {
      geos: [deadTree, lavaRock],
      density: { high: 1400, medium: 700 },
      heightRange: [-5, 180],
      scatterRange: 1600,
      scatterZBase: -1600,
      scatterZRange: 2400,
      densityNoiseScale: 0.004,
      densityNoiseOffset: 25,
      densityThreshold: -0.2,
      colorHue: 0.06,
      colorHueVar: 0.06,
      colorSat: 0.25,
      colorSatVar: 0.2,
      colorLgt: 0.22,
      colorLgtVar: 0.15,
      groundOffset: -0.05,
    };
  },

  cloudCount: 18,
  cloudColor: (night) => night ? '#1a0e08' : '#5a4030',

  particles: undefined,

  landmarks(night): LandmarkDef[] {
    const fumaroleGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const vent = new THREE.CylinderGeometry(0.5, 0.8, 1.5, 8, 1, true);
      vent.translate(0, 0.75, 0);
      parts.push(vent);
      const rim = new THREE.TorusGeometry(0.65, 0.2, 6, 8);
      rim.translate(0, 1.5, 0);
      parts.push(rim);
      const merged = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      return merged;
    })();
    const lavaPoolGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const pool = new THREE.CylinderGeometry(3.5, 3.5, 0.4, 16);
      pool.translate(0, 0.2, 0);
      const poolNI = pool.toNonIndexed();
      pool.dispose();
      parts.push(poolNI);
      const rock1 = new THREE.DodecahedronGeometry(1.5, 0);
      rock1.translate(2.8, 0.6, 1.2);
      parts.push(rock1);
      const rock2 = new THREE.DodecahedronGeometry(1.2, 0);
      rock2.translate(-2, 0.5, -2);
      parts.push(rock2);
      const merged = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      return merged;
    })();
    return [
      { geo: fumaroleGeo, mat: new THREE.MeshStandardMaterial({ color: '#3a2a1a', roughness: 0.9, emissive: '#ff4a10', emissiveIntensity: night ? 3 : 0.6 }), minDistFromWall: 15, maxDistFromWall: 120, count: 12, scaleY: 1, yOffset: 0 },
      { geo: lavaPoolGeo, mat: new THREE.MeshStandardMaterial({ color: night ? '#4a1a08' : '#6a2a10', roughness: 0.7, emissive: '#ff2a00', emissiveIntensity: night ? 4 : 0.8 }), minDistFromWall: 30, maxDistFromWall: 200, count: 5, scaleY: 1, yOffset: -0.3 },
    ];
  },

  roadOverlay: () => ({ texture: lavaRoadTexture(), opacity: 0.4, color: '#3a1a0a' }),

  lampColor: '#ff3020',
  lampEmissive: '#ff3020',
  lampIntensity: (night) => night ? 5 : 0.4,
};

const BIOME_MAP: Record<string, TrackBiome> = {
  coastline: coastBiome,
  desert: desertBiome,
  snow: snowBiome,
  volcano: volcanoBiome,
};

export function getBiome(trackId: string): TrackBiome {
  return BIOME_MAP[trackId] ?? coastBiome;
}
