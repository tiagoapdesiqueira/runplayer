import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  State,
  Track,
  useProgress,
  useTrackPlayerEvents,
} from 'react-native-track-player';

const DOC_DIR = FileSystem.documentDirectory ?? '';

type Mp3 = { id: string; name: string; uri: string };

async function setupPlayer() {
  try {
    await TrackPlayer.setupPlayer({
      autoHandleInterruptions: true,
    });
  } catch (e: any) {
    if (!String(e?.message ?? e).includes('already been initialized')) throw e;
  }
  await TrackPlayer.updateOptions({
    android: {
      appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
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
        'Depois, no RunPlayer, toque no botão de recarregar (circulo com seta).\n'
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

function toTracks(list: Mp3[]): Track[] {
  return list.map((f) => ({
    id: f.id,
    url: f.uri,
    title: f.name,
    artist: 'RunPlayer',
  }));
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [files, setFiles] = useState<Mp3[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const didSetupRef = useRef(false);

  const progress = useProgress(500);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listMp3s();
      setFiles(list);
      await TrackPlayer.reset();
      if (list.length > 0) {
        await TrackPlayer.add(toTracks(list));
      }
      setCurrentId(null);
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (didSetupRef.current) return;
      didSetupRef.current = true;
      await setupPlayer();
      setReady(true);
      await reload();
    })();
  }, [reload]);

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
          setCurrentId((t?.id as string) ?? null);
        }
      }
    }
  );

  const playFile = async (f: Mp3) => {
    const idx = files.findIndex((x) => x.id === f.id);
    if (idx < 0) return;
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
    const shuffled = shuffleInPlace([...files]);
    setFiles(shuffled);
    await TrackPlayer.reset();
    await TrackPlayer.add(toTracks(shuffled));
    await TrackPlayer.skip(0);
    await TrackPlayer.play();
  };

  const current = files.find((f) => f.id === currentId) ?? null;

  const pct =
    progress.duration > 0
      ? Math.min(1, Math.max(0, progress.position / progress.duration))
      : 0;

  if (!ready || loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      </SafeAreaView>
    );
  }

  if (files.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.center}>
          <Text style={styles.title}>Nenhum MP3 encontrado</Text>
          <Text style={styles.help}>
            Abra o app Arquivos no iPhone, vá em{'\n'}
            <Text style={styles.helpBold}>No meu iPhone › RunPlayer</Text>
            {'\n'}e coloque seus arquivos .mp3 ali.
          </Text>
          <Pressable style={styles.btnBig} onPress={reload}>
            <Text style={styles.btnBigText}>Recarregar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.appTitle}>RunPlayer</Text>
        <Pressable onPress={reload} style={styles.reload}>
          <Text style={styles.reloadText}>↻</Text>
        </Pressable>
      </View>

      <FlatList
        data={files}
        keyExtractor={(f) => f.id}
        contentContainerStyle={{ paddingBottom: 240 }}
        renderItem={({ item }) => {
          const active = item.id === currentId;
          return (
            <Pressable
              onPress={() => playFile(item)}
              style={[styles.row, active && styles.rowActive]}
            >
              <Text
                numberOfLines={1}
                style={[styles.rowText, active && styles.rowTextActive]}
              >
                {active ? '▶  ' : ''}
                {item.name}
              </Text>
            </Pressable>
          );
        }}
      />

      <View style={styles.playerBar}>
        <Text numberOfLines={1} style={styles.nowPlaying}>
          {current ? current.name : 'Toque uma música'}
        </Text>

        <View style={styles.progressWrap}>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
          </View>
          <View style={styles.timeRow}>
            <Text style={styles.time}>{fmt(progress.position)}</Text>
            <Text style={styles.time}>{fmt(progress.duration)}</Text>
          </View>
        </View>

        <View style={styles.controls}>
          <Pressable style={styles.ctrl} onPress={prev}>
            <Text style={styles.ctrlText}>⏮</Text>
          </Pressable>
          <Pressable style={[styles.ctrl, styles.ctrlMain]} onPress={togglePlay}>
            <Text style={styles.ctrlTextMain}>{playing ? '⏸' : '▶'}</Text>
          </Pressable>
          <Pressable style={styles.ctrl} onPress={next}>
            <Text style={styles.ctrlText}>⏭</Text>
          </Pressable>
          <Pressable style={styles.ctrl} onPress={shuffle}>
            <Text style={styles.ctrlText}>🔀</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0d' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 12 },
  help: { color: '#bbb', fontSize: 16, textAlign: 'center', lineHeight: 22 },
  helpBold: { color: '#fff', fontWeight: '700' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  appTitle: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: 0.5 },
  reload: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1c1c22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reloadText: { color: '#fff', fontSize: 22 },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomColor: '#1a1a1f',
    borderBottomWidth: 1,
  },
  rowActive: { backgroundColor: '#15151a' },
  rowText: { color: '#ddd', fontSize: 17 },
  rowTextActive: { color: '#4ade80', fontWeight: '700' },
  playerBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#141418',
    borderTopColor: '#222',
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
  },
  nowPlaying: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 10, textAlign: 'center' },
  progressWrap: { marginBottom: 12 },
  progressBg: {
    height: 6,
    backgroundColor: '#2a2a30',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#4ade80' },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  time: { color: '#888', fontSize: 12 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  ctrl: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1f1f26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlMain: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#4ade80',
  },
  ctrlText: { color: '#fff', fontSize: 26 },
  ctrlTextMain: { color: '#0b0b0d', fontSize: 32, fontWeight: '900' },
  btnBig: {
    marginTop: 24,
    backgroundColor: '#4ade80',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 28,
  },
  btnBigText: { color: '#0b0b0d', fontSize: 17, fontWeight: '800' },
});
