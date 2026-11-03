import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_RESUME = 'runplayer.resume.v1';
const KEY_GROUP_BY_ARTIST = 'runplayer.groupByArtist.v1';
const KEY_WORKOUTS_SEEDED = 'runplayer.workoutsSeeded.v1';
const KEY_META_CACHE = 'runplayer.metaCache.v1';
const KEY_RECENTLY_PLAYED = 'runplayer.recentlyPlayed.v1';
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
