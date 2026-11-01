const APP_GROUP = 'group.com.tiago.runplayer';

let SharedPrefs: any = null;
let WidgetKit: any = null;
try {
  SharedPrefs = require('react-native-shared-group-preferences').default
    ?? require('react-native-shared-group-preferences');
} catch {}
try {
  WidgetKit = require('react-native-widgetkit');
} catch {}

let lastWrite: { title: string; artist: string; state: string } | null = null;

export async function updateWidget(
  title: string,
  artist: string,
  playing: boolean
): Promise<void> {
  if (!SharedPrefs) return;
  const state = playing ? 'playing' : 'paused';
  if (
    lastWrite &&
    lastWrite.title === title &&
    lastWrite.artist === artist &&
    lastWrite.state === state
  ) {
    return;
  }
  lastWrite = { title, artist, state };
  try {
    const setItem =
      SharedPrefs.setItem ?? SharedPrefs.default?.setItem;
    if (setItem) {
      await setItem.call(SharedPrefs, 'nowPlayingTitle', title, APP_GROUP);
      await setItem.call(SharedPrefs, 'nowPlayingArtist', artist, APP_GROUP);
      await setItem.call(SharedPrefs, 'nowPlayingState', state, APP_GROUP);
    }
    if (WidgetKit?.reloadAllTimelines) {
      WidgetKit.reloadAllTimelines();
    } else if (WidgetKit?.default?.reloadAllTimelines) {
      WidgetKit.default.reloadAllTimelines();
    }
  } catch {}
}

export async function clearWidget(): Promise<void> {
  if (!SharedPrefs) return;
  lastWrite = null;
  try {
    const setItem =
      SharedPrefs.setItem ?? SharedPrefs.default?.setItem;
    if (setItem) {
      await setItem.call(SharedPrefs, 'nowPlayingTitle', '', APP_GROUP);
      await setItem.call(SharedPrefs, 'nowPlayingArtist', '', APP_GROUP);
      await setItem.call(SharedPrefs, 'nowPlayingState', '', APP_GROUP);
    }
    if (WidgetKit?.reloadAllTimelines) {
      WidgetKit.reloadAllTimelines();
    } else if (WidgetKit?.default?.reloadAllTimelines) {
      WidgetKit.default.reloadAllTimelines();
    }
  } catch {}
}
