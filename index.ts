import 'react-native-gesture-handler';
import React from 'react';
import { View } from 'react-native';
import { registerRootComponent } from 'expo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import TrackPlayer from 'react-native-track-player';

import App from './App';
import { PlaybackService } from './service';

function Root() {
  return React.createElement(
    GestureHandlerRootView,
    { style: { flex: 1 } },
    React.createElement(App)
  );
}

registerRootComponent(Root);
TrackPlayer.registerPlaybackService(() => PlaybackService);
