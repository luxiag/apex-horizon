import type { Vehicle, DriveInput } from './vehicle';

export interface AIProfile {
  name: string;
  skill: number; // 0.85 ~ 1.05
  aggression: number;
  laneBias: number;
}

export class AIDriver {
  v: Vehicle;
  profile: AIProfile;
  offset = 0;
  targetOffset = 0;
  stuckTimer = 0;
  reverseTimer = 0;
  private input: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
  private wobble = Math.random() * 100;

  constructor(v: Vehicle, profile: AIProfile) {
    this.v = v;
    this.profile = profile;
    v.isAI = true;
  }

  update(dt: number, others: Vehicle[], rubber: number): DriveInput {
    const v = this.v;
    const tr = v.track;
    const inp = this.input;
    const speed = v.speed;
    const s = v.proj.s;
    this.wobble += dt;

    // 超车/避让：检测前方车辆
    let avoid = 0;
    for (const o of others) {
      if (o === v) continue;
      let ds = o.proj.s - s;
      if (ds < -tr.length / 2) ds += tr.length;
      if (ds > tr.length / 2) ds -= tr.length;
      if (ds > 0 && ds < 22) {
        const dl = o.proj.lateral - (v.proj.lateral);
        if (Math.abs(dl) < 2.6) {
          const closing = speed - o.speed;
          if (closing > -1) avoid += (dl >= 0 ? -1 : 1) * (1 - ds / 22) * 4.5;
        }
      }
    }
    const hw = tr.halfWidth - 1.8;
    const look = 10 + speed * 0.55;
    const idxAhead = tr.indexAt(s + look);
    const baseLine = tr.racingLine[idxAhead] * (0.85 + this.profile.aggression * 0.15) + this.profile.laneBias;
    this.targetOffset = Math.max(-hw, Math.min(hw, baseLine + avoid));
    this.offset += (this.targetOffset - this.offset) * Math.min(1, dt * 1.6);

    const target = tr.pointAt(s + look, this.offset);
    const dx = target.x - v.pos.x;
    const dz = target.z - v.pos.z;
    const desired = Math.atan2(dx, dz);
    let diff = desired - v.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxSteer = v.def.tune.steer / (1 + Math.max(0, speed - 6) / 24);
    let steer = (diff * 1.6) / Math.max(0.08, maxSteer);
    steer -= v.yawRate * 0.12;
    inp.steer = Math.max(-1, Math.min(1, steer));

    // 速度控制：看前方一段距离内最小允许速度
    const gripF = Math.sqrt((v.def.tune.grip * v.gripScale) / 1.25);
    let vTarget = 999;
    const brakeLook = 18 + speed * speed * 0.03;
    for (let d = 0; d < brakeLook; d += 6) {
      const i = tr.indexAt(s + d);
      const allowed = tr.aiSpeed[i] * gripF * this.profile.skill * rubber;
      const decel = 12;
      const need = Math.sqrt(allowed * allowed + 2 * decel * d);
      vTarget = Math.min(vTarget, need);
    }
    vTarget *= 1 + Math.sin(this.wobble * 0.3) * 0.015;
    const err = vTarget - speed;
    inp.throttle = err > 0 ? Math.min(1, 0.4 + err * 0.25) : 0;
    inp.brake = err < -1.5 ? Math.min(1, -err * 0.12) : 0;
    inp.handbrake = false;
    // 大角度时松油
    if (Math.abs(diff) > 0.5 && speed > 15) inp.throttle *= 0.5;
    inp.nitro = v.nitro > 0.6 && Math.abs(tr.curv[v.proj.index]) < 0.002 && speed > 35 && err > 8 && this.profile.aggression > 0.4;

    // 卡住处理
    if (speed < 2 && this.reverseTimer <= 0) this.stuckTimer += dt;
    else this.stuckTimer = Math.max(0, this.stuckTimer - dt);
    if (this.stuckTimer > 2.5) {
      this.stuckTimer = 0;
      this.reverseTimer = 1.3;
    }
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      inp.throttle = 0;
      inp.brake = 1;
      inp.steer = -inp.steer;
      if (this.reverseTimer <= 0 && Math.abs(v.proj.lateral) > tr.wallOffset - 3) v.resetToTrack();
    }
    return inp;
  }
}

export const AI_NAMES: AIProfile[] = [
  { name: 'K. Tanaka', skill: 1.0, aggression: 0.8, laneBias: 0.3 },
  { name: 'M. Rossi', skill: 0.98, aggression: 0.6, laneBias: -0.4 },
  { name: 'L. Weber', skill: 0.97, aggression: 0.5, laneBias: 0.6 },
  { name: 'A. Silva', skill: 0.96, aggression: 0.7, laneBias: -0.2 },
  { name: 'J. Carter', skill: 0.95, aggression: 0.4, laneBias: 0.1 },
  { name: '陈 昊', skill: 0.99, aggression: 0.9, laneBias: -0.6 },
  { name: 'E. Dubois', skill: 0.94, aggression: 0.3, laneBias: 0.4 },
];
