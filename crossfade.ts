import { Audio } from 'expo-av';
import TrackPlayer from 'react-native-track-player';

const STEPS = 30;

let sound: Audio.Sound | null = null;
let active = false;
let handoffSignaled = false;
let audioModeConfigured = false;

async function ensureAudioMode(): Promise<void> {
  if (audioModeConfigured) return;
  try {
    await Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });
    audioModeConfigured = true;
  } catch {}
}

export function isCrossfadeActive(): boolean {
  return active;
}

export async function startCrossfade(
  nextUri: string,
  durationMs: number,
  targetVolume = 1
): Promise<void> {
  if (active) return;
  active = true;
  handoffSignaled = false;
  try {
    await ensureAudioMode();
    const result = await Audio.Sound.createAsync(
      { uri: nextUri },
      {
        volume: 0,
        shouldPlay: true,
        positionMillis: 0,
        progressUpdateIntervalMillis: 100,
      }
    );
    sound = result.sound;
    const stepMs = Math.max(20, durationMs / STEPS);
    for (let i = 1; i <= STEPS; i++) {
      if (!active || handoffSignaled || !sound) break;
      const t = i / STEPS;
      const expoVol = targetVolume * t;
      const rntpVol = targetVolume * (1 - t);
      try {
        await sound.setVolumeAsync(expoVol);
      } catch {}
      try {
        await TrackPlayer.setVolume(Math.max(0, rntpVol));
      } catch {}
      await new Promise((r) => setTimeout(r, stepMs));
    }
  } catch {
    active = false;
    if (sound) {
      try {
        await sound.unloadAsync();
      } catch {}
      sound = null;
    }
    try {
      await TrackPlayer.setVolume(targetVolume);
    } catch {}
  }
}

export async function handoffToTrackPlayer(targetVolume = 1): Promise<void> {
  if (!active) return;
  handoffSignaled = true;
  const localSound = sound;
  if (!localSound) {
    try {
      await TrackPlayer.setVolume(targetVolume);
    } catch {}
    sound = null;
    active = false;
    return;
  }
  try {
    await new Promise((r) => setTimeout(r, 40));
    const status = await localSound.getStatusAsync();
    let posSec = 0;
    if (status.isLoaded && 'positionMillis' in status) {
      posSec = (status.positionMillis ?? 0) / 1000;
    }
    try {
      await TrackPlayer.setVolume(0);
    } catch {}
    if (posSec > 0.3) {
      try {
        await TrackPlayer.seekTo(posSec);
      } catch {}
    }
    const microSteps = 6;
    const microStepMs = 25;
    for (let i = 1; i <= microSteps; i++) {
      const t = i / microSteps;
      const rntpVol = targetVolume * t;
      const expoVol = targetVolume * (1 - t);
      try {
        await TrackPlayer.setVolume(rntpVol);
      } catch {}
      try {
        await localSound.setVolumeAsync(Math.max(0, expoVol));
      } catch {}
      await new Promise((r) => setTimeout(r, microStepMs));
    }
    try {
      await TrackPlayer.setVolume(targetVolume);
    } catch {}
    try {
      await localSound.stopAsync();
      await localSound.unloadAsync();
    } catch {}
  } catch {
    try {
      await TrackPlayer.setVolume(targetVolume);
    } catch {}
  }
  sound = null;
  active = false;
  handoffSignaled = false;
}

export async function cancelCrossfade(targetVolume = 1): Promise<void> {
  if (!active) {
    try {
      await TrackPlayer.setVolume(targetVolume);
    } catch {}
    return;
  }
  active = false;
  handoffSignaled = false;
  const localSound = sound;
  sound = null;
  try {
    if (localSound) {
      await localSound.stopAsync();
      await localSound.unloadAsync();
    }
  } catch {}
  try {
    await TrackPlayer.setVolume(targetVolume);
  } catch {}
}
