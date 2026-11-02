import * as FileSystem from 'expo-file-system';

const DATA_DIR = (FileSystem.documentDirectory ?? '') + '.runplayer/';
const FILE = DATA_DIR + 'workouts.json';

export interface WorkoutEntry {
  id: string;
  startTime: number;
  endTime: number;
  distanceM: number;
  paceSecPerKm: number;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DATA_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DATA_DIR, { intermediates: true });
  }
}

export async function loadWorkouts(): Promise<WorkoutEntry[]> {
  try {
    await ensureDir();
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(FILE);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e) =>
          e &&
          typeof e.id === 'string' &&
          typeof e.startTime === 'number' &&
          typeof e.endTime === 'number' &&
          typeof e.distanceM === 'number'
      )
      .sort((a, b) => b.startTime - a.startTime);
  } catch {
    return [];
  }
}

export async function saveWorkouts(entries: WorkoutEntry[]): Promise<void> {
  try {
    await ensureDir();
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify(entries, null, 2));
  } catch {}
}

export async function addWorkout(
  entry: Omit<WorkoutEntry, 'id'>
): Promise<WorkoutEntry[]> {
  const current = await loadWorkouts();
  const withId: WorkoutEntry = {
    ...entry,
    id:
      Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
  };
  const next = [withId, ...current].sort((a, b) => b.startTime - a.startTime);
  await saveWorkouts(next);
  return next;
}

export async function deleteWorkout(id: string): Promise<WorkoutEntry[]> {
  const current = await loadWorkouts();
  const next = current.filter((e) => e.id !== id);
  await saveWorkouts(next);
  return next;
}
