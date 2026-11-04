import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  SectionList,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import * as FileSystem from 'expo-file-system';
import { useFonts } from 'expo-font';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { getColors } from 'react-native-image-colors';
import {
  AudioPlayer,
  AudioEvent,
  RepeatMode,
  RepeatModeValue,
  Track,
  useAudioEvents,
  useAudioProgress,
} from './audioPlayer';

import { readId3, Metadata } from './metadata';
import {
  hasSeededWorkouts,
  loadCrossfadeEnabled,
  loadCrossfadeSeconds,
  loadGroupByArtist,
  loadMetaCache,
  loadRecentlyPlayed,
  loadResume,
  markWorkoutsSeeded,
  pushRecentlyPlayed,
  saveCrossfadeEnabled,
  saveCrossfadeSeconds,
  saveGroupByArtist,
  saveMetaCache,
  saveRecentlyPlayed,
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
import {
  fadeInForTrack,
  fadeOutAndStop,
  resetVolumeState,
  setTargetVolume,
} from './volume';
import { startAutoPause, stopAutoPause } from './autoPause';
import {
  announceWorkoutEnd,
  startWorkout,
  stopWorkout,
  WorkoutStats,
} from './workout';
import {
  addWorkout,
  deleteWorkout,
  loadWorkouts,
  seedFakeWorkouts,
  WorkoutEntry,
} from './workoutHistory';
import { requestHeartRateAuth } from './healthkit';

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
  await AudioPlayer.setupPlayer();
  await AudioPlayer.setRepeatMode(RepeatMode.Queue);
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
        'Depois, no Run Player, toque no botão de recarregar.\n'
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
    artworkUri: f.meta?.artworkUri,
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

function fmtWorkoutDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Hoje';
  if (sameDay(d, yesterday)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function fmtWorkoutTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtWorkoutDuration(startMs: number, endMs: number): string {
  const secs = Math.max(0, (endMs - startMs) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min ${s}s`;
  return `${s}s`;
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
            Músicas
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
  selectionMode,
  selected,
  onPress,
  onLongPress,
  onMenu,
}: {
  item: Enriched;
  active: boolean;
  selectionMode?: boolean;
  selected?: boolean;
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
      {selectionMode ? (
        <View style={styles.rowCheckbox}>
          <Ionicons
            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={selected ? theme.accent : theme.textMuted}
          />
        </View>
      ) : null}
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
      {!selectionMode && onMenu ? (
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
  coverUri,
  onPress,
  onLongPress,
}: {
  playlist: Playlist;
  coverUri?: string;
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
      {coverUri && !liked ? (
        <Image source={{ uri: coverUri }} style={styles.plCover} />
      ) : (
        <View style={styles.plIcon}>
          <Ionicons
            name={liked ? 'checkmark-circle' : 'musical-notes'}
            size={22}
            color={theme.accent}
          />
        </View>
      )}
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {playlist.name}
        </Text>
        <Text numberOfLines={1} style={styles.rowArtist}>
          {playlist.trackIds.length}{' '}
          {playlist.trackIds.length === 1 ? 'música' : 'músicas'}
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

function MiniProgressBar({ onSeek }: { onSeek: (pos: number) => void }) {
  const prog = useAudioProgress(400);
  const duration = prog.duration;
  const position = prog.position;

  const [barW, setBarW] = useState(SCREEN_W - spacing.md * 2);
  const [scrubbing, setScrubbing] = useState(false);

  const progressX = useSharedValue(0);
  const isScrubbingSv = useSharedValue(false);
  const barWRef = useRef(barW);
  const durationRef = useRef(duration);

  useEffect(() => {
    barWRef.current = barW;
  }, [barW]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    if (scrubbing) return;
    if (duration > 0 && barW > 0) {
      progressX.value = Math.max(
        0,
        Math.min(barW, (position / duration) * barW)
      );
    }
  }, [position, duration, barW, scrubbing, progressX]);

  const fillStyle = useAnimatedStyle(() => ({
    width: progressX.value,
  }));

  const beginScrub = useCallback(() => {
    hapSelect();
    setScrubbing(true);
  }, []);

  const endScrub = useCallback(
    (x: number) => {
      if (durationRef.current <= 0 || barWRef.current <= 0) {
        setScrubbing(false);
        return;
      }
      const p = (x / barWRef.current) * durationRef.current;
      onSeek(p);
      setTimeout(() => setScrubbing(false), 300);
    },
    [onSeek]
  );

  const pan = Gesture.Pan()
    .minDistance(0)
    .activeOffsetX([-1, 1])
    .onBegin((e) => {
      isScrubbingSv.value = true;
      const x = Math.max(0, Math.min(barWRef.current, e.x));
      progressX.value = x;
      runOnJS(beginScrub)();
    })
    .onUpdate((e) => {
      const x = Math.max(0, Math.min(barWRef.current, e.x));
      progressX.value = x;
    })
    .onEnd((e) => {
      const x = Math.max(0, Math.min(barWRef.current, e.x));
      isScrubbingSv.value = false;
      runOnJS(endScrub)(x);
    })
    .onFinalize(() => {
      isScrubbingSv.value = false;
    });

  const tap = Gesture.Tap().onEnd((e) => {
    const x = Math.max(0, Math.min(barWRef.current, e.x));
    progressX.value = x;
    isScrubbingSv.value = false;
    runOnJS(hapSelect)();
    runOnJS(endScrub)(x);
  });

  const gesture = Gesture.Exclusive(pan, tap);

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.miniProgressHit}
        onLayout={(e) => setBarW(e.nativeEvent.layout.width)}
      >
        <View style={styles.miniProgressBg}>
          <Animated.View style={[styles.miniProgressFillAnim, fillStyle]} />
        </View>
      </View>
    </GestureDetector>
  );
}

function MiniPlayer({
  current,
  playing,
  liked,
  onToggle,
  onNext,
  onPrev,
  onOpen,
  onToggleLike,
  onSeek,
}: {
  current?: Enriched;
  playing: boolean;
  liked: boolean;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onOpen: () => void;
  onToggleLike: () => void;
  onSeek: (pos: number) => void;
}) {
  if (!current) return null;
  const title = current.meta?.title || current.name;
  const artist = current.meta?.artist;
  return (
    <View style={styles.miniWrap}>
      <MiniProgressBar onSeek={onSeek} />
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
    </View>
  );
}

function AddToPlaylistSheet({
  visible,
  track,
  subtitleOverride,
  playlists,
  onClose,
  onAdd,
  onCreateAndAdd,
}: {
  visible: boolean;
  track?: Enriched;
  subtitleOverride?: string;
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
          <Text style={styles.sheetTitle}>Adicionar à playlist</Text>
          <Text numberOfLines={1} style={styles.sheetSub}>
            {subtitleOverride ?? (track?.meta?.title || track?.name || '')}
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
                    {pl.trackIds.length === 1 ? 'música' : 'músicas'}
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

function AddSongsSheet({
  visible,
  playlistName,
  availableSongs,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  playlistName: string;
  availableSongs: Enriched[];
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) {
      setSelected(new Set());
      setQuery('');
    }
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableSongs;
    return availableSongs.filter((f) => {
      const title = (f.meta?.title || f.name).toLowerCase();
      const artist = (f.meta?.artist || '').toLowerCase();
      return title.includes(q) || artist.includes(q);
    });
  }, [availableSongs, query]);

  const toggle = (id: string) => {
    hapSelect();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Pressable style={styles.sheetBackdrop} onPress={onClose}>
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={styles.pickerHeader}>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                style={styles.pickerCancelBtn}
              >
                <Text style={styles.pickerCancelText}>Cancelar</Text>
              </Pressable>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text numberOfLines={1} style={styles.pickerTitle}>
                  Adicionar à {playlistName}
                </Text>
                <Text style={styles.pickerSub}>
                  {selected.size}{' '}
                  {selected.size === 1 ? 'selecionada' : 'selecionadas'}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  if (selected.size === 0) return;
                  hapMedium();
                  onConfirm(Array.from(selected));
                }}
                hitSlop={10}
                disabled={selected.size === 0}
                style={[
                  styles.pickerDoneBtn,
                  selected.size === 0 && { opacity: 0.4 },
                ]}
              >
                <Text style={styles.pickerDoneText}>Adicionar</Text>
              </Pressable>
            </View>
            {availableSongs.length === 0 ? (
              <View style={styles.historyEmpty}>
                <Ionicons
                  name="musical-notes-outline"
                  size={40}
                  color={theme.textDim}
                  style={{ marginBottom: spacing.sm }}
                />
                <Text style={styles.historyEmptyText}>
                  Todas as suas músicas já{'\n'}estão nessa playlist.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.searchBar}>
                  <Ionicons
                    name="search"
                    size={16}
                    color={theme.textMuted}
                    style={{ marginRight: spacing.sm }}
                  />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Buscar música ou artista"
                    placeholderTextColor={theme.textMuted}
                    style={styles.searchInput}
                    returnKeyType="search"
                  />
                  {query.length > 0 && (
                    <Pressable
                      hitSlop={10}
                      onPress={() => setQuery('')}
                      style={styles.searchClear}
                    >
                      <Ionicons
                        name="close-circle"
                        size={16}
                        color={theme.textMuted}
                      />
                    </Pressable>
                  )}
                </View>
                <FlatList
                  data={filtered}
                  keyExtractor={(f) => f.id}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  renderItem={({ item }) => (
                    <SongRow
                      item={item}
                      active={false}
                      selectionMode
                      selected={selected.has(item.id)}
                      onPress={() => toggle(item.id)}
                    />
                  )}
                />
              </>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SettingsSheet({
  visible,
  crossfadeEnabled,
  crossfadeSeconds,
  onClose,
  onToggleCrossfade,
  onChangeCrossfadeSeconds,
}: {
  visible: boolean;
  crossfadeEnabled: boolean;
  crossfadeSeconds: number;
  onClose: () => void;
  onToggleCrossfade: (v: boolean) => void;
  onChangeCrossfadeSeconds: (n: number) => void;
}) {
  const presets = [3, 6, 9, 12];
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
          <Text style={styles.sheetTitle}>Ajustes</Text>
          <Text style={styles.sheetSub}>Personalize a reprodução</Text>

          <View style={styles.settingsBlock}>
            <View style={styles.settingsRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingsLabel}>Crossfade</Text>
                <Text style={styles.settingsHint}>
                  Mistura o fim de uma música com o começo da próxima
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  hapLight();
                  onToggleCrossfade(!crossfadeEnabled);
                }}
                style={[
                  styles.settingsToggle,
                  crossfadeEnabled && styles.settingsToggleOn,
                ]}
              >
                <View
                  style={[
                    styles.settingsToggleKnob,
                    crossfadeEnabled && styles.settingsToggleKnobOn,
                  ]}
                />
              </Pressable>
            </View>

            {crossfadeEnabled ? (
              <View style={styles.settingsSubRow}>
                <Text style={styles.settingsHint}>
                  Duração: {crossfadeSeconds}s
                </Text>
                <View style={styles.presetRow}>
                  {presets.map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => {
                        hapSelect();
                        onChangeCrossfadeSeconds(s);
                      }}
                      style={[
                        styles.presetBtn,
                        crossfadeSeconds === s && styles.presetBtnActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.presetText,
                          crossfadeSeconds === s && styles.presetTextActive,
                        ]}
                      >
                        {s}s
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function HistorySheet({
  visible,
  history,
  onClose,
  onDelete,
}: {
  visible: boolean;
  history: WorkoutEntry[];
  onClose: () => void;
  onDelete: (id: string) => void;
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
          <Text style={styles.sheetTitle}>Histórico de treinos</Text>
          <Text style={styles.sheetSub}>
            {history.length}{' '}
            {history.length === 1 ? 'treino registrado' : 'treinos registrados'}
          </Text>
          {history.length === 0 ? (
            <View style={styles.historyEmpty}>
              <Ionicons
                name="walk-outline"
                size={40}
                color={theme.textDim}
                style={{ marginBottom: spacing.sm }}
              />
              <Text style={styles.historyEmptyText}>
                Nenhum treino ainda.{'\n'}Comece agora!
              </Text>
            </View>
          ) : (
            <FlatList
              data={history}
              keyExtractor={(e) => e.id}
              style={{ maxHeight: 480 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <View style={styles.historyRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyDate}>
                      {fmtWorkoutDate(item.startTime)}{' '}
                      <Text style={styles.historyTime}>
                        · {fmtWorkoutTime(item.startTime)}
                      </Text>
                    </Text>
                    <View style={styles.historyStats}>
                      <Text style={styles.historyStatVal}>
                        {fmtKm(item.distanceM)}
                      </Text>
                      <Text style={styles.historyStatUnit}>km</Text>
                      <View style={styles.historyDot} />
                      <Text style={styles.historyStatVal}>
                        {fmtPace(item.paceSecPerKm)}
                      </Text>
                      <Text style={styles.historyStatUnit}>/km</Text>
                      <View style={styles.historyDot} />
                      <Text style={styles.historyStatVal}>
                        {fmtWorkoutDuration(item.startTime, item.endTime)}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    hitSlop={10}
                    onPress={() => onDelete(item.id)}
                    style={styles.historyDeleteBtn}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={theme.textMuted}
                    />
                  </Pressable>
                </View>
              )}
              ItemSeparatorComponent={() => (
                <View style={styles.historyDivider} />
              )}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function NpProgressBar({
  visible,
  onSeek,
}: {
  visible: boolean;
  onSeek: (pos: number) => void;
}) {
  const prog = useAudioProgress(visible ? 300 : 2000);
  const position = prog.position;
  const duration = prog.duration;

  const [barW, setBarW] = useState(SCREEN_W - spacing.xxl * 2);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubDisplay, setScrubDisplay] = useState(0);

  const progressX = useSharedValue(0);
  const isScrubbingSv = useSharedValue(false);
  const barWRef = useRef(barW);
  const durationRef = useRef(duration);

  useEffect(() => {
    barWRef.current = barW;
  }, [barW]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    if (scrubbing) return;
    if (duration > 0 && barW > 0) {
      progressX.value = Math.max(
        0,
        Math.min(barW, (position / duration) * barW)
      );
    }
  }, [position, duration, barW, scrubbing, progressX]);

  const fillStyle = useAnimatedStyle(() => ({
    width: progressX.value,
  }));

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progressX.value - (isScrubbingSv.value ? 8 : 5) }],
    width: isScrubbingSv.value ? 16 : 10,
    height: isScrubbingSv.value ? 16 : 10,
    borderRadius: isScrubbingSv.value ? 8 : 5,
    top: isScrubbingSv.value ? -6.5 : -3.5,
  }));

  const updateScrubDisplay = useCallback((x: number) => {
    if (durationRef.current <= 0 || barWRef.current <= 0) return;
    const p = (x / barWRef.current) * durationRef.current;
    setScrubDisplay(p);
  }, []);

  const beginScrub = useCallback(() => {
    hapSelect();
    setScrubbing(true);
  }, []);

  const endScrub = useCallback(
    (x: number) => {
      if (durationRef.current <= 0 || barWRef.current <= 0) {
        setScrubbing(false);
        return;
      }
      const p = (x / barWRef.current) * durationRef.current;
      onSeek(p);
      setTimeout(() => setScrubbing(false), 300);
    },
    [onSeek]
  );

  const pan = Gesture.Pan()
    .minDistance(0)
    .activeOffsetX([-1, 1])
    .onBegin((e) => {
      isScrubbingSv.value = true;
      const x = Math.max(0, Math.min(barWRef.current, e.x));
      progressX.value = x;
      runOnJS(beginScrub)();
      runOnJS(updateScrubDisplay)(x);
    })
    .onUpdate((e) => {
      const x = Math.max(0, Math.min(barWRef.current, e.x));
      progressX.value = x;
      runOnJS(updateScrubDisplay)(x);
    })
    .onEnd((e) => {
      const x = Math.max(0, Math.min(barWRef.current, e.x));
      isScrubbingSv.value = false;
      runOnJS(endScrub)(x);
    })
    .onFinalize(() => {
      isScrubbingSv.value = false;
    });

  const tap = Gesture.Tap().onEnd((e) => {
    const x = Math.max(0, Math.min(barWRef.current, e.x));
    progressX.value = x;
    isScrubbingSv.value = false;
    runOnJS(hapSelect)();
    runOnJS(endScrub)(x);
  });

  const gesture = Gesture.Exclusive(pan, tap);

  const timeDisplay = scrubbing ? scrubDisplay : position;

  return (
    <View style={styles.npProgressWrap}>
      <GestureDetector gesture={gesture}>
        <View
          style={styles.npProgressHit}
          onLayout={(e) => setBarW(e.nativeEvent.layout.width)}
        >
          <View style={styles.npProgressBg}>
            <Animated.View style={[styles.npProgressFillAnim, fillStyle]} />
            <Animated.View style={[styles.npProgressDotAnim, dotStyle]} />
          </View>
        </View>
      </GestureDetector>
      <View style={styles.npTimeRow}>
        <Text style={styles.npTime}>{fmt(timeDisplay)}</Text>
        <Text style={styles.npTime}>
          -{fmt(Math.max(0, duration - timeDisplay))}
        </Text>
      </View>
    </View>
  );
}

function NowPlaying({
  visible,
  onClose,
  current,
  palette,
  playing,
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
  shuffleOn: boolean;
  repeatMode: RepeatModeValue;
  liked: boolean;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onSeek: (pos: number) => void;
  onToggleLike: () => void;
}) {

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

          <NpProgressBar visible={visible} onSeek={onSeek} />

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
  const [workoutStartedAt, setWorkoutStartedAt] = useState<number | null>(null);
  const [workoutHistory, setWorkoutHistory] = useState<WorkoutEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatModeValue>(RepeatMode.Queue);
  const [groupByArtist, setGroupByArtist] = useState(false);
  const [expandedArtists, setExpandedArtists] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [addSongsToPlaylistId, setAddSongsToPlaylistId] = useState<string | null>(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState<string[]>([]);
  const [playlistCovers, setPlaylistCovers] = useState<Record<string, string>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [crossfadeEnabled, setCrossfadeEnabled] = useState(true);
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(6);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const didSetupRef = useRef(false);
  const lastSavedRef = useRef<{ id: string; pos: number } | null>(null);
  const filesByIdRef = useRef<Map<string, Enriched>>(new Map());
  const metaCacheRef = useRef<Record<string, Metadata>>({});
  const cacheSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoPausedRef = useRef(false);
  const playingRef = useRef(false);
  const workoutActiveRef = useRef(false);
  const fadeOutStartedRef = useRef(false);
  const awaitingTrackProgressRef = useRef(false);

  const progress = useAudioProgress(500);

  const persistPlaylists = useCallback((next: Playlist[]) => {
    setPlaylists(next);
    savePlaylists(next).catch(() => {});
  }, []);

  const toggleGroupByArtist = useCallback(() => {
    hapLight();
    setTab('songs');
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
      const newOnes = list.filter((f) => !existing.get(f.id)?.meta);
      if (newOnes.length > 0) {
        enrich(newOnes);
      }
    } finally {
      setRefreshing(false);
    }
  }, [enrich]);

  const scheduleCacheSave = useCallback(() => {
    if (cacheSaveTimerRef.current) clearTimeout(cacheSaveTimerRef.current);
    cacheSaveTimerRef.current = setTimeout(() => {
      saveMetaCache(metaCacheRef.current).catch(() => {});
    }, 1500);
  }, []);

  const enrich = useCallback(
    async (list: Mp3[]) => {
      for (const file of list) {
        if (metaCacheRef.current[file.id]) continue;
        try {
          const meta = await readId3(file.uri, file.id);
          metaCacheRef.current[file.id] = meta;
          scheduleCacheSave();
          setFiles((prev) =>
            prev.map((f) => (f.id === file.id ? { ...f, meta } : f))
          );
          filesByIdRef.current.set(file.id, { ...file, meta });
          const queue = await AudioPlayer.getQueue();
          const idx = queue.findIndex((t) => t.id === file.id);
          if (idx >= 0) {
            AudioPlayer.updateMetadataForTrackIndex(idx, {
              title: meta.title || file.name,
              artist: meta.artist || 'Desconhecido',
              artwork: meta.artworkUri,
            });
          }
        } catch {}
      }
    },
    [scheduleCacheSave]
  );

  const buildQueue = useCallback(
    async (list: Enriched[], startIndex: number) => {
      resetVolumeState();
      await AudioPlayer.setQueue(toTracks(list), startIndex);
    },
    []
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listMp3s();
      filesByIdRef.current = new Map(list.map((f) => [f.id, f]));
      setFiles(list);
      resetVolumeState();
      await AudioPlayer.setQueue(toTracks(list), 0);
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
      const cache = await loadMetaCache();
      let cacheDirty = false;
      for (const id of Object.keys(cache)) {
        const uri = cache[id]?.artworkUri;
        if (!uri) continue;
        try {
          const info = await FileSystem.getInfoAsync(uri);
          if (!info.exists) {
            delete cache[id];
            cacheDirty = true;
          }
        } catch {
          delete cache[id];
          cacheDirty = true;
        }
      }
      metaCacheRef.current = cache;
      if (cacheDirty) saveMetaCache(cache).catch(() => {});
      const list = await listMp3s();
      const enriched: Enriched[] = list.map((f) =>
        cache[f.id] ? { ...f, meta: cache[f.id] } : f
      );
      filesByIdRef.current = new Map(enriched.map((f) => [f.id, f]));
      setFiles(enriched);
      const pls = await loadPlaylists();
      setPlaylists(pls);
      const covers: Record<string, string> = {};
      for (const pl of pls) {
        const songsWithArt = pl.trackIds
          .map((id) => filesByIdRef.current.get(id))
          .filter((f): f is Enriched => !!f?.meta?.artworkUri);
        if (songsWithArt.length === 0) continue;
        const pick =
          songsWithArt[Math.floor(Math.random() * songsWithArt.length)];
        if (pick.meta?.artworkUri) covers[pl.id] = pick.meta.artworkUri;
      }
      setPlaylistCovers(covers);
      const grouped = await loadGroupByArtist();
      setGroupByArtist(grouped);
      const hist = await loadWorkouts();
      setWorkoutHistory(hist);
      const recent = await loadRecentlyPlayed();
      setRecentlyPlayed(recent);
      const cfEnabled = await loadCrossfadeEnabled();
      setCrossfadeEnabled(cfEnabled);
      const cfSec = await loadCrossfadeSeconds();
      setCrossfadeSeconds(cfSec);
      if (enriched.length > 0) {
        await AudioPlayer.setQueue(toTracks(enriched), 0);
        const resume = await loadResume();
        if (resume) {
          const idx = enriched.findIndex((f) => f.id === resume.trackId);
          if (idx >= 0) {
            try {
              await AudioPlayer.skip(idx);
              if (resume.position > 2) await AudioPlayer.seekTo(resume.position);
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

  const sortedFiles = useMemo(() => {
    if (recentlyPlayed.length === 0) return files;
    const recentSet = new Set(recentlyPlayed);
    const inRecent: Enriched[] = [];
    for (const id of recentlyPlayed) {
      const f = files.find((x) => x.id === id);
      if (f) inRecent.push(f);
    }
    const rest = files.filter((f) => !recentSet.has(f.id));
    return [...inRecent, ...rest];
  }, [files, recentlyPlayed]);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedFiles;
    return sortedFiles.filter((f) => {
      const title = (f.meta?.title || f.name).toLowerCase();
      const artist = (f.meta?.artist || '').toLowerCase();
      return title.includes(q) || artist.includes(q);
    });
  }, [sortedFiles, searchQuery]);

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
    if (!crossfadeEnabled) return;
    if (!playing || !progress.duration || !currentId) return;
    const remaining = progress.duration - progress.position;
    // A track-change event reaches React before the next native progress
    // sample.  Do not use the previous track's final position to start yet
    // another crossfade on the new track.
    if (awaitingTrackProgressRef.current) {
      if (remaining > crossfadeSeconds + 0.3) {
        awaitingTrackProgressRef.current = false;
        fadeOutStartedRef.current = false;
      }
      return;
    }
    if (remaining <= 0 || remaining > crossfadeSeconds + 0.3) return;
    if (fadeOutStartedRef.current) return;
    fadeOutStartedRef.current = true;
    AudioPlayer.startCrossfade(crossfadeSeconds).catch(() => {});
  }, [progress.position, progress.duration, playing, currentId, crossfadeEnabled, crossfadeSeconds]);


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
        AudioPlayer.pause().catch(() => {});
        autoPausedRef.current = true;
      }
    } else {
      if (autoPausedRef.current && !playingRef.current) {
        AudioPlayer.play().catch(() => {});
        autoPausedRef.current = false;
      }
    }
  }, []);

  useAudioEvents(
    useCallback(
      (ev: AudioEvent) => {
        if (ev.type === 'stateChanged') {
          setPlaying(ev.isPlaying);
        }
        if (ev.type === 'trackChanged') {
          // Wait for progress from the newly active native node before
          // considering another crossfade.  The current React value can still
          // describe the song that just ended.
          fadeOutStartedRef.current = true;
          awaitingTrackProgressRef.current = true;
          const id = ev.trackId;
          setCurrentId(id);
          setRecentlyPlayed((prev) => {
            const next = pushRecentlyPlayed(prev, id);
            saveRecentlyPlayed(next).catch(() => {});
            return next;
          });
          const file = filesByIdRef.current.get(id);
          const gain = file?.meta?.gainDb;
          if (ev.isCrossfade) {
            // The native player already handed off the next node at its live
            // playback position and volume.  A normal fade-in here would
            // restart the perceived volume from zero.
          } else if (ev.index !== ev.lastIndex && ev.lastIndex >= 0) {
            fadeInForTrack(gain).catch(() => {});
          } else {
            setTargetVolume(gain).catch(() => {});
          }
          if (file) {
            AudioPlayer.setNowPlayingMetadata(
              file.meta?.title || file.name,
              file.meta?.artist || 'Desconhecido',
              file.meta?.artworkUri ?? null,
              file.meta?.durationSec ?? 0
            );
          }
        }
      },
      []
    )
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
    await AudioPlayer.play();
  };

  const togglePlay = async () => {
    autoPausedRef.current = false;
    if (!currentId && files.length > 0) {
      await playFromContext({ kind: 'library' }, files[0].id);
      return;
    }
    if (playing) {
      await AudioPlayer.cancelCrossfade();
      await AudioPlayer.pause();
    } else {
      fadeOutStartedRef.current = false;
      setTargetVolume(current?.meta?.gainDb).catch(() => {});
      await AudioPlayer.play();
    }
  };

  const next = async () => {
    try {
      await AudioPlayer.cancelCrossfade();
      fadeOutStartedRef.current = false;
      await AudioPlayer.skipToNext();
      await AudioPlayer.play();
    } catch {}
  };

  const prev = async () => {
    try {
      await AudioPlayer.cancelCrossfade();
      fadeOutStartedRef.current = false;
      await AudioPlayer.skipToPrevious();
      await AudioPlayer.play();
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
      if (playingRef.current) await AudioPlayer.play();
      return;
    }
    const shuffled = [...list];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setShuffleOn(true);
    await buildQueue(shuffled, 0);
    await AudioPlayer.play();
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
      await AudioPlayer.setRepeatMode(nextMode);
      setRepeatMode(nextMode);
    } catch {}
  };

  const seek = async (pos: number) => {
    try {
      // The native seek cancels any active crossfade.  Allow the transition to
      // be scheduled again later if the user seeks back near the end.
      fadeOutStartedRef.current = false;
      await AudioPlayer.seekTo(pos);
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
            'Isso remove só a playlist. Suas músicas continuam na biblioteca.',
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

  const deleteSongFile = async (song: Enriched) => {
    try {
      const isCurrent = currentId === song.id;
      try {
        await FileSystem.deleteAsync(song.uri, { idempotent: true });
      } catch {}
      delete metaCacheRef.current[song.id];
      scheduleCacheSave();
      const nextPlaylists = playlists.map((p) => removeTrack(p, song.id));
      persistPlaylists(nextPlaylists);
      const nextFiles = files.filter((f) => f.id !== song.id);
      filesByIdRef.current.delete(song.id);
      setFiles(nextFiles);
      try {
        const queue = await AudioPlayer.getQueue();
        const idxInQueue = queue.findIndex((t) => String(t.id) === song.id);
        if (idxInQueue >= 0) {
          await AudioPlayer.removeTracks([idxInQueue]);
        }
      } catch {}
      if (isCurrent) {
        setCurrentId(null);
        setPlaying(false);
      }
    } catch {}
  };

  const enterSelectionMode = (initialId?: string) => {
    hapMedium();
    setTab('songs');
    setSelectionMode(true);
    setSelectedIds(initialId ? new Set([initialId]) : new Set());
  };

  const cancelSelection = () => {
    hapLight();
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id: string) => {
    hapSelect();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteMultipleSongs = async (ids: string[]) => {
    try {
      const idSet = new Set(ids);
      const currentWillBeDeleted = !!(currentId && idSet.has(currentId));
      for (const f of files) {
        if (!idSet.has(f.id)) continue;
        try {
          await FileSystem.deleteAsync(f.uri, { idempotent: true });
        } catch {}
        delete metaCacheRef.current[f.id];
      }
      scheduleCacheSave();
      const nextPlaylists = playlists.map((p) => ({
        ...p,
        trackIds: p.trackIds.filter((tid) => !idSet.has(tid)),
      }));
      persistPlaylists(nextPlaylists);
      const nextFiles = files.filter((f) => !idSet.has(f.id));
      filesByIdRef.current = new Map(nextFiles.map((f) => [f.id, f]));
      setFiles(nextFiles);
      try {
        const queue = await AudioPlayer.getQueue();
        const toRemove: number[] = [];
        queue.forEach((t, i) => {
          if (idSet.has(String(t.id))) toRemove.push(i);
        });
        if (toRemove.length > 0) {
          await AudioPlayer.removeTracks(toRemove);
        }
      } catch {}
      if (currentWillBeDeleted) {
        setCurrentId(null);
        setPlaying(false);
      }
    } catch {}
  };

  const bulkAddToPlaylist = (playlistId: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const next = playlists.map((p) => {
      if (p.id !== playlistId) return p;
      const existing = new Set(p.trackIds);
      const additions = ids.filter((id) => !existing.has(id));
      return { ...p, trackIds: [...p.trackIds, ...additions] };
    });
    persistPlaylists(next);
    setBulkAddOpen(false);
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const bulkCreatePlaylistAndAdd = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    Alert.prompt(
      'Nova playlist',
      'Como quer chamar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Criar',
          onPress: (name) => {
            const pl = newPlaylist(name || '');
            const withTracks = { ...pl, trackIds: ids };
            persistPlaylists([...playlists, withTracks]);
            setBulkAddOpen(false);
            setSelectionMode(false);
            setSelectedIds(new Set());
          },
        },
      ],
      'plain-text',
      ''
    );
  };

  const confirmBulkDelete = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    Alert.alert(
      `Excluir ${ids.length} ${ids.length === 1 ? 'música' : 'músicas'}?`,
      'Os arquivos serão removidos da pasta do app e das playlists. Essa ação não pode ser desfeita.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            await deleteMultipleSongs(ids);
            setSelectionMode(false);
            setSelectedIds(new Set());
          },
        },
      ]
    );
  };

  const confirmDeleteSong = (song: Enriched) => {
    const title = song.meta?.title || song.name;
    Alert.alert(
      'Excluir música?',
      `"${title}" será removida da pasta do app e de todas as playlists. Essa ação não pode ser desfeita.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: () => deleteSongFile(song),
        },
      ]
    );
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
        text: 'Adicionar à outra playlist',
        onPress: () => openAddToPlaylist(song),
      });
      options.push({
        text: 'Remover da playlist',
        style: 'destructive',
        onPress: () => removeFromPlaylist(inPlaylistId, song.id),
      });
    } else {
      options.push({
        text: 'Adicionar à playlist',
        onPress: () => openAddToPlaylist(song),
      });
      options.push({
        text: 'Selecionar várias',
        onPress: () => enterSelectionMode(song.id),
      });
    }
    options.push({
      text: 'Excluir da pasta',
      style: 'destructive',
      onPress: () => confirmDeleteSong(song),
    });
    options.push({ text: 'Cancelar', style: 'cancel' });
    Alert.alert(song.meta?.title || song.name, undefined, options);
  };

  const handleStartWorkout = async () => {
    hapMedium();
    await requestHeartRateAuth();
    const okGps = await startWorkout(setWorkoutStats);
    if (!okGps) {
      Alert.alert(
        'Localização negada',
        'Para medir distância e ritmo o app precisa de acesso à localização.'
      );
      return;
    }
    await startAutoPause(handleMotionChange);
    setWorkoutStartedAt(Date.now());
    setWorkoutActive(true);
  };

  const handleStopWorkout = async () => {
    Alert.alert('Encerrar treino?', undefined, [
      { text: 'Continuar', style: 'cancel' },
      {
        text: 'Encerrar',
        style: 'destructive',
        onPress: async () => {
          hapMedium();
          announceWorkoutEnd();
          const stats = workoutStats;
          const start = workoutStartedAt;
          stopWorkout(setWorkoutStats);
          stopAutoPause(handleMotionChange);
          setWorkoutStats(null);
          setWorkoutActive(false);
          setWorkoutStartedAt(null);
          autoPausedRef.current = false;
          if (start && stats && stats.distanceM >= 10) {
            try {
              const list = await addWorkout({
                startTime: start,
                endTime: Date.now(),
                distanceM: stats.distanceM,
                paceSecPerKm: stats.paceSecPerKm,
              });
              setWorkoutHistory(list);
            } catch {}
          }
        },
      },
    ]);
  };

  const handleDeleteWorkout = (id: string) => {
    Alert.alert('Apagar treino?', 'Essa ação não pode ser desfeita.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: async () => {
          hapMedium();
          const next = await deleteWorkout(id);
          setWorkoutHistory(next);
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
          <Text style={styles.emptyTitle}>Nenhuma música ainda</Text>
          <Text style={styles.emptyHelp}>
            Abra o app Arquivos no iPhone, vá em{'\n'}
            <Text style={styles.emptyHelpBold}>No meu iPhone › Run Player</Text>
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
                  {viewingPlaylistSongs.length === 1 ? 'música' : 'músicas'}
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
                  setAddSongsToPlaylistId(viewingPlaylist.id);
                }}
                style={styles.headerIconBtn}
              >
                <Ionicons name="add" size={22} color={theme.text} />
              </Pressable>
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
                  Volte na aba Músicas, segure uma música{'\n'}e adicione a esta
                  playlist.
                </Text>
              </View>
            ) : (
              <DraggableFlatList
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
                onDragEnd={({ data }) => {
                  const newOrder = data.map((f) => f.id);
                  const next = playlists.map((p) =>
                    p.id === viewingPlaylist.id
                      ? { ...p, trackIds: newOrder }
                      : p
                  );
                  persistPlaylists(next);
                  hapSelect();
                }}
                renderItem={({
                  item,
                  drag,
                  isActive,
                }: RenderItemParams<Enriched>) => (
                  <ScaleDecorator>
                    <SongRow
                      item={item}
                      active={item.id === currentId}
                      onPress={() =>
                        playFromContext(
                          { kind: 'playlist', id: viewingPlaylist.id },
                          item.id
                        )
                      }
                      onLongPress={() => {
                        hapMedium();
                        drag();
                      }}
                      onMenu={() => openSongMenu(item, viewingPlaylist.id)}
                    />
                  </ScaleDecorator>
                )}
              />
            )}
          </>
        ) : (
          <>
            {selectionMode ? (
              <View style={styles.selectionBar}>
                <Pressable
                  hitSlop={10}
                  onPress={cancelSelection}
                  style={styles.selectionCancelBtn}
                >
                  <Text style={styles.selectionCancelText}>Cancelar</Text>
                </Pressable>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={styles.selectionCountText}>
                    {selectedIds.size}{' '}
                    {selectedIds.size === 1
                      ? 'selecionada'
                      : 'selecionadas'}
                  </Text>
                </View>
                <Pressable
                  hitSlop={10}
                  onPress={() => {
                    if (selectedIds.size === 0) return;
                    hapLight();
                    setBulkAddOpen(true);
                  }}
                  disabled={selectedIds.size === 0}
                  style={[
                    styles.selectionDeleteBtn,
                    { marginRight: spacing.sm },
                    selectedIds.size === 0 && { opacity: 0.4 },
                  ]}
                >
                  <Ionicons
                    name="add"
                    size={22}
                    color={theme.accent}
                  />
                </Pressable>
                <Pressable
                  hitSlop={10}
                  onPress={confirmBulkDelete}
                  disabled={selectedIds.size === 0}
                  style={[
                    styles.selectionDeleteBtn,
                    selectedIds.size === 0 && { opacity: 0.4 },
                  ]}
                >
                  <Ionicons
                    name="trash-outline"
                    size={20}
                    color={theme.accent}
                  />
                </Pressable>
              </View>
            ) : (
              <>
                <View style={styles.topRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.topKicker}>Biblioteca</Text>
                    <Text style={styles.topTitle}>Suas músicas</Text>
                  </View>
                  <Pressable
                    hitSlop={10}
                    onPress={() => {
                      hapLight();
                      setSearchOpen((prev) => {
                        if (prev) setSearchQuery('');
                        return !prev;
                      });
                    }}
                    style={[
                      styles.subtleIconBtn,
                      searchOpen && styles.subtleIconBtnActive,
                    ]}
                  >
                    <Ionicons
                      name="search-outline"
                      size={18}
                      color={searchOpen ? theme.accent : theme.textSoft}
                    />
                  </Pressable>
                  <Pressable
                    hitSlop={10}
                    onPress={() => {
                      hapLight();
                      setHistoryOpen(true);
                    }}
                    style={styles.subtleIconBtn}
                  >
                    <Ionicons
                      name="time-outline"
                      size={18}
                      color={theme.textSoft}
                    />
                  </Pressable>
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
                  <Pressable
                    hitSlop={10}
                    onPress={() => {
                      hapLight();
                      setSettingsOpen(true);
                    }}
                    style={styles.subtleIconBtn}
                  >
                    <Ionicons
                      name="settings-outline"
                      size={18}
                      color={theme.textSoft}
                    />
                  </Pressable>
                </View>
                {searchOpen && (
                  <View style={styles.searchBarWrap}>
                    <View style={styles.searchBar}>
                      <Ionicons
                        name="search"
                        size={16}
                        color={theme.textMuted}
                        style={{ marginRight: spacing.sm }}
                      />
                      <TextInput
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder="Buscar música ou artista"
                        placeholderTextColor={theme.textMuted}
                        style={styles.searchInput}
                        autoFocus
                        returnKeyType="search"
                      />
                      {searchQuery.length > 0 && (
                        <Pressable
                          hitSlop={10}
                          onPress={() => setSearchQuery('')}
                          style={styles.searchClear}
                        >
                          <Ionicons
                            name="close-circle"
                            size={16}
                            color={theme.textMuted}
                          />
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
              </>
            )}

            <View style={styles.toolRow}>
              {workoutActive && workoutStats ? (
                <Pressable
                  style={[styles.workoutChipPill, { flex: 1 }]}
                  onPress={handleStopWorkout}
                >
                  <View style={styles.workoutLive} />
                  <Text style={styles.workoutChipText} numberOfLines={1}>
                    <Text style={styles.workoutChipNum}>
                      {fmtKm(workoutStats.distanceM)}
                    </Text>
                    <Text style={styles.workoutChipUnit}> km</Text>
                    <Text style={styles.workoutChipSep}>  ·  </Text>
                    {workoutStats.distanceM < 100 ? (
                      <Text style={styles.workoutChipWarm}>aquecendo</Text>
                    ) : (
                      <>
                        <Text style={styles.workoutChipNum}>
                          {fmtPace(workoutStats.paceSecPerKm)}
                        </Text>
                        <Text style={styles.workoutChipUnit}> /km</Text>
                      </>
                    )}
                  </Text>
                  <Ionicons
                    name="close"
                    size={14}
                    color={theme.accent}
                    style={{ marginLeft: spacing.sm }}
                  />
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.workoutStartPill, { flex: 1 }]}
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
              )}
            </View>

            <SegmentedTabs tab={tab} onChange={setTab} />

            {tab === 'songs' ? (
              groupByArtist && !selectionMode ? (
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
                  data={filteredFiles}
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
                      selectionMode={selectionMode}
                      selected={selectedIds.has(item.id)}
                      onPress={() => {
                        if (selectionMode) toggleSelected(item.id);
                        else playFromContext({ kind: 'library' }, item.id);
                      }}
                      onLongPress={() => {
                        if (!selectionMode) enterSelectionMode(item.id);
                      }}
                      onMenu={() => openSongMenu(item)}
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
                      Toque em "Criar nova playlist" ou{'\n'}segure uma música
                      na aba Músicas.
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
                        coverUri={playlistCovers[item.id]}
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
        liked={currentIsLiked}
        onToggle={togglePlay}
        onNext={next}
        onPrev={prev}
        onOpen={() => {
          hapLight();
          setNowPlayingOpen(true);
        }}
        onToggleLike={handleToggleLike}
        onSeek={seek}
      />

      <NowPlaying
        visible={nowPlayingOpen}
        onClose={() => setNowPlayingOpen(false)}
        current={current}
        palette={palette}
        playing={playing}
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

      <AddSongsSheet
        visible={!!addSongsToPlaylistId}
        playlistName={
          playlists.find((p) => p.id === addSongsToPlaylistId)?.name ?? ''
        }
        availableSongs={(() => {
          if (!addSongsToPlaylistId) return [];
          const pl = playlists.find((p) => p.id === addSongsToPlaylistId);
          if (!pl) return [];
          const inPl = new Set(pl.trackIds);
          return files.filter((f) => !inPl.has(f.id));
        })()}
        onClose={() => setAddSongsToPlaylistId(null)}
        onConfirm={(ids) => {
          if (!addSongsToPlaylistId) return;
          const next = playlists.map((p) => {
            if (p.id !== addSongsToPlaylistId) return p;
            const existing = new Set(p.trackIds);
            const additions = ids.filter((id) => !existing.has(id));
            return { ...p, trackIds: [...p.trackIds, ...additions] };
          });
          persistPlaylists(next);
          setAddSongsToPlaylistId(null);
        }}
      />

      <AddToPlaylistSheet
        visible={!!addTarget || bulkAddOpen}
        track={addTarget ?? undefined}
        subtitleOverride={
          bulkAddOpen
            ? `${selectedIds.size} ${
                selectedIds.size === 1 ? 'música selecionada' : 'músicas selecionadas'
              }`
            : undefined
        }
        playlists={playlists}
        onClose={() => {
          setAddTarget(null);
          setBulkAddOpen(false);
        }}
        onAdd={bulkAddOpen ? bulkAddToPlaylist : addSongToPlaylist}
        onCreateAndAdd={
          bulkAddOpen ? bulkCreatePlaylistAndAdd : createPlaylistAndAdd
        }
      />

      <HistorySheet
        visible={historyOpen}
        history={workoutHistory}
        onClose={() => setHistoryOpen(false)}
        onDelete={handleDeleteWorkout}
      />

      <SettingsSheet
        visible={settingsOpen}
        crossfadeEnabled={crossfadeEnabled}
        crossfadeSeconds={crossfadeSeconds}
        onClose={() => setSettingsOpen(false)}
        onToggleCrossfade={(v) => {
          setCrossfadeEnabled(v);
          saveCrossfadeEnabled(v).catch(() => {});
          if (!v) AudioPlayer.cancelCrossfade().catch(() => {});
        }}
        onChangeCrossfadeSeconds={(n) => {
          setCrossfadeSeconds(n);
          saveCrossfadeSeconds(n).catch(() => {});
        }}
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

  // Search bar
  searchBarWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    color: theme.text,
    fontFamily: ff,
    fontSize: font.body,
    padding: 0,
    margin: 0,
  },
  searchClear: {
    marginLeft: spacing.sm,
    padding: 2,
  },

  // Selection mode bar
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  selectionCancelBtn: {
    paddingVertical: 6,
    paddingRight: spacing.sm,
  },
  selectionCancelText: {
    color: theme.textSoft,
    fontFamily: ff,
    fontSize: font.button,
    fontWeight: weight.medium,
  },
  selectionCountText: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.callout,
    fontWeight: weight.semibold,
    letterSpacing: -0.1,
  },
  selectionDeleteBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCheckbox: {
    width: 32,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },

  // Add songs picker sheet
  pickerSheet: {
    backgroundColor: theme.bgElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    flexShrink: 1,
    minHeight: 300,
    maxHeight: '90%',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.md,
  },
  pickerCancelBtn: {
    paddingVertical: 6,
    paddingRight: spacing.sm,
  },
  pickerCancelText: {
    color: theme.textSoft,
    fontFamily: ff,
    fontSize: font.button,
    fontWeight: weight.medium,
  },
  pickerTitle: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.callout,
    fontWeight: weight.semibold,
    letterSpacing: -0.1,
  },
  pickerSub: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.caption,
    marginTop: 1,
  },
  pickerDoneBtn: {
    paddingVertical: 6,
    paddingLeft: spacing.sm,
  },
  pickerDoneText: {
    color: theme.accent,
    fontFamily: ff,
    fontSize: font.button,
    fontWeight: weight.semibold,
  },

  // Settings sheet
  settingsBlock: {
    marginTop: spacing.sm,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  settingsLabel: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.callout,
    fontWeight: weight.semibold,
    letterSpacing: -0.1,
  },
  settingsHint: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.small,
    marginTop: 2,
  },
  settingsToggle: {
    width: 52,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.surfaceHigh,
    padding: 2,
    justifyContent: 'center',
  },
  settingsToggleOn: {
    backgroundColor: theme.accent,
  },
  settingsToggleKnob: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.text,
  },
  settingsToggleKnobOn: {
    alignSelf: 'flex-end',
  },
  settingsSubRow: {
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.divider,
  },
  presetRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  presetBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: theme.surfaceHigh,
    alignItems: 'center',
  },
  presetBtnActive: {
    backgroundColor: theme.accentSoft,
  },
  presetText: {
    color: theme.textSoft,
    fontFamily: ff,
    fontSize: font.button,
    fontWeight: weight.semibold,
  },
  presetTextActive: {
    color: theme.accent,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  workoutStartPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accentSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.full,
  },
  historyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceOverlay,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
  },
  historyPillText: {
    color: theme.textSoft,
    fontFamily: ff,
    fontSize: font.button,
    fontWeight: weight.semibold,
    letterSpacing: 0.1,
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
  workoutChipPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.accentSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.full,
  },
  workoutLive: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.accent,
    marginRight: spacing.sm,
  },
  workoutChipText: {
    flex: 1,
    color: theme.accent,
    fontFamily: ff,
    fontSize: font.button,
    fontWeight: weight.semibold,
    letterSpacing: 0.1,
  },
  workoutChipNum: {
    fontVariant: ['tabular-nums'],
  },
  workoutChipUnit: {
    opacity: 0.7,
    fontWeight: weight.medium,
  },
  workoutChipSep: {
    opacity: 0.5,
  },
  workoutChipWarm: {
    fontStyle: 'italic',
    opacity: 0.75,
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
  plCover: {
    width: 46,
    height: 46,
    borderRadius: radius.sm,
    backgroundColor: theme.surface,
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
  miniProgressHit: {
    paddingVertical: 10,
    marginBottom: 2,
    marginHorizontal: spacing.sm,
  },
  miniProgressBg: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  miniProgressFill: {
    height: '100%',
    backgroundColor: theme.accent,
    borderRadius: 2,
  },
  miniProgressFillAnim: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    height: '100%',
    backgroundColor: theme.accent,
    borderRadius: 2,
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

  // Workout history
  historyEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  historyEmptyText: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.body,
    textAlign: 'center',
    lineHeight: 22,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  historyDate: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.callout,
    fontWeight: weight.semibold,
    letterSpacing: -0.1,
  },
  historyTime: {
    color: theme.textMuted,
    fontWeight: weight.regular,
    fontSize: font.small,
  },
  historyStats: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 4,
    gap: 3,
  },
  historyStatVal: {
    color: theme.text,
    fontFamily: ff,
    fontSize: font.small,
    fontWeight: weight.semibold,
    fontVariant: ['tabular-nums'],
  },
  historyStatUnit: {
    color: theme.textMuted,
    fontFamily: ff,
    fontSize: font.caption,
    fontWeight: weight.medium,
  },
  historyDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: theme.textDim,
    marginHorizontal: 7,
    alignSelf: 'center',
  },
  historyDeleteBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  historyDivider: {
    height: 1,
    backgroundColor: theme.divider,
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
  npProgressDotActive: {
    width: 16,
    height: 16,
    borderRadius: 8,
    top: -6.5,
    marginLeft: -8,
  },
  npProgressFillAnim: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 2,
  },
  npProgressDotAnim: {
    position: 'absolute',
    backgroundColor: theme.text,
    left: 0,
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
