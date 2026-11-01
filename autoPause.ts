import { Accelerometer } from 'expo-sensors';

const SAMPLE_INTERVAL_MS = 500;
const WINDOW_SIZE = 10;
const MOVING_THRESHOLD = 0.15;
const STILL_THRESHOLD = 0.07;
const STILL_SECONDS = 5;
const MOVING_SECONDS = 2;

type Listener = (moving: boolean) => void;

let subscription: ReturnType<typeof Accelerometer.addListener> | null = null;
let listeners: Set<Listener> = new Set();
let samples: number[] = [];
let lastStateMoving = true;
let stillStart = 0;
let movingStart = 0;

function emit(moving: boolean) {
  if (moving === lastStateMoving) return;
  lastStateMoving = moving;
  for (const fn of listeners) {
    try {
      fn(moving);
    } catch {}
  }
}

function handleSample(x: number, y: number, z: number) {
  const mag = Math.abs(Math.sqrt(x * x + y * y + z * z) - 1);
  samples.push(mag);
  if (samples.length > WINDOW_SIZE) samples.shift();
  if (samples.length < WINDOW_SIZE) return;

  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const now = Date.now();

  if (avg < STILL_THRESHOLD) {
    movingStart = 0;
    if (stillStart === 0) stillStart = now;
    if (now - stillStart > STILL_SECONDS * 1000) emit(false);
  } else if (avg > MOVING_THRESHOLD) {
    stillStart = 0;
    if (movingStart === 0) movingStart = now;
    if (now - movingStart > MOVING_SECONDS * 1000) emit(true);
  }
}

export async function startAutoPause(onChange: Listener): Promise<boolean> {
  listeners.add(onChange);
  if (subscription) return true;
  try {
    const { status } = await Accelerometer.requestPermissionsAsync();
    if (status !== 'granted') return false;
    Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);
    samples = [];
    stillStart = 0;
    movingStart = 0;
    lastStateMoving = true;
    subscription = Accelerometer.addListener(({ x, y, z }) => {
      handleSample(x, y, z);
    });
    return true;
  } catch {
    return false;
  }
}

export function stopAutoPause(onChange?: Listener) {
  if (onChange) listeners.delete(onChange);
  if (listeners.size === 0 && subscription) {
    subscription.remove();
    subscription = null;
    samples = [];
  }
}
