import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, MeshReflectorMaterial, ContactShadows, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { useGame } from '../game/store';
import { carById } from '../game/cars';
import { ShowroomCar } from './CarModel';
import { PostFX } from './PostFX';

const CAMS: Record<string, { pos: [number, number, number]; look: [number, number, number]; fov: number }> = {
  intro: { pos: [7.5, 1.4, 6.5], look: [0, 0.6, 0], fov: 32 },
  menu: { pos: [-6.8, 1.6, 6.2], look: [-1.9, 0.7, 0], fov: 36 },
  garage: { pos: [6.4, 1.6, 6.4], look: [-1.5, 0.45, 1.5], fov: 36 },
  tracks: { pos: [-4.5, 3.2, -7.5], look: [-1.2, 0.4, 0], fov: 40 },
};

function CameraRig() {
  const screen = useGame((s) => s.screen);
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(0, 0.6, 0));
  const t = useRef(0);
  useEffect(() => {
    t.current = 0;
  }, [screen]);
  useFrame((state, dt) => {
    const c = CAMS[screen] ?? CAMS.menu;
    t.current += dt;
    const k = 1 - Math.exp(-dt * 2.2);
    // 轻微呼吸式漂移
    const time = state.clock.elapsedTime;
    const target = new THREE.Vector3(...c.pos);
    if (screen === 'intro') {
      const a = time * 0.12;
      target.set(Math.cos(a) * 8.5, 1.3 + Math.sin(time * 0.3) * 0.2, Math.sin(a) * 8.5);
    } else {
      target.x += Math.sin(time * 0.25) * 0.25;
      target.y += Math.sin(time * 0.33) * 0.08;
    }
    camera.position.lerp(target, k);
    look.current.lerp(new THREE.Vector3(...c.look), k);
    camera.lookAt(look.current);
    const pc = camera as THREE.PerspectiveCamera;
    pc.fov += (c.fov - pc.fov) * k;
    pc.updateProjectionMatrix();
  });
  return null;
}

function Turntable({ accent }: { accent: string }) {
  const screen = useGame((s) => s.screen);
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.MeshStandardMaterial>(null);
  const carId = useGame((s) => s.carId);
  const flash = useRef(1);
  useEffect(() => {
    flash.current = 1;
  }, [carId]);
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * (screen === 'garage' ? 0.18 : 0.1);
    flash.current = Math.max(0, flash.current - dt * 1.5);
    if (ring.current) {
      ring.current.emissive.set(accent);
      ring.current.emissiveIntensity = 2.5 + flash.current * 10;
    }
  });
  const def = carById(carId);
  const paint = useGame((s) => s.paint[carId]);
  return (
    <group>
      <mesh position={[0, 0.005, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[3.6, 96]} />
        <meshStandardMaterial color="#0c0d10" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.012, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[3.55, 3.66, 128]} />
        <meshStandardMaterial ref={ring} color="#000" emissive={accent} emissiveIntensity={3} toneMapped={false} />
      </mesh>
      <group ref={group}>
        <ShowroomCar key={def.id} def={def} paint={paint} lights={0.6} />
      </group>
    </group>
  );
}

export function Showroom() {
  const carId = useGame((s) => s.carId);
  const def = carById(carId);
  return (
    <>
      <color attach="background" args={['#050608']} />
      <fog attach="fog" args={['#050608', 12, 38]} />
      <CameraRig />
      <ambientLight intensity={0.15} />
      <spotLight position={[0, 9, 0]} angle={0.55} penumbra={0.8} intensity={120} color="#ffffff" castShadow shadow-mapSize={[1024, 1024]} />
      <spotLight position={[-8, 3, 4]} angle={0.5} penumbra={1} intensity={60} color={def.accent} />
      <spotLight position={[8, 2.5, -5]} angle={0.5} penumbra={1} intensity={45} color="#8fb4ff" />

      <Environment resolution={512} frames={1}>
        <color attach="background" args={['#000']} />
        <Lightformer form="rect" intensity={3} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[10, 3, 1]} />
        <Lightformer form="rect" intensity={2} position={[0, 4, -9]} scale={[20, 1.2, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[-9, 2, 0]} rotation-y={Math.PI / 2} scale={[16, 0.6, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[9, 2, 0]} rotation-y={-Math.PI / 2} scale={[16, 0.6, 1]} />
        <Lightformer form="ring" color={def.accent} intensity={3} position={[0, 3, 8]} scale={3} />
        <Lightformer form="rect" intensity={1} position={[0, -1, 0]} rotation-x={-Math.PI / 2} scale={[4, 4, 1]} color="#223" />
      </Environment>

      <Turntable accent={def.accent} />
      <ContactShadows position={[0, 0.02, 0]} opacity={0.85} scale={12} blur={2.4} far={3} resolution={512} color="#000" />

      {/* 反射地面 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
        <planeGeometry args={[80, 80]} />
        <MeshReflectorMaterial
          blur={[400, 100]}
          resolution={1024}
          mixBlur={1}
          mixStrength={18}
          roughness={0.85}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.3}
          color="#0a0b0e"
          metalness={0.6}
          mirror={0.5}
        />
      </mesh>

      {/* 背景灯带 */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 14, 3.5, -6]} rotation-y={-s * 0.6}>
          <planeGeometry args={[0.18, 7]} />
          <meshBasicMaterial color={def.accent} toneMapped={false} />
        </mesh>
      ))}
      {Array.from({ length: 9 }).map((_, i) => (
        <mesh key={i} position={[(i - 4) * 3.2, 6.5, -14]}>
          <planeGeometry args={[2.4, 0.08]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
      ))}
      <Sparkles count={70} scale={[16, 6, 16]} size={2} speed={0.25} opacity={0.35} color={def.accent} position={[0, 3, 0]} />
      <PostFX mode="showroom" />
    </>
  );
}
