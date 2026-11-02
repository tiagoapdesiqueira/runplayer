import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  SectionList,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { useFonts } from 'expo-font';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { getColors } from 'react-native-image-colors';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode,
  State,
  Track,
  useProgress,
  useTrackPlayerEvents,
} from 'react-native-track-player';

import { readId3, Metadata } from './metadata';
import {
  loadGroupByArtist,
  loadResume,
  saveGroupByArtist,
  saveResume,
} from './storage';
import {
  defaultPalette,
  ff,
  Palette,
  radius,
  spacing,
  theme,
  font,
  weight,
} from './theme';
import {
  addTrack,
  isLiked,
  LIKED_PLAYLIST_ID,
  loadPlaylists,
  moveTrackToEnd,
  moveTrackToTop,
  newPlaylist,
  Playlist,
  removeTrack,
  renamePlaylist,
  savePlaylists,
  toggleLiked,
} from './playlists';
import { fadeInForTrack, resetVolumeState, setTargetVolume } from './volume';
import { startAutoPause, stopAutoPause } from './autoPause';
import {
  announceDebugSample,
  announceWorkoutEnd,
  listPtBrVoices,
  startWorkout,
  stopWorkout,
  WorkoutStats,
} from './workout';
import { diagnoseBpm, requestHeartRateAuth } from './healthkit';

const DOC_DIR = FileSystem.documentDirectory ?? '';
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const ARTWORK_SIZE = Math.min(SCREEN_W - spacing.xxl * 2, SCREEN_H * 0.42);

type Mp3 = { id: string; name: string; uri: string };
type Enriched = Mp3 & { meta?: Metadata };

type Context = { kind: 'library' } | { kind: 'playlist'; id: string };

const hapLight = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};
const hapMedium = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
};
const hapSelect = () => {
  Haptics.selectionAsync().catch(() => {});
};

async function setupPlayer() {
  try {
    await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
  } catch (e: any) {
    if (!String(e?.message ?? e).includes('already been initialized')) throw e;
  }
  await TrackPlayer.updateOptions({
    android: {
      appKilledPlaybackBehavior:
        AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
    },
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
      Capability.Stop,
    ],
    compactCapabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
    ],
    progressUpdateEventInterval: 1,
  });
  try {
    await TrackPlayer.setRepeatMode(RepeatMode.Queue);
  } catch {}
}

async function ensureFolderVisible(): Promise<void> {
  if (!DOC_DIR) return;
  const marker = DOC_DIR + 'LEIA-ME.txt';
  try {
    const info = await FileSystem.getInfoAsync(marker);
    if (info.exists) return;
    await FileSystem.writeAsStringAsync(
      marker,
      'Coloque seus arquivos .mp3 nesta pasta.\n' +
        'Depois, no RunPlayer, toque no botao de recarregar.\n'
    );
  } catch {}
}

async function listMp3s(): Promise<Mp3[]> {
  if (!DOC_DIR) return [];
  await ensureFolderVisible();
  const entries = await FileSystem.readDirectoryAsync(DOC_DIR);
  return entries
    .filter((n) => n.toLowerCase().endsWith('.mp3'))
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
    .map((name) => ({
      id: name,
      name: name.replace(/\.mp3$/i, ''),
      uri: DOC_DIR + name,
    }));
}

