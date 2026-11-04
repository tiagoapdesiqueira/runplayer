import { AudioPlayer } from './audioPlayer';

const FADE_IN_MS = 350;
const FADE_OUT_MS = 1500;
const STEPS = 20;

let activeTimer: ReturnType<typeof setInterval> | null = null;
let currentVolume = 1;
let fadingOut = false;

function cancelFade() {
  if (activeTimer) {
    clearInterval(activeTimer);
    activeTimer = null;
  }
}

async function animate(from: number, to: number, durationMs: number): Promise<void> {
  cancelFade();
  return new Promise((resolve) => {
    const stepMs = Math.max(10, durationMs / STEPS);
    let i = 0;
    activeTimer = setInterval(() => {
      i++;
      const t = Math.min(1, i / STEPS);
      const v = from + (to - from) * t;
      currentVolume = v;
      AudioPlayer.setVolume(Math.max(0, Math.min(1, v))).catch(() => {});
      if (t >= 1) {
        cancelFade();
        resolve();
      }
    }, stepMs);
  });
}

export function gainToMultiplier(gainDb?: number): number {
  if (gainDb == null || !isFinite(gainDb)) return 1;
  const target = -14;
  const applied = Math.max(-12, Math.min(0, target - gainDb));
  return Math.pow(10, applied / 20);
}

export async function setTargetVolume(gainDb: number | undefined): Promise<void> {
  const mult = gainToMultiplier(gainDb);
  cancelFade();
  currentVolume = mult;
  await AudioPlayer.setVolume(mult).catch(() => {});
}

export async function fadeInForTrack(gainDb: number | undefined): Promise<void> {
  fadingOut = false;
  const target = gainToMultiplier(gainDb);
  currentVolume = 0;
  await AudioPlayer.setVolume(0).catch(() => {});
  await animate(0, target, FADE_IN_MS);
}

export function isFadingOut(): boolean {
  return fadingOut;
}

export async function fadeOutAndStop(): Promise<void> {
  if (fadingOut) return;
  fadingOut = true;
  await animate(currentVolume, 0, FADE_OUT_MS);
  fadingOut = false;
}

export function resetVolumeState(): void {
  cancelFade();
  fadingOut = false;
  currentVolume = 1;
}
