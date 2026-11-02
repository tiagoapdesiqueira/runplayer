import * as FileSystem from 'expo-file-system';

const DATA_DIR = (FileSystem.documentDirectory ?? '') + '.runplayer/';
const PLAYLISTS_FILE = DATA_DIR + 'playlists.json';

export const LIKED_PLAYLIST_ID = '__liked__';
export const LIKED_PLAYLIST_NAME = 'Musicas Curtidas';

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  pinned?: boolean;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DATA_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DATA_DIR, { intermediates: true });
  }
}

function makeLiked(): Playlist {
  return {
    id: LIKED_PLAYLIST_ID,
    name: LIKED_PLAYLIST_NAME,
    trackIds: [],
    createdAt: 0,
    pinned: true,
  };
}

export async function loadPlaylists(): Promise<Playlist[]> {
  try {
    await ensureDir();
    const info = await FileSystem.getInfoAsync(PLAYLISTS_FILE);
    let list: Playlist[] = [];
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(PLAYLISTS_FILE);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        list = parsed.filter(
          (p) =>
            p &&
            typeof p.id === 'string' &&
            typeof p.name === 'string' &&
            Array.isArray(p.trackIds)
        );
      }
    }
    if (!list.find((p) => p.id === LIKED_PLAYLIST_ID)) {
      list = [makeLiked(), ...list];
    }
    return list;
  } catch {
    return [makeLiked()];
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

export function moveTrackToTop(playlist: Playlist, trackId: string): Playlist {
  if (!playlist.trackIds.includes(trackId)) return playlist;
  const rest = playlist.trackIds.filter((id) => id !== trackId);
  return { ...playlist, trackIds: [trackId, ...rest] };
}

export function moveTrackToEnd(playlist: Playlist, trackId: string): Playlist {
  if (!playlist.trackIds.includes(trackId)) return playlist;
  const rest = playlist.trackIds.filter((id) => id !== trackId);
  return { ...playlist, trackIds: [...rest, trackId] };
}

export function renamePlaylist(playlist: Playlist, name: string): Playlist {
  if (playlist.id === LIKED_PLAYLIST_ID) return playlist;
  return { ...playlist, name: name.trim() || playlist.name };
}

export function isLiked(playlists: Playlist[], trackId: string): boolean {
  const liked = playlists.find((p) => p.id === LIKED_PLAYLIST_ID);
  return !!liked?.trackIds.includes(trackId);
}

export function toggleLiked(
  playlists: Playlist[],
  trackId: string
): Playlist[] {
  return playlists.map((p) => {
    if (p.id !== LIKED_PLAYLIST_ID) return p;
    const has = p.trackIds.includes(trackId);
    return has ? removeTrack(p, trackId) : addTrack(p, trackId);
  });
}
