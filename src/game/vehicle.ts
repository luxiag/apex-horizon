import * as THREE from 'three';
import type { CarDef } from './cars';
import type { Track, TrackProjection } from './track';

export interface DriveInput {
  throttle: number;
  brake: number;
  steer: number; // +1 左
  handbrake: boolean;
  nitro: boolean;
}

export const emptyInput = (): DriveInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false });

const G = 9.81;
const clamp = THREE.MathUtils.clamp;

function pacejka(alpha: number, peak: number) {
  // 简化魔术公式：峰值约在 peak 弧度处，之后缓慢衰减
  const B = 1.0 / peak;
  const C = 1.35;
  return Math.sin(C * Math.atan(B * alpha * 1.15));
}

export interface CollisionEvent {
  impulse: number;
  x: number;
  y: number;
  z: number;
}

/**
 * 街机化的单车模型（bicycle model）+ 魔术公式轮胎 + 摩擦圆
 * 手感目标：接近地平线的“抓地 + 可控漂移”。
 */
export class Vehicle {
  def: CarDef;
  track: Track;
  // 状态
  pos = new THREE.Vector3();
  vel = new THREE.Vector3(); // 世界坐标速度（x,z 水平，y 垂直）
  yaw = 0;
  yawRate = 0;
  steerAngle = 0;
  steerInput = 0;
  gear = 1;
  rpm = 1000;
  shiftTimer = 0;
  reversing = false;
  nitro = 1;
  nitroActive = false;
  airborne = false;
  grounded = true;
  wheelSpin = 0; // 轮子滚动角
  rearSpinBoost = 0;
  // 表现用
  pitch = 0;
  roll = 0;
  bodyPitch = 0;
  bodyRoll = 0;
  bodyPitchV = 0;
  bodyRollV = 0;
  heave = 0;
  // 遥测
  speed = 0;
  forwardSpeed = 0;
  lateralSpeed = 0;
  slipRear = 0;
  slipFront = 0;
  driftAngle = 0;
  wheelspinAmount = 0;
  onGrass = false;
  onCurb = false;
  braking = false;
  accelLong = 0;
  accelLat = 0;
  lastShift = 0; // +1 升档 / -1 降档（事件）
  collisions: CollisionEvent[] = [];
  // 赛道投影
  proj: TrackProjection = { index: 0, s: 0, lateral: 0, height: 0 };
  // 参数
  mass: number;
  inertia: number;
  a: number;
  b: number;
  wheelBase: number;
  cgHeight = 0.45;
  wheelRadius: number;
  halfWidth: number;
  halfLength: number;
  dragK: number;
  finalDrive: number;
  gripScale = 1;
  powerScale = 1;
  isAI = false;
  assist = true;

  constructor(def: CarDef, track: Track, dims: { wheelBase: number; wheelRadius: number; width: number; length: number }) {
    this.def = def;
    this.track = track;
    this.mass = def.tune.mass;
    this.wheelBase = clamp(dims.wheelBase, 2.2, 3.0);
    this.a = this.wheelBase * 0.47;
    this.b = this.wheelBase * 0.53;
    this.inertia = this.mass * (this.a * this.a + this.b * this.b) * 0.62;
    this.wheelRadius = clamp(dims.wheelRadius, 0.28, 0.42);
    this.halfWidth = dims.width / 2;
    this.halfLength = dims.length / 2;
    const vTop = def.tune.topSpeed / 3.6;
    this.dragK = (def.tune.power * 1000 * 0.92) / (vTop * vTop * vTop);
    const top = def.tune.gears[def.tune.gears.length - 1];
    // 让最高档在红线时刚好达到极速的 1.03 倍
    this.finalDrive = (def.tune.redline * 2 * Math.PI * this.wheelRadius) / (60 * top * vTop * 1.03);
  }

  placeAt(s: number, lateral: number) {
    const p = this.track.pointAt(s, lateral);
    this.pos.copy(p);
    this.yaw = this.track.headingAt(s);
    this.vel.set(0, 0, 0);
    this.yawRate = 0;
    this.gear = 1;
    this.rpm = 1000;
    this.proj = this.track.project(p.x, p.z, -1);
    this.pos.y = this.proj.height;
  }

