import { Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useGame } from './game/store';
import { CARS, carById } from './game/cars';
import { Showroom } from './scene/Showroom';
import { RaceScene } from './scene/RaceScene';
import { UI } from './ui/UI';
import { audio } from './game/audio';
import { hud } from './game/race';

CARS.forEach((c) => useGLTF.preload(c.url));

if (import.meta.env.DEV) Object.assign(window, { __game: useGame, __hud: hud });

export default function App() {
  const screen = useGame((s) => s.screen);
  const raceKey = useGame((s) => s.raceKey);
  const carId = useGame((s) => s.carId);
  const volume = useGame((s) => s.volume);
  const quality = useGame((s) => s.quality);
  const inRace = screen === 'race' || screen === 'results';

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', carById(carId).accent);
  }, [carId]);
  useEffect(() => audio.setVolume(volume), [volume]);

  return (
    <>
      <div className="stage">
        <Canvas
          shadows
          dpr={quality === 'high' ? [1, 1.75] : [0.75, 1]}
          flat
          gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
          camera={{ fov: 40, near: 0.1, far: 9000, position: [7, 1.6, 7] }}
          onCreated={(s) => {
            if (import.meta.env.DEV) Object.assign(window, { __r3f: s });
          }}
        >
          <Suspense fallback={null}>{inRace ? <RaceScene key={raceKey} /> : <Showroom />}</Suspense>
        </Canvas>
      </div>
      <UI />
    </>
  );
}
