import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { CarDef } from '../game/cars';
import { prepareCar, instantiateCar, setCarLights, type CarInstance } from '../game/carModel';

export function usePreparedCar(def: CarDef) {
  const gltf = useGLTF(def.url);
  return useMemo(() => prepareCar(def, gltf.scene), [def, gltf.scene]);
}

/** 展厅/菜单中使用的静态车辆 */
export function ShowroomCar({ def, paint, onReady, lights = 0.4 }: { def: CarDef; paint?: string; onReady?: (inst: CarInstance) => void; lights?: number }) {
  const prep = usePreparedCar(def);
  const inst = useMemo(() => instantiateCar(def, prep, { paint: def.paintable ? paint ?? def.colors[0] : undefined }), [def, prep]);
  useEffect(() => {
    if (def.paintable && paint) inst.paint.forEach((m) => m.color.set(paint));
  }, [paint, inst, def]);
  useEffect(() => {
    setCarLights(inst, 0, lights, lights);
    onReady?.(inst);
  }, [inst, lights, onReady]);
  useEffect(() => {
    inst.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.receiveShadow = false;
    });
  }, [inst]);
  return <primitive object={inst.root} />;
}
