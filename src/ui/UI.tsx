import { useEffect, useRef, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { useGame, type TimeOfDay, type Difficulty } from '../game/store';
import { CARS, carById } from '../game/cars';
import { TRACKS, getTrack } from '../game/track';
import { audio } from '../game/audio';
import { formatLap } from '../game/race';
import { HUD } from './HUD';
import { TrackMapBig, trackFacts } from './TrackMap';

export function UI() {
  const screen = useGame((s) => s.screen);
  const paused = useGame((s) => s.paused);
  return (
    <div className="ui">
      {screen === 'intro' && <Intro />}
      {screen === 'menu' && <MainMenu />}
      {screen === 'garage' && <Garage />}
      {screen === 'tracks' && <TrackSelect />}
      {screen === 'race' && <HUD />}
      {screen === 'race' && paused && <Pause />}
      {screen === 'results' && <Results />}
    </div>
  );
}

/** 菜单的键盘导航 */
function useMenuKeys(count: number, onSelect: (i: number) => void, onBack?: () => void, initial = 0) {
  const [idx, setIdx] = useState(initial);
  const ref = useRef({ idx, count, onSelect, onBack });
  ref.current = { idx, count, onSelect, onBack };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const r = ref.current;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        setIdx((i) => (i + 1) % r.count);
        audio.uiMove();
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        setIdx((i) => (i - 1 + r.count) % r.count);
        audio.uiMove();
      } else if (e.code === 'Enter' || e.code === 'Space') {
        audio.uiSelect();
        r.onSelect(r.idx);
      } else if ((e.code === 'Escape' || e.code === 'Backspace') && r.onBack) {
        audio.uiBack();
        r.onBack();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return [idx, setIdx] as const;
}

function Logo({ size }: { size?: number }) {
  return (
    <div className="logo" style={size ? { fontSize: size } : undefined}>
      <div className="a">APEX</div>
      <div className="b">RUSH</div>
    </div>
  );
}

// ------------------------------------------------------------------
function Intro() {
  const { progress, active, total, loaded } = useProgress();
  const go = useGame((s) => s.go);
  const ready = !active && progress >= 100;
  useEffect(() => {
    if (!ready) return;
    const h = () => {
      audio.ensure();
      audio.uiSelect();
      go('menu');
    };
    window.addEventListener('keydown', h);
    window.addEventListener('mousedown', h);
    return () => {
      window.removeEventListener('keydown', h);
      window.removeEventListener('mousedown', h);
    };
  }, [ready, go]);
  return (
    <div className="intro">
      <div className="scanlines" />
      <div className="fade-in" style={{ textAlign: 'center' }}>
        <div className="logo">
          <span className="a">APEX</span> <span className="b">RUSH</span>
        </div>
        <div className="tagline" style={{ marginTop: 18 }}>
          极速地平线 · open road racing
        </div>
      </div>
      <div className="progress">
        <i style={{ transform: `scaleX(${progress / 100})` }} />
      </div>
      {ready ? (
        <div className="press">按任意键开始 · PRESS ANY KEY</div>
      ) : (
        <div className="tagline" style={{ letterSpacing: '0.3em' }}>
          正在载入车辆 {Math.round(progress)}% · {loaded}/{total}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
function MainMenu() {
  const go = useGame((s) => s.go);
  const carId = useGame((s) => s.carId);
  const car = carById(carId);
  const [settings, setSettings] = useState(false);
  const items = [
    { en: 'Race', cn: '开始比赛', act: () => go('tracks') },
    { en: 'Garage', cn: '车库 · 选择座驾', act: () => go('garage') },
    { en: 'Settings', cn: '设置', act: () => setSettings((s) => !s) },
  ];
  const [idx, setIdx] = useMenuKeys(items.length, (i) => items[i].act());
  return (
    <div className="menu">
      <div className="shade-left" />
      <div className="shade-bottom" />
      <div className="slide-in" style={{ position: 'relative' }}>
        <Logo />
        <div className="tagline" style={{ marginTop: 14 }}>
          极速地平线 · season 01
        </div>
      </div>
      <div className="menu-list" style={{ position: 'relative' }}>
        {items.map((it, i) => (
          <div
            key={it.en}
            className={`menu-item slide-in ${idx === i ? 'active' : ''}`}
            style={{ animationDelay: `${0.1 + i * 0.07}s` }}
            onMouseEnter={() => {
              if (idx !== i) audio.uiMove();
              setIdx(i);
            }}
            onClick={() => {
              audio.uiSelect();
              it.act();
            }}
          >
            <span className="num">0{i + 1}</span>
            <span className="en">{it.en}</span>
            <span className="cn">{it.cn}</span>
          </div>
        ))}
      </div>
      {settings && <SettingsPanel />}
      <div className="menu-foot" style={{ position: 'relative' }}>
        <div className="hints">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span>选择
          </span>
          <span>
            <span className="kbd">Enter</span>确认
          </span>
          <span>支持 Xbox / PS 手柄</span>
        </div>
        <div className="current-car fade-in">
          <div className="label">当前座驾</div>
          <div className="brand">{car.brand}</div>
          <div className="name">{car.model}</div>
          <div style={{ marginTop: 8 }}>
            <span className="chip accent">{car.tag}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsPanel() {
  const { volume, quality, set } = useGame();
  return (
    <div className="settings-panel fade-in">
      <div className="setting-row">
        <span>主音量</span>
        <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => set({ volume: +e.target.value })} />
      </div>
      <div className="setting-row">
        <span>画面质量</span>
        <div className="seg">
          {(['high', 'medium'] as const).map((q) => (
            <button key={q} className={quality === q ? 'on' : ''} onClick={() => set({ quality: q })}>
              {q === 'high' ? '高画质' : '流畅'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
function Garage() {
  const { carId, set, go, paint } = useGame();
  const idx = CARS.findIndex((c) => c.id === carId);
  const car = carById(carId);
  const change = (d: number) => {
    const n = CARS[(idx + d + CARS.length) % CARS.length];
    audio.uiMove();
    set({ carId: n.id });
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') change(-1);
      if (e.code === 'ArrowRight' || e.code === 'KeyD') change(1);
      if (e.code === 'Enter') {
        audio.uiSelect();
        go('tracks');
      }
      if (e.code === 'Escape' || e.code === 'Backspace') {
        audio.uiBack();
        go('menu');
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  const stats: [string, number][] = [
    ['极速', car.stats.speed],
    ['加速', car.stats.accel],
    ['操控', car.stats.handling],
    ['制动', car.stats.braking],
  ];
  const pi = Math.round((car.stats.speed + car.stats.accel + car.stats.handling + car.stats.braking) * 25);
  return (
    <div className="garage">
      <div className="shade-left" />
      <div className="shade-bottom" />
      <div className="topbar" style={{ position: 'relative' }}>
        <div className="back" onClick={() => (audio.uiBack(), go('menu'))}>
          ◀ <span>ESC 返回</span>
        </div>
        <div className="title">GARAGE</div>
        <div className="crumb">车库 · 选择你的座驾</div>
        <div className="spacer" />
        <span className="chip">
          {idx + 1} / {CARS.length}
        </span>
      </div>
      <div className="car-panel" key={car.id} style={{ position: 'relative' }}>
        <div className="slide-in">
          <div className="brand">{car.brand}</div>
          <div className="model">{car.model}</div>
        </div>
        <div className="meta slide-in" style={{ animationDelay: '0.05s' }}>
          <span className="chip accent">{car.tag}</span>
          <span className="chip">{car.year}</span>
          <span className="chip">{car.specs.drive}</span>
          <span className="chip">PI {pi}</span>
        </div>
        <div className="stats slide-in" style={{ animationDelay: '0.1s' }}>
          {stats.map(([k, v]) => (
            <div className="stat" key={k}>
              <span>{k}</span>
              <div className="bar">
                <i style={{ transform: `scaleX(${v / 10})` }} />
              </div>
              <span className="val">{v.toFixed(1)}</span>
            </div>
          ))}
        </div>
        <div className="specs slide-in" style={{ animationDelay: '0.15s' }}>
          <div className="spec">
            <div className="k">最大马力</div>
            <div className="v">
              {car.specs.hp}
              <small>hp</small>
            </div>
          </div>
          <div className="spec">
            <div className="k">峰值扭矩</div>
            <div className="v">
              {car.specs.torque}
              <small>N·m</small>
            </div>
          </div>
          <div className="spec">
            <div className="k">极速</div>
            <div className="v">
              {car.specs.top}
              <small>km/h</small>
            </div>
          </div>
          <div className="spec">
            <div className="k">0-100 km/h</div>
            <div className="v">
              {car.specs.zeroTo100}
              <small>s</small>
            </div>
          </div>
          <div className="spec">
            <div className="k">整备质量</div>
            <div className="v">
              {car.specs.weight}
              <small>kg</small>
            </div>
          </div>
          <div className="spec">
            <div className="k">驱动</div>
            <div className="v">{car.specs.drive}</div>
          </div>
        </div>
        <div className="engine-line">动力总成：{car.specs.engine}</div>
        {car.paintable && (
          <div className="swatches">
            <span style={{ fontSize: 13, color: 'var(--dim)', marginRight: 6 }}>车漆</span>
            {car.colors.map((c) => (
              <div
                key={c}
                className={`swatch ${(paint[car.id] ?? car.colors[0]) === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => {
                  audio.uiMove();
                  set({ paint: { ...paint, [car.id]: c } });
                }}
              />
            ))}
          </div>
        )}
      </div>
      <div />
      <div className="car-strip" style={{ position: 'relative' }}>
        <div className="arrow" onClick={() => change(-1)}>
          ◀
        </div>
        {CARS.map((c) => (
          <div
            key={c.id}
            className={`car-card ${c.id === carId ? 'on' : ''}`}
            style={{ ['--c' as string]: c.accent }}
            onClick={() => {
              audio.uiMove();
              set({ carId: c.id });
            }}
          >
            <div className="cb">{c.brand}</div>
            <div className="cm">{c.model}</div>
            <div className="ct">
              {c.year} · {c.tag}
            </div>
          </div>
        ))}
        <div className="arrow" onClick={() => change(1)}>
          ▶
        </div>
      </div>
      <div className="garage-actions">
        <button className="btn" onClick={() => (audio.uiSelect(), go('tracks'))}>
          Select<small>选择并出发</small>
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          className={value === v ? 'on' : ''}
          onClick={() => {
            audio.uiMove();
            onChange(v);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function TrackSelect() {
  const g = useGame();
  const track = getTrack(g.trackId);
  const def = TRACKS.find((t) => t.id === g.trackId)!;
  const facts = trackFacts(track);
  const best = g.bestLaps[`${g.trackId}:${g.carId}`];
  const car = carById(g.carId);
  const start = () => {
    audio.ensure();
    audio.uiSelect();
    g.restartRace();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'Enter') start();
      if (e.code === 'Escape' || e.code === 'Backspace') {
        audio.uiBack();
        g.go('menu');
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  return (
    <div className="tracks">
      <div className="topbar">
        <div className="back" onClick={() => (audio.uiBack(), g.go('menu'))}>
          ◀ <span>ESC 返回</span>
        </div>
        <div className="title">EVENT</div>
        <div className="crumb">赛事 · 选择赛道</div>
        <div className="spacer" />
        <span className="chip">座驾 · {car.brand} {car.model}</span>
      </div>
      <div className="track-body">
        <div className="track-map fade-in">
          <TrackMapBig trackId={g.trackId} />
          <div className="corner" style={{ left: -1, top: -1, borderWidth: '2px 0 0 2px' }} />
          <div className="corner" style={{ right: -1, top: -1, borderWidth: '2px 2px 0 0' }} />
          <div className="corner" style={{ left: -1, bottom: -1, borderWidth: '0 0 2px 2px' }} />
          <div className="corner" style={{ right: -1, bottom: -1, borderWidth: '0 2px 2px 0' }} />
        </div>
        <div className="slide-in">
          <span className="chip">{def.location}</span>
          <div className="track-name" style={{ marginTop: 12 }}>
            {def.name}
          </div>
          <div className="track-sub">{def.subtitle}</div>
          <div className="track-desc">{def.description}</div>
          <div className="track-facts">
            <div className="fact">
              <div className="k">全长</div>
              <div className="v">
                {(facts.length / 1000).toFixed(2)}
                <small>km</small>
              </div>
            </div>
            <div className="fact">
              <div className="k">弯道</div>
              <div className="v">{facts.corners}</div>
            </div>
            <div className="fact">
              <div className="k">落差</div>
              <div className="v">
                {facts.elevation.toFixed(0)}
                <small>m</small>
              </div>
            </div>
            <div className="fact">
              <div className="k">最佳圈速</div>
              <div className="v" style={{ fontSize: 26 }}>
                {best ? formatLap(best) : '--:--.---'}
              </div>
            </div>
          </div>
          <div className="race-settings">
            <div className="setting-row">
              <span>圈数</span>
              <Seg value={g.laps} options={[[1, '1 圈'], [2, '2 圈'], [3, '3 圈'], [5, '5 圈']]} onChange={(v) => g.set({ laps: v })} />
            </div>
            <div className="setting-row">
              <span>对手数量</span>
              <Seg value={g.opponents} options={[[0, '计时赛'], [3, '3'], [5, '5'], [7, '7']]} onChange={(v) => g.set({ opponents: v })} />
            </div>
            <div className="setting-row">
              <span>AI 难度</span>
              <Seg<Difficulty> value={g.difficulty} options={[['easy', '休闲'], ['normal', '专业'], ['hard', '传奇']]} onChange={(v) => g.set({ difficulty: v })} />
            </div>
            <div className="setting-row">
              <span>时间</span>
              <Seg<TimeOfDay> value={g.timeOfDay} options={[['sunset', '黄昏'], ['noon', '正午'], ['night', '夜晚']]} onChange={(v) => g.set({ timeOfDay: v })} />
            </div>
          </div>
          <button className="btn" onClick={start}>
            Start Race<small>开始比赛 · Enter</small>
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
function Pause() {
  const g = useGame();
  const items = [
    { en: 'Resume', cn: '继续比赛', act: () => g.set({ paused: false }) },
    { en: 'Restart', cn: '重新开始', act: () => g.restartRace() },
    { en: 'Quit', cn: '退出到主菜单', act: () => g.go('menu') },
  ];
  const [idx, setIdx] = useMenuKeys(items.length, (i) => items[i].act());
  return (
    <div className="overlay fade-in">
      <div className="pause-box">
        <div>
          <div className="logo" style={{ fontSize: 96 }}>
            <div className="a">PAUSED</div>
          </div>
          <div className="controls-table">
            <span>
              <span className="kbd">W</span>
              <span className="kbd">↑</span>
            </span>
            <span>油门</span>
            <span>
              <span className="kbd">S</span>
              <span className="kbd">↓</span>
            </span>
            <span>刹车 / 倒车</span>
            <span>
              <span className="kbd">A</span>
              <span className="kbd">D</span>
            </span>
            <span>转向</span>
            <span>
              <span className="kbd">Space</span>
            </span>
            <span>手刹（漂移）</span>
            <span>
              <span className="kbd">Shift</span>
            </span>
            <span>氮气加速</span>
            <span>
              <span className="kbd">C</span>
            </span>
            <span>切换视角</span>
            <span>
              <span className="kbd">Q</span>
            </span>
            <span>回看</span>
            <span>
              <span className="kbd">R</span>
            </span>
            <span>回到赛道</span>
            <span>
              <span className="kbd">M</span>
            </span>
            <span>静音</span>
          </div>
        </div>
        <div className="pause-list">
          {items.map((it, i) => (
            <div
              key={it.en}
              className={`menu-item ${idx === i ? 'active' : ''}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => {
                audio.uiSelect();
                it.act();
              }}
            >
              <span className="num">0{i + 1}</span>
              <span className="en">{it.en}</span>
              <span className="cn">{it.cn}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
function Results() {
  const g = useGame();
  const rows = g.results ?? [];
  const me = rows.findIndex((r) => r.isPlayer);
  const place = me + 1;
  const myBest = rows[me]?.bestLap ?? null;
  const record = g.bestLaps[`${g.trackId}:${g.carId}`];
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'Enter') g.restartRace();
      if (e.code === 'Escape') g.go('menu');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  const leader = rows[0]?.time ?? 0;
  const title = place === 1 ? '冠军！' : place <= 3 ? '登上领奖台' : '完成比赛';
  return (
    <div className="overlay fade-in">
      <div className="results">
        <div className="head">
          <div className={`place p${place}`}>P{place}</div>
          <div>
            <div className="tagline">race complete · {rows.length} 位车手</div>
            <div className="logo" style={{ fontSize: 64 }}>
              <div className="a">{title}</div>
            </div>
          </div>
        </div>
        <div className="summary">
          <div className="fact">
            <div className="k">你的最快圈</div>
            <div className="v">{formatLap(myBest)}</div>
          </div>
          <div className="fact">
            <div className="k">赛道纪录（本车）</div>
            <div className="v">{formatLap(record ?? null)}</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>名次</th>
              <th>车手</th>
              <th>车辆</th>
              <th>总用时</th>
              <th>差距</th>
              <th>最快圈</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const c = carById(r.carId);
              return (
                <tr key={i} className={r.isPlayer ? 'me' : ''}>
                  <td className="pos">{i + 1}</td>
                  <td>{r.isPlayer ? '你' : r.name}</td>
                  <td>
                    <span style={{ color: c.accent, fontSize: 11, letterSpacing: '0.2em' }}>{c.brand}</span> {c.model}
                  </td>
                  <td>
                    {formatLap(r.time)}
                    {!r.finished && <span style={{ color: 'var(--dim)', fontSize: 11 }}> (预计)</span>}
                  </td>
                  <td>{i === 0 ? '—' : `+${(r.time - leader).toFixed(3)}`}</td>
                  <td>{formatLap(r.bestLap)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="actions">
          <button className="btn" onClick={() => (audio.uiSelect(), g.restartRace())}>
            Race Again<small>再来一局 · Enter</small>
          </button>
          <button className="btn ghost" onClick={() => (audio.uiSelect(), g.go('garage'))}>
            Garage<small>换车</small>
          </button>
          <button className="btn ghost" onClick={() => (audio.uiBack(), g.go('menu'))}>
            Menu<small>主菜单 · Esc</small>
          </button>
        </div>
      </div>
    </div>
  );
}
