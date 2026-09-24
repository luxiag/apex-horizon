import * as THREE from 'three';
import { CARS, type CarDef } from './cars';
import type { Track } from './track';
import { Vehicle, emptyInput, type DriveInput } from './vehicle';
import { AIDriver, AI_NAMES } from './ai';
import type { Difficulty } from './store';

export type RacePhase = 'intro' | 'countdown' | 'racing' | 'finished';

export interface Racer {
  id: number;
  name: string;
  def: CarDef;
  vehicle: Vehicle;
  ai: AIDriver | null;
  isPlayer: boolean;
  lap: number; // 已开始的圈数（越过起跑线后为 1）
  halfway: boolean;
  lastS: number;
  lapStart: number;
  lastLap: number | null;
  bestLap: number | null;
  finishTime: number | null;
  progress: number;
  position: number;
  paint?: string;
  input: DriveInput;
}

export interface HudMessage {
  id: number;
  text: string;
  sub?: string;
  kind: 'info' | 'good' | 'warn' | 'drift';
  t: number;
}

/** HUD 读取的共享可变状态（避免每帧触发 React 渲染） */
export const hud = {
  speed: 0,
  rpm: 0,
  redline: 8000,
  gear: 'N' as string,
  nitro: 1,
  nitroActive: false,
  lap: 0,
  totalLaps: 3,
  position: 1,
  totalCars: 1,
  lapTime: 0,
  totalTime: 0,
  bestLap: null as number | null,
  lastLap: null as number | null,
  phase: 'intro' as RacePhase,
  countdown: -1,
  wrongWay: false,
  driftScore: 0,
  driftMult: 1,
  driftActive: false,
  totalDrift: 0,
  messages: [] as HudMessage[],
  standings: [] as { name: string; isPlayer: boolean; gap: string; carId: string }[],
  minimap: [] as { x: number; z: number; player: boolean; color: string }[],
  cameraName: '',
  speedFactor: 0,
  impact: 0,
  paused: false,
};

let msgId = 0;
export function pushMessage(text: string, kind: HudMessage['kind'] = 'info', sub?: string) {
  hud.messages.push({ id: msgId++, text, sub, kind, t: performance.now() });
  if (hud.messages.length > 4) hud.messages.shift();
}

export interface RaceConfig {
  playerCar: CarDef;
  playerPaint?: string;
  laps: number;
  opponents: number;
  difficulty: Difficulty;
  dims: Record<string, { wheelBase: number; wheelRadius: number; width: number; length: number }>;
}

export class RaceSession {
  track: Track;
  racers: Racer[] = [];
  player: Racer;
  phase: RacePhase = 'intro';
  phaseTime = 0;
  raceTime = 0;
  laps: number;
  finishOrder: Racer[] = [];
  wrongWayTimer = 0;
  driftHold = 0;
  lastPosition = 0;
  events: { type: 'impact'; strength: number; player: boolean; x: number; y: number; z: number }[] = [];

