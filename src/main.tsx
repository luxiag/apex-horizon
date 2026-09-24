import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Sparkles, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import './styles.css'

type Telemetry = { speed: number; boost: number; drift: boolean; lap: number; lapTime: number; best: number; gear: number; rpm: number; active: boolean; countdown: number; driftScore: number; score: number; finished: boolean; driftChain: number; rank: number }
type GameState = Telemetry & { angle: number; angularVelocity: number; lateral: number; distance: number; lapStarted: number; lastSplit: number; driftChain: number; raceProgress: number }
type InputKey = 'forward' | 'reverse' | 'left' | 'right' | 'drift' | 'boost'

const track = { a: 33, b: 51, width: 13, centerZ: -9 }
const inputCodes: Record<string, InputKey> = {
  ArrowUp: 'forward', KeyW: 'forward', ArrowDown: 'reverse', KeyS: 'reverse',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Space: 'drift', ShiftLeft: 'boost', ShiftRight: 'boost', KeyX: 'boost',
}
const input = new Set<InputKey>()
const readBest = () => { try { return Number(localStorage.getItem('midnight-best') ?? 0) } catch { return 0 } }
const initialGame = (): GameState => ({ speed: 0, boost: 100, drift: false, lap: 1, lapTime: 0, best: readBest(), gear: 1, rpm: 900, active: false, countdown: 3, driftScore: 0, score: 0, finished: false, driftChain: 1, rank: 4, raceProgress: 0, angle: Math.PI / 2, angularVelocity: 0, lateral: 0, distance: 0, lapStarted: 0, lastSplit: 0 })

const opponentProgress = [0.015, 0.017, 0.019]
const resetOpponents = () => { opponentProgress[0] = 0.015; opponentProgress[1] = 0.017; opponentProgress[2] = 0.019 }
function routePoint(progress: number, lane: number, target = new THREE.Vector3()) {
  const angle = progress * Math.PI * 2
  const radius = 1 + lane / track.b
  target.set(Math.sin(angle) * track.a * radius, 0.42, track.centerZ + Math.cos(angle) * track.b * radius)
  return target
}
function routeHeading(progress: number) { return Math.atan2(Math.cos(progress * Math.PI * 2) * track.a, -Math.sin(progress * Math.PI * 2) * track.b) }

function ellipseBandGeometry(inner: number, outer: number) {
  const geometry = new THREE.BufferGeometry()
  const positions: number[] = []
  const indices: number[] = []
  const segments = 240
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    positions.push(cosine * track.a * inner, 0, track.centerZ + sine * track.b * inner)
    positions.push(cosine * track.a * outer, 0, track.centerZ + sine * track.b * outer)
    if (i < segments) {
      const base = i * 2
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function AssetModel({ path, scale = 1, position = [0, 0, 0], rotation = [0, 0, 0] }: { path: string; scale?: number; position?: [number, number, number]; rotation?: [number, number, number] }) {
  const { scene } = useGLTF(path)
  const model = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true
        node.receiveShadow = true
      }
    })
    return clone
  }, [scene])
  return <primitive object={model} position={position} rotation={rotation} scale={scale} />
}

const playerCarAsset = '/assets/racing-kit/raceCarRed.glb'
useGLTF.preload(playerCarAsset)

