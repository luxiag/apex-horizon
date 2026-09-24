/**
 * 全部音效用 WebAudio 实时合成，无需外部音频资源。
 */
class EngineVoice {
  ctx: AudioContext;
  out: GainNode;
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  osc3: OscillatorNode;
  sub: OscillatorNode;
  filter: BiquadFilterNode;
  shaper: WaveShaperNode;
  gain: GainNode;
  noiseGain: GainNode;
  panner: StereoPannerNode;
  electric: boolean;

  constructor(ctx: AudioContext, dest: AudioNode, noise: AudioBuffer, electric: boolean) {
    this.ctx = ctx;
    this.electric = electric;
    this.panner = ctx.createStereoPanner();
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.gain = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2.5;
    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * (electric ? 1.2 : 3.2));
    }
    this.shaper.curve = curve;
    this.osc1 = ctx.createOscillator();
    this.osc2 = ctx.createOscillator();
    this.osc3 = ctx.createOscillator();
    this.sub = ctx.createOscillator();
    this.osc1.type = electric ? 'sine' : 'sawtooth';
    this.osc2.type = electric ? 'triangle' : 'square';
    this.osc3.type = electric ? 'sine' : 'sawtooth';
    this.sub.type = 'sine';
    const g1 = ctx.createGain();
    const g2 = ctx.createGain();
    const g3 = ctx.createGain();
    const gs = ctx.createGain();
    g1.gain.value = electric ? 0.35 : 0.5;
    g2.gain.value = electric ? 0.12 : 0.22;
    g3.gain.value = electric ? 0.18 : 0.16;
    gs.gain.value = electric ? 0.05 : 0.45;
    this.osc1.connect(g1).connect(this.shaper);
    this.osc2.connect(g2).connect(this.shaper);
    this.osc3.connect(g3).connect(this.shaper);
    this.sub.connect(gs).connect(this.filter);
    // 粗糙感：噪声调制
    const ns = ctx.createBufferSource();
    ns.buffer = noise;
    ns.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 900;
    nf.Q.value = 0.8;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.0;
    ns.connect(nf).connect(this.noiseGain).connect(this.filter);
    this.shaper.connect(this.filter);
    this.filter.connect(this.gain).connect(this.out).connect(this.panner).connect(dest);
    [this.osc1, this.osc2, this.osc3, this.sub].forEach((o) => o.start());
    ns.start();
  }

  update(rpm: number, throttle: number, cylinders: number, tone: number, volume: number, speed: number) {
    const t = this.ctx.currentTime;
    const k = 0.04;
    if (this.electric) {
      const f = 90 + speed * 9 * tone;
      this.osc1.frequency.setTargetAtTime(f, t, k);
      this.osc2.frequency.setTargetAtTime(f * 2.01, t, k);
      this.osc3.frequency.setTargetAtTime(f * 3.5, t, k);
      this.sub.frequency.setTargetAtTime(f * 0.5, t, k);
      this.filter.frequency.setTargetAtTime(1800 + throttle * 2500, t, k);
      this.gain.gain.setTargetAtTime(0.18 + throttle * 0.2, t, k);
      this.noiseGain.gain.setTargetAtTime(0.02 + speed * 0.001, t, k);
    } else {
      const fire = (rpm / 60) * (cylinders / 2);
      const f = fire * tone * 0.5;
      this.osc1.frequency.setTargetAtTime(f, t, k);
      this.osc2.frequency.setTargetAtTime(f * 0.5, t, k);
      this.osc3.frequency.setTargetAtTime(f * 1.5 + 3, t, k);
      this.sub.frequency.setTargetAtTime(f * 0.25, t, k);
      this.filter.frequency.setTargetAtTime(280 + throttle * 1800 + rpm * 0.28, t, k);
      this.gain.gain.setTargetAtTime(0.16 + throttle * 0.26, t, k);
      this.noiseGain.gain.setTargetAtTime(0.05 + throttle * 0.25, t, k);
    }
    this.out.gain.setTargetAtTime(volume, t, 0.05);
  }

  stop() {
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    const nodes = [this.osc1, this.osc2, this.osc3, this.sub];
    setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch { /* noop */ } }), 400);
  }
}

