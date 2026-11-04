export type RunplayerAudioTrack = {
  id: string;
  url: string;
  title?: string;
  artist?: string;
  artworkUri?: string;
};

export type PositionEvent = {
  position: number;
  duration: number;
};

export type StateEvent = {
  isPlaying: boolean;
};

export type TrackChangeEvent = {
  index: number;
  trackId: string;
};

export type RemoteEvent = Record<string, never>;

export type RunplayerAudioEvents = {
  onPositionChanged: (event: PositionEvent) => void;
  onStateChanged: (event: StateEvent) => void;
  onTrackChanged: (event: TrackChangeEvent) => void;
  onRemotePlay: (event: RemoteEvent) => void;
  onRemotePause: (event: RemoteEvent) => void;
  onRemoteNext: (event: RemoteEvent) => void;
  onRemotePrev: (event: RemoteEvent) => void;
};
