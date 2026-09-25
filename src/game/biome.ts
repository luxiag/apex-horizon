import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm, ridged, smoothstep, noise2 } from './noise';
import { asphaltRoughness, grassTexture } from './textures';

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
      return merged;
    })();
    return {
      geos: [pine, broad],
      density: { high: 5200, medium: 2600 },
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
};

const BIOME_MAP: Record<string, TrackBiome> = {
  coastline: coastBiome,
  desert: desertBiome,
};

export function getBiome(trackId: string): TrackBiome {
  return BIOME_MAP[trackId] ?? coastBiome;
}
