import * as FileSystem from 'expo-file-system';

const DATA_DIR = (FileSystem.documentDirectory ?? '') + '.runplayer/';
const PLAYLISTS_FILE = DATA_DIR + 'playlists.json';

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DATA_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DATA_DIR, { intermediates: true });
  }
}

export async function loadPlaylists(): Promise<Playlist[]> {
  try {
    await ensureDir();
    const info = await FileSystem.getInfoAsync(PLAYLISTS_FILE);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(PLAYLISTS_FILE);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p) =>
        p &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        Array.isArray(p.trackIds)
    );
  } catch {
    return [];
  }
}

export async function savePlaylists(playlists: Playlist[]): Promise<void> {
  try {
    await ensureDir();
    await FileSystem.writeAsStringAsync(
      PLAYLISTS_FILE,
      JSON.stringify(playlists, null, 2)
    );
  } catch {}
}

export function newPlaylist(name: string): Playlist {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: name.trim() || 'Nova playlist',
    trackIds: [],
    createdAt: Date.now(),
  };
}

export function addTrack(playlist: Playlist, trackId: string): Playlist {
  if (playlist.trackIds.includes(trackId)) return playlist;
  return { ...playlist, trackIds: [...playlist.trackIds, trackId] };
}

export function removeTrack(playlist: Playlist, trackId: string): Playlist {
  return {
    ...playlist,
    trackIds: playlist.trackIds.filter((id) => id !== trackId),
  };
}

export function renamePlaylist(playlist: Playlist, name: string): Playlist {
  return { ...playlist, name: name.trim() || playlist.name };
}
