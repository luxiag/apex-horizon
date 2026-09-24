import { create } from 'zustand';

export type Screen = 'intro' | 'menu' | 'garage' | 'tracks' | 'race' | 'results';
export type TimeOfDay = 'sunset' | 'noon' | 'night';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface RaceResultRow {
  name: string;
  carId: string;
  isPlayer: boolean;
  time: number; // 总用时（秒），未完赛为估算值
  bestLap: number | null;
  finished: boolean;
}

interface GameState {
  screen: Screen;
  carId: string;
  paint: Record<string, string>;
  trackId: string;
  laps: number;
  opponents: number;
  difficulty: Difficulty;
  timeOfDay: TimeOfDay;
  volume: number;
  quality: 'high' | 'medium';
  raceKey: number;
  paused: boolean;
  results: RaceResultRow[] | null;
  bestLaps: Record<string, number>;
  set: (p: Partial<GameState>) => void;
  go: (s: Screen) => void;
  restartRace: () => void;
  saveBestLap: (key: string, t: number) => boolean;
}

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('apex-save') || '{}');
  } catch {
    return {};
  }
})();

export const useGame = create<GameState>((set, get) => ({
  screen: 'intro',
  carId: saved.carId ?? 'gt3rs',
  paint: saved.paint ?? {},
  trackId: 'coastline',
  laps: saved.laps ?? 3,
  opponents: saved.opponents ?? 5,
  difficulty: saved.difficulty ?? 'normal',
  timeOfDay: saved.timeOfDay ?? 'sunset',
  volume: saved.volume ?? 0.8,
  quality: saved.quality ?? 'high',
  raceKey: 0,
  paused: false,
  results: null,
  bestLaps: saved.bestLaps ?? {},
  set: (p) => set(p),
  go: (screen) => set({ screen, paused: false }),
  restartRace: () => set((s) => ({ raceKey: s.raceKey + 1, screen: 'race', results: null, paused: false })),
  saveBestLap: (key, t) => {
    const cur = get().bestLaps[key];
    if (cur === undefined || t < cur) {
      set({ bestLaps: { ...get().bestLaps, [key]: t } });
      return true;
    }
    return false;
  },
}));

useGame.subscribe((s) => {
  const { carId, paint, laps, opponents, difficulty, timeOfDay, volume, quality, bestLaps } = s;
  localStorage.setItem('apex-save', JSON.stringify({ carId, paint, laps, opponents, difficulty, timeOfDay, volume, quality, bestLaps }));
});

export function formatTime(t: number | null | undefined) {
  if (t === null || t === undefined || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t * 1000) % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
