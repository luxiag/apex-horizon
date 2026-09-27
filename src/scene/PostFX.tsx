import { forwardRef, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, ChromaticAberration, SMAA } from '@react-three/postprocessing';
import { BlendFunction, ChromaticAberrationEffect, Effect } from 'postprocessing';
import * as THREE from 'three';
import { hud } from '../game/race';
import { useGame } from '../game/store';

class HeatWaveEffect extends Effect {
  constructor() {
    super('HeatWave', `
      uniform float uTime;
      uniform float uStrength;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 d = uv;
        float wave = sin(uv.y * 35.0 + uTime * 3.5) * uStrength;
        wave += sin(uv.y * 15.0 - uTime * 2.0) * uStrength * 0.6;
        d.x += wave;
        d.y += cos(uv.x * 25.0 + uTime * 2.8) * uStrength * 0.3;
        outputColor = texture2D(inputBuffer, d);
      }
    `, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uTime', new THREE.Uniform(0)],
        ['uStrength', new THREE.Uniform(0.0015)],
      ]),
    });
  }
}

const HeatWave = forwardRef(function HeatWave(_props, ref) {
  const effect = useMemo(() => new HeatWaveEffect(), []);
  useFrame((state) => {
    effect.uniforms.get('uTime')!.value = state.clock.elapsedTime;
  });
  return <primitive ref={ref} object={effect} dispose={null} />;
});

class BlizzardSnowEffect extends Effect {
  constructor() {
    super('BlizzardSnow', `
      uniform float uTime;
      uniform float uIntensity;
      uniform float uCameraNear;
      uniform float uCameraFar;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float readDepth(vec2 uv) {
        float d = texture2D(depthBuffer, uv).r;
        return uCameraNear * uCameraFar / (uCameraFar + d * (uCameraNear - uCameraFar));
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float linearDepth = readDepth(uv);
        float nd = clamp(linearDepth / uCameraFar, 0.0, 1.0);
        vec4 col = inputColor;
        float whiteout = smoothstep(0.02, 0.12, nd) * uIntensity * 0.9;
        col.rgb = mix(col.rgb, vec3(0.88, 0.90, 0.93), whiteout);
        for (float layer = 0.0; layer < 3.0; layer++) {
          float speed = 0.18 + layer * 0.12;
          float drift = 0.1 + layer * 0.05;
          float scale = 50.0 + layer * 40.0;
          vec2 st = uv * scale;
          st.y += uTime * speed * scale;
          st.x += sin(uv.y * 6.0 + uTime * drift + layer * 3.5) * 4.0;
          vec2 cell = floor(st);
          vec2 f = fract(st);
          float r = hash(cell + layer * 100.0);
          if (r > 0.55) {
            vec2 center = vec2(hash(cell * 1.3 + layer * 50.0), hash(cell * 2.7 + layer * 80.0));
            float d = length(f - center);
            float size = 0.18 + hash(cell * 3.1 + layer) * 0.2;
            float depthFade = smoothstep(0.0, 0.04, nd);
            float alpha = smoothstep(size, size * 0.2, d) * (0.25 + r * 0.4) * uIntensity * depthFade;
            col = mix(col, vec4(0.95, 0.97, 1.0, 1.0), alpha);
          }
        }
        outputColor = col;
      }
    `, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uTime', new THREE.Uniform(0)],
        ['uIntensity', new THREE.Uniform(1.0)],
        ['uCameraNear', new THREE.Uniform(0.1)],
        ['uCameraFar', new THREE.Uniform(9000)],
      ]),
    });
  }
}

const BlizzardSnow = forwardRef(function BlizzardSnow(_props, ref) {
  const effect = useMemo(() => new BlizzardSnowEffect(), []);
  useFrame((state) => {
    effect.uniforms.get('uTime')!.value = state.clock.elapsedTime;
    const cam = state.camera as THREE.PerspectiveCamera;
    effect.uniforms.get('uCameraNear')!.value = cam.near;
    effect.uniforms.get('uCameraFar')!.value = cam.far;
  });
  return <primitive ref={ref} object={effect} dispose={null} />;
});

class VolcanicGlowEffect extends Effect {
  constructor() {
    super('VolcanicGlow', `
      uniform float uTime;
      uniform float uIntensity;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec4 col = inputColor;
        float pulse = 0.7 + 0.3 * sin(uTime * 1.2) * sin(uTime * 0.7 + 1.5);
        float bottomMask = smoothstep(0.45, 0.0, uv.y);
        float edgeFalloff = smoothstep(0.0, 0.15, uv.x) * smoothstep(1.0, 0.85, uv.x);
        float glow = bottomMask * edgeFalloff * uIntensity * pulse;
        col.rgb += vec3(0.8, 0.2, 0.05) * glow;
        outputColor = col;
      }
    `, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uTime', new THREE.Uniform(0)],
        ['uIntensity', new THREE.Uniform(0.35)],
      ]),
    });
  }
}

const VolcanicGlow = forwardRef(function VolcanicGlow(_props, ref) {
  const effect = useMemo(() => new VolcanicGlowEffect(), []);
  useFrame((state) => {
    effect.uniforms.get('uTime')!.value = state.clock.elapsedTime;
  });
  return <primitive ref={ref} object={effect} dispose={null} />;
});

