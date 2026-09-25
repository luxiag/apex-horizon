import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { CARS, carById } from '../game/cars';
import { prepareCar, instantiateCar, setCarLights, type CarInstance } from '../game/carModel';
import { getTrack } from '../game/track';
import { buildWorld } from '../game/world';
import { RaceSession, hud, pushMessage } from '../game/race';
import { useGame } from '../game/store';
import { readDriveInput, consumePress, clearPresses, consumePadPress, isDown as isKeyDown } from '../game/input';
import { audio } from '../game/audio';
import { Skidmarks, Particles } from '../game/effects';
import { blobShadowTexture } from '../game/textures';
import { Atmosphere, TOD } from './Atmosphere';
import { PostFX } from './PostFX';

const CAMERA_MODES = [
  { name: '追尾视角', dist: 6.4, height: 2.0, look: 1.05, fov: 60 },
  { name: '近距追尾', dist: 4.9, height: 1.55, look: 0.95, fov: 64 },
  { name: '车头视角', dist: 0, height: 0, look: 0, fov: 72 },
];

const FIXED = 1 / 120;

export function RaceScene() {
  const cfg = useMemo(() => useGame.getState(), []);
  const track = useMemo(() => getTrack(cfg.trackId), [cfg]);
  const tod = TOD[cfg.timeOfDay];
  const gltfs = useGLTF(CARS.map((c) => c.url));
  const preps = useMemo(() => {
    const m: Record<string, ReturnType<typeof prepareCar>> = {};
    CARS.forEach((d, i) => (m[d.id] = prepareCar(d, gltfs[i].scene)));
    return m;
  }, [gltfs]);

  const session = useMemo(() => {
    const dims: Record<string, { wheelBase: number; wheelRadius: number; width: number; length: number }> = {};
    for (const d of CARS) {
      const p = preps[d.id];
      dims[d.id] = { wheelBase: p.wheelBase, wheelRadius: p.wheelRadius, width: p.width, length: p.length };
    }
    const player = carById(cfg.carId);
    return new RaceSession(track, {
      playerCar: player,
      playerPaint: player.paintable ? cfg.paint[player.id] ?? player.colors[0] : undefined,
      laps: cfg.laps,
      opponents: cfg.opponents,
      difficulty: cfg.difficulty,
      dims,
    });
  }, [cfg, preps, track]);

  const instances = useMemo<CarInstance[]>(
    () =>
      session.racers.map((r) => {
        const inst = instantiateCar(r.def, preps[r.def.id], { paint: r.def.paintable ? r.paint ?? (r.isPlayer ? undefined : r.def.colors[(r.id * 3) % r.def.colors.length]) : undefined });
        // 接地软阴影（AO），让车辆“压”在路面上
        const blob = new THREE.Mesh(
          new THREE.PlaneGeometry(inst.info.width * 1.25, inst.info.length * 1.18),
          new THREE.MeshBasicMaterial({ map: blobShadowTexture(), color: '#000', transparent: true, opacity: 0.82, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }),
        );
        blob.rotation.x = -Math.PI / 2;
        blob.position.y = 0.03;
        blob.renderOrder = 1;
        inst.root.add(blob);
        // 车身接收阴影（尾翼、后视镜投影到车身上）
        inst.body.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.receiveShadow = true;
        });
        return inst;
      }),
    [session, preps],
  );

  const world = useMemo(() => buildWorld(track, { night: tod.night, quality: cfg.quality }), [track, tod, cfg.quality]);
  const fx = useMemo(
    () => ({
      skid: new Skidmarks(4000),
      smoke: new Particles(900, false, { drag: 1.6, gravity: 0.6 }),
      dirt: new Particles(300, false, { drag: 2.2, gravity: -6 }),
      sparks: new Particles(300, true, { drag: 1.0, gravity: -9, texture: 'glow' }),
      flame: new Particles(300, true, { drag: 5, gravity: 0, texture: 'glow' }),
    }),
    [],
  );

  const { camera, size, gl } = useThree();
  const headlight = useRef<THREE.SpotLight>(null);
  const cam = useRef({ yaw: 0, mode: 0, shake: 0, dist: 6, t: 0, pitchLag: 0, fov: 60, lastCountdown: -1, resultsSent: false, lastPhase: 'intro' as string });
  const accumulator = useRef(0);

  useEffect(() => {
    audio.ensure();
    audio.startEngine(session.player.def.tune.cylinders === 0);
    audio.startRival(false);
    hud.cameraName = CAMERA_MODES[0].name;
    cam.current.yaw = session.player.vehicle.yaw;
    clearPresses();
    gl.shadowMap.autoUpdate = true;
    return () => {
      audio.stopEngine();
      world.dispose();
      Object.values(fx).forEach((f) => f.dispose());
    };
  }, [session, world, fx, gl]);

  useEffect(() => {
    if (headlight.current) {
      const inst = instances[instances.length - 1];
      inst.root.add(headlight.current);
      inst.root.add(headlight.current.target);
      headlight.current.position.set(0, 0.75, inst.info.length / 2 - 0.2);
      headlight.current.target.position.set(0, 0, 30);
    }
  }, [instances]);

  const tmp = useMemo(
    () => ({
      v: new THREE.Vector3(),
      w: new THREE.Vector3(),
      look: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      e: new THREE.Euler(0, 0, 0, 'YXZ'),
    }),
    [],
  );

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const game = useGame.getState();
    const c = cam.current;

    // ---------- 按键 ----------
    if (consumePress('Escape') || consumePress('KeyP') || consumePadPress(9)) {
      if (session.phase !== 'finished') game.set({ paused: !game.paused });
    }
    if (consumePress('KeyM')) audio.toggleMute();
    const paused = useGame.getState().paused;
    hud.paused = paused;
    if (paused) {
      audio.updateDriving({ rpm: 0, throttle: 0, cylinders: 8, tone: 1, speed: 0, slip: 0, nitro: false, grass: false });
      audio.engine?.out.gain.setTargetAtTime(0, audio.ctx!.currentTime, 0.05);
      return;
    }
    if (consumePress('KeyC') || consumePadPress(3)) {
      c.mode = (c.mode + 1) % CAMERA_MODES.length;
      hud.cameraName = CAMERA_MODES[c.mode].name;
      pushMessage(CAMERA_MODES[c.mode].name, 'info');
    }
    if ((consumePress('KeyR') || consumePadPress(2)) && session.phase === 'racing') {
      session.player.vehicle.resetToTrack();
      fx.skid.add(-1, 0, 0, 0, 0, 0, 0, 0);
    }

    // ---------- 物理 ----------
    const input = readDriveInput(dt);
    accumulator.current += dt;
    let shifted = 0;
    const wasNitro = session.player.vehicle.nitroActive;
    while (accumulator.current >= FIXED) {
      session.step(FIXED, input);
      if (session.player.vehicle.lastShift) shifted = session.player.vehicle.lastShift;
      accumulator.current -= FIXED;
    }
    const pv = session.player.vehicle;
    if (shifted > 0) audio.shift(true);
    if (!wasNitro && pv.nitroActive) audio.nitroStart();

    // ---------- 阶段事件 ----------
    if (session.phase === 'countdown' && hud.countdown !== c.lastCountdown) {
      c.lastCountdown = hud.countdown;
      audio.countdown(false);
    }
    if (session.phase !== c.lastPhase) {
      if (session.phase === 'racing') {
        audio.countdown(true);
        pushMessage('GO!', 'good');
      }
      if (session.phase === 'finished') {
        audio.finish();
        const best = session.player.bestLap;
        if (best !== null) {
          const isRecord = game.saveBestLap(`${cfg.trackId}:${cfg.carId}`, best);
          if (isRecord) pushMessage('新纪录', 'good');
        }
      }
      c.lastPhase = session.phase;
    }
    if (session.phase === 'finished' && session.phaseTime > 4 && !c.resultsSent) {
      c.resultsSent = true;
      game.set({ results: session.results(), screen: 'results' });
    }

    // 起跑灯
    world.startLights.forEach((m, i) => {
      const on = session.phase === 'countdown' && hud.countdown > i;
      m.emissiveIntensity = on ? 8 : 0;
      m.color.set(on ? '#ff2020' : '#1a0000');
    });

    // ---------- 碰撞事件 ----------
    for (const ev of session.events) {
      audio.impact(ev.strength);
      c.shake = Math.min(1, c.shake + ev.strength * 0.06);
      hud.impact = Math.min(1, hud.impact + ev.strength * 0.08);
      for (let k = 0; k < Math.min(40, 6 + ev.strength * 3); k++) {
        fx.sparks.emit(ev.x, ev.y, ev.z, (Math.random() - 0.5) * 12, Math.random() * 6 + 1, (Math.random() - 0.5) * 12, 0.3 + Math.random() * 0.4, 0.12, -0.1, 1, 1, 0.65, 0.25);
      }
    }
    session.events.length = 0;
    hud.impact *= Math.exp(-dt * 4);

    // ---------- 车辆表现 ----------
    const camPos = camera.position;
    session.racers.forEach((r, idx) => {
      const v = r.vehicle;
      const inst = instances[idx];
      const root = inst.root;
      root.position.set(v.pos.x, v.pos.y - v.heave, v.pos.z);
      tmp.e.set(v.pitch, v.yaw, 0, 'YXZ');
      root.quaternion.setFromEuler(tmp.e);
      // 让车身的俯仰/侧倾叠加在模型原始修正朝向上，避免翻转模型时丢失车头方向
      inst.body.rotation.set(v.bodyPitch, inst.flipY, v.bodyRoll);
      const wheelRot = v.wheelSpin;
      for (const k of ['FL', 'FR', 'RL', 'RR'] as const) {
        const w = inst.wheels[k];
        if (!w) continue;
        if (k[0] === 'F') w.steer.rotation.y = v.steerAngle;
        w.spin.rotation.x = k[0] === 'R' ? wheelRot + v.rearSpinBoost * state.clock.elapsedTime * 0.05 : wheelRot;
      }
      setCarLights(inst, v.braking || r.input.handbrake ? 1 : 0, tod.night ? 1 : 0.28, tod.night ? 1 : 0);

      // 距离裁剪：远处不生成特效
      const d2 = (v.pos.x - camPos.x) ** 2 + (v.pos.z - camPos.z) ** 2;
      if (d2 > 200 * 200 || session.phase === 'intro' || session.phase === 'countdown') {
        if (r.isPlayer && session.phase === 'countdown' && input.throttle > 0.5) {
          // 原地轰油门的尾气
          const fx0 = Math.sin(v.yaw);
          const fz0 = Math.cos(v.yaw);
          if (Math.random() < 0.3) fx.smoke.emit(v.pos.x - fx0 * v.halfLength, v.pos.y + 0.35, v.pos.z - fz0 * v.halfLength, -fx0 * 2, 0.5, -fz0 * 2, 0.8, 0.5, 1.2, 0.18, 0.8, 0.8, 0.82);
        }
        return;
      }
      root.updateMatrixWorld();
      const fxv = Math.sin(v.yaw);
      const fzv = Math.cos(v.yaw);
      const slip = Math.abs(v.slipRear);
      const smokeAmt = v.grounded && !v.onGrass ? Math.max(0, (slip - 0.12) * 3.2) * Math.min(1, v.speed / 8) + v.wheelspinAmount * 1.2 + (r.input.handbrake && v.speed > 5 ? 0.4 : 0) : 0;
      const markAmt = v.grounded && !v.onGrass ? Math.max(smokeAmt, v.braking && v.speed > 20 && r.input.brake > 0.8 ? 0.35 : 0) : 0;
      (['RL', 'RR', 'FL', 'FR'] as const).forEach((k, wi) => {
        const w = inst.wheels[k];
        if (!w) return;
        w.steer.getWorldPosition(tmp.w);
        const isRear = wi < 2;
        const amt = isRear ? markAmt : Math.max(0, (Math.abs(v.slipFront) - 0.2) * 2) * (v.grounded ? 1 : 0);
        fx.skid.add(r.id * 4 + wi, tmp.w.x, v.pos.y, tmp.w.z, fxv, fzv, 0.28, amt);
        if (isRear && smokeAmt > 0.15 && Math.random() < Math.min(1, smokeAmt) * 0.9) {
          const shade = tod.night ? 0.55 : 0.92;
          fx.smoke.emit(
            tmp.w.x + (Math.random() - 0.5) * 0.3,
            v.pos.y + 0.25,
            tmp.w.z + (Math.random() - 0.5) * 0.3,
            v.vel.x * 0.25 + (Math.random() - 0.5) * 1.5,
            0.6 + Math.random() * 0.8,
            v.vel.z * 0.25 + (Math.random() - 0.5) * 1.5,
            1.6 + Math.random() * 1.2,
            0.9,
            2.6,
            Math.min(0.55, smokeAmt * 0.35),
            shade,
            shade,
            shade * 1.02,
          );
        }
        if (isRear && v.onGrass && v.speed > 6 && Math.random() < 0.5) {
          fx.dirt.emit(tmp.w.x, v.pos.y + 0.2, tmp.w.z, -v.vel.x * 0.1 + (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2.5, -v.vel.z * 0.1 + (Math.random() - 0.5) * 2, 0.9, 0.35, 1.2, 0.6, 0.42, 0.34, 0.22);
        }
      });
      if (v.nitroActive) {
        for (let k = 0; k < 3; k++) {
          const side = k % 2 ? 0.35 : -0.35;
          const lx = Math.cos(v.yaw) * side;
          const lz = -Math.sin(v.yaw) * side;
          fx.flame.emit(
            v.pos.x - fxv * (v.halfLength - 0.1) + lx,
            v.pos.y + 0.42,
            v.pos.z - fzv * (v.halfLength - 0.1) + lz,
            v.vel.x - fxv * 14,
            0,
            v.vel.z - fzv * 14,
            0.12 + Math.random() * 0.06,
            0.55,
            -1.5,
            0.9,
            0.35 + Math.random() * 0.2,
            0.55,
            1,
          );
        }
      }
    });
    fx.smoke.update(dt);
    fx.dirt.update(dt);
    fx.sparks.update(dt);
    fx.flame.update(dt);
    world.water.material instanceof THREE.MeshPhysicalMaterial && world.water.material.normalMap?.offset.set(state.clock.elapsedTime * 0.004, state.clock.elapsedTime * 0.0025);

    // ---------- 相机 ----------
    const mode = CAMERA_MODES[c.mode];
    const pInst = instances[instances.length - 1];
    const speedF = Math.min(1, pv.speed / 85);
    hud.speedFactor = speedF;
    c.shake *= Math.exp(-dt * 5);
    const cam3 = camera as THREE.PerspectiveCamera;
    const fyaw = pv.yaw;
    let fovTarget = mode.fov + speedF * 14 + (pv.nitroActive ? 8 : 0);

    if (session.phase === 'intro') {
      const t = session.phaseTime / 3.2;
      const a = pv.yaw + Math.PI * (0.15 + 0.85 * THREE.MathUtils.smootherstep(t, 0, 1)) + Math.PI;
      const r = 7.5 - t * 1.5;
      camPos.set(pv.pos.x + Math.sin(a) * r, pv.pos.y + 1.2 + t * 0.6, pv.pos.z + Math.cos(a) * r);
      tmp.look.set(pv.pos.x, pv.pos.y + 0.7, pv.pos.z);
      camera.lookAt(tmp.look);
      fovTarget = 40;
      c.yaw = pv.yaw;
    } else if (session.phase === 'finished') {
      c.t += dt;
      const a = pv.yaw + c.t * 0.25 + Math.PI * 0.75;
      camPos.set(pv.pos.x + Math.sin(a) * 8, pv.pos.y + 2.0, pv.pos.z + Math.cos(a) * 8);
      tmp.look.set(pv.pos.x, pv.pos.y + 0.6, pv.pos.z);
      camera.lookAt(tmp.look);
      fovTarget = 45;
    } else if (c.mode === 2) {
      // 车头视角：固定在车身上
      pInst.root.updateMatrixWorld();
      tmp.pos.set(0, Math.max(0.62, pInst.info.height * 0.5), pInst.info.length / 2 + 0.05).applyMatrix4(pInst.root.matrixWorld);
      camPos.copy(tmp.pos);
      tmp.look.set(0, Math.max(0.62, pInst.info.height * 0.5) - 0.05, pInst.info.length / 2 + 20).applyMatrix4(pInst.root.matrixWorld);
      camera.lookAt(tmp.look);
      c.yaw = pv.yaw;
    } else {
      // 相机偏航追随车头，漂移时部分跟随速度方向
      const velYaw = pv.speed > 4 ? Math.atan2(pv.vel.x, pv.vel.z) : fyaw;
      let blendYaw = fyaw;
      let d = velYaw - fyaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < 1.4 && pv.forwardSpeed > 0) blendYaw = fyaw + d * 0.45;
      if (pv.forwardSpeed < -2) blendYaw = fyaw; // 倒车
      let dy = blendYaw - c.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      c.yaw += dy * (1 - Math.exp(-dt * 7));
      const lookBack = consumeLookBack();
      const yawUse = c.yaw + (lookBack ? Math.PI : 0);
      c.dist += (mode.dist + speedF * 1.1 - (pv.nitroActive ? -0.5 : 0) - c.dist) * (1 - Math.exp(-dt * 3));
      const h = mode.height + speedF * 0.2;
      c.pitchLag += (pv.pos.y - c.pitchLag) * (1 - Math.exp(-dt * 8));
      camPos.set(pv.pos.x - Math.sin(yawUse) * c.dist, c.pitchLag + h, pv.pos.z - Math.cos(yawUse) * c.dist);
      // 相机不钻地
      const pr = track.project(camPos.x, camPos.z, pv.proj.index);
      const floor = (Math.abs(pr.lateral) < track.wallOffset + 6 ? pr.height : world.groundHeight(camPos.x, camPos.z)) + 0.5;
      if (camPos.y < floor) camPos.y = floor;
      tmp.look.set(pv.pos.x + Math.sin(yawUse) * 3.5, pv.pos.y + mode.look, pv.pos.z + Math.cos(yawUse) * 3.5);
      camera.lookAt(tmp.look);
    }
    // 震动
    const shakeAmt = c.shake * 0.25 + (session.phase === 'racing' ? speedF * speedF * 0.02 + (pv.onGrass ? 0.05 * speedF : 0) : 0);
    if (shakeAmt > 0.001) {
      const t = state.clock.elapsedTime;
      camera.rotateZ(Math.sin(t * 43) * shakeAmt * 0.08);
      camera.rotateX(Math.sin(t * 37 + 1) * shakeAmt * 0.05);
      camera.rotateY(Math.sin(t * 29 + 2) * shakeAmt * 0.04);
    }
    c.fov += (fovTarget - c.fov) * (1 - Math.exp(-dt * 3));
    cam3.fov = c.fov;
    cam3.updateProjectionMatrix();
    [fx.smoke, fx.dirt, fx.sparks, fx.flame].forEach((p) => p.setViewport(size.height * gl.getPixelRatio(), cam3.fov));

    // ---------- 音频 ----------
    const racing = session.phase !== 'intro';
    const pr0 = session.player;
    audio.updateDriving({
      rpm: pv.rpm,
      throttle: racing || session.phase === 'intro' ? Math.max(pr0.input.throttle, session.phase === 'countdown' || session.phase === 'intro' ? input.throttle : 0) : 0,
      cylinders: pv.def.tune.cylinders || 8,
      tone: pv.def.tune.engineTone,
      speed: pv.speed,
      slip: pv.grounded && !pv.onGrass ? Math.max(0, Math.abs(pv.slipRear) - 0.1) * 2 + pv.wheelspinAmount * 0.6 : 0,
      nitro: pv.nitroActive,
      grass: pv.onGrass,
    });
    // 最近的对手引擎
    let nearest = null as null | (typeof session.racers)[number];
    let nd = Infinity;
    for (const r of session.racers) {
      if (r.isPlayer) continue;
      const d = r.vehicle.pos.distanceTo(camPos);
      if (d < nd) {
        nd = d;
        nearest = r;
      }
    }
    if (nearest) {
      const nv = nearest.vehicle;
      tmp.v.copy(nv.pos).sub(camPos);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      audio.updateRival({ rpm: nv.rpm, throttle: nearest.input.throttle, cylinders: nv.def.tune.cylinders || 8, tone: nv.def.tune.engineTone, speed: nv.speed, distance: nd, pan: tmp.v.normalize().dot(right) });
    }

    // ---------- HUD ----------
    hud.speed = Math.abs(pv.forwardSpeed) * 3.6;
    hud.rpm = pv.rpm;
    hud.gear = pv.reversing ? 'R' : pv.speed < 0.5 && pr0.input.throttle < 0.1 ? 'N' : String(pv.gear);
    hud.nitro = pv.nitro;
    hud.nitroActive = pv.nitroActive;
    hud.lap = Math.max(1, Math.min(session.laps, pr0.lap));
    hud.position = pr0.position;
    hud.lapTime = session.phase === 'racing' ? session.raceTime - pr0.lapStart : 0;
    hud.totalTime = session.raceTime;
    hud.bestLap = pr0.bestLap;
    const sorted = [...session.racers].sort((a, b) => a.position - b.position);
    const refSpeed = Math.max(25, pv.speed);
    hud.standings = sorted.map((r) => {
      const gap = (r.progress - pr0.progress) / refSpeed;
      return { name: r.name, isPlayer: r.isPlayer, carId: r.def.id, gap: r.isPlayer ? '' : `${gap > 0 ? '+' : '-'}${Math.abs(gap).toFixed(1)}s` };
    });
    hud.minimap = session.racers.map((r) => ({ x: r.vehicle.pos.x, z: r.vehicle.pos.z, player: r.isPlayer, color: r.def.accent }));

    // 夜间大灯
    if (headlight.current) headlight.current.intensity = tod.night ? 400 : 0;
  });

  const follow = useMemo(() => () => session.player.vehicle.pos, [session]);

  return (
    <>
      <Atmosphere tod={cfg.timeOfDay} follow={follow} quality={cfg.quality} />
      <primitive object={world.group} />
      {instances.map((inst, i) => (
        <primitive key={i} object={inst.root} />
      ))}
      <primitive object={fx.skid.mesh} />
      <primitive object={fx.smoke.points} />
      <primitive object={fx.dirt.points} />
      <primitive object={fx.sparks.points} />
      <primitive object={fx.flame.points} />
      <spotLight ref={headlight} angle={0.55} penumbra={0.6} distance={120} decay={1.2} intensity={0} color="#fff3e0" />
      <PostFX mode="race" />
    </>
  );
}

function consumeLookBack() {
  // 按住 Q 或手柄 LB 回看
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = Array.from(pads).find((p) => p && p.connected);
  return isKeyDown('KeyQ') || !!pad?.buttons[4]?.pressed;
}
