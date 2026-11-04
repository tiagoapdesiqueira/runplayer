import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_RESUME = 'runplayer.resume.v1';
const KEY_GROUP_BY_ARTIST = 'runplayer.groupByArtist.v1';
const KEY_WORKOUTS_SEEDED = 'runplayer.workoutsSeeded.v1';
const KEY_META_CACHE = 'runplayer.metaCache.v1';
// v1 was populated by every native track-change, including automatic playback
// and the queue prepared at app launch.  Start a clean, click-based history.
const KEY_RECENTLY_PLAYED = 'runplayer.recentlyPlayed.v2';
const KEY_CROSSFADE_ENABLED = 'runplayer.crossfadeEnabled.v1';
const KEY_CROSSFADE_SECONDS = 'runplayer.crossfadeSeconds.v1';
const RECENT_LIMIT = 15;

export interface ResumeState {
  trackId: string;
  position: number;
}

export async function saveResume(state: ResumeState): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_RESUME, JSON.stringify(state));
  } catch {}
}

export async function loadResume(): Promise<ResumeState | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_RESUME);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.trackId === 'string' && typeof parsed?.position === 'number') {
      return parsed;
    }
  } catch {}
  return null;
}

export async function clearResume(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_RESUME);
  } catch {}
}

export async function saveGroupByArtist(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_GROUP_BY_ARTIST, enabled ? '1' : '0');
  } catch {}
}

export async function loadGroupByArtist(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY_GROUP_BY_ARTIST);
    return raw === '1';
  } catch {}
  return false;
}

export async function hasSeededWorkouts(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY_WORKOUTS_SEEDED);
    return raw === '1';
  } catch {}
  return false;
}

export async function markWorkoutsSeeded(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_WORKOUTS_SEEDED, '1');
  } catch {}
}

export async function loadMetaCache(): Promise<Record<string, any>> {
  try {
    const raw = await AsyncStorage.getItem(KEY_META_CACHE);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  return {};
}

export async function saveMetaCache(cache: Record<string, any>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_META_CACHE, JSON.stringify(cache));
  } catch {}
}

export async function loadRecentlyPlayed(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_RECENTLY_PLAYED);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string');
    }
  } catch {}
  return [];
}

export async function saveRecentlyPlayed(ids: string[]): Promise<void> {
  try {
    const trimmed = ids.slice(0, RECENT_LIMIT);
    await AsyncStorage.setItem(KEY_RECENTLY_PLAYED, JSON.stringify(trimmed));
  } catch {}
}

export function pushRecentlyPlayed(current: string[], id: string): string[] {
  const without = current.filter((x) => x !== id);
  return [id, ...without].slice(0, RECENT_LIMIT);
}

export async function loadCrossfadeEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY_CROSSFADE_ENABLED);
    if (raw === null) return true;
    return raw === '1';
  } catch {}
  return true;
}

export async function saveCrossfadeEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_CROSSFADE_ENABLED, enabled ? '1' : '0');
  } catch {}
}

export async function loadCrossfadeSeconds(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(KEY_CROSSFADE_SECONDS);
    const n = raw ? parseInt(raw, 10) : NaN;
    if (isFinite(n) && n >= 2 && n <= 12) return n;
  } catch {}
  return 6;
}

export async function saveCrossfadeSeconds(seconds: number): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_CROSSFADE_SECONDS, String(seconds));
  } catch {}
}