function formatTime(time: number) {
  const seconds = Math.floor(time / 1000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}.${Math.floor((time % 1000) / 10).toString().padStart(2, '0')}`
}

function Car({ game, onUpdate, running }: { game: React.MutableRefObject<GameState>; onUpdate: (state: GameState) => void; running: React.MutableRefObject<boolean> }) {
  const root = useRef<THREE.Group>(null)
  const flame = useRef<THREE.Mesh>(null)
  const { camera } = useThree()
  const cameraTarget = useRef(new THREE.Vector3())
  const smoke = useRef<THREE.Points>(null)
  const smokePositions = useRef<Float32Array>(new Float32Array(180 * 3))

  useFrame((_, rawDelta) => {
    const car = root.current
    if (!car) return
    if (!running.current) return
    const dt = Math.min(rawDelta, 0.04)
    const s = game.current
    const throttle = input.has('forward')
    const reverse = input.has('reverse')
    const steering = Number(input.has('left')) - Number(input.has('right'))
    const drifting = input.has('drift') && Math.abs(s.speed) > 5 && Math.abs(steering) > 0
    const boosting = input.has('boost') && s.boost > 0 && throttle

    if (s.countdown > 0) {
      s.countdown = Math.max(0, s.countdown - dt)
      if (s.countdown > 0) { onUpdate(s); return }
    }
    if (s.finished) { onUpdate(s); return }

    if (throttle) s.speed += (boosting ? 32 : 19) * dt
    else if (reverse) s.speed -= 23 * dt
    else s.speed *= Math.exp(-0.26 * dt)
    s.speed = THREE.MathUtils.clamp(s.speed, -11, boosting ? 82 : 61)
    if (boosting) s.boost = Math.max(0, s.boost - 27 * dt)
    else if (!drifting) s.boost = Math.min(100, s.boost + 5.5 * dt)
    if (drifting) s.boost = Math.min(100, s.boost + Math.abs(s.speed) * 0.115 * dt)

    const steeringPower = THREE.MathUtils.clamp(Math.abs(s.speed) / 19, 0, 1)
    const targetYaw = steering * steeringPower * (drifting ? 1.12 : 0.62) * Math.sign(s.speed || 1)
    s.angularVelocity = THREE.MathUtils.damp(s.angularVelocity, targetYaw, drifting ? 3.8 : 7, dt)
    s.angle += s.angularVelocity * dt
    const heading = s.angle
    const forwardX = -Math.sin(heading)
    const forwardZ = -Math.cos(heading)
    const sideX = Math.cos(heading)
    const sideZ = -Math.sin(heading)
    const grip = drifting ? 1.9 : 8.5
    s.lateral = THREE.MathUtils.damp(s.lateral, drifting ? steering * Math.min(Math.abs(s.speed) * 0.24, 13) : 0, grip, dt)
    car.position.x += (forwardX * s.speed + sideX * s.lateral) * dt
    car.position.z += (forwardZ * s.speed + sideZ * s.lateral) * dt
    car.rotation.y = heading
    car.rotation.z = THREE.MathUtils.damp(car.rotation.z, -steering * 0.045 - (drifting ? steering * 0.085 : 0), 5, dt)

    const dx = car.position.x
    const dz = car.position.z - track.centerZ
    const normalized = Math.hypot(dx / track.a, dz / track.b)
    const outerEdge = 1 + track.width / (2 * track.b)
    const innerEdge = 1 - track.width / (2 * track.b)
    const offTrack = normalized > outerEdge || normalized < innerEdge
    if (offTrack) {
      s.speed *= Math.exp(-1.8 * dt)
      if (normalized > 1.8 || normalized < 0.25) {
        const recoveryRadius = THREE.MathUtils.clamp(normalized, innerEdge, outerEdge)
        car.position.x = dx / (normalized || 1) * recoveryRadius
        car.position.z = track.centerZ + dz / (normalized || 1) * recoveryRadius
        s.speed = Math.min(s.speed, 12)
      }
    }
    s.distance += Math.abs(s.speed) * dt
    if (!s.active && s.countdown <= 0) { s.active = true; s.lapStarted = performance.now() - s.lapTime }
    if (s.active) s.lapTime = performance.now() - s.lapStarted

    if (drifting && Math.abs(s.speed) > 12) {
      s.driftChain = Math.min(5, 1 + Math.abs(s.lateral) * 0.22)
      s.driftScore += Math.round(Math.abs(s.speed) * Math.abs(steering) * 0.85 * s.driftChain * dt)
      s.score += Math.round(Math.abs(s.speed) * Math.abs(steering) * s.driftChain * dt)
    } else s.driftChain = THREE.MathUtils.damp(s.driftChain, 1, 3, dt)

    const progress = (Math.atan2(dx / track.a, dz / track.b) + Math.PI * 2) % (Math.PI * 2)
    s.raceProgress = progress / (Math.PI * 2) + (s.lap - 1)
    s.rank = 1 + opponentProgress.filter((opponent) => opponent > s.raceProgress).length
    if (progress < 0.035 && s.distance > 250 && performance.now() - s.lastSplit > 7000) {
      if (s.best === 0 || s.lapTime < s.best) {
        s.best = s.lapTime
        try { localStorage.setItem('midnight-best', String(s.best)) } catch { /* Storage may be disabled in private browsing. */ }
      }
      if (s.lap >= 3) {
        s.finished = true
        s.active = false
        running.current = false
      } else {
        s.lap += 1
        s.distance = 0
        s.lapStarted = performance.now()
        s.lastSplit = performance.now()
        s.lapTime = 0
      }
    }

    s.drift = drifting
    s.gear = Math.max(1, Math.min(6, Math.floor(Math.abs(s.speed) / 11) + 1))
    s.rpm = 900 + Math.min(7100, (Math.abs(s.speed) % 11) / 11 * 7100)
    if (flame.current) {
      flame.current.visible = boosting
      flame.current.scale.z = 1 + Math.random() * 0.7
    }
    if (smoke.current && drifting) {
      const positions = smokePositions.current
      for (let i = positions.length - 3; i >= 3; i -= 3) {
        positions[i] = positions[i - 3]
        positions[i + 1] = positions[i - 2]
        positions[i + 2] = positions[i - 1]
      }
      positions[0] = car.position.x + sideX * (steering > 0 ? -1.25 : 1.25)
      positions[1] = 0.22 + Math.random() * 0.18
      positions[2] = car.position.z + sideZ * (steering > 0 ? -1.25 : 1.25)
      smoke.current.geometry.attributes.position.needsUpdate = true
    }
    cameraTarget.current.set(car.position.x - forwardX * 13 + sideX * 2.8, car.position.y + 8.4, car.position.z - forwardZ * 13 + sideZ * 2.8)
    camera.position.lerp(cameraTarget.current, 1 - Math.exp(-3.8 * dt))
    camera.lookAt(car.position.x, car.position.y + 0.2, car.position.z - 3)
    onUpdate(s)
  })

  return (
    <group ref={root} position={[0, 0.42, track.centerZ + track.b]}>
      <AssetModel path={playerCarAsset} position={[0, 0.06, 0]} rotation={[0, Math.PI, 0]} scale={2.2} />
      <mesh position={[0, 0.62, -2.2]}><boxGeometry args={[1.8, 0.13, 0.08]} /><meshBasicMaterial color="#ff392f" toneMapped={false} /></mesh>
      <mesh position={[0, 0.62, 2.2]}><boxGeometry args={[1.5, 0.11, 0.08]} /><meshBasicMaterial color="#fff1d0" toneMapped={false} /></mesh>
      <mesh position={[0, 0.7, 1.75]}><boxGeometry args={[1.85, 0.12, 0.12]} /><meshStandardMaterial color="#161b1d" metalness={0.7} roughness={0.24} /></mesh>
      <mesh ref={flame} visible={false} position={[0, 0.35, -2.75]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.28, 1.5, 10]} /><meshBasicMaterial color="#71dfff" toneMapped={false} /></mesh>
      <points ref={smoke}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[smokePositions.current, 3]} count={180} /></bufferGeometry>
        <pointsMaterial color="#bfc4c1" size={0.7} transparent opacity={0.32} depthWrite={false} sizeAttenuation />
      </points>
      <pointLight position={[0, 0.35, -2.55]} color="#ff3124" intensity={8} distance={9} />
    </group>
  )
}

function Track() {
  const curvePoints = Array.from({ length: 240 }, (_, i) => {
    const a = (i / 240) * Math.PI * 2
    return new THREE.Vector3(Math.sin(a) * track.a, 0.01, track.centerZ + Math.cos(a) * track.b)
  })
  const curve = new THREE.CatmullRomCurve3(curvePoints, true)
  const laneMarks = Array.from({ length: 48 }, (_, i) => curve.getPoint(i / 48))
  const lightPoints = Array.from({ length: 12 }, (_, i) => curve.getPoint((i + 0.5) / 12))
  const signPoints = Array.from({ length: 4 }, (_, i) => curve.getPoint((i + 0.22) / 4))
  const innerBarrier = curvePoints.map((p) => new THREE.Vector3(p.x * 0.7, 0.26, track.centerZ + (p.z - track.centerZ) * 0.7))
  const outerBarrier = curvePoints.map((p) => new THREE.Vector3(p.x * 1.34, 0.26, track.centerZ + (p.z - track.centerZ) * 1.34))
  const startLine = Array.from({ length: 9 }, (_, i) => <mesh key={i} position={[-5.2 + i * 1.3, 0.035, track.centerZ + track.b - 0.2]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[1.3, 2.4]} /><meshBasicMaterial color={i % 2 ? '#f1efe7' : '#161a1b'} /></mesh>)

  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.18, track.centerZ]} receiveShadow><planeGeometry args={[360, 360]} /><meshStandardMaterial color="#111713" roughness={1} /></mesh>
    <mesh geometry={ellipseBandGeometry(1 - track.width / (2 * track.b), 1 + track.width / (2 * track.b))} position={[0, 0.005, 0]} receiveShadow><meshStandardMaterial color="#24272a" roughness={0.95} side={THREE.DoubleSide} /></mesh>
    <mesh geometry={ellipseBandGeometry(1 - track.width / (2 * track.b) + 0.08, 1 + track.width / (2 * track.b) - 0.08)} position={[0, 0.008, 0]}><meshStandardMaterial color="#2a3033" roughness={0.28} metalness={0.12} transparent opacity={0.19} side={THREE.DoubleSide} /></mesh>
    <mesh geometry={ellipseBandGeometry(1 - track.width / (2 * track.b) - 0.035, 1 - track.width / (2 * track.b))} position={[0, -0.075, 0]}><meshStandardMaterial color="#d5d2c7" roughness={0.84} side={THREE.DoubleSide} /></mesh>
    <mesh geometry={ellipseBandGeometry(1 + track.width / (2 * track.b), 1 + track.width / (2 * track.b) + 0.035)} position={[0, -0.07, 0]}><meshStandardMaterial color="#d5d2c7" roughness={0.84} side={THREE.DoubleSide} /></mesh>
    <group>{startLine}<mesh position={[0, 4.15, track.centerZ + track.b - 0.2]}><boxGeometry args={[13, 0.42, 0.38]} /><meshStandardMaterial color="#202628" metalness={0.65} roughness={0.34} /></mesh>{[-5.7, 5.7].map((x) => <mesh key={x} position={[x, 2, track.centerZ + track.b - 0.2]}><cylinderGeometry args={[0.12, 0.16, 4.1, 8]} /><meshStandardMaterial color="#333a3a" metalness={0.5} /></mesh>)}</group>
    {laneMarks.map((p, i) => <mesh key={i} position={[p.x, 0.018, p.z]} rotation={[0, Math.atan2(p.x, -(p.z - track.centerZ)), 0]}><boxGeometry args={[0.16, 0.018, 2.4]} /><meshBasicMaterial color="#a6a69d" /></mesh>)}
    <AssetModel path="/assets/racing-kit/overheadLights.glb" position={[0, 0, track.centerZ + track.b - 0.2]} scale={4.4} />
    <mesh><tubeGeometry args={[new THREE.CatmullRomCurve3(innerBarrier, true), 260, 0.2, 6, true]} /><meshStandardMaterial color="#3d4748" metalness={0.78} roughness={0.27} /></mesh>
    <mesh><tubeGeometry args={[new THREE.CatmullRomCurve3(outerBarrier, true), 260, 0.22, 6, true]} /><meshStandardMaterial color="#3d4748" metalness={0.78} roughness={0.27} /></mesh>
    {curvePoints.filter((_, i) => i % 5 === 0).map((p, i) => <group key={`barrier-${i}`} position={[p.x * 1.34, 0, track.centerZ + (p.z - track.centerZ) * 1.34]} rotation={[0, Math.atan2(p.x, -(p.z - track.centerZ)), 0]}><AssetModel path={i % 2 ? '/assets/racing-kit/barrierWhite.glb' : '/assets/racing-kit/barrierRed.glb'} scale={1.35} /></group>)}
    {lightPoints.map((p, i) => <group key={i} position={[p.x * 1.53, 0, track.centerZ + (p.z - track.centerZ) * 1.53]} rotation={[0, Math.atan2(p.x, -(p.z - track.centerZ)), 0]}><AssetModel path={i % 2 ? '/assets/racing-kit/lightPostModern.glb' : '/assets/racing-kit/lightPostLarge.glb'} scale={3.2} /><pointLight color="#ffc28c" intensity={i % 3 === 0 ? 7 : 0} distance={10} decay={2} /></group>)}
    {signPoints.map((p, i) => <group key={`sign-${i}`} position={[p.x * 1.46, 0, track.centerZ + (p.z - track.centerZ) * 1.46]} rotation={[0, Math.atan2(p.x, -(p.z - track.centerZ)), 0]}><AssetModel path={i % 2 ? '/assets/racing-kit/bannerTowerGreen.glb' : '/assets/racing-kit/bannerTowerRed.glb'} scale={4.6} /></group>)}
    <group position={[-56, 0, track.centerZ - 2]} rotation={[0, 0.18, 0]}><AssetModel path="/assets/racing-kit/grandStandCovered.glb" scale={5.5} /></group>
    <group position={[56, 0, track.centerZ + 8]} rotation={[0, -0.18, 0]}><AssetModel path="/assets/racing-kit/grandStand.glb" scale={5.5} /></group>
    {[-1, 1].flatMap((side) => Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return <group key={`tree-${side}-${i}`} position={[Math.sin(a) * 90 + side * 24, 0, track.centerZ + Math.cos(a) * 112]}><AssetModel path={i % 2 ? '/assets/racing-kit/treeSmall.glb' : '/assets/racing-kit/treeLarge.glb'} scale={3.8 + (i % 3) * 0.65} /></group> }))}
    {Array.from({ length: 14 }, (_, i) => {
      const angle = (i / 14) * Math.PI * 2
      const x = Math.cos(angle) * 154
      const z = track.centerZ + Math.sin(angle) * 182
      const height = 18 + ((i * 17) % 28)
      return <mesh key={`mountain-${i}`} position={[x, height * 0.42, z]} rotation={[0, -angle, 0]}><coneGeometry args={[22 + (i % 4) * 8, height, 5]} /><meshStandardMaterial color={i % 2 ? '#111a1c' : '#172123'} roughness={1} flatShading /></mesh>
    })}
    <Sparkles count={64} scale={[170, 18, 190]} size={1.6} speed={0.12} color="#ff6849" opacity={0.36} />
  </group>
}

function OpponentModel({ path }: { path: string }) {
  const { scene } = useGLTF(path)
  const model = useMemo(() => {
    const source = scene.clone(true)
    source.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true } })
    return source
  }, [scene])
  return <primitive object={model} position={[0, 0.06, 0]} rotation={[0, Math.PI, 0]} scale={1.8} />
}

function OpponentCars({ game, running }: { game: React.MutableRefObject<GameState>; running: React.MutableRefObject<boolean> }) {
  const roots = useRef<Array<THREE.Group | null>>([])
  const positions = useRef(opponentProgress.map(() => new THREE.Vector3()))
  useFrame((_, rawDelta) => {
    if (!running.current) return
    const dt = Math.min(rawDelta, 0.04)
    if (game.current.countdown > 0 || game.current.finished) return
    opponentProgress.forEach((_, index) => {
      opponentProgress[index] += dt * [0.052, 0.048, 0.045][index]
      const progress = opponentProgress[index] % 1
      routePoint(progress, [-3.2, 0, 3.2][index], positions.current[index])
      const root = roots.current[index]
      if (root) {
        root.position.copy(positions.current[index])
        root.rotation.y = routeHeading(progress)
      }
    })
  })
  const assets = ['/assets/racing-kit/raceCarWhite.glb', '/assets/racing-kit/raceCarGreen.glb', '/assets/racing-kit/raceCarOrange.glb']
  return <>{opponentProgress.map((_, index) => <group key={index} ref={(node) => { roots.current[index] = node }}>
    <OpponentModel path={assets[index]} />
    <pointLight color={index === 0 ? '#8ce3f2' : '#ff513b'} intensity={1.8} distance={4} />
  </group>)}</>
}

function Scene({ game, onUpdate, running }: { game: React.MutableRefObject<GameState>; onUpdate: (state: GameState) => void; running: React.MutableRefObject<boolean> }) {
  return <>
    <color attach="background" args={['#080b0d']} /><fog attach="fog" args={['#080b0d', 68, 220]} />
    <ambientLight intensity={0.44} /><hemisphereLight args={['#b1c0d1', '#29312c', 0.64]} />
    <directionalLight position={[22, 36, 12]} intensity={2.1} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
    <Track /><OpponentCars game={game} running={running} /><Car game={game} onUpdate={onUpdate} running={running} />
    <ContactShadows position={[0, -0.1, track.centerZ]} opacity={0.35} scale={120} blur={3} far={16} />
    <Environment preset="night" />
  </>
}

function App() {
  const game = useRef<GameState>(initialGame())
  const audio = useRef<{ context: AudioContext; engine: OscillatorNode; engineGain: GainNode; noise: AudioBufferSourceNode; noiseGain: GainNode } | null>(null)
  const running = useRef(false)
  const [hud, setHud] = useState<Telemetry>(game.current)
  const [started, setStarted] = useState(false)
  const lastHud = useRef(0)

  const toggleAudio = () => {
    if (!audio.current) {
      const context = new AudioContext()
      const engine = context.createOscillator()
      const engineGain = context.createGain()
      const filter = context.createBiquadFilter()
      engine.type = 'sawtooth'
      engine.frequency.value = 44
      filter.type = 'lowpass'
      filter.frequency.value = 260
      engineGain.gain.value = 0
      engine.connect(filter).connect(engineGain).connect(context.destination)
      engine.start()
      const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
      const channel = buffer.getChannelData(0)
      for (let i = 0; i < channel.length; i += 1) channel[i] = Math.random() * 2 - 1
      const noise = context.createBufferSource()
      const noiseGain = context.createGain()
      noise.buffer = buffer
      noise.loop = true
      noiseGain.gain.value = 0
      noise.connect(noiseGain).connect(context.destination)
      noise.start()
      audio.current = { context, engine, engineGain, noise, noiseGain }
    }
    const sounds = audio.current
    if (!sounds) return
    if (sounds.context.state === 'suspended') void sounds.context.resume()
    const enabled = sounds.engineGain.gain.value < 0.001
    sounds.engineGain.gain.setTargetAtTime(enabled ? 0.08 : 0, sounds.context.currentTime, 0.08)
    sounds.noiseGain.gain.setTargetAtTime(enabled ? 0.006 : 0, sounds.context.currentTime, 0.08)
  }

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Escape' || event.code === 'KeyP') {
        running.current = !running.current
        setStarted(running.current)
        if (!running.current) input.clear()
        return
      }
      if (event.code in inputCodes) { event.preventDefault(); input.add(inputCodes[event.code]) }
      if (event.code === 'Enter') { running.current = true; setStarted(true) }
    }
    const up = (event: KeyboardEvent) => { if (event.code in inputCodes) input.delete(inputCodes[event.code]) }
    const clear = () => input.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear) }
  }, [])

  const update = (s: GameState) => {
    const now = performance.now()
    if (now - lastHud.current < 80) return
    lastHud.current = now
    setHud({ speed: s.speed, boost: s.boost, drift: s.drift, lap: s.lap, lapTime: s.lapTime, best: s.best, gear: s.gear, rpm: s.rpm, active: s.active, countdown: s.countdown, driftScore: s.driftScore, score: s.score, finished: s.finished, driftChain: s.driftChain, rank: s.rank })
    const sounds = audio.current
    if (sounds) {
      const speedRatio = Math.min(1, Math.abs(s.speed) / 82)
      sounds.engine.frequency.setTargetAtTime(42 + speedRatio * 138 + (s.gear - 1) * 9, sounds.context.currentTime, 0.055)
      sounds.engineGain.gain.setTargetAtTime(sounds.engineGain.gain.value > 0.001 ? 0.035 + speedRatio * 0.065 : 0, sounds.context.currentTime, 0.08)
      sounds.noiseGain.gain.setTargetAtTime(s.drift && sounds.engineGain.gain.value > 0.001 ? 0.009 : 0, sounds.context.currentTime, 0.06)
    }
  }

  const hold = (control: InputKey) => ({ onPointerDown: (event: React.PointerEvent) => { event.preventDefault(); running.current = true; setStarted(true); input.add(control) }, onPointerUp: () => input.delete(control), onPointerLeave: () => input.delete(control), onContextMenu: (event: React.MouseEvent) => event.preventDefault() })
  const togglePause = () => {
    running.current = !running.current
    setStarted(running.current)
    if (!running.current) input.clear()
  }

  return <main className={hud.drift ? 'game is-drifting' : 'game'}>
    <Canvas shadows dpr={[1, 1.5]} camera={{ position: [0, 7, 18], fov: 52 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <Scene game={game} onUpdate={update} running={running} />
    </Canvas>
    <div className="vignette" />
    <header className="topbar">
      <div className="brand-mark">N<span>/</span>S</div>
      <div className="event-name"><span className="live-dot" />MIDNIGHT CIRCUIT<small>JAPAN / HAKONE PASS</small></div>
      <div className="event-meta"><span>FREE ROAM</span><b>01:42 AM</b></div>
      <button className="sound-toggle" aria-label="开启/关闭引擎音效" onClick={toggleAudio}>♪</button>
      <button className="pause-button" aria-label="暂停或继续" onClick={togglePause}>{started ? 'Ⅱ' : '▶'}</button>
    </header>
    <section className="race-info">
      <div className="lap-count"><small>LAP</small><strong>{String(hud.lap).padStart(2, '0')}<i>/ 03</i></strong></div>
      <div className="timer"><small>CURRENT LAP</small><strong>{formatTime(hud.lapTime)}</strong><span>{hud.best ? `BEST ${formatTime(hud.best)}` : hud.active ? 'TIMING' : 'READY TO DRIVE'}</span></div>
    </section>
    <section className="speed-cluster" aria-label="车辆仪表">
      <div className="gear"><small>GEAR</small><strong>{hud.gear}</strong></div>
      <div className="speed-readout"><strong>{Math.round(Math.abs(hud.speed) * 3.6)}</strong><span>KM/H</span></div>
      <div className="rpm"><div className="rpm-track"><i style={{ width: `${Math.min(100, hud.rpm / 80)}%` }} /></div><span>RPM <b>{Math.round(hud.rpm)}</b></span></div>
    </section>
    <section className="boost-meter"><div className="boost-head"><span>▸ NITROUS</span><b>{Math.round(hud.boost)}%</b></div><div className="boost-track"><i style={{ width: `${hud.boost}%` }} /></div><small>HOLD SHIFT / X</small></section>
    <div className="status-chip">{hud.drift ? <><span className="chip-dot hot" />DRIFT ANGLE <b>ACTIVE</b></> : <><span className="chip-dot" />GRIP <b>OPTIMAL</b></>}</div>
    <section className="control-hint"><span className="keycap">W</span><span className="keycap">A</span><span className="keycap">S</span><span className="keycap">D</span><small>DRIVE</small><span className="keycap wide">SPACE</span><small>DRIFT</small><span className="keycap wide orange">SHIFT</span><small>BOOST</small></section>
    <div className="track-label"><span>▰</span> TSUKUBA NIGHT RUN <i>•</i> 4.8 KM</div>
    <section className="touch-controls"><button {...hold('left')}>◀</button><button {...hold('right')}>▶</button><button {...hold('drift')}>DRIFT</button><button {...hold('reverse')}>BRAKE</button><button {...hold('forward')}>GAS</button><button {...hold('boost')}>N₂O</button></section>
    {started && hud.countdown > 0 && <div className="countdown"><small>GET READY</small><strong>{Math.ceil(hud.countdown)}</strong></div>}
    {started && <div className="drift-score"><small>DRIFT SCORE</small><strong>{hud.driftScore.toLocaleString()}</strong>{hud.drift && <span>× {hud.driftChain.toFixed(1)}</span>}</div>}
    <div className="rank-badge"><small>POSITION</small><strong>{hud.rank}<i>/ 04</i></strong></div>
    {hud.finished && <div className="finish-overlay"><small>HAKONE NIGHT RUN / COMPLETE</small><strong>FINISH<br /><i>THE RUN.</i></strong><div className="finish-stats"><span>FINAL TIME<b>{formatTime(hud.lapTime)}</b></span><span>BEST LAP<b>{formatTime(hud.best)}</b></span><span>DRIFT SCORE<b>{hud.score.toLocaleString()}</b></span></div><button onClick={() => { resetOpponents(); game.current = initialGame(); setHud(game.current); running.current = true; setStarted(true) }}>RACE AGAIN <b>↗</b></button></div>}
    {started && !running.current && !hud.finished && <button className="pause-overlay" onClick={togglePause}><span>SESSION PAUSED</span><strong>RESUME</strong><small>PRESS ENTER</small></button>}
    {!started && <button className="start-overlay" onClick={() => { running.current = true; setStarted(true) }}><span>ENGINE READY</span><strong>START<br /><i>YOUR RUN</i></strong><small>PRESS ENTER OR TAP TO BEGIN <b>↗</b></small></button>}
    <div className="grain" />
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