  resetToTrack() {
    const pr = this.track.project(this.pos.x, this.pos.z, this.proj.index);
    const lat = clamp(pr.lateral, -this.track.halfWidth + 2.5, this.track.halfWidth - 2.5);
    this.placeAt(pr.s, lat);
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  gearRatio(g = this.gear) {
    return this.def.tune.gears[clamp(g, 1, this.def.tune.gears.length) - 1] * this.finalDrive;
  }

  enginePower(rpmN: number) {
    // 归一化功率曲线
    if (this.def.tune.cylinders === 0) return rpmN < 0.35 ? 0.85 + rpmN * 0.4 : 1.0 - Math.max(0, rpmN - 0.8) * 0.8; // 电机
    const x = clamp(rpmN, 0.1, 1.05);
    return clamp(0.32 + 1.55 * x - 0.9 * x * x, 0, 1) * (x > 1 ? 0.6 : 1);
  }

  step(dt: number, input: DriveInput) {
    const t = this.def.tune;
    const tr = this.track;
    this.lastShift = 0;

    // ---------- 赛道投影 & 地面 ----------
    this.proj = tr.project(this.pos.x, this.pos.z, this.proj.index, this.proj);
    const lat = Math.abs(this.proj.lateral);
    this.onGrass = lat > tr.halfWidth + 0.9;
    this.onCurb = !this.onGrass && lat > tr.halfWidth - 0.2 && Math.abs(tr.curv[this.proj.index]) > 0.004;

    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const lx = fz; // 左
    const lz = -fx;
    let vF = this.vel.x * fx + this.vel.z * fz;
    let vL = this.vel.x * lx + this.vel.z * lz;
    const speed = Math.hypot(vF, vL);

    // ---------- 转向 ----------
    const steerRate = this.isAI ? 6 : input.steer === 0 ? 7 : 4.2;
    this.steerInput += clamp(input.steer - this.steerInput, -steerRate * dt, steerRate * dt);
    const speedFactor = 1 / (1 + Math.max(0, speed - 6) / 24);
    let maxSteer = t.steer * speedFactor;
    let steer = this.steerInput * maxSteer;
    // 漂移辅助：根据车身侧滑角自动反打
    const beta = speed > 3 ? Math.atan2(vL, Math.abs(vF)) : 0;
    if (this.assist && speed > 8) {
      steer += clamp(beta * 0.55, -0.35, 0.35) * (input.handbrake ? 0.4 : 1);
    }
    this.steerAngle = clamp(steer, -t.steer - 0.2, t.steer + 0.2);
    const delta = this.steerAngle;

    // ---------- 发动机/变速箱 ----------
    const wantsReverse = input.brake > 0.3 && vF < 1.5 && input.throttle < 0.1;
    if (wantsReverse && !this.reversing && Math.abs(vF) < 1.5) this.reversing = true;
    if (this.reversing && input.throttle > 0.1) this.reversing = false;

    const nGears = t.gears.length;
    const wheelRpm = (Math.abs(vF) / this.wheelRadius) * (60 / (2 * Math.PI));
    let engRpm = wheelRpm * this.gearRatio();
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (!this.reversing && this.shiftTimer <= 0) {
      if (engRpm > t.redline * 0.93 && this.gear < nGears) {
        this.gear++;
        this.shiftTimer = 0.18;
        this.lastShift = 1;
      } else if (this.gear > 1 && wheelRpm * this.gearRatio(this.gear - 1) < t.redline * 0.62) {
        this.gear--;
        this.shiftTimer = 0.12;
        this.lastShift = -1;
      }
    }
    if (this.reversing) this.gear = 1;
    engRpm = wheelRpm * this.gearRatio();
    const idle = t.cylinders === 0 ? 0 : 900;
    const throttle = this.reversing ? input.brake : input.throttle;
    // 起步时离合打滑
    const clutchRpm = idle + throttle * (t.redline * 0.45);
    const targetRpm = this.gear === 1 && engRpm < clutchRpm ? Math.max(engRpm, clutchRpm) : Math.max(engRpm, idle);
    const rpmLerp = 1 - Math.exp(-dt * (this.shiftTimer > 0 ? 18 : 12));
    this.rpm += (Math.min(targetRpm, t.redline * 1.02) - this.rpm) * rpmLerp;
    const rpmN = this.rpm / t.redline;

    // 氮气
    this.nitroActive = input.nitro && this.nitro > 0.02 && throttle > 0.1 && !this.reversing;
    if (this.nitroActive) this.nitro = Math.max(0, this.nitro - dt * 0.2);
    const nitroMul = this.nitroActive ? 1.55 : 1;

    const powerW = t.power * 1000 * this.enginePower(rpmN) * this.powerScale * nitroMul;
    let driveF = 0;
    if (this.shiftTimer <= 0 || this.reversing) {
      if (this.reversing) driveF = -throttle * Math.min(this.mass * 4, powerW / Math.max(Math.abs(vF), 5)) * (vF < -9 ? 0 : 1);
      else driveF = (throttle * powerW) / Math.max(Math.abs(vF), 7);
      if (!this.reversing && rpmN > 1.0 && this.gear === nGears) driveF *= 0.2;
    }

    // ---------- 载荷 ----------
    const L = this.wheelBase;
    const downforce = 0.9 * speed * speed; // N
    const weight = this.mass * G + downforce;
    const transfer = (this.mass * this.accelLong * this.cgHeight) / L;
    let Nf = clamp(weight * (this.b / L) - transfer, weight * 0.15, weight * 0.85);
    let Nr = weight - Nf;
    if (!this.grounded) {
      Nf = 0;
      Nr = 0;
    }

    let mu = t.grip * this.gripScale * (this.isAI ? 1 : 1.06);
    if (this.onGrass) mu *= 0.68;

    // ---------- 纵向力（刹车/驱动） ----------
    const brakeInput = this.reversing ? 0 : input.brake;
    this.braking = brakeInput > 0.05 && vF > 1;
    let brakeF = 0;
    if (brakeInput > 0 && Math.abs(vF) > 0.3) brakeF = brakeInput * t.brake * this.mass * G * 1.25 * Math.sign(vF);
    let hbF = 0;
    if (input.handbrake && Math.abs(vF) > 0.3) hbF = this.mass * G * 0.55 * Math.sign(vF);

    const driveRearShare = this.def.specs.drive === 'AWD' ? 0.55 : 1;
    const rearLong = driveF * driveRearShare - brakeF * 0.4 - hbF;
    const frontLong = driveF * (1 - driveRearShare) - brakeF * 0.6;

    // ---------- 侧向力（魔术公式 + 摩擦圆） ----------
    const vFa = Math.max(Math.abs(vF), 2.5);
    const alphaF = Math.atan2(vL + this.yawRate * this.a, vFa) - delta * Math.sign(vF || 1);
    const alphaR = Math.atan2(vL - this.yawRate * this.b, vFa);
    this.slipFront = alphaF;
    this.slipRear = alphaR;

    const maxRearLong = mu * Nr;
    const rearUsage = clamp(Math.abs(rearLong) / Math.max(maxRearLong, 1), 0, 1.5);
    this.wheelspinAmount = !this.reversing && driveF > 0 && rearUsage > 0.95 ? clamp((rearUsage - 0.95) * 3, 0, 1) : 0;
    let rearLatMax = mu * Nr * Math.sqrt(Math.max(0.05, 1 - Math.min(rearUsage, 1) ** 2 * 0.85));
    if (input.handbrake) rearLatMax *= t.drift;
    const frontLatMax = mu * Nf * Math.sqrt(Math.max(0.1, 1 - (Math.abs(frontLong) / Math.max(mu * Nf, 1)) ** 2 * 0.6));

    const Ff = -frontLatMax * pacejka(alphaF, 0.16);
    const Fr = -rearLatMax * pacejka(alphaR, 0.13);
    const rearLongClamped = clamp(rearLong, -maxRearLong * 1.05, maxRearLong * (1.05 - this.wheelspinAmount * 0.3));
    const frontLongClamped = clamp(frontLong, -mu * Nf * 1.1, mu * Nf * 1.1);

    // 阻力
    const drag = this.dragK * vF * Math.abs(vF);
    const rolling = (this.onGrass ? 0.06 : 0.012) * this.mass * G * Math.sign(vF) * Math.min(1, Math.abs(vF));
    const slope = this.grounded ? -this.mass * G * tr.ty[this.proj.index] * (fx * tr.tx[this.proj.index] + fz * tr.tz[this.proj.index]) : 0;

    // 车身坐标系下的力
    const cosD = Math.cos(delta);
    const sinD = Math.sin(delta);
    let Fx = rearLongClamped + frontLongClamped * cosD - Ff * sinD - drag - rolling + slope;
    let Fy = Fr + Ff * cosD + frontLongClamped * sinD;
    if (!this.grounded) {
      Fx = -drag;
      Fy = 0;
    }
    let torque = this.a * (Ff * cosD + frontLongClamped * sinD) - this.b * Fr;

    // 稳定性辅助：阻尼偏航
    if (this.assist && this.grounded) {
      const damp = input.handbrake ? 0.15 : this.isAI ? 0.9 : 0.5;
      torque -= this.yawRate * this.inertia * damp;
    }

    // 世界坐标积分
    const ax = (Fx * fx + Fy * lx) / this.mass;
    const az = (Fx * fz + Fy * lz) / this.mass;
    this.vel.x += ax * dt;
    this.vel.z += az * dt;
    this.yawRate += (torque / this.inertia) * dt;

    // 低速：运动学转向 + 横向阻尼，避免数值抖动
    vF = this.vel.x * fx + this.vel.z * fz;
    vL = this.vel.x * lx + this.vel.z * lz;
    if (this.grounded) {
      const lowBlend = clamp(1 - Math.abs(vF) / 6, 0, 1);
      if (lowBlend > 0) {
        const kin = (vF * Math.tan(delta)) / L;
        this.yawRate += (kin - this.yawRate) * lowBlend * Math.min(1, dt * 12);
        vL *= 1 - lowBlend * Math.min(1, dt * 10);
      }
      // 刹停
      if (brakeInput > 0 && Math.abs(vF) < 0.4 && !this.reversing && input.throttle < 0.05) vF *= 0.8;
      if (input.throttle < 0.05 && brakeInput < 0.05 && Math.abs(vF) < 0.25) vF *= 0.9;
      this.vel.x = fx * vF + lx * vL;
      this.vel.z = fz * vF + lz * vL;
    }

    this.yaw += this.yawRate * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // 纵/横向加速度（用于载荷转移与车身姿态）
    this.accelLong += ((Fx / this.mass) - this.accelLong) * Math.min(1, dt * 8);
    this.accelLat += ((Fy / this.mass) - this.accelLat) * Math.min(1, dt * 8);

    // ---------- 垂直 ----------
    this.proj = tr.project(this.pos.x, this.pos.z, this.proj.index, this.proj);
    const gh = this.proj.height + (this.onGrass ? -0.02 : 0);
    // 接地车辆直接跟随赛道表面。旧逻辑把相邻采样点的高度差转成垂直速度，
    // 在起步坡度或高速下坡时会把车辆错误地弹到空中，911 的长车身尤其明显。
    if (this.grounded) {
      this.pos.y = gh;
      this.vel.y = 0;
    } else {
      this.vel.y -= G * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= gh) {
        if (this.vel.y < -3) {
          this.bodyPitchV -= this.vel.y * 0.05;
          this.heave = Math.min(0.12, -this.vel.y * 0.015);
        }
        this.pos.y = gh;
        this.vel.y = 0;
        this.grounded = true;
      }
    }
    this.airborne = !this.grounded;

    // ---------- 护墙碰撞 ----------
    const wall = tr.wallOffset - this.halfWidth * 0.95;
    const pl = this.proj.lateral;
    if (Math.abs(pl) > wall) {
      const i = this.proj.index;
      const side = Math.sign(pl);
      const nx = tr.tz[i] * side; // 指向墙外
      const nz = -tr.tx[i] * side;
      const pen = Math.abs(pl) - wall;
      this.pos.x -= nx * pen;
      this.pos.z -= nz * pen;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn > 0) {
        this.vel.x -= nx * vn * 1.35;
        this.vel.z -= nz * vn * 1.35;
        const tv = 1 - Math.min(0.35, vn * 0.02);
        this.vel.x *= tv;
        this.vel.z *= tv;
        // 车头被墙推回赛道方向
        const tanYaw = Math.atan2(tr.tx[i], tr.tz[i]);
        let d = tanYaw - this.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) < Math.PI / 2) this.yawRate += d * Math.min(3, vn * 0.25);
        this.yawRate *= 0.6;
        if (vn > 1.5) this.collisions.push({ impulse: vn, x: this.pos.x + nx * this.halfWidth, y: this.pos.y + 0.5, z: this.pos.z + nz * this.halfWidth });
      }
    }

    // ---------- 氮气回充 ----------
    const driftDeg = Math.abs(beta) * (180 / Math.PI);
    this.driftAngle = speed > 8 ? driftDeg * Math.sign(beta) : 0;
    if (!this.nitroActive) {
      let refill = 0.012;
      if (driftDeg > 12 && speed > 12) refill += 0.1;
      if (speed > 60) refill += 0.01;
      this.nitro = Math.min(1, this.nitro + refill * dt);
    }

    // ---------- 表现：车身姿态 ----------
    const i = this.proj.index;
    const slopeAlong = tr.ty[i] * (fx * tr.tx[i] + fz * tr.tz[i]);
    this.pitch += (-Math.atan(slopeAlong) - this.pitch) * Math.min(1, dt * 10);
    const kP = 60;
    const cP = 9;
    const targetPitch = clamp(-this.accelLong * 0.0045, -0.05, 0.05);
    this.bodyPitchV += ((targetPitch - this.bodyPitch) * kP - this.bodyPitchV * cP) * dt;
    this.bodyPitch += this.bodyPitchV * dt;
    const targetRoll = clamp(this.accelLat * 0.0055, -0.07, 0.07);
    this.bodyRollV += ((targetRoll - this.bodyRoll) * kP - this.bodyRollV * cP) * dt;
    this.bodyRoll += this.bodyRollV * dt;
    this.heave *= Math.exp(-dt * 6);

    // 轮子
    vF = this.vel.x * fx + this.vel.z * fz;
    this.forwardSpeed = vF;
    this.lateralSpeed = vL;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.wheelSpin += (vF / this.wheelRadius) * dt;
    this.rearSpinBoost += ((this.wheelspinAmount > 0 ? 25 : 0) - this.rearSpinBoost) * Math.min(1, dt * 5);
  }
}
