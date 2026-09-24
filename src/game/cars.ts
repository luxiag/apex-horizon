export interface CarStats {
  speed: number; // 0-10
  accel: number;
  handling: number;
  braking: number;
}

export interface CarPhysicsTune {
  mass: number; // kg
  power: number; // kW 峰值功率
  topSpeed: number; // km/h
  grip: number; // 轮胎抓地系数
  steer: number; // 最大转向角（弧度）
  brake: number; // 制动力系数
  drift: number; // 手刹时后轮抓地保留比例（越小越容易漂）
  gears: number[];
  finalDrive: number;
  redline: number;
  cylinders: number;
  engineTone: number; // 引擎音色偏移
}

export interface CarDef {
  id: string;
  brand: string;
  model: string;
  year: string;
  tag: string; // 级别标签
  url: string;
  format?: 'gltf' | 'fbx';
  /** 目标车长（米） */
  length: number;
  /** 模型车头朝向 -Z 时需要翻转 */
  flip?: boolean;
  /** 匹配轮胎/轮毂（材质名或祖先节点名） */
  wheelMatch?: RegExp;
  /** 跟随转向但不旋转（卡钳等） */
  hubMatch?: RegExp;
  /** 需要隐藏的网格（高速模糊轮毂、损坏玻璃等） */
  hideMatch?: RegExp;
  /** 车漆材质 */
  paintMatch?: RegExp;
  /** 车漆是否可换色 */
  paintable: boolean;
  /** 尾灯/刹车灯材质（用于刹车发光） */
  rearLightMatch?: RegExp;
  /** 大灯材质（夜间发光） */
  headLightMatch?: RegExp;
  colors: string[];
  lights?: { front: [number, number, number][]; rear: [number, number, number][] };
  specs: { hp: number; torque: number; top: number; zeroTo100: number; weight: number; drive: string; engine: string };
  stats: CarStats;
  tune: CarPhysicsTune;
  accent: string;
}

const base = '/models';

