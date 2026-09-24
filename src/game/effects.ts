import * as THREE from 'three';
import { smokeTexture, glowTexture } from './textures';

/** 轮胎印：环形缓冲的四边形条带 */
export class Skidmarks {
  mesh: THREE.Mesh;
  private max: number;
  private pos: Float32Array;
  private alpha: Float32Array;
  private cursor = 0;
  private last = new Map<number, { x: number; y: number; z: number; lx: number; lz: number } | null>();
  private geo: THREE.BufferGeometry;

  constructor(max = 3000) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const b = i * 4;
      idx.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.03,0.03,0.035, vA*0.55); }`,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** 每个轮子一个 id；intensity<=0 时断开 */
  add(id: number, x: number, y: number, z: number, dirX: number, dirZ: number, width: number, intensity: number) {
    if (intensity <= 0.05) {
      this.last.set(id, null);
      return;
    }
    const lx = dirZ * width * 0.5;
    const lz = -dirX * width * 0.5;
    const prev = this.last.get(id);
    if (prev) {
      const d2 = (prev.x - x) ** 2 + (prev.z - z) ** 2;
      if (d2 < 0.09) return;
      if (d2 > 16) {
        this.last.set(id, { x, y, z, lx, lz });
        return;
      }
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const b = i * 12;
      const yy = y + 0.035;
      this.pos.set([prev.x + prev.lx, prev.y + 0.035, prev.z + prev.lz, prev.x - prev.lx, prev.y + 0.035, prev.z - prev.lz, x + lx, yy, z + lz, x - lx, yy, z - lz], b);
      const a = Math.min(1, intensity);
      this.alpha.set([a, a, a, a], i * 4);
      (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
    }
    this.last.set(id, { x, y, z, lx, lz });
  }

  reset() {
    this.pos.fill(0);
    this.alpha.fill(0);
    this.last.clear();
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** 通用粒子池（烟雾 / 火花 / 氮气火焰） */
export class Particles {
  points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private grow: Float32Array;
  private alpha: Float32Array;
  private color: Float32Array;
  private cursor = 0;
  private geo: THREE.BufferGeometry;
  drag: number;
  gravity: number;

  constructor(max: number, additive: boolean, opts: { drag?: number; gravity?: number; texture?: 'smoke' | 'glow' } = {}) {
    this.max = max;
    this.drag = opts.drag ?? 1.2;
    this.gravity = opts.gravity ?? 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    const map = opts.texture === 'glow' ? glowTexture() : smokeTexture();
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, scale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 pcolor;
        varying float vA; varying vec3 vC; uniform float scale;
        void main(){
          vA = alpha; vC = pcolor;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying float vA; varying vec3 vC;
        void main(){
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vC, t.a * vA);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  setViewport(height: number, fov: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, alpha: number, r: number, g: number, b: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.alpha[i] = alpha;
    this.color[i * 3] = r;
    this.color[i * 3 + 1] = g;
    this.color[i * 3 + 2] = b;
    this.baseAlpha[i] = alpha;
  }
  private baseAlpha: Float32Array;

  update(dt: number) {
    const k = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.gravity * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.baseAlpha[i] * t * Math.min(1, (1 - t) * 8);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
  }

  reset() {
    this.life.fill(0);
    this.alpha.fill(0);
  }

  dispose() {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
