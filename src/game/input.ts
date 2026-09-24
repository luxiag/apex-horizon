import type { DriveInput } from './vehicle';

const keys = new Set<string>();
const pressedOnce = new Set<string>();

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (!keys.has(e.code)) pressedOnce.add(e.code);
    keys.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
}

export const isDown = (...codes: string[]) => codes.some((c) => keys.has(c));

/** 消费一次性按键 */
export function consumePress(code: string) {
  if (pressedOnce.has(code)) {
    pressedOnce.delete(code);
    return true;
  }
  return false;
}
export function clearPresses() {
  pressedOnce.clear();
}

let prevPadButtons: boolean[] = [];
const padPressed = new Set<number>();

function readPad(): Gamepad | null {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p && p.connected) return p;
  return null;
}

export function consumePadPress(btn: number) {
  if (padPressed.has(btn)) {
    padPressed.delete(btn);
    return true;
  }
  return false;
}

let smoothSteer = 0;

export function readDriveInput(dt: number): DriveInput {
  const pad = readPad();
  let throttle = isDown('KeyW', 'ArrowUp') ? 1 : 0;
  let brake = isDown('KeyS', 'ArrowDown') ? 1 : 0;
  let steerKey = (isDown('KeyA', 'ArrowLeft') ? 1 : 0) - (isDown('KeyD', 'ArrowRight') ? 1 : 0);
  let handbrake = isDown('Space');
  let nitro = isDown('ShiftLeft', 'ShiftRight', 'KeyN');

  // 键盘转向：带一点渐进，避免数字输入过冲
  const target = steerKey;
  const rate = target === 0 ? 10 : Math.sign(target) !== Math.sign(smoothSteer) && smoothSteer !== 0 ? 12 : 5.5;
  smoothSteer += Math.max(-rate * dt, Math.min(rate * dt, target - smoothSteer));
  let steer = smoothSteer;

  if (pad) {
    const btn = pad.buttons.map((b) => b.pressed);
    btn.forEach((p, i) => {
      if (p && !prevPadButtons[i]) padPressed.add(i);
    });
    prevPadButtons = btn;
    const ax = pad.axes[0] ?? 0;
    if (Math.abs(ax) > 0.08) steer = -Math.sign(ax) * Math.pow((Math.abs(ax) - 0.08) / 0.92, 1.4);
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;
    if (rt > 0.02) throttle = Math.max(throttle, rt);
    if (lt > 0.02) brake = Math.max(brake, lt);
    if (pad.buttons[0]?.pressed) handbrake = true; // A
    if (pad.buttons[1]?.pressed || pad.buttons[5]?.pressed) nitro = true; // B / RB
  }
  return { throttle, brake, steer, handbrake, nitro };
}
