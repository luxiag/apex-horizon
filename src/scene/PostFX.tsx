import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, ToneMapping, ChromaticAberration, SMAA } from '@react-three/postprocessing';
import { ToneMappingMode, BlendFunction, ChromaticAberrationEffect } from 'postprocessing';
import * as THREE from 'three';
import { hud } from '../game/race';
import { useGame } from '../game/store';

export function PostFX({ mode }: { mode: 'showroom' | 'race' }) {
  const ca = useRef<ChromaticAberrationEffect>(null);
  const quality = useGame((s) => s.quality);
  const offset = useRef(new THREE.Vector2(0, 0));
  useFrame((_, dt) => {
    if (!ca.current) return;
    const target = mode === 'race' ? (hud.nitroActive ? 0.0022 : 0) + hud.impact * 0.004 + hud.speedFactor * 0.0004 : 0;
    const cur = offset.current.x;
    const v = cur + (target - cur) * Math.min(1, dt * 6);
    offset.current.set(v, v * 0.6);
    ca.current.offset = offset.current;
  });
  return (
    <EffectComposer multisampling={quality === 'high' ? 4 : 0} enableNormalPass={false}>
      <Bloom mipmapBlur intensity={mode === 'showroom' ? 0.9 : 0.75} luminanceThreshold={mode === 'showroom' ? 0.9 : 0.95} luminanceSmoothing={0.2} radius={0.75} />
      <ChromaticAberration ref={ca} offset={offset.current} radialModulation modulationOffset={0.35} blendFunction={BlendFunction.NORMAL} />
      <ToneMapping mode={mode === 'race' ? ToneMappingMode.ACES_FILMIC : ToneMappingMode.AGX} />
      <Vignette eskil={false} offset={0.28} darkness={mode === 'showroom' ? 0.75 : 0.55} />
      {quality === 'high' ? null : <SMAA />}
    </EffectComposer>
  );
}