  constructor(track: Track, cfg: RaceConfig) {
    this.track = track;
    this.laps = cfg.laps;
    const skillBase = cfg.difficulty === 'easy' ? 0.86 : cfg.difficulty === 'hard' ? 1.02 : 0.95;
    const others = CARS.filter((c) => c.id !== cfg.playerCar.id);
    const n = cfg.opponents;
    const grid: { def: CarDef; ai: boolean; name: string; paint?: string }[] = [];
    for (let i = 0; i < n; i++) {
      const def = others.length ? others[i % others.length] : cfg.playerCar;
      grid.push({ def, ai: true, name: AI_NAMES[i % AI_NAMES.length].name });
    }
    // 玩家在最后一排发车，增加超车乐趣
    grid.push({ def: cfg.playerCar, ai: false, name: 'YOU', paint: cfg.playerPaint });

    grid.forEach((g, idx) => {
      const v = new Vehicle(g.def, track, cfg.dims[g.def.id]);
      const s = -12 - idx * 9;
      const lat = idx % 2 === 0 ? 3.2 : -3.2;
      v.placeAt((s + track.length) % track.length, lat);
      let ai: AIDriver | null = null;
      if (g.ai) {
        const prof = { ...AI_NAMES[idx % AI_NAMES.length] };
        prof.skill *= skillBase;
        ai = new AIDriver(v, prof);
        v.powerScale = cfg.difficulty === 'hard' ? 1.04 : cfg.difficulty === 'easy' ? 0.92 : 0.98;
      }
      const r: Racer = {
        id: idx,
        name: g.name,
        def: g.def,
        vehicle: v,
        ai,
        isPlayer: !g.ai,
        lap: 0,
        halfway: true,
        lastS: v.proj.s,
        lapStart: 0,
        lastLap: null,
        bestLap: null,
        finishTime: null,
        progress: 0,
        position: idx + 1,
        paint: g.paint,
        input: emptyInput(),
      };
      this.racers.push(r);
    });
    this.player = this.racers[this.racers.length - 1];
    hud.totalLaps = this.laps;
    hud.totalCars = this.racers.length;
    hud.redline = cfg.playerCar.tune.redline;
    hud.messages = [];
    hud.bestLap = null;
    hud.lastLap = null;
    hud.totalDrift = 0;
    hud.driftScore = 0;
    hud.phase = 'intro';
    hud.countdown = -1;
    hud.lap = 0;
    this.updateProgress();
    this.lastPosition = this.player.position;
  }

  private updateProgress() {
    const L = this.track.length;
    for (const r of this.racers) {
      const s = r.vehicle.proj.s;
      r.progress = r.lap >= 1 ? (r.lap - 1) * L + s : s - L;
    }
    const sorted = [...this.racers].sort((a, b) => {
      if (a.finishTime !== null && b.finishTime !== null) return a.finishTime - b.finishTime;
      if (a.finishTime !== null) return -1;
      if (b.finishTime !== null) return 1;
      return b.progress - a.progress;
    });
    sorted.forEach((r, i) => (r.position = i + 1));
  }

