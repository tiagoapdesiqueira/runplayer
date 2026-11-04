import ExpoModulesCore
import AVFoundation
import MediaPlayer

public class RunplayerAudioModule: Module {
    private var player: AudioEnginePlayer?

    public func definition() -> ModuleDefinition {
        Name("RunplayerAudio")

        Events(
            "onPositionChanged",
            "onStateChanged",
            "onTrackChanged",
            "onRemotePlay",
            "onRemotePause",
            "onRemoteNext",
            "onRemotePrev"
        )

        OnCreate {
            self.player = AudioEnginePlayer()
            self.player?.delegate = self
        }

        OnDestroy {
            self.player?.teardown()
            self.player = nil
        }

        AsyncFunction("setQueue") { (tracks: [[String: Any]], startIndex: Int) in
            self.player?.setQueue(tracks: tracks, startIndex: startIndex)
        }

        AsyncFunction("play") {
            self.player?.play()
        }

        AsyncFunction("pause") {
            self.player?.pause()
        }

        AsyncFunction("seek") { (positionSec: Double) in
            self.player?.seek(to: positionSec)
        }

        AsyncFunction("skipToIndex") { (index: Int) in
            self.player?.skip(to: index)
        }

        AsyncFunction("skipToNext") {
            self.player?.skipToNext()
        }

        AsyncFunction("removeTracks") { (indices: [Int]) in
            self.player?.removeTracks(at: indices)
        }

        AsyncFunction("skipToPrevious") {
            self.player?.skipToPrevious()
        }

        Function("setVolume") { (volume: Double) in
            self.player?.setVolume(Float(volume))
        }

        AsyncFunction("startCrossfade") { (durationSec: Double) in
            self.player?.startCrossfade(durationSec: durationSec)
        }

        AsyncFunction("cancelCrossfade") {
            self.player?.cancelCrossfade()
        }

        Function("setNowPlayingMetadata") {
            (title: String, artist: String, artworkUri: String?, durationSec: Double) in
            self.player?.setNowPlayingMetadata(
                title: title,
                artist: artist,
                artworkUri: artworkUri,
                durationSec: durationSec
            )
        }

        Function("getPosition") { () -> Double in
            return self.player?.currentPosition ?? 0
        }

        Function("getDuration") { () -> Double in
            return self.player?.currentDuration ?? 0
        }

        Function("getIsPlaying") { () -> Bool in
            return self.player?.isPlaying ?? false
        }

        Function("getActiveIndex") { () -> Int in
            return self.player?.activeIndex ?? -1
        }
    }
}

extension RunplayerAudioModule: AudioEnginePlayerDelegate {
    func playerDidChangePosition(_ position: Double, duration: Double) {
        sendEvent("onPositionChanged", [
            "position": position,
            "duration": duration,
        ])
    }

    func playerDidChangeState(isPlaying: Bool) {
        sendEvent("onStateChanged", [
            "isPlaying": isPlaying,
        ])
    }

    func playerDidChangeTrack(index: Int, trackId: String) {
        sendEvent("onTrackChanged", [
            "index": index,
            "trackId": trackId,
        ])
    }

    func playerRemoteCommand(_ command: String) {
        switch command {
        case "play": sendEvent("onRemotePlay", [:])
        case "pause": sendEvent("onRemotePause", [:])
        case "next": sendEvent("onRemoteNext", [:])
        case "prev": sendEvent("onRemotePrev", [:])
        default: break
        }
    }
}