class AudioManager {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  noise!: AudioBuffer;
  engine: EngineVoice | null = null;
  rival: EngineVoice | null = null;
  tire!: GainNode;
  tireFilter!: BiquadFilterNode;
  wind!: GainNode;
  nitroGain!: GainNode;
  nitroFilter!: BiquadFilterNode;
  volume = 0.8;
  muted = false;

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 轮胎尖叫
    const tsrc = ctx.createBufferSource();
    tsrc.buffer = this.noise;
    tsrc.loop = true;
    this.tireFilter = ctx.createBiquadFilter();
    this.tireFilter.type = 'bandpass';
    this.tireFilter.frequency.value = 1100;
    this.tireFilter.Q.value = 6;
    const tf2 = ctx.createBiquadFilter();
    tf2.type = 'peaking';
    tf2.frequency.value = 2300;
    tf2.gain.value = 10;
    this.tire = ctx.createGain();
    this.tire.gain.value = 0;
    tsrc.connect(this.tireFilter).connect(tf2).connect(this.tire).connect(this.master);
    tsrc.start();
    // 风噪
    const wsrc = ctx.createBufferSource();
    wsrc.buffer = this.noise;
    wsrc.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 700;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    wsrc.connect(wf).connect(this.wind).connect(this.master);
    wsrc.start();
    // 氮气
    const nsrc = ctx.createBufferSource();
    nsrc.buffer = this.noise;
    nsrc.loop = true;
    this.nitroFilter = ctx.createBiquadFilter();
    this.nitroFilter.type = 'bandpass';
    this.nitroFilter.frequency.value = 500;
    this.nitroFilter.Q.value = 1.2;
    this.nitroGain = ctx.createGain();
    this.nitroGain.gain.value = 0;
    nsrc.connect(this.nitroFilter).connect(this.nitroGain).connect(this.master);
    nsrc.start();
    return ctx;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
    return this.muted;
  }

  startEngine(electric: boolean) {
    const ctx = this.ensure();
    this.stopEngine();
    this.engine = new EngineVoice(ctx, this.master, this.noise, electric);
  }

  startRival(electric: boolean) {
    const ctx = this.ensure();
    if (this.rival) this.rival.stop();
    this.rival = new EngineVoice(ctx, this.master, this.noise, electric);
  }

  stopEngine() {
    this.engine?.stop();
    this.engine = null;
    this.rival?.stop();
    this.rival = null;
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.tire.gain.setTargetAtTime(0, t, 0.05);
      this.wind.gain.setTargetAtTime(0, t, 0.05);
      this.nitroGain.gain.setTargetAtTime(0, t, 0.05);
    }
  }

  updateDriving(p: { rpm: number; throttle: number; cylinders: number; tone: number; speed: number; slip: number; nitro: boolean; grass: boolean }) {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    this.engine.update(p.rpm, p.throttle, p.cylinders, p.tone, 0.55, p.speed);
    this.tire.gain.setTargetAtTime(Math.min(0.32, p.slip * 0.4) * (p.grass ? 0.2 : 1), t, 0.04);
    this.tireFilter.frequency.setTargetAtTime(900 + p.slip * 500, t, 0.05);
    this.wind.gain.setTargetAtTime(Math.min(0.28, (p.speed / 90) ** 2 * 0.3) + (p.grass ? 0.1 : 0), t, 0.1);
    this.nitroGain.gain.setTargetAtTime(p.nitro ? 0.22 : 0, t, p.nitro ? 0.05 : 0.2);
    this.nitroFilter.frequency.setTargetAtTime(p.nitro ? 1400 : 400, t, 0.3);
  }

  updateRival(p: { rpm: number; throttle: number; cylinders: number; tone: number; speed: number; distance: number; pan: number }) {
    if (!this.ctx || !this.rival) return;
    const vol = Math.max(0, 1 - p.distance / 60) ** 2 * 0.4;
    this.rival.update(p.rpm, p.throttle, p.cylinders, p.tone, vol, p.speed);
    this.rival.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, p.pan)), this.ctx.currentTime, 0.05);
  }

  private blip(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.2, slide = 0) {
    const ctx = this.ensure();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, gain: number, type: BiquadFilterType = 'lowpass') {
    const ctx = this.ensure();
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random());
    s.stop(t + dur);
  }

  uiMove() {
    this.blip(880, 0.06, 'triangle', 0.08);
  }
  uiSelect() {
    this.blip(660, 0.08, 'triangle', 0.12);
    setTimeout(() => this.blip(1320, 0.12, 'triangle', 0.1), 60);
  }
  uiBack() {
    this.blip(520, 0.1, 'triangle', 0.1, 0.6);
  }
  countdown(go: boolean) {
    if (go) this.blip(1320, 0.7, 'square', 0.12);
    else this.blip(660, 0.35, 'square', 0.1);
  }
  shift(up: boolean) {
    if (up) {
      this.burst(0.08, 2200, 0.35, 'bandpass');
      setTimeout(() => this.burst(0.05, 900, 0.25), 70);
    }
  }
  impact(strength: number) {
    const g = Math.min(1, strength / 15);
    this.burst(0.25 + g * 0.3, 380, 0.6 * g + 0.1);
    this.burst(0.12, 2500, 0.2 * g, 'highpass');
  }
  lap() {
    [0, 90, 180].forEach((d, i) => setTimeout(() => this.blip(880 * (1 + i * 0.26), 0.18, 'triangle', 0.1), d));
  }
  nitroStart() {
    this.burst(0.5, 600, 0.35, 'bandpass');
  }
  finish() {
    [0, 120, 240, 420].forEach((d, i) => setTimeout(() => this.blip([784, 988, 1175, 1568][i], 0.35, 'triangle', 0.12), d));
  }
}

export const audio = new AudioManager();