export const CARS: CarDef[] = [
  {
    id: 'gt3rs',
    brand: 'PORSCHE',
    model: '911 GT3 RS (992)',
    year: '2024',
    tag: 'S1 · 900',
    url: `${base}/2024_porsche_992_gt3_rs/scene.gltf`,
    length: 4.57,
    wheelMatch: /^(EXT_RIM(_\d+)?|MI_Tyre_Flex_Dry_R(_\d+)?|EXT_Disc(_\d+)?)$/,
    hubMatch: /^EXT_CALIPER/,
    hideMatch: /^EXT_RIM_BLUR/,
    paintMatch: /EXT_Carpaint/,
    paintable: false,
    rearLightMatch: /^EXT_(Emissive_Light_Rear|Glass_Emissive_Rear)/,
    headLightMatch: /^EXT_(Emissive_Light_Front|Glass_Emissive_Front)/,
    colors: [],
    specs: { hp: 525, torque: 465, top: 296, zeroTo100: 3.2, weight: 1450, drive: 'RWD', engine: '4.0L 水平对置 6 缸' },
    stats: { speed: 7.4, accel: 8.2, handling: 9.8, braking: 9.6 },
    tune: { mass: 1450, power: 386, topSpeed: 296, grip: 1.32, steer: 0.52, brake: 1.25, drift: 0.55, gears: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], finalDrive: 4.1, redline: 9000, cylinders: 6, engineTone: 1.15 },
    accent: '#39ff9f',
  },
  {
    id: '600lt',
    brand: 'McLAREN',
    model: '600LT',
    year: '2019',
    tag: 'S1 · 920',
    url: `${base}/mclaren_600lt/scene.gltf`,
    length: 4.6,
    // GLTF 顶层矩阵变换后车头朝 -Z，统一到车辆物理使用的 +Z 方向
    flip: true,
    // GLTFLoader 会去掉节点名中的 "."，wheel_lf.child_122 -> wheel_lfchild_122
    wheelMatch: /wheel_(lf|lr|rf|rr)\.?child/,
    hubMatch: /hub_(lf|lr|rf|rr)/,
    hideMatch: /^siren/,
    paintable: false,
    rearLightMatch: /brakelight|taillight/,
    headLightMatch: /headlight_|extralight/,
    colors: [],
    specs: { hp: 600, torque: 620, top: 328, zeroTo100: 2.9, weight: 1356, drive: 'RWD', engine: '3.8L 双涡轮 V8' },
    stats: { speed: 8.6, accel: 9.0, handling: 8.8, braking: 9.0 },
    tune: { mass: 1356, power: 441, topSpeed: 328, grip: 1.26, steer: 0.5, brake: 1.2, drift: 0.5, gears: [3.98, 2.61, 1.91, 1.48, 1.18, 0.97, 0.79], finalDrive: 3.3, redline: 8500, cylinders: 8, engineTone: 1.0 },
    accent: '#ff7a1a',
  },
  {
    id: 'gt1',
    brand: 'PORSCHE',
    model: '911 GT1',
    year: '1996',
    tag: 'R · 950',
    url: `${base}/1996_porsche_911_gt1/scene.gltf`,
    length: 4.71,
    wheelMatch: /^(rim|inner_rim|outer_rim|wheel_black|tyre)\.001$/,
    hubMatch: /^caliper\.001$/,
    hideMatch: /^(blur_rim|blur_lip)\.001$/,
    paintable: false,
    rearLightMatch: /^(rearlamps|brakes)\.001$/,
    headLightMatch: /^head_light\.001$/,
    colors: [],
    specs: { hp: 600, torque: 650, top: 330, zeroTo100: 3.3, weight: 1050, drive: 'RWD', engine: '3.2L 双涡轮 水平对置 6 缸' },
    stats: { speed: 8.8, accel: 9.2, handling: 9.4, braking: 9.8 },
    tune: { mass: 1100, power: 441, topSpeed: 330, grip: 1.4, steer: 0.48, brake: 1.35, drift: 0.6, gears: [3.2, 2.2, 1.65, 1.3, 1.07, 0.9], finalDrive: 3.6, redline: 8200, cylinders: 6, engineTone: 0.9 },
    accent: '#ffd400',
  },
  {
    id: 'sls',
    brand: 'MERCEDES-AMG',
    model: 'SLS AMG',
    year: '2010',
    tag: 'A · 800',
    url: `${base}/2010_mercedes_sls_amg/scene.gltf`,
    length: 4.64,
    wheelMatch: /^(Rim|Tyre|Brake_Disk)\.00\d$/,
    hubMatch: /^Brake_Caliper/,
    hideMatch: /^(Rim_Blurred_Spokes|Rim_Blurred_Solid|DAMAGE_GLASS)/,
    paintMatch: /^Carpaint\.007$/,
    paintable: true,
    rearLightMatch: /^Lights_Rear/,
    headLightMatch: /^Lights_Front/,
    colors: ['#c9ccd1', '#b10f16', '#0b0c10', '#e8e6df', '#1a3c8f', '#d6a21e', '#2d6a4f'],
    specs: { hp: 571, torque: 650, top: 317, zeroTo100: 3.8, weight: 1620, drive: 'RWD', engine: '6.2L 自然吸气 V8' },
    stats: { speed: 8.0, accel: 7.4, handling: 7.2, braking: 7.8 },
    tune: { mass: 1620, power: 420, topSpeed: 317, grip: 1.12, steer: 0.55, brake: 1.05, drift: 0.42, gears: [3.4, 2.19, 1.63, 1.29, 1.03, 0.84, 0.67], finalDrive: 3.67, redline: 7200, cylinders: 8, engineTone: 0.72 },
    accent: '#7fd4ff',
  },
  {
    id: 'missionr',
    brand: 'PORSCHE',
    model: 'Mission R',
    year: '2021',
    tag: 'X · 999',
    url: `${base}/porsche_mission_r_concept/scene.gltf`,
    length: 4.33,
    wheelMatch: /^Rl1Mtl$/,
    paintable: false,
    colors: [],
    specs: { hp: 1088, torque: 1000, top: 300, zeroTo100: 2.5, weight: 1500, drive: 'AWD', engine: '双电机 纯电驱动' },
    stats: { speed: 7.8, accel: 10, handling: 9.2, braking: 9.2 },
    tune: { mass: 1500, power: 620, topSpeed: 305, grip: 1.3, steer: 0.5, brake: 1.25, drift: 0.62, gears: [1.6], finalDrive: 6.2, redline: 16000, cylinders: 0, engineTone: 1.6 },
    accent: '#b58cff',
  },
];

export const carById = (id: string) => CARS.find((c) => c.id === id) ?? CARS[0];
