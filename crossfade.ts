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

    const startTime = Date.now();
    const endTime = startTime + durationMs;
    const rntpFadeEnd = startTime + Math.min(durationMs * 0.5, 1800);
    let rntpSilenced = false;
    const stepMs = 40;

    while (Date.now() < endTime) {
      if (!active || handoffSignaled || !sound) break;
      const now = Date.now();
      const tExpo = Math.min(1, (now - startTime) / durationMs);
      const expoVol = targetVolume * tExpo;
      try {
        await sound.setVolumeAsync(expoVol);
      } catch {}
      if (!rntpSilenced) {
        const tRntp = Math.min(1, (now - startTime) / (rntpFadeEnd - startTime));
        const rntpVol = targetVolume * (1 - tRntp);
        try {
          await TrackPlayer.setVolume(Math.max(0, rntpVol));
        } catch {}
        if (tRntp >= 1) {
          rntpSilenced = true;
          try {
            await TrackPlayer.setVolume(0);
          } catch {}
        }
      } else {
        try {
          await TrackPlayer.setVolume(0);
        } catch {}
      }
      await new Promise((r) => setTimeout(r, stepMs));
    }
    if (active && !handoffSignaled) {
      try {
        await TrackPlayer.setVolume(0);
      } catch {}
      if (sound) {
        try {
          await sound.setVolumeAsync(targetVolume);
        } catch {}
      }
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
