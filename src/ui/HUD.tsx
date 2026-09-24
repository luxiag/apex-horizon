import { useEffect, useMemo, useRef, useState } from 'react';
import { hud, formatLap, type HudMessage } from '../game/race';
import { useGame } from '../game/store';
import { getTrack } from '../game/track';
import { trackPath } from './TrackMap';
import { carById } from '../game/cars';

const R = 128;
const ARC = 260; // 仪表弧度
const START = 140; // 起始角（度，从 +x 顺时针）

function polar(a: number, r: number) {
  const rad = (a * Math.PI) / 180;
  return [150 + Math.cos(rad) * r, 150 + Math.sin(rad) * r];
}
function arcPath(a0: number, a1: number, r: number) {
  const [x0, y0] = polar(a0, r);
  const [x1, y1] = polar(a1, r);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`;
}

function suffix(n: number) {
  return n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH';
}

export function HUD() {
  const trackId = useGame((s) => s.trackId);
  const track = getTrack(trackId);
  const refs = {
    spd: useRef<HTMLDivElement>(null),
    gear: useRef<HTMLDivElement>(null),
    rpmArc: useRef<SVGPathElement>(null),
    pos: useRef<HTMLSpanElement>(null),
    posSuf: useRef<HTMLSpanElement>(null),
    lap: useRef<HTMLSpanElement>(null),
    total: useRef<HTMLDivElement>(null),
    lapT: useRef<HTMLDivElement>(null),
    best: useRef<HTMLDivElement>(null),
    nitro: useRef<HTMLDivElement>(null),
    lines: useRef<HTMLDivElement>(null),
    flash: useRef<HTMLDivElement>(null),
    drift: useRef<HTMLDivElement>(null),
    driftV: useRef<HTMLDivElement>(null),
    driftM: useRef<HTMLDivElement>(null),
    dots: useRef<SVGGElement>(null),
  };
  const [, setTick] = useState(0);
  const mm = useMemo(() => trackPath(track, 230, 170, 12), [track]);
  const arcLen = useMemo(() => (Math.PI * 2 * R * ARC) / 360, []);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const r = refs;
      if (r.spd.current) r.spd.current.textContent = String(Math.round(hud.speed));
      if (r.gear.current) r.gear.current.textContent = hud.gear;
      if (r.rpmArc.current) {
        const f = Math.min(1, hud.rpm / hud.redline);
        r.rpmArc.current.style.strokeDashoffset = String(arcLen * (1 - f));
        r.rpmArc.current.style.stroke = f > 0.9 ? '#ff3d5a' : 'var(--accent)';
      }
      if (r.pos.current) r.pos.current.textContent = String(hud.position);
      if (r.posSuf.current) r.posSuf.current.textContent = suffix(hud.position);
      if (r.lap.current) r.lap.current.textContent = String(hud.lap);
      if (r.total.current) r.total.current.textContent = formatLap(hud.totalTime);
      if (r.lapT.current) r.lapT.current.textContent = formatLap(hud.lapTime);
      if (r.best.current) r.best.current.textContent = formatLap(hud.bestLap);
      if (r.nitro.current) {
        const segs = r.nitro.current.querySelectorAll('.seg');
        const on = Math.round(hud.nitro * segs.length);
        segs.forEach((s, i) => s.classList.toggle('on', i < on));
        r.nitro.current.classList.toggle('active', hud.nitroActive);
      }
      if (r.lines.current) {
        const o = hud.nitroActive ? 0.55 : Math.max(0, hud.speedFactor - 0.7) * 1.1;
        r.lines.current.style.opacity = String(o);
      }
      if (r.flash.current) r.flash.current.style.opacity = String(Math.min(0.7, hud.impact));
      if (r.drift.current) {
        r.drift.current.style.opacity = hud.driftActive && hud.driftScore > 60 ? '1' : '0';
        if (r.driftV.current) r.driftV.current.textContent = Math.round(hud.driftScore).toLocaleString();
        if (r.driftM.current) r.driftM.current.textContent = `x${hud.driftMult.toFixed(1)}`;
      }
      if (r.dots.current) {
        const kids = r.dots.current.children;
        hud.minimap.forEach((p, i) => {
          const el = kids[i] as SVGCircleElement | undefined;
          if (!el) return;
          const [x, y] = mm.map(p.x, p.z);
          el.setAttribute('cx', x.toFixed(1));
          el.setAttribute('cy', y.toFixed(1));
        });
      }
      if (t - last > 120) {
        last = t;
        setTick((x) => x + 1);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mm, arcLen]);

  const now = performance.now();
  const msgs = hud.messages.filter((m: HudMessage) => now - m.t < 2400);
  const phase = hud.phase;
  const ticks = (() => {
    const out: { x1: number; y1: number; x2: number; y2: number; red: boolean; label?: string; lx?: number; ly?: number }[] = [];
    const max = Math.ceil(hud.redline / 1000);
    for (let i = 0; i <= max; i++) {
      const a = START + (ARC * i) / max;
      const [x1, y1] = polar(a, R + 8);
      const [x2, y2] = polar(a, R + 18);
      const [lx, ly] = polar(a, R - 14);
      out.push({ x1, y1, x2, y2, red: i >= max - 1, label: String(i), lx, ly });
    }
    return out;
  })();

  return (
    <div className="hud pass">
      <div className="speedlines" ref={refs.lines} />
      <div className="impact-flash" ref={refs.flash} />

      <div className="tl">
        <div className="pos-big">
          <span className="n" ref={refs.pos}>
            {hud.position}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="suf" ref={refs.posSuf}>
              {suffix(hud.position)}
            </span>
            <span className="of">/{hud.totalCars}</span>
          </div>
        </div>
        <div className="lapbox" style={{ marginTop: 12 }}>
          <div className="k">LAP · 圈数</div>
          <div className="v">
            <span ref={refs.lap}>{hud.lap}</span>
            <small>/{hud.totalLaps}</small>
          </div>
        </div>
      </div>

      <div className="tr">
        <div className="time-row main">
          <span className="k">TIME</span>
          <span className="v" ref={refs.total}>
            0:00.000
          </span>
        </div>
        <div className="time-row">
          <span className="k">LAP</span>
          <span className="v" ref={refs.lapT}>
            0:00.000
          </span>
        </div>
        <div className="time-row">
          <span className="k">BEST</span>
          <span className="v" ref={refs.best} style={{ color: 'var(--accent)' }}>
            --:--.---
          </span>
        </div>
        <div className="time-row">
          <span className="k" style={{ letterSpacing: '0.1em' }}>
            {hud.cameraName} · C 切换
          </span>
        </div>
      </div>

      {hud.totalCars > 1 && (
        <div className="standings">
          {hud.standings.map((s, i) => (
            <div key={s.name} className={`standing ${s.isPlayer ? 'me' : ''}`}>
              <span className="p">{i + 1}</span>
              <span className="dot" style={{ background: s.isPlayer ? '#000' : carAccent(s.carId) }} />
              <span>{s.isPlayer ? '你' : s.name}</span>
              <span className="g">{s.gap}</span>
            </div>
          ))}
        </div>
      )}

      <div className="minimap">
        <svg viewBox="0 0 230 170">
          <path d={mm.d} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={9} strokeLinejoin="round" />
          <path d={mm.d} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={4} strokeLinejoin="round" />
          <g ref={refs.dots}>
            {hud.minimap.map((p, i) => (
              <circle key={i} r={p.player ? 5.5 : 4} fill={p.player ? 'var(--accent)' : p.color} stroke="#000" strokeWidth={1.5} />
            ))}
          </g>
        </svg>
      </div>

      <div className="gauge">
        <svg viewBox="0 0 300 300">
          <defs>
            <radialGradient id="gbg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(0,0,0,0.55)" />
              <stop offset="70%" stopColor="rgba(0,0,0,0.35)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
            <filter id="gglow">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle cx={150} cy={150} r={150} fill="url(#gbg)" />
          <path d={arcPath(START, START + ARC, R)} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={12} />
          <path d={arcPath(START + ARC * 0.9, START + ARC, R)} fill="none" stroke="rgba(255,61,90,0.45)" strokeWidth={12} />
          <path
            ref={refs.rpmArc}
            d={arcPath(START, START + ARC, R)}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={12}
            strokeDasharray={arcLen}
            strokeDashoffset={arcLen}
            filter="url(#gglow)"
          />
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.red ? '#ff3d5a' : 'rgba(255,255,255,0.7)'} strokeWidth={2.5} />
              <text x={t.lx} y={t.ly} fill={t.red ? '#ff3d5a' : 'rgba(255,255,255,0.6)'} fontSize={13} textAnchor="middle" dominantBaseline="middle" fontFamily="Chakra Petch">
                {t.label}
              </text>
            </g>
          ))}
          <text x={150} y={262} fill="rgba(255,255,255,0.4)" fontSize={10} textAnchor="middle" fontFamily="Chakra Petch" letterSpacing={3}>
            x1000 RPM
          </text>
        </svg>
        <div className="center">
          <div className="spd" ref={refs.spd}>
            0
          </div>
          <div className="unit">KM/H</div>
          <div className="gear" ref={refs.gear}>
            N
          </div>
        </div>
      </div>
      <div className="nitro" ref={refs.nitro}>
        <span className="lbl">N₂O</span>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="seg on" />
        ))}
      </div>

      <div className="drift" ref={refs.drift} style={{ opacity: 0 }}>
        <div className="k">DRIFT · 漂移</div>
        <div className="v" ref={refs.driftV}>
          0
        </div>
        <div className="m" ref={refs.driftM}>
          x1.0
        </div>
      </div>

      <div className="center-msg">
        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.kind}`}>
            <div className="t">{m.text}</div>
            {m.sub && <div className="s">{m.sub}</div>}
          </div>
        ))}
      </div>

      {hud.wrongWay && <div className="wrongway">逆行 · WRONG WAY</div>}

      {phase === 'intro' && (
        <div className="intro-banner">
          <div className="t">{track.def.name}</div>
          <div className="s">{track.def.subtitle} · {hud.totalLaps} LAPS</div>
        </div>
      )}
      {phase === 'countdown' && (
        <div className="countdown">
          <div className="lights">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={`lamp ${hud.countdown > i ? 'on' : ''}`} />
            ))}
          </div>
        </div>
      )}
      {phase === 'racing' && hud.totalTime < 1.2 && (
        <div className="countdown">
          <div className="go">GO!</div>
        </div>
      )}
      {(phase === 'intro' || phase === 'countdown') && (
        <div className="controls-hint hints">
          <span>
            <span className="kbd">W</span>
            <span className="kbd">A</span>
            <span className="kbd">S</span>
            <span className="kbd">D</span>驾驶
          </span>
          <span>
            <span className="kbd">Space</span>手刹漂移
          </span>
          <span>
            <span className="kbd">Shift</span>氮气
          </span>
          <span>
            <span className="kbd">C</span>视角
          </span>
          <span>
            <span className="kbd">R</span>复位
          </span>
          <span>
            <span className="kbd">Esc</span>暂停
          </span>
        </div>
      )}
    </div>
  );
}

function carAccent(id: string) {
  return carById(id).accent;
}