  /** 固定步长推进 */
  step(dt: number, playerInput: DriveInput) {
    this.phaseTime += dt;
    const tr = this.track;
    const L = tr.length;
    const frozen = this.phase === 'intro' || this.phase === 'countdown';

    if (this.phase === 'intro' && this.phaseTime > 3.2) {
      this.phase = 'countdown';
      this.phaseTime = 0;
    }
    if (this.phase === 'countdown') {
      hud.countdown = Math.min(5, Math.floor(this.phaseTime / 0.7) + 1);
      if (this.phaseTime > 0.7 * 5 + 0.6) {
        this.phase = 'racing';
        this.phaseTime = 0;
        this.raceTime = 0;
        hud.countdown = 0;
        this.racers.forEach((r) => {
          r.lapStart = 0;
          // 发车瞬间清除倒计时阶段留下的垂直残差，所有车辆从赛道表面起步。
          const v = r.vehicle;
          const p = tr.project(v.pos.x, v.pos.z, v.proj.index, v.proj);
          v.proj = p;
          v.pos.y = p.height;
          v.vel.y = 0;
          v.grounded = true;
          v.airborne = false;
          v.heave = 0;
        });
      }
    }
    if (this.phase === 'racing' || this.phase === 'finished') this.raceTime += dt;

    // 领先者，用于橡皮筋
    const playerProg = this.player.progress;

    for (const r of this.racers) {
      let input: DriveInput;
      if (frozen) {
        input = emptyInput();
        const v = r.vehicle;
        // 倒计时阶段锁定在发车位，避免重力积分或碰撞修正积累垂直速度。
        const start = tr.project(v.pos.x, v.pos.z, v.proj.index, v.proj);
        v.proj = start;
        v.pos.y = start.height;
        v.vel.set(0, 0, 0);
        v.yawRate = 0;
        v.grounded = true;
        v.airborne = false;
        v.heave = 0;
        if (r.isPlayer) {
          input.throttle = playerInput.throttle; // 可以原地轰油门
          const target = 1000 + playerInput.throttle * (v.def.tune.redline * 0.85 - 1000);
          v.rpm += (target - v.rpm) * Math.min(1, dt * (playerInput.throttle > 0 ? 6 : 3));
        }
        r.input = input;
        continue;
      }
      if (r.ai) {
        const gap = r.progress - playerProg;
        let rubber = 1;
        if (gap > 120) rubber = 0.94;
        else if (gap < -120) rubber = 1.05;
        input = r.ai.update(dt, this.racers.map((x) => x.vehicle), rubber);
      } else if (r.finishTime !== null) {
        // 冲线后由 AI 接管
        if (!r.ai) r.ai = new AIDriver(r.vehicle, { name: 'auto', skill: 0.8, aggression: 0.2, laneBias: 0 });
        input = r.ai.update(dt, this.racers.map((x) => x.vehicle), 0.75);
        r.vehicle.isAI = false;
      } else input = playerInput;
      r.input = input;
      r.vehicle.step(dt, input);

      // 计圈
      const s = r.vehicle.proj.s;
      if (s > L * 0.45 && s < L * 0.55) r.halfway = true;
      if (r.lastS > L - 60 && s < 60) {
        if (r.halfway || r.lap === 0) {
          r.lap += 1;
          r.halfway = false;
          if (r.lap > 1) {
            const lapTime = this.raceTime - r.lapStart;
            r.lastLap = lapTime;
            const isBest = r.bestLap === null || lapTime < r.bestLap;
            if (isBest) r.bestLap = lapTime;
            r.lapStart = this.raceTime;
            if (r.isPlayer && r.finishTime === null) {
              hud.lastLap = lapTime;
              if (isBest && r.lap > 2) pushMessage('最快圈速', 'good', formatLap(lapTime));
            }
          }
          if (r.lap > this.laps && r.finishTime === null) {
            r.finishTime = this.raceTime;
            this.finishOrder.push(r);
            if (r.isPlayer) {
              this.phase = 'finished';
              this.phaseTime = 0;
            }
          } else if (r.isPlayer && r.lap > 1) {
            if (r.lap === this.laps) pushMessage('最后一圈', 'warn', `第 ${r.lap} / ${this.laps} 圈`);
            else pushMessage(`第 ${r.lap} 圈`, 'info', `上一圈 ${formatLap(r.lastLap)}`);
          }
        }
      } else if (r.lastS < 60 && s > L - 60) {
        // 倒车越线
        if (r.lap > 0) {
          r.lap -= 1;
          r.halfway = true;
        }
      }
      r.lastS = s;
    }

    this.resolveCarCollisions();
    this.updateProgress();

    // 玩家事件
    const p = this.player.vehicle;
    for (const c of p.collisions) this.events.push({ type: 'impact', strength: c.impulse, player: true, x: c.x, y: c.y, z: c.z });
    p.collisions.length = 0;
    for (const r of this.racers) if (!r.isPlayer) r.vehicle.collisions.length = 0;

    if (!frozen && this.phase === 'racing') {
      // 逆行检测
      const i = p.proj.index;
      const dot = p.vel.x * tr.tx[i] + p.vel.z * tr.tz[i];
      if (dot < -3) this.wrongWayTimer += dt;
      else this.wrongWayTimer = Math.max(0, this.wrongWayTimer - dt * 2);
      hud.wrongWay = this.wrongWayTimer > 1.2;

      // 漂移计分
      const drifting = Math.abs(p.driftAngle) > 11 && p.speed > 14 && p.grounded && !p.onGrass;
      if (drifting) {
        this.driftHold = 0;
        if (!hud.driftActive) {
          hud.driftActive = true;
          hud.driftScore = 0;
          hud.driftMult = 1;
        }
        hud.driftScore += p.speed * Math.min(Math.abs(p.driftAngle), 45) * dt * 0.9 * hud.driftMult;
        hud.driftMult = Math.min(5, hud.driftMult + dt * 0.35);
      } else if (hud.driftActive) {
        this.driftHold += dt;
        if (p.onGrass) this.endDrift(false);
        else if (this.driftHold > 0.8) this.endDrift(true);
      }

      // 位次变化
      if (this.player.position < this.lastPosition) pushMessage(`超车`, 'good', `第 ${this.player.position} 名`);
      this.lastPosition = this.player.position;
    }

    hud.phase = this.phase;
  }

