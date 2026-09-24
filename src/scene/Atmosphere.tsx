import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Sky, Environment, Stars, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import type { TimeOfDay } from '../game/store';

export interface TodPreset {
  sunElevation: number; // 度
  sunAzimuth: number; // 弧度
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fog: string;
  fogNear: number;
  fogFar: number;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  envIntensity: number;
  night: boolean;
}

export const TOD: Record<TimeOfDay, TodPreset> = {
  sunset: {
    sunElevation: 3.2,
    sunAzimuth: -0.65,
    sunColor: '#ffa468',
    sunIntensity: 3.6,
    hemiSky: '#ffc9a0',
    hemiGround: '#3b2c22',
    hemiIntensity: 0.7,
    fog: '#e0a988',
    fogNear: 220,
    fogFar: 2400,
    turbidity: 9,
    rayleigh: 3.2,
    mieCoefficient: 0.008,
    mieDirectionalG: 0.95,
    envIntensity: 1,
    night: false,
  },
  noon: {
    sunElevation: 58,
    sunAzimuth: -0.4,
    sunColor: '#fff6ea',
    sunIntensity: 3.6,
    hemiSky: '#cfe6ff',
    hemiGround: '#4d5a39',
    hemiIntensity: 0.9,
    fog: '#b9d2ea',
    fogNear: 300,
    fogFar: 3200,
    turbidity: 3,
    rayleigh: 1.2,
    mieCoefficient: 0.004,
    mieDirectionalG: 0.8,
    envIntensity: 1,
    night: false,
  },
  night: {
    sunElevation: -12,
    sunAzimuth: -0.65,
    sunColor: '#9db8ff',
    sunIntensity: 0.9,
    hemiSky: '#3b4d7a',
    hemiGround: '#11151c',
    hemiIntensity: 0.55,
    fog: '#0a1020',
    fogNear: 120,
    fogFar: 1500,
    turbidity: 10,
    rayleigh: 0.4,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.8,
    envIntensity: 0.6,
    night: true,
  },
};

export function sunDirection(p: TodPreset) {
  const el = THREE.MathUtils.degToRad(p.sunElevation);
  return new THREE.Vector3(Math.cos(el) * Math.sin(p.sunAzimuth), Math.sin(el), Math.cos(el) * Math.cos(p.sunAzimuth));
}

export function Atmosphere({ tod, follow, quality }: { tod: TimeOfDay; follow: () => THREE.Vector3; quality: 'high' | 'medium' }) {
  const p = TOD[tod];
  const sun = useRef<THREE.DirectionalLight>(null);
  const { scene } = useThree();
  const dir = useMemo(() => sunDirection(p), [p]);
  // 夜间的“月光”方向与太阳相反的高处
  const lightDir = useMemo(() => (p.night ? new THREE.Vector3(0.4, 0.8, -0.45).normalize() : dir.clone()), [p, dir]);
  const skyPos = useMemo(() => dir.clone().multiplyScalar(1000), [dir]);

  useEffect(() => {
    scene.fog = new THREE.Fog(p.fog, p.fogNear, p.fogFar);
    scene.environmentIntensity = p.envIntensity;
    return () => {
      scene.fog = null;
    };
  }, [p, scene]);

  useEffect(() => {
    if (sun.current) scene.add(sun.current.target);
  }, [scene]);

  useFrame(() => {
    const l = sun.current;
    if (!l) return;
    const f = follow();
    l.position.copy(f).addScaledVector(lightDir, 300);
    l.target.position.copy(f);
    l.target.updateMatrixWorld();
  });

  const size = quality === 'high' ? 4096 : 2048;
  return (
    <>
      <Sky distance={6000} sunPosition={skyPos} turbidity={p.turbidity} rayleigh={p.rayleigh} mieCoefficient={p.mieCoefficient} mieDirectionalG={p.mieDirectionalG} />
      {p.night && <Stars radius={2500} depth={600} count={6000} factor={40} saturation={0.2} fade speed={0.3} />}
      {p.night && (
        <mesh position={[-1400, 900, 1600]}>
          <sphereGeometry args={[45, 32, 16]} />
          <meshBasicMaterial color="#f4f1e6" toneMapped={false} fog={false} />
        </mesh>
      )}
      <hemisphereLight args={[p.hemiSky, p.hemiGround, p.hemiIntensity]} />
      <directionalLight
        ref={sun}
        color={p.sunColor}
        intensity={p.sunIntensity}
        castShadow
        shadow-mapSize={[size, size]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.04}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-camera-near={10}
        shadow-camera-far={700}
      />
      <Environment resolution={256} frames={1} environmentIntensity={p.envIntensity}>
        <Sky distance={6000} sunPosition={skyPos} turbidity={p.turbidity} rayleigh={p.rayleigh} mieCoefficient={p.mieCoefficient} mieDirectionalG={p.mieDirectionalG} />
        {/* 下半球是地面而不是天空，避免车身下部反射出天空显得“飘” */}
        <mesh position={[0, -2, 0]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[400, 32]} />
          <meshBasicMaterial color={p.night ? '#07090c' : p.sunElevation < 10 ? '#3a3027' : '#3d4435'} />
        </mesh>
        {p.night && (
          <>
            <Lightformer form="rect" intensity={0.8} color="#ffe2b8" position={[0, 30, 0]} rotation-x={Math.PI / 2} scale={[60, 20, 1]} />
            <Lightformer form="rect" intensity={0.5} color="#8fb0ff" position={[60, 10, 0]} rotation-y={-Math.PI / 2} scale={[60, 8, 1]} />
          </>
        )}
        {!p.night && <Lightformer form="rect" intensity={0.6} color="#ffffff" position={[0, 40, 0]} rotation-x={Math.PI / 2} scale={[80, 80, 1]} />}
      </Environment>
    </>
  );
}
