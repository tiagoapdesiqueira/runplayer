import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { getColors } from 'react-native-image-colors';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  State,
  Track,
  useProgress,
  useTrackPlayerEvents,
} from 'react-native-track-player';

import { readId3, Metadata } from './metadata';
import { loadResume, saveResume } from './storage';
import { defaultPalette, Palette, radius, spacing, theme } from './theme';

const DOC_DIR = FileSystem.documentDirectory ?? '';
const { width: SCREEN_W } = Dimensions.get('window');
const ARTWORK_SIZE = Math.min(SCREEN_W - spacing.xl * 2, 360);

type Mp3 = {
  id: string;
  name: string;
  uri: string;
};

type Enriched = Mp3 & { meta?: Metadata };

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
}: {
  uri?: string;
  size: number;
}) {
  const style = {
    width: size,
    height: size,
    borderRadius: size >= 100 ? radius.lg : radius.sm,
    backgroundColor: theme.surface,
  };
  if (!uri) {
    return (
      <View style={[style, styles.artFallback]}>
        <Text style={{ fontSize: size * 0.4, color: theme.textDim }}>♪</Text>
      </View>
    );
  }
  return <Image source={{ uri }} style={style} />;
});

function SongRow({
  item,
  active,
  onPress,
}: {
  item: Enriched;
  active: boolean;
  onPress: () => void;
}) {
  const title = item.meta?.title || item.name;
  const artist = item.meta?.artist;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        active && styles.rowActive,
        pressed && { opacity: 0.6 },
      ]}
    >
      <ArtworkThumb uri={item.meta?.artworkUri} size={52} />
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
    </Pressable>
  );
}

