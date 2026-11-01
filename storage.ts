import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_RESUME = 'runplayer.resume.v1';

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
