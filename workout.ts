import * as Location from 'expo-location';
import * as Speech from 'expo-speech';

import { getLatestBpm } from './healthkit';

export interface WorkoutStats {
  distanceM: number;
  elapsedS: number;
  paceSecPerKm: number;
  lastKmAnnounced: number;
  bpm?: number | null;
}

const INITIAL: WorkoutStats = {
  distanceM: 0,
  elapsedS: 0,
  paceSecPerKm: 0,
  lastKmAnnounced: 0,
};

const MIN_DIST_FOR_PACE = 100;

type Listener = (stats: WorkoutStats) => void;

let watcher: Location.LocationSubscription | null = null;
let lastPoint: { lat: number; lon: number; t: number } | null = null;
let startedAt = 0;
let stats: WorkoutStats = { ...INITIAL };
let tickTimer: ReturnType<typeof setInterval> | null = null;
let bpmTimer: ReturnType<typeof setInterval> | null = null;
let listeners: Set<Listener> = new Set();
let preferredVoice: string | null = null;

function scoreVoice(v: any): number {
  const id = String(v.identifier || '').toLowerCase();
  const quality = String(v.quality || '').toLowerCase();
  let s = 0;
  if (id.includes('siri')) s += 30;
  if (quality === 'premium' || id.includes('premium')) s += 25;
  if (quality === 'enhanced' || id.includes('enhanced')) s += 15;
  if (id.includes('neural')) s += 20;
  if (id.includes('compact')) s -= 10;
  return s;
}

async function selectVoice(): Promise<string | null> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const ptBr = voices.filter((v) =>
      (v.language || '').toLowerCase().startsWith('pt-br') ||
      (v.language || '').toLowerCase().startsWith('pt_br')
    );
    if (ptBr.length === 0) return null;
    const sorted = [...ptBr].sort((a, b) => scoreVoice(b) - scoreVoice(a));
    return sorted[0]?.identifier ?? null;
  } catch {
    return null;
  }
}

export async function warmupVoice(): Promise<void> {
  preferredVoice = await selectVoice();
}

function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function emit() {
  for (const fn of listeners) {
    try {
      fn({ ...stats });
    } catch {}
  }
}

function formatPaceLabel(secPerKm: number): string {
  if (!isFinite(secPerKm) || secPerKm <= 0) return '';
  const m = Math.floor(secPerKm / 60);
  const s = Math.floor(secPerKm % 60);
  const sStr = s < 10 ? '0' + s : String(s);
  return `${m} e ${sStr}`;
}

function speak(msg: string) {
  try {
    Speech.speak(msg, {
      language: 'pt-BR',
      voice: preferredVoice ?? undefined,
      rate: 0.98,
      pitch: 1.0,
    });
  } catch {}
}

function announceKm(km: number) {
  const paceLabel = formatPaceLabel(stats.paceSecPerKm);
  const parts: string[] = [`Quilometro ${km}.`];
  if (paceLabel) parts.push(`Ritmo ${paceLabel} por quilometro.`);
  if (stats.bpm != null && stats.bpm > 30 && stats.bpm < 230) {
    parts.push(`Batimentos ${stats.bpm}.`);
  }
  speak(parts.join(' '));
}

function tick() {
  if (startedAt === 0) return;
  stats.elapsedS = Math.max(0, (Date.now() - startedAt) / 1000);
  if (stats.distanceM >= MIN_DIST_FOR_PACE) {
    const km = stats.distanceM / 1000;
    stats.paceSecPerKm = stats.elapsedS / km;
  } else {
    stats.paceSecPerKm = 0;
  }
  emit();
}

function handlePosition(loc: Location.LocationObject) {
  const { latitude, longitude, accuracy } = loc.coords;
  const now = loc.timestamp;
  if (accuracy != null && accuracy > 25) return;
  if (!lastPoint) {
    lastPoint = { lat: latitude, lon: longitude, t: now };
    return;
  }
  const dt = (now - lastPoint.t) / 1000;
  if (dt < 1) return;
  const d = haversine(lastPoint.lat, lastPoint.lon, latitude, longitude);
  const instantSpeed = d / dt;
  if (instantSpeed > 8) {
    lastPoint = { lat: latitude, lon: longitude, t: now };
    return;
  }
  if (d > 2) {
    stats.distanceM += d;
    lastPoint = { lat: latitude, lon: longitude, t: now };
    const nextKm = Math.floor(stats.distanceM / 1000);
    if (nextKm > stats.lastKmAnnounced) {
      stats.lastKmAnnounced = nextKm;
      announceKm(nextKm);
    }
    emit();
  }
}

export async function startWorkout(onChange: Listener): Promise<boolean> {
  listeners.add(onChange);
  if (watcher) {
    emit();
    return true;
  }
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') return false;
  try {
    await Location.requestBackgroundPermissionsAsync();
  } catch {}
  await warmupVoice();
  stats = { ...INITIAL };
  lastPoint = null;
  startedAt = Date.now();
  try {
    watcher = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 2,
        timeInterval: 1000,
      },
      handlePosition
    );
  } catch {
    return false;
  }
  tickTimer = setInterval(tick, 1000);
  bpmTimer = setInterval(async () => {
    const bpm = await getLatestBpm(180);
    stats.bpm = bpm;
    emit();
  }, 10000);
  emit();
  return true;
}

export function stopWorkout(onChange?: Listener) {
  if (onChange) listeners.delete(onChange);
  if (listeners.size > 0) return;
  if (watcher) {
    watcher.remove();
    watcher = null;
  }
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (bpmTimer) {
    clearInterval(bpmTimer);
    bpmTimer = null;
  }
  startedAt = 0;
  lastPoint = null;
  stats = { ...INITIAL };
}

export function isWorkoutActive(): boolean {
  return watcher != null;
}

export async function announceDebugSample() {
  await warmupVoice();
  const bpm = await getLatestBpm(300);
  const parts: string[] = [
    'Quilometro 1.',
    'Ritmo 5 e 30 por quilometro.',
  ];
  if (bpm != null && bpm > 30 && bpm < 230) {
    parts.push(`Batimentos ${bpm}.`);
  } else {
    parts.push('Batimentos 160.');
  }
  speak(parts.join(' '));
}

export function announceWorkoutEnd() {
  const km = (stats.distanceM / 1000).toFixed(2).replace('.', ',');
  const paceLabel = formatPaceLabel(stats.paceSecPerKm);
  const msg = paceLabel
    ? `Treino finalizado. ${km} quilometros. Ritmo medio ${paceLabel}.`
    : `Treino finalizado. ${km} quilometros.`;
  speak(msg);
}