function toTracks(list: Enriched[]): Track[] {
  return list.map((f) => ({
    id: f.id,
    url: f.uri,
    title: f.meta?.title || f.name,
    artist: f.meta?.artist || 'Desconhecido',
    artwork: f.meta?.artworkUri,
  }));
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtKm(m: number): string {
  const km = m / 1000;
  if (km < 10) return km.toFixed(2).replace('.', ',');
  return km.toFixed(1).replace('.', ',');
}

function fmtPace(secPerKm: number): string {
  if (!isFinite(secPerKm) || secPerKm <= 0) return '--:--';
  const m = Math.floor(secPerKm / 60);
  const s = Math.floor(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtTotalDuration(secs: number): string {
  if (!isFinite(secs) || secs <= 0) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

function sumDuration(list: Enriched[]): number {
  let sum = 0;
  for (const f of list) {
    if (f.meta?.durationSec) sum += f.meta.durationSec;
  }
  return sum;
}

function groupByArtistSections(list: Enriched[]) {
  const map = new Map<string, Enriched[]>();
  for (const f of list) {
    const key = (f.meta?.artist || 'Desconhecido').trim() || 'Desconhecido';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  const sections = Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { sensitivity: 'base' }))
    .map(([artist, data]) => ({
      title: artist,
      data,
      artworkUri: data.find((d) => d.meta?.artworkUri)?.meta?.artworkUri,
    }));
  return sections;
}

async function extractPalette(uri?: string): Promise<Palette> {
  if (!uri) return defaultPalette;
  try {
    const colors = await getColors(uri, {
      fallback: defaultPalette.dominant,
      cache: true,
      key: uri,
    });
    if (colors.platform === 'ios') {
      return {
        dominant: colors.background,
        vibrant: colors.primary,
        dark: colors.detail,
      };
    }
    if (colors.platform === 'android') {
      return {
        dominant: colors.dominant ?? defaultPalette.dominant,
        vibrant: colors.vibrant ?? defaultPalette.vibrant,
        dark: colors.darkMuted ?? defaultPalette.dark,
      };
    }
  } catch {}
  return defaultPalette;
}

const ArtworkThumb = React.memo(function ArtworkThumb({
  uri,
  size,
  rounded,
}: {
  uri?: string;
  size: number;
  rounded?: number;
}) {
  const r = rounded ?? (size >= 120 ? radius.lg : radius.sm);
  const style = {
    width: size,
    height: size,
    borderRadius: r,
    backgroundColor: theme.surface,
  };
  if (!uri) {
    return (
      <View style={[style, styles.artFallback]}>
        <Ionicons
          name="musical-notes"
          size={size * 0.42}
          color={theme.textDim}
        />
      </View>
    );
  }
  return <Image source={{ uri }} style={style} />;
});

function SegmentedTabs({
  tab,
  onChange,
}: {
  tab: 'songs' | 'playlists';
  onChange: (t: 'songs' | 'playlists') => void;
}) {
  return (
    <View style={styles.segWrap}>
      <View style={styles.segBar}>
        <View
          style={[
            styles.segIndicator,
            tab === 'playlists' && { left: '50%' },
          ]}
        />
        <Pressable
          onPress={() => {
            hapSelect();
            onChange('songs');
          }}
          style={styles.segBtn}
        >
          <Text style={[styles.segText, tab === 'songs' && styles.segTextActive]}>
            Musicas
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            hapSelect();
            onChange('playlists');
          }}
          style={styles.segBtn}
        >
          <Text
            style={[styles.segText, tab === 'playlists' && styles.segTextActive]}
          >
            Playlists
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function SongRow({
  item,
  active,
  onPress,
  onLongPress,
  onMenu,
}: {
  item: Enriched;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onMenu?: () => void;
}) {
  const title = item.meta?.title || item.name;
  const artist = item.meta?.artist;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={320}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.55 }]}
    >
      <ArtworkThumb uri={item.meta?.artworkUri} size={46} />
      <View style={styles.rowText}>
        <Text
          numberOfLines={1}
          style={[styles.rowTitle, active && { color: theme.accent }]}
        >
          {title}
        </Text>
        {artist ? (
          <Text numberOfLines={1} style={styles.rowArtist}>
            {artist}
          </Text>
        ) : null}
      </View>
      {onMenu ? (
        <Pressable
          hitSlop={10}
          onPress={(e) => {
            e.stopPropagation();
            onMenu();
          }}
          style={styles.rowMenu}
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={18}
            color={theme.textMuted}
          />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function PlaylistRow({
  playlist,
  onPress,
  onLongPress,
}: {
  playlist: Playlist;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const liked = playlist.id === LIKED_PLAYLIST_ID;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={320}
      style={({ pressed }) => [styles.plRow, pressed && { opacity: 0.55 }]}
    >
      <View style={styles.plIcon}>
        <Ionicons
          name={liked ? 'checkmark-circle' : 'musical-notes'}
          size={22}
          color={theme.accent}
        />
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {playlist.name}
        </Text>
        <Text numberOfLines={1} style={styles.rowArtist}>
          {playlist.trackIds.length}{' '}
          {playlist.trackIds.length === 1 ? 'musica' : 'musicas'}
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={theme.textDim}
        style={{ marginRight: spacing.xs }}
      />
    </Pressable>
  );
}

function MiniPlayer({
  current,
  playing,
  progress,
  liked,
  onToggle,
  onNext,
  onPrev,
  onOpen,
  onToggleLike,
}: {
  current?: Enriched;
  playing: boolean;
  progress: number;
  liked: boolean;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onOpen: () => void;
  onToggleLike: () => void;
}) {
  if (!current) return null;
  const title = current.meta?.title || current.name;
  const artist = current.meta?.artist;
  return (
    <View style={styles.miniWrap}>
      <View style={styles.miniCard}>
        <Pressable style={styles.miniTap} onPress={onOpen}>
          <ArtworkThumb uri={current.meta?.artworkUri} size={40} />
          <View style={styles.miniText}>
            <Text numberOfLines={1} style={styles.miniTitle}>
              {title}
            </Text>
            {artist ? (
              <Text numberOfLines={1} style={styles.miniArtist}>
                {artist}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <View style={styles.miniControls}>
          <Pressable
            hitSlop={10}
            onPress={() => {
              hapLight();
              onToggleLike();
            }}
            style={styles.miniCtrlBtn}
          >
            <Ionicons
              name={liked ? 'checkmark-circle' : 'checkmark-circle-outline'}
              size={22}
              color={liked ? theme.accent : theme.textSoft}
            />
          </Pressable>
          <Pressable
            hitSlop={10}
            onPress={() => {
              hapLight();
              onPrev();
            }}
            style={styles.miniCtrlBtn}
          >
            <Ionicons name="play-skip-back" size={20} color={theme.text} />
          </Pressable>
          <Pressable
            hitSlop={10}
            onPress={() => {
              hapLight();
              onToggle();
            }}
            style={styles.miniCtrlBtn}
          >
            <Ionicons
              name={playing ? 'pause' : 'play'}
              size={22}
              color={theme.text}
            />
          </Pressable>
          <Pressable
            hitSlop={10}
            onPress={() => {
              hapLight();
              onNext();
            }}
            style={styles.miniCtrlBtn}
          >
            <Ionicons name="play-skip-forward" size={20} color={theme.text} />
          </Pressable>
        </View>
      </View>
      <View style={styles.miniProgressBg}>
        <View style={[styles.miniProgressFill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
}

function AddToPlaylistSheet({
  visible,
  track,
  playlists,
  onClose,
  onAdd,
  onCreateAndAdd,
}: {
  visible: boolean;
  track?: Enriched;
  playlists: Playlist[];
  onClose: () => void;
  onAdd: (playlistId: string) => void;
  onCreateAndAdd: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Adicionar a playlist</Text>
          <Text numberOfLines={1} style={styles.sheetSub}>
            {track?.meta?.title || track?.name || ''}
          </Text>

          <View style={styles.sheetList}>
            <Pressable
              style={styles.sheetItem}
              onPress={() => {
                hapLight();
                onCreateAndAdd();
              }}
            >
              <View style={styles.sheetItemIcon}>
                <Ionicons name="add" size={20} color={theme.accent} />
              </View>
              <Text style={styles.sheetItemText}>Criar nova playlist</Text>
            </Pressable>

            {playlists.map((pl) => (
              <Pressable
                key={pl.id}
                style={styles.sheetItem}
                onPress={() => {
                  hapLight();
                  onAdd(pl.id);
                }}
              >
                <View style={styles.sheetItemIconMuted}>
                  <Ionicons
                    name="musical-notes"
                    size={16}
                    color={theme.textSoft}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.sheetItemText}>
                    {pl.name}
                  </Text>
                  <Text style={styles.sheetItemSub}>
                    {pl.trackIds.length}{' '}
                    {pl.trackIds.length === 1 ? 'musica' : 'musicas'}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function NowPlaying({
  visible,
  onClose,
  current,
  palette,
  playing,
  position,
  duration,
  shuffleOn,
  repeatMode,
  liked,
  onToggle,
  onNext,
  onPrev,
  onShuffle,
  onRepeat,
  onSeek,
  onToggleLike,
}: {
  visible: boolean;
  onClose: () => void;
  current?: Enriched;
  palette: Palette;
  playing: boolean;
  position: number;
  duration: number;
  shuffleOn: boolean;
  repeatMode: RepeatMode;
  liked: boolean;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onSeek: (pos: number) => void;
  onToggleLike: () => void;
}) {
  const pct = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const barW = SCREEN_W - spacing.xxl * 2;

  const handleSeekBar = (locationX: number) => {
    if (duration <= 0) return;
    const clamped = Math.max(0, Math.min(barW, locationX));
    const next = (clamped / barW) * duration;
    hapSelect();
    onSeek(next);
  };

  const repeatIcon =
    repeatMode === RepeatMode.Track ? 'repeat' : 'repeat';
  const repeatActive = repeatMode !== RepeatMode.Off;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={[palette.dominant, '#000000']}
        locations={[0, 0.95]}
        style={styles.npContainer}
      >
        <SafeAreaView style={{ flex: 1 }}>
          <View style={styles.npHandleWrap}>
            <Pressable
              hitSlop={16}
              onPress={() => {
                hapLight();
                onClose();
              }}
              style={styles.npHandle}
            />
          </View>

          <View style={styles.npHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.npHeaderKicker}>TOCANDO AGORA</Text>
            </View>
            <Pressable
              hitSlop={10}
              onPress={() => {
                hapLight();
                onClose();
              }}
              style={styles.npHeaderBtn}
            >
              <Ionicons
                name="chevron-down"
                size={22}
                color={theme.text}
              />
            </Pressable>
          </View>

          <View style={styles.npArtWrap}>
            <View style={styles.npArtShadow}>
              <ArtworkThumb
                uri={current?.meta?.artworkUri}
                size={ARTWORK_SIZE}
                rounded={radius.lg}
              />
            </View>
          </View>

          <View style={styles.npInfo}>
            <View style={{ flex: 1, marginRight: spacing.md }}>
              <Text numberOfLines={1} style={styles.npTitle}>
                {current?.meta?.title || current?.name || ''}
              </Text>
              <Text numberOfLines={1} style={styles.npArtist}>
                {current?.meta?.artist || 'Desconhecido'}
              </Text>
            </View>
            <Pressable
              hitSlop={12}
              onPress={() => {
                hapLight();
                onToggleLike();
              }}
              style={styles.npLikeBtn}
            >
              <Ionicons
                name={liked ? 'checkmark-circle' : 'checkmark-circle-outline'}
                size={30}
                color={liked ? theme.accent : 'rgba(255,255,255,0.75)'}
              />
            </Pressable>
          </View>

          <View style={styles.npProgressWrap}>
            <Pressable
              onPress={(e) => handleSeekBar(e.nativeEvent.locationX)}
              style={styles.npProgressHit}
            >
              <View style={styles.npProgressBg}>
                <View style={[styles.npProgressFill, { width: `${pct * 100}%` }]} />
                <View
                  style={[
                    styles.npProgressDot,
                    { left: `${pct * 100}%` },
                  ]}
                />
              </View>
            </Pressable>
            <View style={styles.npTimeRow}>
              <Text style={styles.npTime}>{fmt(position)}</Text>
              <Text style={styles.npTime}>-{fmt(Math.max(0, duration - position))}</Text>
            </View>
          </View>

          <View style={styles.npControls}>
            <Pressable
              hitSlop={10}
              style={styles.npSideBtn}
              onPress={() => {
                hapLight();
                onShuffle();
              }}
            >
              <Ionicons
                name="shuffle"
                size={20}
                color={shuffleOn ? theme.accent : theme.textSoft}
              />
            </Pressable>
            <Pressable
              hitSlop={10}
              style={styles.npCtrlBtn}
              onPress={() => {
                hapLight();
                onPrev();
              }}
            >
              <Ionicons name="play-skip-back" size={34} color={theme.text} />
            </Pressable>
            <Pressable
              hitSlop={10}
              style={styles.npPlayBtn}
              onPress={() => {
                hapMedium();
                onToggle();
              }}
            >
              <Ionicons
                name={playing ? 'pause' : 'play'}
                size={30}
                color={theme.accentDark}
              />
            </Pressable>
            <Pressable
              hitSlop={10}
              style={styles.npCtrlBtn}
              onPress={() => {
                hapLight();
                onNext();
              }}
            >
              <Ionicons name="play-skip-forward" size={34} color={theme.text} />
            </Pressable>
            <Pressable
              hitSlop={10}
              style={styles.npSideBtn}
              onPress={() => {
                hapLight();
                onRepeat();
              }}
            >
              <Ionicons
                name={repeatIcon as any}
                size={20}
                color={repeatActive ? theme.accent : theme.textSoft}
              />
              {repeatMode === RepeatMode.Track ? (
                <View style={styles.npRepeatBadge}>
                  <Text style={styles.npRepeatBadgeText}>1</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>
    </Modal>
  );
}

export default function App() {
  const [iconsLoaded] = useFonts(Ionicons.font);
  const [ready, setReady] = useState(false);
  const [files, setFiles] = useState<Enriched[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [palette, setPalette] = useState<Palette>(defaultPalette);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [tab, setTab] = useState<'songs' | 'playlists'>('songs');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [viewingPlaylistId, setViewingPlaylistId] = useState<string | null>(null);
  const [addTarget, setAddTarget] = useState<Enriched | null>(null);
  const [context, setContext] = useState<Context>({ kind: 'library' });
  const [workoutActive, setWorkoutActive] = useState(false);
  const [workoutStats, setWorkoutStats] = useState<WorkoutStats | null>(null);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(RepeatMode.Queue);
  const [groupByArtist, setGroupByArtist] = useState(false);
  const [expandedArtists, setExpandedArtists] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const didSetupRef = useRef(false);
  const lastSavedRef = useRef<{ id: string; pos: number } | null>(null);
  const filesByIdRef = useRef<Map<string, Enriched>>(new Map());
  const autoPausedRef = useRef(false);
  const playingRef = useRef(false);
  const workoutActiveRef = useRef(false);

  const progress = useProgress(500);

  const persistPlaylists = useCallback((next: Playlist[]) => {
    setPlaylists(next);
    savePlaylists(next).catch(() => {});
  }, []);

  const toggleGroupByArtist = useCallback(() => {
    hapLight();
    setGroupByArtist((prev) => {
      const next = !prev;
      saveGroupByArtist(next).catch(() => {});
      if (next) setExpandedArtists(new Set());
      return next;
    });
  }, []);

  const toggleArtistSection = useCallback((artist: string) => {
    hapSelect();
    setExpandedArtists((prev) => {
      const next = new Set(prev);
      if (next.has(artist)) next.delete(artist);
      else next.add(artist);
      return next;
    });
  }, []);

  const softReload = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await listMp3s();
      const existing = filesByIdRef.current;
      const merged: Enriched[] = list.map((f) => existing.get(f.id) ?? f);
      filesByIdRef.current = new Map(merged.map((f) => [f.id, f]));
      setFiles(merged);
      const pls = await loadPlaylists();
      setPlaylists(pls);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const enrich = useCallback(async (list: Mp3[]) => {
    for (const file of list) {
      try {
        const meta = await readId3(file.uri, file.id);
        setFiles((prev) =>
          prev.map((f) => (f.id === file.id ? { ...f, meta } : f))
        );
        filesByIdRef.current.set(file.id, { ...file, meta });
        const queue = await TrackPlayer.getQueue();
        const idx = queue.findIndex((t) => t.id === file.id);
        if (idx >= 0) {
          await TrackPlayer.updateMetadataForTrack(idx, {
            title: meta.title || file.name,
            artist: meta.artist || 'Desconhecido',
            artwork: meta.artworkUri,
          });
        }
      } catch {}
    }
  }, []);

  const buildQueue = useCallback(
    async (list: Enriched[], startIndex: number) => {
      await TrackPlayer.reset();
      resetVolumeState();
      await TrackPlayer.add(toTracks(list));
      if (startIndex > 0) await TrackPlayer.skip(startIndex);
    },
    []
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listMp3s();
      filesByIdRef.current = new Map(list.map((f) => [f.id, f]));
      setFiles(list);
      await TrackPlayer.reset();
      resetVolumeState();
      if (list.length > 0) await TrackPlayer.add(toTracks(list));
      setCurrentId(null);
      setPlaying(false);
      setContext({ kind: 'library' });
      setShuffleOn(false);
      enrich(list);
      const pls = await loadPlaylists();
      setPlaylists(pls);
    } finally {
      setLoading(false);
    }
  }, [enrich]);

  useEffect(() => {
    (async () => {
      if (didSetupRef.current) return;
      didSetupRef.current = true;
      await setupPlayer();
      setReady(true);
      const list = await listMp3s();
      filesByIdRef.current = new Map(list.map((f) => [f.id, f]));
      setFiles(list);
      const pls = await loadPlaylists();
      setPlaylists(pls);
      const grouped = await loadGroupByArtist();
      setGroupByArtist(grouped);
      if (list.length > 0) {
        await TrackPlayer.reset();
        await TrackPlayer.add(toTracks(list));
        const resume = await loadResume();
        if (resume) {
          const idx = list.findIndex((f) => f.id === resume.trackId);
          if (idx >= 0) {
            try {
              await TrackPlayer.skip(idx);
              if (resume.position > 2) await TrackPlayer.seekTo(resume.position);
              setCurrentId(resume.trackId);
            } catch {}
          }
        }
      }
      setLoading(false);
      enrich(list);
    })();
  }, [enrich]);

  const currentIndex = useMemo(
    () => (currentId ? files.findIndex((f) => f.id === currentId) : -1),
    [currentId, files]
  );
  const current = currentIndex >= 0 ? files[currentIndex] : undefined;

  useEffect(() => {
    (async () => {
      const p = await extractPalette(current?.meta?.artworkUri);
      setPalette(p);
    })();
  }, [current?.meta?.artworkUri]);

  useEffect(() => {
    if (!currentId) return;
    const pos = Math.floor(progress.position);
    const last = lastSavedRef.current;
    if (last && last.id === currentId && Math.abs(last.pos - pos) < 3) return;
    lastSavedRef.current = { id: currentId, pos };
    saveResume({ trackId: currentId, position: pos }).catch(() => {});
  }, [currentId, progress.position]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    workoutActiveRef.current = workoutActive;
  }, [workoutActive]);

  const handleMotionChange = useCallback((moving: boolean) => {
    if (!workoutActiveRef.current) return;
    if (!moving) {
      if (playingRef.current) {
        TrackPlayer.pause().catch(() => {});
        autoPausedRef.current = true;
      }
    } else {
      if (autoPausedRef.current && !playingRef.current) {
        TrackPlayer.play().catch(() => {});
        autoPausedRef.current = false;
      }
    }
  }, []);

  useTrackPlayerEvents(
    [Event.PlaybackState, Event.PlaybackActiveTrackChanged],
    async (ev) => {
      if (ev.type === Event.PlaybackState) {
        setPlaying(ev.state === State.Playing);
      }
      if (ev.type === Event.PlaybackActiveTrackChanged) {
        const idx = await TrackPlayer.getActiveTrackIndex();
        if (idx != null) {
          const t = await TrackPlayer.getTrack(idx);
          if (t?.id) {
            const id = String(t.id);
            setCurrentId(id);
            const file = filesByIdRef.current.get(id);
            const gain = file?.meta?.gainDb;
            if (ev.index !== ev.lastIndex && ev.lastIndex != null) {
              fadeInForTrack(gain).catch(() => {});
            } else {
              setTargetVolume(gain).catch(() => {});
            }
          }
        }
      }
    }
  );

  const songsForContext = (ctx: Context): Enriched[] => {
    if (ctx.kind === 'library') return files;
    const pl = playlists.find((p) => p.id === ctx.id);
    if (!pl) return [];
    const map = filesByIdRef.current;
    return pl.trackIds
      .map((id) => map.get(id))
      .filter((f): f is Enriched => !!f);
  };

  const playFromContext = async (ctx: Context, trackId: string) => {
    const list = songsForContext(ctx);
    const idx = list.findIndex((f) => f.id === trackId);
    if (idx < 0) return;
    hapSelect();
    setContext(ctx);
    setShuffleOn(false);
    await buildQueue(list, idx);
    await TrackPlayer.play();
  };

  const togglePlay = async () => {
    autoPausedRef.current = false;
    if (!currentId && files.length > 0) {
      await playFromContext({ kind: 'library' }, files[0].id);
      return;
    }
    if (playing) await TrackPlayer.pause();
    else await TrackPlayer.play();
  };

  const next = async () => {
    try {
      await TrackPlayer.skipToNext();
      await TrackPlayer.play();
    } catch {}
  };

  const prev = async () => {
    try {
      await TrackPlayer.skipToPrevious();
      await TrackPlayer.play();
    } catch {}
  };

  const shuffle = async () => {
    const list = songsForContext(context);
    if (list.length === 0) return;
    hapMedium();
    if (shuffleOn) {
      // disable shuffle: restore original order
      setShuffleOn(false);
      const cur = currentId;
      const idx = cur ? list.findIndex((f) => f.id === cur) : 0;
      await buildQueue(list, Math.max(0, idx));
      if (playingRef.current) await TrackPlayer.play();
      return;
    }
    const shuffled = [...list];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setShuffleOn(true);
    await buildQueue(shuffled, 0);
    await TrackPlayer.play();
  };

  const cycleRepeat = async () => {
    hapLight();
    const nextMode =
      repeatMode === RepeatMode.Off
        ? RepeatMode.Queue
        : repeatMode === RepeatMode.Queue
        ? RepeatMode.Track
        : RepeatMode.Off;
    try {
      await TrackPlayer.setRepeatMode(nextMode);
      setRepeatMode(nextMode);
    } catch {}
  };

  const seek = async (pos: number) => {
    try {
      await TrackPlayer.seekTo(pos);
    } catch {}
  };

  const handleToggleLike = () => {
    if (!currentId) return;
    const next = toggleLiked(playlists, currentId);
    persistPlaylists(next);
  };

  const currentIsLiked = currentId ? isLiked(playlists, currentId) : false;

  const openAddToPlaylist = (track: Enriched) => {
    hapLight();
    setAddTarget(track);
  };

  const addSongToPlaylist = (playlistId: string) => {
    if (!addTarget) return;
    const next = playlists.map((p) =>
      p.id === playlistId ? addTrack(p, addTarget.id) : p
    );
    persistPlaylists(next);
    setAddTarget(null);
  };

  const createPlaylistAndAdd = () => {
    Alert.prompt(
      'Nova playlist',
      'Como quer chamar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Criar',
          onPress: (name) => {
            const pl = newPlaylist(name || '');
            const withTrack = addTarget ? addTrack(pl, addTarget.id) : pl;
            persistPlaylists([...playlists, withTrack]);
            setAddTarget(null);
          },
        },
      ],
      'plain-text',
      ''
    );
  };

  const createPlaylist = () => {
    Alert.prompt(
      'Nova playlist',
      'Como quer chamar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Criar',
          onPress: (name) => {
            const pl = newPlaylist(name || '');
            persistPlaylists([...playlists, pl]);
          },
        },
      ],
      'plain-text',
      ''
    );
  };

  const handlePlaylistLongPress = (pl: Playlist) => {
    hapLight();
    if (pl.id === LIKED_PLAYLIST_ID) return;
    Alert.alert(pl.name, undefined, [
      {
        text: 'Renomear',
        onPress: () => {
          Alert.prompt(
            'Renomear playlist',
            undefined,
            [
              { text: 'Cancelar', style: 'cancel' },
              {
                text: 'Salvar',
                onPress: (name) => {
                  if (!name) return;
                  const next = playlists.map((p) =>
                    p.id === pl.id ? renamePlaylist(p, name) : p
                  );
                  persistPlaylists(next);
                },
              },
            ],
            'plain-text',
            pl.name
          );
        },
      },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            'Apagar playlist?',
            'Isso remove so a playlist. Suas musicas continuam na biblioteca.',
            [
              { text: 'Cancelar', style: 'cancel' },
              {
                text: 'Apagar',
                style: 'destructive',
                onPress: () => {
                  persistPlaylists(playlists.filter((p) => p.id !== pl.id));
                  if (viewingPlaylistId === pl.id) setViewingPlaylistId(null);
                },
              },
            ]
          );
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const removeFromPlaylist = (playlistId: string, trackId: string) => {
    const next = playlists.map((p) =>
      p.id === playlistId ? removeTrack(p, trackId) : p
    );
    persistPlaylists(next);
  };

  const openSongMenu = (song: Enriched, inPlaylistId?: string) => {
    hapLight();
    const options: any[] = [];
    if (inPlaylistId) {
      options.push({
        text: 'Mover para o topo',
        onPress: () => {
          const next = playlists.map((p) =>
            p.id === inPlaylistId ? moveTrackToTop(p, song.id) : p
          );
          persistPlaylists(next);
        },
      });
      options.push({
        text: 'Mover para o final',
        onPress: () => {
          const next = playlists.map((p) =>
            p.id === inPlaylistId ? moveTrackToEnd(p, song.id) : p
          );
          persistPlaylists(next);
        },
      });
      options.push({
        text: 'Adicionar a outra playlist',
        onPress: () => openAddToPlaylist(song),
      });
      options.push({
        text: 'Remover da playlist',
        style: 'destructive',
        onPress: () => removeFromPlaylist(inPlaylistId, song.id),
      });
    } else {
      options.push({
        text: 'Adicionar a playlist',
        onPress: () => openAddToPlaylist(song),
      });
    }
    options.push({ text: 'Cancelar', style: 'cancel' });
    Alert.alert(song.meta?.title || song.name, undefined, options);
  };

  const handleStartWorkout = async () => {
    hapMedium();
    await requestHeartRateAuth();
    const okGps = await startWorkout(setWorkoutStats);
    if (!okGps) {
      Alert.alert(
        'Localizacao negada',
        'Para medir distancia e ritmo o app precisa de acesso a localizacao.'
      );
      return;
    }
    await startAutoPause(handleMotionChange);
    setWorkoutActive(true);
  };

  const handleStopWorkout = async () => {
    Alert.alert('Encerrar treino?', undefined, [
      { text: 'Continuar', style: 'cancel' },
      {
        text: 'Encerrar',
        style: 'destructive',
        onPress: () => {
          hapMedium();
          announceWorkoutEnd();
          stopWorkout(setWorkoutStats);
          stopAutoPause(handleMotionChange);
          setWorkoutStats(null);
          setWorkoutActive(false);
          autoPausedRef.current = false;
        },
      },
    ]);
  };

  if (!iconsLoaded || !ready || loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.center}>
          <ActivityIndicator size="small" color={theme.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (files.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.center}>
          <Ionicons
            name="musical-notes-outline"
            size={56}
            color={theme.textDim}
            style={{ marginBottom: spacing.lg }}
          />
          <Text style={styles.emptyTitle}>Nenhuma musica ainda</Text>
          <Text style={styles.emptyHelp}>
            Abra o app Arquivos no iPhone, va em{'\n'}
            <Text style={styles.emptyHelpBold}>No meu iPhone › RunPlayer</Text>
            {'\n'}e coloque seus arquivos .mp3 ali.
          </Text>
          <Pressable
            style={styles.emptyBtn}
            onPress={() => {
              hapLight();
              reload();
            }}
          >
            <Ionicons
              name="refresh"
              size={16}
              color={theme.text}
              style={{ marginRight: spacing.sm }}
            />
            <Text style={styles.emptyBtnText}>Recarregar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const viewingPlaylist = viewingPlaylistId
    ? playlists.find((p) => p.id === viewingPlaylistId)
    : null;
  const viewingPlaylistSongs = viewingPlaylist
    ? viewingPlaylist.trackIds
        .map((id) => filesByIdRef.current.get(id))
        .filter((f): f is Enriched => !!f)
    : [];

  const hasCurrent = !!current;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={{ flex: 1 }}>
        {viewingPlaylist ? (
          <>
            <View style={styles.headerBar}>
              <Pressable
                hitSlop={10}
                onPress={() => {
                  hapLight();
                  setViewingPlaylistId(null);
                }}
                style={styles.headerIconBtn}
              >
                <Ionicons name="chevron-back" size={22} color={theme.text} />
              </Pressable>
              <View style={styles.headerCenter}>
                <Text style={styles.headerKicker}>
                  PLAYLIST · {viewingPlaylistSongs.length}{' '}
                  {viewingPlaylistSongs.length === 1 ? 'musica' : 'musicas'}
                  {sumDuration(viewingPlaylistSongs) > 0
                    ? ` · ${fmtTotalDuration(sumDuration(viewingPlaylistSongs))}`
                    : ''}
                </Text>
                <Text numberOfLines={1} style={styles.headerTitle}>
                  {viewingPlaylist.name}
                </Text>
              </View>
              <Pressable
                hitSlop={10}
                onPress={() => {
                  hapLight();
                  if (viewingPlaylistSongs.length > 0) {
                    playFromContext(
                      { kind: 'playlist', id: viewingPlaylist.id },
                      viewingPlaylistSongs[0].id
                    );
                  }
                }}
                style={styles.headerIconBtnAccent}
              >
                <Ionicons name="play" size={14} color={theme.accentDark} />
              </Pressable>
            </View>
            {viewingPlaylistSongs.length === 0 ? (
              <View style={styles.center}>
                <Ionicons
                  name="musical-notes-outline"
                  size={48}
                  color={theme.textDim}
                  style={{ marginBottom: spacing.lg }}
                />
                <Text style={styles.emptyTitle}>Playlist vazia</Text>
                <Text style={styles.emptyHelp}>
                  Volte na aba Musicas, segure uma musica{'\n'}e adicione a esta
                  playlist.
                </Text>
              </View>
            ) : (
              <FlatList
                data={viewingPlaylistSongs}
                keyExtractor={(f) => f.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: spacing.lg,
                  paddingBottom: hasCurrent ? 120 : 24,
                  paddingTop: spacing.sm,
                }}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={softReload}
                    tintColor={theme.accent}
                  />
                }
                renderItem={({ item }) => (
                  <SongRow
                    item={item}
                    active={item.id === currentId}
                    onPress={() =>
                      playFromContext(
                        { kind: 'playlist', id: viewingPlaylist.id },
                        item.id
                      )
                    }
                    onLongPress={() => openSongMenu(item, viewingPlaylist.id)}
                    onMenu={() => openSongMenu(item, viewingPlaylist.id)}
                  />
                )}
              />
            )}
          </>
        ) : (
          <>
            <View style={styles.topRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.topKicker}>Biblioteca</Text>
                <Text style={styles.topTitle}>Suas musicas</Text>
              </View>
              <Pressable
                hitSlop={10}
                onPress={toggleGroupByArtist}
                style={[
                  styles.subtleIconBtn,
                  groupByArtist && styles.subtleIconBtnActive,
                ]}
              >
                <Ionicons
                  name="people-outline"
                  size={18}
                  color={groupByArtist ? theme.accent : theme.textSoft}
                />
              </Pressable>
            </View>

            <View style={styles.toolRow}>
              {workoutActive && workoutStats ? (
                <Pressable
                  style={styles.workoutCard}
                  onPress={handleStopWorkout}
                >
                  <View style={styles.workoutLive} />
                  <View style={styles.workoutStats}>
                    <View style={styles.workoutStat}>
                      <Text style={styles.workoutStatVal}>
                        {fmtKm(workoutStats.distanceM)}
                      </Text>
                      <Text style={styles.workoutStatUnit}>km</Text>
                    </View>
                    <View style={styles.workoutDivider} />
                    <View style={styles.workoutStat}>
                      {workoutStats.distanceM < 100 ? (
                        <Text style={styles.workoutStatWarm}>aquecendo</Text>
                      ) : (
                        <>
                          <Text style={styles.workoutStatVal}>
                            {fmtPace(workoutStats.paceSecPerKm)}
                          </Text>
                          <Text style={styles.workoutStatUnit}>/km</Text>
                        </>
                      )}
                    </View>
                    <View style={styles.workoutDivider} />
                    <View style={styles.workoutStat}>
                      <Text style={styles.workoutStatVal}>
                        {workoutStats.bpm ?? '--'}
                      </Text>
                      <Text style={styles.workoutStatUnit}>bpm</Text>
                    </View>
                  </View>
                  <Ionicons
                    name="stop"
                    size={14}
                    color={theme.accent}
                    style={{ marginLeft: spacing.sm }}
                  />
                </Pressable>
              ) : (
                <View style={styles.workoutStartRow}>
                  <Pressable
                    style={styles.workoutStartPill}
                    onPress={handleStartWorkout}
                  >
                    <Ionicons
                      name="walk"
                      size={16}
                      color={theme.accent}
                      style={{ marginRight: spacing.xs }}
                    />
                    <Text style={styles.workoutStartText}>Iniciar treino</Text>
                  </Pressable>
                  <Pressable
                    style={styles.debugPill}
                    onPress={async () => {
                      hapLight();
                      const voiceId = await announceDebugSample().catch(
                        () => '(erro)'
                      );
                      const voices = await listPtBrVoices().catch(() => []);
                      Alert.alert(
                        'Voz em uso',
                        `Selecionada:\n${voiceId}\n\nDisponiveis pt-BR:\n${voices.join('\n') || '(nenhuma)'}`
                      );
                    }}
                  >
                    <Ionicons
                      name="volume-high-outline"
                      size={14}
                      color={theme.textSoft}
                    />
                    <Text style={styles.debugPillText}>Testar voz</Text>
                  </Pressable>
                  <Pressable
                    style={styles.debugPill}
                    onPress={async () => {
                      hapLight();
                      await requestHeartRateAuth();
                      const info = await diagnoseBpm();
                      Alert.alert('Diagnostico BPM', info);
                    }}
                  >
                    <Ionicons
                      name="heart-outline"
                      size={14}
                      color={theme.textSoft}
                    />
                    <Text style={styles.debugPillText}>Testar BPM</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <SegmentedTabs tab={tab} onChange={setTab} />

            {tab === 'songs' ? (
              groupByArtist ? (
                <SectionList
                  sections={groupByArtistSections(files).map((s) => ({
                    ...s,
                    totalCount: s.data.length,
                    data: expandedArtists.has(s.title) ? s.data : [],
                  }))}
                  keyExtractor={(f) => f.id}
                  showsVerticalScrollIndicator={false}
                  stickySectionHeadersEnabled={false}
                  contentContainerStyle={{
                    paddingHorizontal: spacing.lg,
                    paddingBottom: hasCurrent ? 120 : 24,
                    paddingTop: spacing.xs,
                  }}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={softReload}
                      tintColor={theme.accent}
                    />
                  }
                  renderSectionHeader={({ section }) => {
                    const isOpen = expandedArtists.has(section.title);
                    const count =
                      (section as any).totalCount ?? section.data.length;
                    return (
                      <Pressable
                        onPress={() => toggleArtistSection(section.title)}
                        style={({ pressed }) => [
                          styles.sectionHeader,
                          pressed && { opacity: 0.6 },
                        ]}
                      >
                        <ArtworkThumb
                          uri={(section as any).artworkUri}
                          size={36}
                          rounded={radius.sm}
                        />
                        <Text
                          numberOfLines={1}
                          style={styles.sectionTitle}
                        >
                          {section.title}
                        </Text>
                        <Text style={styles.sectionCount}>{count}</Text>
                        <Ionicons
                          name={isOpen ? 'chevron-up' : 'chevron-down'}
                          size={16}
                          color={theme.textMuted}
                          style={{ marginLeft: spacing.sm }}
                        />
                      </Pressable>
                    );
                  }}
                  renderItem={({ item }) => (
                    <View style={styles.sectionItem}>
                      <SongRow
                        item={item}
                        active={item.id === currentId}
                        onPress={() =>
                          playFromContext({ kind: 'library' }, item.id)
                        }
                        onLongPress={() => openAddToPlaylist(item)}
                        onMenu={() => openAddToPlaylist(item)}
                      />
                    </View>
                  )}
                />
              ) : (
                <FlatList
                  data={files}
                  keyExtractor={(f) => f.id}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingHorizontal: spacing.lg,
                    paddingBottom: hasCurrent ? 120 : 24,
                    paddingTop: spacing.xs,
                  }}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={softReload}
                      tintColor={theme.accent}
                    />
                  }
                  renderItem={({ item }) => (
                    <SongRow
                      item={item}
                      active={item.id === currentId}
                      onPress={() =>
                        playFromContext({ kind: 'library' }, item.id)
                      }
                      onLongPress={() => openAddToPlaylist(item)}
                      onMenu={() => openAddToPlaylist(item)}
                    />
                  )}
                />
              )
            ) : (
              <>
                <Pressable
                  style={styles.plCreateGhost}
                  onPress={() => {
                    hapLight();
                    createPlaylist();
                  }}
                >
                  <Ionicons
                    name="add"
                    size={18}
                    color={theme.accent}
                    style={{ marginRight: spacing.sm }}
                  />
                  <Text style={styles.plCreateGhostText}>
                    Criar nova playlist
                  </Text>
                </Pressable>
                {playlists.length === 0 ? (
                  <View style={styles.center}>
                    <Ionicons
                      name="list-outline"
                      size={48}
                      color={theme.textDim}
                      style={{ marginBottom: spacing.lg }}
                    />
                    <Text style={styles.emptyTitle}>Sem playlists ainda</Text>
                    <Text style={styles.emptyHelp}>
                      Toque em "Criar nova playlist" ou{'\n'}segure uma musica
                      na aba Musicas.
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={playlists}
                    keyExtractor={(p) => p.id}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{
                      paddingHorizontal: spacing.lg,
                      paddingBottom: hasCurrent ? 120 : 24,
                    }}
                    renderItem={({ item }) => (
                      <PlaylistRow
                        playlist={item}
                        onPress={() => {
                          hapSelect();
                          setViewingPlaylistId(item.id);
                        }}
                        onLongPress={() => handlePlaylistLongPress(item)}
                      />
                    )}
                  />
                )}
              </>
            )}
          </>
        )}
      </SafeAreaView>

      <MiniPlayer
        current={current}
        playing={playing}
        progress={
          progress.duration > 0 ? progress.position / progress.duration : 0
        }
        liked={currentIsLiked}
        onToggle={togglePlay}
        onNext={next}
        onPrev={prev}
        onOpen={() => {
          hapLight();
          setNowPlayingOpen(true);
        }}
        onToggleLike={handleToggleLike}
      />

      <NowPlaying
        visible={nowPlayingOpen}
        onClose={() => setNowPlayingOpen(false)}
        current={current}
        palette={palette}
        playing={playing}
        position={progress.position}
        duration={progress.duration}
        shuffleOn={shuffleOn}
        repeatMode={repeatMode}
        liked={currentIsLiked}
        onToggle={togglePlay}
        onNext={next}
        onPrev={prev}
        onShuffle={shuffle}
        onRepeat={cycleRepeat}
        onSeek={seek}
        onToggleLike={handleToggleLike}
      />

      <AddToPlaylistSheet
        visible={!!addTarget}
        track={addTarget ?? undefined}
        playlists={playlists}
        onClose={() => setAddTarget(null)}
        onAdd={addSongToPlaylist}
        onCreateAndAdd={createPlaylistAndAdd}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },

  // Empty state
  emptyTitle: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.title3,
    fontWeight: weight.semibold,
    marginBottom: spacing.sm,
    letterSpacing: -0.3,
  },
  emptyHelp: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.body,
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: weight.regular,
  },
  emptyHelpBold: {
    color: theme.text,
    fontFamily: ff,
    fontWeight: weight.semibold,
  },
  emptyBtn: {
    marginTop: spacing.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surfaceHigh,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
  },
  emptyBtnText: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.button,
    fontWeight: weight.semibold,
  },

  // Top header (library view)
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  topKicker: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.tiny,
    fontWeight: weight.semibold,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  topTitle: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.title1,
    fontWeight: weight.bold,
    marginTop: 2,
    letterSpacing: -0.5,
    lineHeight: font.title1 * 1.1,
  },
  subtleIconBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtleIconBtnActive: {
    backgroundColor: theme.accentSoft,
  },

  // Header bar (playlist detail)
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: theme.surfaceOverlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconBtnAccent: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, marginHorizontal: spacing.xs },
  headerKicker: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.tiny,
    fontWeight: weight.semibold,
    letterSpacing: 1.4,
  },
  headerTitle: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.title3,
    fontWeight: weight.semibold,
    letterSpacing: -0.3,
    marginTop: 1,
  },

  // Tool row (workout control)
  toolRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  workoutStartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  workoutStartPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.accentSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
  },
  debugPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: theme.surfaceOverlay,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  debugPillText: {
    color: theme.textSoft,
    fontFamily: ff,
    fontSize: font.caption,
    fontWeight: weight.medium,
  },
  workoutStartText: {
    color: theme.accent,
    fontFamily: ff,
    fontSize: font.button,
    fontWeight: weight.semibold,
    letterSpacing: 0.1,
  },
  workoutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  workoutLive: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.accent,
    marginRight: spacing.md,
  },
  workoutStats: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  workoutStat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  workoutStatVal: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.body,
    fontWeight: weight.semibold,
    fontVariant: ['tabular-nums'],
  },
  workoutStatUnit: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.tiny,
    fontWeight: weight.medium,
  },
  workoutStatWarm: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.caption,
    fontWeight: weight.medium,
    fontStyle: 'italic',
  },
  workoutDivider: {
    width: 1,
    height: 10,
    backgroundColor: theme.divider,
    marginHorizontal: spacing.md,
  },

  // Segmented control
  segWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  segBar: {
    flexDirection: 'row',
    backgroundColor: theme.surfaceOverlay,
    borderRadius: radius.md,
    padding: 3,
    position: 'relative',
  },
  segIndicator: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    width: '50%',
    left: 3,
    backgroundColor: theme.surfaceHigh,
    borderRadius: radius.sm,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    zIndex: 1,
  },
  segText: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.button,
    fontWeight: weight.medium,
  },
  segTextActive: {
    color: theme.text,
    fontWeight: weight.semibold,
  },

  // Song row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: spacing.xs,
  },
  rowText: { flex: 1, marginLeft: spacing.md },
  rowTitle: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.callout,
    fontWeight: weight.semibold,
    letterSpacing: -0.1,
  },
  rowArtist: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.small,
    marginTop: 2,
    fontWeight: weight.regular,
  },
  rowMenu: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artFallback: { alignItems: 'center', justifyContent: 'center' },

  // Section header (group by artist)
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
    gap: spacing.sm,
  },
  sectionTitle: {
    flex: 1,
    color: theme.text,
    fontFamily: ff,
    fontSize: font.callout,
    fontWeight: weight.semibold,
    letterSpacing: -0.2,
    marginLeft: spacing.sm,
  },
  sectionCount: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.small,
    fontWeight: weight.medium,
    fontVariant: ['tabular-nums'],
  },
  sectionItem: {
    paddingLeft: spacing.lg,
  },

  // Playlist row
  plRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: spacing.xs,
  },
  plIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.sm,
    backgroundColor: theme.surfaceOverlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plCreateGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
  },
  plCreateGhostText: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.body,
    fontWeight: weight.semibold,
  },

  // Mini player
  miniWrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: 28,
  },
  miniCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.bgElevated,
    borderRadius: radius.md,
    paddingVertical: 7,
    paddingLeft: 7,
    paddingRight: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  miniTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  miniText: {
    flex: 1,
    marginLeft: spacing.md,
    marginRight: spacing.sm,
    minWidth: 0,
  },
  miniTitle: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.small,
    fontWeight: weight.semibold,
    letterSpacing: -0.1,
  },
  miniArtist: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.caption,
    marginTop: 1,
    fontWeight: weight.regular,
  },
  miniControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  miniCtrlBtn: {
    width: 32,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniProgressBg: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: -4,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  miniProgressFill: {
    height: '100%',
    backgroundColor: theme.accent,
    borderBottomLeftRadius: 2,
  },

  // Sheet (modal)
  sheetBackdrop: {
    flex: 1,
    backgroundColor: theme.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.bgElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.dividerStrong,
    marginBottom: spacing.lg,
  },
  sheetTitle: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.title3,
    fontWeight: weight.semibold,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  sheetSub: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.small,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: spacing.lg,
  },
  sheetList: { maxHeight: 420 },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  sheetItemIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetItemIconMuted: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: theme.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetItemText: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.body,
    fontWeight: weight.semibold,
  },
  sheetItemSub: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.caption,
    marginTop: 1,
  },

  // Now Playing
  npContainer: { flex: 1 },
  npHandleWrap: {
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  npHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  npHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  npHeaderKicker: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: ff,
    fontSize: font.tiny,
    fontWeight: weight.semibold,
    letterSpacing: 1.5,
  },
  npHeaderBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  npArtWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  npArtShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 14 },
    borderRadius: radius.lg,
  },
  npInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
  },
  npLikeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  npTitle: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.title2,
    fontWeight: weight.bold,
    letterSpacing: -0.4,
    lineHeight: font.title2 * 1.15,
  },
  npArtist: {
    color: 'rgba(255,255,255,0.65)',
    fontFamily: ff,
    fontSize: font.callout,
    marginTop: 3,
    fontWeight: weight.regular,
  },
  npProgressWrap: {
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.md,
  },
  npProgressHit: { paddingVertical: spacing.xs },
  npProgressBg: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    overflow: 'visible',
    position: 'relative',
  },
  npProgressFill: {
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 2,
  },
  npProgressDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.text,
    top: -3.5,
    marginLeft: -5,
  },
  npTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  npTime: {
    color: 'rgba(255,255,255,0.6)',
    fontFamily: ff,
    fontSize: font.caption,
    fontVariant: ['tabular-nums'],
    fontWeight: weight.medium,
  },
  npControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  npSideBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  npCtrlBtn: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  npPlayBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: theme.text,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  npRepeatBadge: {
    position: 'absolute',
    top: 8,
    right: 6,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  npRepeatBadgeText: {
    color: theme.accentDark,
    fontSize: 8,
    fontWeight: weight.bold,
  },
});
