import { NativeModule, requireNativeModule } from 'expo-modules-core';

import type {
  RunplayerAudioEvents,
  RunplayerAudioTrack,
} from './types';

declare class RunplayerAudioModule extends NativeModule<RunplayerAudioEvents> {
  setQueue(tracks: RunplayerAudioTrack[], startIndex: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(positionSec: number): Promise<void>;
  skipToIndex(index: number): Promise<void>;
  skipToNext(): Promise<void>;
  skipToPrevious(): Promise<void>;
  setVolume(volume: number): void;
  startCrossfade(durationSec: number): Promise<void>;
  cancelCrossfade(): Promise<void>;
  setNowPlayingMetadata(
    title: string,
    artist: string,
    artworkUri: string | null,
    durationSec: number
  ): void;
  getPosition(): number;
  getDuration(): number;
  getIsPlaying(): boolean;
  getActiveIndex(): number;
}

export default requireNativeModule<RunplayerAudioModule>('RunplayerAudio');
export * from './types';