class VogEffect extends Effect {
  constructor() {
    super('Vog', `
      uniform float uTime;
      uniform float uIntensity;
      uniform float uCameraNear;
      uniform float uCameraFar;
      float readDepth(vec2 uv) {
        float d = texture2D(depthBuffer, uv).r;
        return uCameraNear * uCameraFar / (uCameraFar + d * (uCameraNear - uCameraFar));
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float linearDepth = readDepth(uv);
        float nd = clamp(linearDepth / uCameraFar, 0.0, 1.0);
        vec4 col = inputColor;
        float vogMask = smoothstep(0.0, 0.25, nd) * uIntensity;
        float flicker = 0.92 + 0.08 * sin(uTime * 0.3) * sin(uTime * 0.17 + 2.0);
        vec3 vogColor = vec3(0.35, 0.18, 0.1);
        col.rgb = mix(col.rgb, vogColor, vogMask * 0.4 * flicker);
        col.rgb *= mix(1.0, 0.85, vogMask * 0.3);
        outputColor = col;
      }
    `, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uTime', new THREE.Uniform(0)],
        ['uIntensity', new THREE.Uniform(1.0)],
        ['uCameraNear', new THREE.Uniform(0.1)],
        ['uCameraFar', new THREE.Uniform(9000)],
      ]),
    });
  }
}

const Vog = forwardRef(function Vog(_props, ref) {
  const effect = useMemo(() => new VogEffect(), []);
  useFrame((state) => {
    effect.uniforms.get('uTime')!.value = state.clock.elapsedTime;
    const cam = state.camera as THREE.PerspectiveCamera;
    effect.uniforms.get('uCameraNear')!.value = cam.near;
    effect.uniforms.get('uCameraFar')!.value = cam.far;
  });
  return <primitive ref={ref} object={effect} dispose={null} />;
});

class VolcanicHeatEffect extends Effect {
  constructor() {
    super('VolcanicHeat', `
      uniform float uTime;
      uniform float uStrength;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 d = uv;
        float groundMask = smoothstep(0.5, 0.0, uv.y);
        float wave = sin(uv.y * 50.0 + uTime * 4.0) * uStrength * groundMask;
        wave += sin(uv.y * 20.0 - uTime * 2.5) * uStrength * 0.5 * groundMask;
        d.x += wave;
        d.y += cos(uv.x * 30.0 + uTime * 3.0) * uStrength * 0.2 * groundMask;
        outputColor = texture2D(inputBuffer, d);
      }
    `, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uTime', new THREE.Uniform(0)],
        ['uStrength', new THREE.Uniform(0.001)],
      ]),
    });
  }
}

const VolcanicHeat = forwardRef(function VolcanicHeat(_props, ref) {
  const effect = useMemo(() => new VolcanicHeatEffect(), []);
  useFrame((state) => {
    effect.uniforms.get('uTime')!.value = state.clock.elapsedTime;
  });
  return <primitive ref={ref} object={effect} dispose={null} />;
});

class VolcanicLightningEffect extends Effect {
  constructor() {
    super('VolcanicLightning', `
      uniform float uFlash;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec4 col = inputColor;
        col.rgb += vec3(0.6, 0.55, 0.7) * uFlash;
        outputColor = col;
      }
    `, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uFlash', new THREE.Uniform(0)],
      ]),
    });
  }
}

const VolcanicLightning = forwardRef(function VolcanicLightning(_props, ref) {
  const effect = useMemo(() => new VolcanicLightningEffect(), []);
  const nextFlash = useRef(Math.random() * 6 + 3);
  const flashTime = useRef(0);
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    if (t > nextFlash.current) {
      flashTime.current = t;
      nextFlash.current = t + Math.random() * 8 + 4;
    }
    const since = t - flashTime.current;
    const flash = since < 0.05 ? 1.0 : since < 0.15 ? 0.3 : since < 0.2 ? 0.5 : since < 0.35 ? 0.1 : 0;
    effect.uniforms.get('uFlash')!.value = flash;
  });
  return <primitive ref={ref} object={effect} dispose={null} />;
});

export function PostFX({ mode }: { mode: 'showroom' | 'race' }) {
  const ca = useRef<ChromaticAberrationEffect>(null);
  const quality = useGame((s) => s.quality);
  const tod = useGame((s) => s.timeOfDay);
  const isHeatwave = tod === 'heatwave';
  const isBlizzard = tod === 'blizzard';
  const isVolcanic = tod === 'volcanic';
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
      <Bloom mipmapBlur intensity={mode === 'showroom' ? 0.9 : isHeatwave ? 0.8 : isBlizzard ? 0.15 : isVolcanic ? 0.6 : 0.3} luminanceThreshold={mode === 'showroom' ? 0.9 : isHeatwave ? 1.5 : isBlizzard ? 8.0 : isVolcanic ? 1.2 : 6.0} luminanceSmoothing={0.3} radius={0.6} />
      <ChromaticAberration ref={ca} offset={offset.current} radialModulation modulationOffset={0.35} blendFunction={BlendFunction.NORMAL} />
      {isHeatwave && <HeatWave />}
      {isBlizzard && <BlizzardSnow />}
      {isVolcanic && <VolcanicGlow />}
      {isVolcanic && <Vog />}
      {isVolcanic && <VolcanicHeat />}
      {isVolcanic && <VolcanicLightning />}
      <Vignette eskil={false} offset={0.28} darkness={mode === 'showroom' ? 0.75 : isBlizzard ? 0.8 : isVolcanic ? 0.7 : 0.55} />
      {quality === 'high' ? null : <SMAA />}
    </EffectComposer>
  );
}
