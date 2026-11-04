import { useEffect, useState } from 'react';
import RunplayerAudio, {
  PositionEvent,
  RunplayerAudioTrack,
  StateEvent,
  TrackChangeEvent,
} from 'runplayer-audio';

export type Track = RunplayerAudioTrack;

export const RepeatMode = {
  Off: 0 as const,
  Track: 1 as const,
  Queue: 2 as const,
};
export type RepeatModeValue = 0 | 1 | 2;

let currentRepeatMode: RepeatModeValue = RepeatMode.Queue;
let currentQueue: Track[] = [];

export const AudioPlayer = {
  setupPlayer: async (): Promise<void> => {},

  setRepeatMode: async (mode: RepeatModeValue): Promise<void> => {
    currentRepeatMode = mode;
  },

  getRepeatMode: (): RepeatModeValue => currentRepeatMode,

  setQueue: async (tracks: Track[], startIndex = 0): Promise<void> => {
    currentQueue = tracks;
    await RunplayerAudio.setQueue(tracks as any, startIndex);
  },

  reset: async (): Promise<void> => {
    currentQueue = [];
    await RunplayerAudio.setQueue([], 0);
  },

  getQueue: async (): Promise<Track[]> => currentQueue.slice(),

  skip: async (index: number): Promise<void> => {
    await RunplayerAudio.skipToIndex(index);
  },

  skipToNext: async (): Promise<void> => {
    await RunplayerAudio.skipToNext();
  },

  skipToPrevious: async (): Promise<void> => {
    await RunplayerAudio.skipToPrevious();
  },

  removeTracks: async (indices: number[]): Promise<void> => {
    const drop = new Set(indices);
    currentQueue = currentQueue.filter((_, i) => !drop.has(i));
    await RunplayerAudio.removeTracks(indices);
  },

  seekTo: async (position: number): Promise<void> => {
    await RunplayerAudio.seek(position);
  },

  play: async (): Promise<void> => {
    await RunplayerAudio.play();
  },

  pause: async (): Promise<void> => {
    await RunplayerAudio.pause();
  },

  setVolume: async (vol: number): Promise<void> => {
    RunplayerAudio.setVolume(vol);
  },

  getPosition: (): number => RunplayerAudio.getPosition(),
  getDuration: (): number => RunplayerAudio.getDuration(),
  getIsPlaying: (): boolean => RunplayerAudio.getIsPlaying(),
  getActiveTrackIndex: async (): Promise<number> =>
    RunplayerAudio.getActiveIndex(),
  getActiveTrack: async (): Promise<Track | null> => {
    const idx = RunplayerAudio.getActiveIndex();
    if (idx < 0 || idx >= currentQueue.length) return null;
    return currentQueue[idx];
  },
  getTrack: async (index: number): Promise<Track | null> => {
    if (index < 0 || index >= currentQueue.length) return null;
    return currentQueue[index];
  },

  startCrossfade: async (seconds: number): Promise<void> => {
    await RunplayerAudio.startCrossfade(seconds);
  },

  cancelCrossfade: async (): Promise<void> => {
    await RunplayerAudio.cancelCrossfade();
  },

  setNowPlayingMetadata: (
    title: string,
    artist: string,
    artworkUri: string | null,
    durationSec: number
  ): void => {
    RunplayerAudio.setNowPlayingMetadata(title, artist, artworkUri, durationSec);
  },

  updateMetadataForTrackIndex: (
    index: number,
    meta: { title?: string; artist?: string; artwork?: string }
  ): void => {
    if (index < 0 || index >= currentQueue.length) return;
    const t = currentQueue[index];
    currentQueue[index] = {
      ...t,
      title: meta.title ?? t.title,
      artist: meta.artist ?? t.artist,
      artworkUri: meta.artwork ?? t.artworkUri,
    };
    if (index === RunplayerAudio.getActiveIndex()) {
      RunplayerAudio.setNowPlayingMetadata(
        currentQueue[index].title ?? '',
        currentQueue[index].artist ?? '',
        currentQueue[index].artworkUri ?? null,
        RunplayerAudio.getDuration()
      );
    }
  },
};

export function useAudioProgress(interval = 300) {
  const [progress, setProgress] = useState({ position: 0, duration: 0 });
  useEffect(() => {
    const sub = RunplayerAudio.addListener(
      'onPositionChanged',
      (e: PositionEvent) =>
        setProgress({ position: e.position, duration: e.duration })
    );
    const timer = setInterval(() => {
      setProgress({
        position: RunplayerAudio.getPosition(),
        duration: RunplayerAudio.getDuration(),
      });
    }, interval);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [interval]);
  return progress;
}

export type AudioEvent =
  | { type: 'stateChanged'; isPlaying: boolean }
  | { type: 'trackChanged'; index: number; trackId: string; lastIndex: number }
  | { type: 'remotePlay' }
  | { type: 'remotePause' }
  | { type: 'remoteNext' }
  | { type: 'remotePrev' };

let lastKnownIndex = -1;

export function useAudioEvents(callback: (event: AudioEvent) => void) {
  useEffect(() => {
    const subs = [
      RunplayerAudio.addListener('onStateChanged', (e: StateEvent) =>
        callback({ type: 'stateChanged', isPlaying: e.isPlaying })
      ),
      RunplayerAudio.addListener('onTrackChanged', (e: TrackChangeEvent) => {
        const prev = lastKnownIndex;
        lastKnownIndex = e.index;
        callback({
          type: 'trackChanged',
          index: e.index,
          trackId: e.trackId,
          lastIndex: prev,
        });
      }),
      RunplayerAudio.addListener('onRemotePlay', () =>
        callback({ type: 'remotePlay' })
      ),
      RunplayerAudio.addListener('onRemotePause', () =>
        callback({ type: 'remotePause' })
      ),
      RunplayerAudio.addListener('onRemoteNext', () =>
        callback({ type: 'remoteNext' })
      ),
      RunplayerAudio.addListener('onRemotePrev', () =>
        callback({ type: 'remotePrev' })
      ),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [callback]);
}
