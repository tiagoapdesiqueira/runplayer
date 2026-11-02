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
    const cleaned = parsed
      .filter(
        (e) =>
          e &&
          typeof e.id === 'string' &&
          !e.id.startsWith('seed-') &&
          typeof e.startTime === 'number' &&
          typeof e.endTime === 'number' &&
          typeof e.distanceM === 'number'
      )
      .sort((a, b) => b.startTime - a.startTime);
    if (cleaned.length !== parsed.length) {
      await saveWorkouts(cleaned);
    }
    return cleaned;
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

export async function seedFakeWorkouts(): Promise<WorkoutEntry[]> {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;
  const MIN = 60 * 1000;

  const fakes: WorkoutEntry[] = [
    {
      id: 'seed-1',
      startTime: now - 2 * HOUR,
      endTime: now - 2 * HOUR + 19 * MIN,
      distanceM: 3520,
      paceSecPerKm: 5 * 60 + 24,
    },
    {
      id: 'seed-2',
      startTime: now - DAY - 13 * HOUR,
      endTime: now - DAY - 13 * HOUR + 27 * MIN,
      distanceM: 5180,
      paceSecPerKm: 5 * 60 + 12,
    },
    {
      id: 'seed-3',
      startTime: now - 3 * DAY - 11 * HOUR,
      endTime: now - 3 * DAY - 11 * HOUR + 23 * MIN,
      distanceM: 4080,
      paceSecPerKm: 5 * 60 + 38,
    },
    {
      id: 'seed-4',
      startTime: now - 7 * DAY - 14 * HOUR,
      endTime: now - 7 * DAY - 14 * HOUR + 45 * MIN,
      distanceM: 8520,
      paceSecPerKm: 5 * 60 + 18,
    },
    {
      id: 'seed-5',
      startTime: now - 14 * DAY - 12 * HOUR,
      endTime: now - 14 * DAY - 12 * HOUR + 12 * MIN,
      distanceM: 2100,
      paceSecPerKm: 6 * 60 + 2,
    },
  ];
  await saveWorkouts(fakes);
  return fakes;
}
