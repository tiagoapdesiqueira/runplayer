import { Audio } from 'expo-av';
import TrackPlayer from 'react-native-track-player';

const STEPS = 30;

let sound: Audio.Sound | null = null;
let active = false;
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
  try {
    await ensureAudioMode();
    const result = await Audio.Sound.createAsync(
      { uri: nextUri },
      { volume: 0, shouldPlay: true, positionMillis: 0, progressUpdateIntervalMillis: 100 }
    );
    sound = result.sound;
    const stepMs = Math.max(20, durationMs / STEPS);
    for (let i = 1; i <= STEPS; i++) {
      if (!active || !sound) break;
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
  }
}

export async function handoffToTrackPlayer(targetVolume = 1): Promise<void> {
  if (!active || !sound) {
    active = false;
    return;
  }
  try {
    const status = await sound.getStatusAsync();
    let posSec = 0;
    if (status.isLoaded && 'positionMillis' in status) {
      posSec = (status.positionMillis ?? 0) / 1000;
    }
    try {
      await TrackPlayer.setVolume(targetVolume);
    } catch {}
    if (posSec > 0.3) {
      try {
        await TrackPlayer.seekTo(posSec);
      } catch {}
    }
    try {
      await sound.stopAsync();
      await sound.unloadAsync();
    } catch {}
  } catch {}
  sound = null;
  active = false;
}

export async function cancelCrossfade(targetVolume = 1): Promise<void> {
  if (!active) return;
  active = false;
  try {
    if (sound) {
      await sound.stopAsync();
      await sound.unloadAsync();
    }
  } catch {}
  sound = null;
  try {
    await TrackPlayer.setVolume(targetVolume);
  } catch {}
}