  endDrift(ok: boolean) {
    if (!hud.driftActive) return;
    hud.driftActive = false;
    const pts = Math.round(hud.driftScore);
    if (ok && pts > 150) {
      hud.totalDrift += pts;
      pushMessage(`漂移 +${pts.toLocaleString()}`, 'drift', `x${hud.driftMult.toFixed(1)} 连击`);
      this.player.vehicle.nitro = Math.min(1, this.player.vehicle.nitro + Math.min(0.25, pts / 12000));
    } else if (!ok && pts > 150) pushMessage('漂移中断', 'warn');
    hud.driftScore = 0;
  }

  private tmpA = new THREE.Vector3();
  private resolveCarCollisions() {
    const rs = this.racers;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i].vehicle;
        const b = rs[j].vehicle;
        const dx0 = b.pos.x - a.pos.x;
        const dz0 = b.pos.z - a.pos.z;
        if (dx0 * dx0 + dz0 * dz0 > 49) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 2) continue;
        const circles = (v: Vehicle) => {
          const fx = Math.sin(v.yaw);
          const fz = Math.cos(v.yaw);
          const off = v.halfLength - v.halfWidth;
          return [-off, 0, off].map((o) => [v.pos.x + fx * o, v.pos.z + fz * o]);
        };
        const ca = circles(a);
        const cb = circles(b);
        const ra = a.halfWidth * 0.98;
        const rb = b.halfWidth * 0.98;
        for (const [ax, az] of ca) {
          for (const [bx, bz] of cb) {
            const dx = bx - ax;
            const dz = bz - az;
            const d = Math.hypot(dx, dz);
            const minD = ra + rb;
            if (d >= minD || d < 1e-4) continue;
            const nx = dx / d;
            const nz = dz / d;
            const pen = minD - d;
            const ma = a.mass;
            const mb = b.mass;
            const wa = mb / (ma + mb);
            const wb = ma / (ma + mb);
            a.pos.x -= nx * pen * wa;
            a.pos.z -= nz * pen * wa;
            b.pos.x += nx * pen * wb;
            b.pos.z += nz * pen * wb;
            const rvx = b.vel.x - a.vel.x;
            const rvz = b.vel.z - a.vel.z;
            const vn = rvx * nx + rvz * nz;
            if (vn < 0) {
              const e = 0.25;
              const J = (-(1 + e) * vn) / (1 / ma + 1 / mb);
              a.vel.x -= (J / ma) * nx;
              a.vel.z -= (J / ma) * nz;
              b.vel.x += (J / mb) * nx;
              b.vel.z += (J / mb) * nz;
              // 偏航扰动
              const rax = ax - a.pos.x;
              const raz = az - a.pos.z;
              const rbx = bx - b.pos.x;
              const rbz = bz - b.pos.z;
              a.yawRate -= ((rax * -nz - raz * -nx) * J * 0.25) / a.inertia;
              b.yawRate += ((rbx * -nz - rbz * -nx) * J * 0.25) / b.inertia;
              if (-vn > 1.5 && (rs[i].isPlayer || rs[j].isPlayer)) {
                this.tmpA.set((ax + bx) / 2, a.pos.y + 0.6, (az + bz) / 2);
                this.events.push({ type: 'impact', strength: -vn, player: true, x: this.tmpA.x, y: this.tmpA.y, z: this.tmpA.z });
                if (hud.driftActive && (rs[i].isPlayer || rs[j].isPlayer)) this.endDrift(false);
              }
            }
          }
        }
      }
    }
  }

  /** 生成最终成绩（未完赛的按当前速度估算） */
  results() {
    const L = this.track.length;
    const total = this.laps * L;
    const rows = this.racers.map((r) => {
      let time = r.finishTime;
      if (time === null) {
        const remaining = Math.max(0, total - r.progress);
        const avg = Math.max(20, r.progress / Math.max(1, this.raceTime));
        time = this.raceTime + remaining / avg;
      }
      return { name: r.name, carId: r.def.id, isPlayer: r.isPlayer, time, bestLap: r.bestLap, finished: r.finishTime !== null };
    });
    rows.sort((a, b) => a.time - b.time);
    return rows;
  }
}

export function formatLap(t: number | null) {
  if (t === null) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t * 1000) % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
