import { useEffect, useMemo, useState } from 'react';
import { getTrack, type Track } from '../game/track';

export function trackPath(track: Track, w: number, h: number, pad = 10) {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < track.count; i++) {
    minX = Math.min(minX, track.px[i]);
    maxX = Math.max(maxX, track.px[i]);
    minZ = Math.min(minZ, track.pz[i]);
    maxZ = Math.max(maxZ, track.pz[i]);
  }
  const sx = (w - pad * 2) / (maxX - minX);
  const sz = (h - pad * 2) / (maxZ - minZ);
  const s = Math.min(sx, sz);
  const ox = (w - (maxX - minX) * s) / 2;
  const oz = (h - (maxZ - minZ) * s) / 2;
  const map = (x: number, z: number) => [ox + (x - minX) * s, oz + (z - minZ) * s] as const;
  let d = '';
  for (let i = 0; i < track.count; i += 3) {
    const [x, y] = map(track.px[i], track.pz[i]);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  d += 'Z';
  return { d, map, scale: s };
}

/** 赛道选择页的大图 */
export function TrackMapBig({ trackId }: { trackId: string }) {
  const track = getTrack(trackId);
  const W = 800;
  const H = 500;
  const { d, map } = useMemo(() => trackPath(track, W, H, 40), [track]);
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setT((x) => (x + 0.0022) % 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const car = track.pointAt(t * track.length);
  const [cx, cy] = map(car.x, car.z);
  const [sx, sy] = map(track.px[0], track.pz[0]);
  // 高度着色的渐变点
  const elev = useMemo(() => {
    const pts: { x: number; y: number; h: number }[] = [];
    let maxH = 0;
    for (let i = 0; i < track.count; i += 12) maxH = Math.max(maxH, track.py[i]);
    for (let i = 0; i < track.count; i += 12) {
      const [x, y] = map(track.px[i], track.pz[i]);
      pts.push({ x, y, h: track.py[i] / (maxH || 1) });
    }
    return pts;
  }, [track, map]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="rgba(255,255,255,0.05)" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />
      <path d={d} fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth={22} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={16} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={4} strokeLinejoin="round" filter="url(#glow)" className="draw" />
      {elev.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2 + p.h * 3} fill={`rgba(255,${Math.round(220 - p.h * 160)},${Math.round(120 - p.h * 100)},${0.35 + p.h * 0.5})`} />
      ))}
      <rect x={sx - 3} y={sy - 14} width={6} height={28} fill="#fff" />
      <text x={sx + 10} y={sy + 34} fill="#fff" fontSize={14} fontFamily="Chakra Petch" letterSpacing={3}>
        START
      </text>
      <circle cx={cx} cy={cy} r={9} fill="var(--accent)" filter="url(#glow)" />
      <circle cx={cx} cy={cy} r={4} fill="#fff" />
    </svg>
  );
}

export function trackFacts(track: Track) {
  let corners = 0;
  let inCorner = false;
  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < track.count; i++) {
    const c = Math.abs(track.curv[i]) > 0.006;
    if (c && !inCorner) corners++;
    inCorner = c;
    minH = Math.min(minH, track.py[i]);
    maxH = Math.max(maxH, track.py[i]);
  }
  let longest = 0;
  let run = 0;
  for (let i = 0; i < track.count * 2; i++) {
    if (Math.abs(track.curv[i % track.count]) < 0.0015) run++;
    else run = 0;
    longest = Math.max(longest, Math.min(run, track.count));
  }
  return { length: track.length, corners, elevation: maxH - minH, straight: longest * track.step };
}