function MiniPlayer({
  current,
  playing,
  progress,
  onToggle,
  onOpen,
}: {
  current?: Enriched;
  playing: boolean;
  progress: number;
  onToggle: () => void;
  onOpen: () => void;
}) {
  if (!current) return null;
  const title = current.meta?.title || current.name;
  const artist = current.meta?.artist;
  return (
    <View style={styles.miniWrap}>
      <View style={styles.miniProgressBg}>
        <View style={[styles.miniProgressFill, { width: `${progress * 100}%` }]} />
      </View>
      <Pressable style={styles.miniRow} onPress={onOpen}>
        <ArtworkThumb uri={current.meta?.artworkUri} size={44} />
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
        <Pressable
          hitSlop={12}
          style={styles.miniBtn}
          onPress={() => {
            hapLight();
            onToggle();
          }}
        >
          <Text style={styles.miniBtnText}>{playing ? '❚❚' : '▶'}</Text>
        </Pressable>
      </Pressable>
    </View>
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
  onToggle,
  onNext,
  onPrev,
  onShuffle,
  onSeek,
}: {
  visible: boolean;
  onClose: () => void;
  current?: Enriched;
  palette: Palette;
  playing: boolean;
  position: number;
  duration: number;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onShuffle: () => void;
  onSeek: (pos: number) => void;
}) {
  const pct = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const barW = SCREEN_W - spacing.xl * 2;
  const scrubRef = useRef<View>(null);

  const handleSeekBar = (locationX: number) => {
    if (duration <= 0) return;
    const clamped = Math.max(0, Math.min(barW, locationX));
    const next = (clamped / barW) * duration;
    hapSelect();
    onSeek(next);
  };

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
        locations={[0, 0.9]}
        style={styles.npContainer}
      >
        <SafeAreaView style={{ flex: 1 }}>
          <View style={styles.npHeader}>
            <Pressable
              hitSlop={16}
              onPress={() => {
                hapLight();
                onClose();
              }}
              style={styles.npHeaderBtn}
            >
              <Text style={styles.npHeaderIcon}>⌄</Text>
            </Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.npHeaderLabel}>TOCANDO AGORA</Text>
            </View>
            <View style={styles.npHeaderBtn} />
          </View>

          <View style={styles.npArtWrap}>
            <View style={styles.npArtShadow}>
              <ArtworkThumb uri={current?.meta?.artworkUri} size={ARTWORK_SIZE} />
            </View>
          </View>

          <View style={styles.npInfo}>
            <Text numberOfLines={1} style={styles.npTitle}>
              {current?.meta?.title || current?.name || ''}
            </Text>
            <Text numberOfLines={1} style={styles.npArtist}>
              {current?.meta?.artist || 'Desconhecido'}
            </Text>
          </View>

          <View style={styles.npProgressWrap}>
            <Pressable
              ref={scrubRef}
              onPress={(e) => handleSeekBar(e.nativeEvent.locationX)}
              style={styles.npProgressHit}
            >
              <View style={styles.npProgressBg}>
                <View style={[styles.npProgressFill, { width: `${pct * 100}%` }]} />
              </View>
            </Pressable>
            <View style={styles.npTimeRow}>
              <Text style={styles.npTime}>{fmt(position)}</Text>
              <Text style={styles.npTime}>{fmt(duration)}</Text>
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
              <Text style={styles.npSideIcon}>⇄</Text>
            </Pressable>
            <Pressable
              hitSlop={10}
              style={styles.npCtrlBtn}
              onPress={() => {
                hapLight();
                onPrev();
              }}
            >
              <Text style={styles.npCtrlIcon}>⏮</Text>
            </Pressable>
            <Pressable
              hitSlop={10}
              style={styles.npPlayBtn}
              onPress={() => {
                hapMedium();
                onToggle();
              }}
            >
              <Text style={styles.npPlayIcon}>{playing ? '❚❚' : '▶'}</Text>
            </Pressable>
            <Pressable
              hitSlop={10}
              style={styles.npCtrlBtn}
              onPress={() => {
                hapLight();
                onNext();
              }}
            >
              <Text style={styles.npCtrlIcon}>⏭</Text>
            </Pressable>
            <View style={styles.npSideBtn} />
          </View>
        </SafeAreaView>
      </LinearGradient>
    </Modal>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [files, setFiles] = useState<Enriched[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [palette, setPalette] = useState<Palette>(defaultPalette);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const didSetupRef = useRef(false);
  const lastSavedRef = useRef<{ id: string; pos: number } | null>(null);

  const progress = useProgress(500);

  const enrich = useCallback(async (list: Mp3[]) => {
    for (const file of list) {
      try {
        const meta = await readId3(file.uri, file.id);
        setFiles((prev) =>
          prev.map((f) => (f.id === file.id ? { ...f, meta } : f))
        );
        const track = await TrackPlayer.getQueue();
        const idx = track.findIndex((t) => t.id === file.id);
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

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listMp3s();
      setFiles(list);
      await TrackPlayer.reset();
      if (list.length > 0) await TrackPlayer.add(toTracks(list));
      setCurrentId(null);
      setPlaying(false);
      enrich(list);
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
      setFiles(list);
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
          if (t?.id) setCurrentId(String(t.id));
        }
      }
    }
  );

  const playFile = async (f: Enriched) => {
    const idx = files.findIndex((x) => x.id === f.id);
    if (idx < 0) return;
    hapSelect();
    await TrackPlayer.skip(idx);
    await TrackPlayer.play();
  };

  const togglePlay = async () => {
    if (!currentId && files.length > 0) {
      await TrackPlayer.skip(0);
      await TrackPlayer.play();
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
    if (files.length === 0) return;
    hapMedium();
    const shuffled = [...files];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setFiles(shuffled);
    await TrackPlayer.reset();
    await TrackPlayer.add(toTracks(shuffled));
    await TrackPlayer.skip(0);
    await TrackPlayer.play();
  };

  const seek = async (pos: number) => {
    try {
      await TrackPlayer.seekTo(pos);
    } catch {}
  };

  if (!ready || loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (files.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>♪</Text>
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
            <Text style={styles.emptyBtnText}>Recarregar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.libHeader}>
          <View>
            <Text style={styles.libKicker}>Biblioteca</Text>
            <Text style={styles.libTitle}>Suas musicas</Text>
          </View>
          <Pressable
            hitSlop={10}
            onPress={() => {
              hapLight();
              reload();
            }}
            style={styles.libReload}
          >
            <Text style={styles.libReloadIcon}>↻</Text>
          </Pressable>
        </View>

        <FlatList
          data={files}
          keyExtractor={(f) => f.id}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: 140,
            paddingTop: spacing.sm,
          }}
          renderItem={({ item }) => (
            <SongRow
              item={item}
              active={item.id === currentId}
              onPress={() => playFile(item)}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
        />
      </SafeAreaView>

      <MiniPlayer
        current={current}
        playing={playing}
        progress={
          progress.duration > 0 ? progress.position / progress.duration : 0
        }
        onToggle={togglePlay}
        onOpen={() => {
          hapLight();
          setNowPlayingOpen(true);
        }}
      />

      <NowPlaying
        visible={nowPlayingOpen}
        onClose={() => setNowPlayingOpen(false)}
        current={current}
        palette={palette}
        playing={playing}
        position={progress.position}
        duration={progress.duration}
        onToggle={togglePlay}
        onNext={next}
        onPrev={prev}
        onShuffle={shuffle}
        onSeek={seek}
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
    padding: spacing.xl,
  },

  emptyIcon: {
    color: theme.textDim,
    fontSize: 64,
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  emptyHelp: {
    color: theme.textMuted,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyHelpBold: { color: theme.text, fontWeight: '700' },
  emptyBtn: {
    marginTop: spacing.xl,
    backgroundColor: theme.accent,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
  },
  emptyBtnText: { color: theme.accentDark, fontSize: 16, fontWeight: '800' },

  libHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  libKicker: {
    color: theme.textDim,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  libTitle: {
    color: theme.text,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 2,
  },
  libReload: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  libReloadIcon: { color: theme.text, fontSize: 20 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  rowActive: { backgroundColor: theme.surface },
  rowText: { flex: 1, marginLeft: spacing.md },
  rowTitle: { color: theme.text, fontSize: 16, fontWeight: '600' },
  rowArtist: { color: theme.textMuted, fontSize: 13, marginTop: 2 },
  artFallback: { alignItems: 'center', justifyContent: 'center' },

  miniWrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: 24,
    backgroundColor: theme.bgElevated,
    borderRadius: radius.md,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  miniProgressBg: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  miniProgressFill: { height: '100%', backgroundColor: theme.accent },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
  },
  miniText: { flex: 1, marginLeft: spacing.md, marginRight: spacing.md },
  miniTitle: { color: theme.text, fontSize: 14, fontWeight: '700' },
  miniArtist: { color: theme.textMuted, fontSize: 12, marginTop: 2 },
  miniBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniBtnText: {
    color: theme.accentDark,
    fontSize: 14,
    fontWeight: '900',
  },

  npContainer: { flex: 1 },
  npHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  npHeaderBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  npHeaderIcon: { color: theme.text, fontSize: 28, fontWeight: '600' },
  npHeaderLabel: {
    color: theme.text,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    opacity: 0.8,
  },
  npArtWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  npArtShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    borderRadius: radius.lg,
  },
  npInfo: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.lg,
  },
  npTitle: {
    color: theme.text,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  npArtist: {
    color: theme.textMuted,
    fontSize: 16,
    marginTop: 4,
    fontWeight: '500',
  },
  npProgressWrap: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.lg,
  },
  npProgressHit: { paddingVertical: spacing.sm },
  npProgressBg: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  npProgressFill: { height: '100%', backgroundColor: theme.text },
  npTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  npTime: { color: theme.textMuted, fontSize: 12 },
  npControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  npSideBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  npSideIcon: { color: theme.text, fontSize: 22, opacity: 0.8 },
  npCtrlBtn: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  npCtrlIcon: { color: theme.text, fontSize: 32 },
  npPlayBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  npPlayIcon: { color: theme.accentDark, fontSize: 26, fontWeight: '900' },
});
