import AVFoundation
import MediaPlayer
import UIKit

protocol AudioEnginePlayerDelegate: AnyObject {
    func playerDidChangePosition(_ position: Double, duration: Double)
    func playerDidChangeState(isPlaying: Bool)
    func playerDidChangeTrack(index: Int, trackId: String)
    func playerRemoteCommand(_ command: String)
}

struct QueuedTrack {
    let id: String
    let url: URL
    let title: String?
    let artist: String?
    let artworkUri: String?
}

private enum Slot { case a, b }

final class AudioEnginePlayer {
    weak var delegate: AudioEnginePlayerDelegate?

    private let engine = AVAudioEngine()
    private let nodeA = AVAudioPlayerNode()
    private let nodeB = AVAudioPlayerNode()

    private var fileA: AVAudioFile?
    private var fileB: AVAudioFile?
    private var activeSlot: Slot = .a

    private var currentNode: AVAudioPlayerNode { activeSlot == .a ? nodeA : nodeB }
    private var otherNode: AVAudioPlayerNode { activeSlot == .a ? nodeB : nodeA }
    private var currentFile: AVAudioFile? { activeSlot == .a ? fileA : fileB }

    private var queue: [QueuedTrack] = []
    private(set) var activeIndex: Int = -1

    private var _isPlaying = false
    private var pausedPosition: Double = 0
    private var seekOffset: Double = 0
    private var playAnchorHostTime: TimeInterval = 0

    private var positionTimer: Timer?
    private var crossfadeTimer: Timer?

    private var sessionInterruptObserver: NSObjectProtocol?
    private var sessionRouteObserver: NSObjectProtocol?
    private var engineConfigObserver: NSObjectProtocol?

    init() {
        setupEngine()
        setupAudioSession()
        setupRemoteCommands()
        observeNotifications()
    }

    func teardown() {
        stopPositionTimer()
        cancelCrossfade()
        if let obs = sessionInterruptObserver {
            NotificationCenter.default.removeObserver(obs)
        }
        if let obs = sessionRouteObserver {
            NotificationCenter.default.removeObserver(obs)
        }
        if let obs = engineConfigObserver {
            NotificationCenter.default.removeObserver(obs)
        }
        nodeA.stop()
        nodeB.stop()
        engine.stop()
    }

    // MARK: - Engine / session

    private func setupEngine() {
        engine.attach(nodeA)
        engine.attach(nodeB)
        let format = engine.mainMixerNode.outputFormat(forBus: 0)
        engine.connect(nodeA, to: engine.mainMixerNode, format: format)
        engine.connect(nodeB, to: engine.mainMixerNode, format: format)
        engine.prepare()
        tryStartEngine()
    }

    private func tryStartEngine() {
        guard !engine.isRunning else { return }
        do {
            try engine.start()
        } catch {
            NSLog("RunplayerAudio: engine start failed: \(error)")
        }
    }

    private func setupAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            NSLog("RunplayerAudio: audio session setup failed: \(error)")
        }
    }

    private func observeNotifications() {
        let nc = NotificationCenter.default
        sessionInterruptObserver = nc.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            self?.handleInterruption(note)
        }
        sessionRouteObserver = nc.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            self?.handleRouteChange(note)
        }
        engineConfigObserver = nc.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: .main
        ) { [weak self] _ in
            self?.tryStartEngine()
        }
    }

    private func handleInterruption(_ note: Notification) {
        guard let info = note.userInfo,
              let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }

        switch type {
        case .began:
            pause()
        case .ended:
            if let optRaw = info[AVAudioSessionInterruptionOptionKey] as? UInt {
                let opts = AVAudioSession.InterruptionOptions(rawValue: optRaw)
                if opts.contains(.shouldResume) { play() }
            }
        @unknown default: break
        }
    }

    private func handleRouteChange(_ note: Notification) {
        guard let info = note.userInfo,
              let raw = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw)
        else { return }
        if reason == .oldDeviceUnavailable {
            pause()
        }
    }

    // MARK: - Queue

    func setQueue(tracks: [[String: Any]], startIndex: Int) {
        let parsed: [QueuedTrack] = tracks.compactMap { dict in
            guard let id = dict["id"] as? String,
                  let urlStr = dict["url"] as? String,
                  let url = URL(string: urlStr)
            else { return nil }
            return QueuedTrack(
                id: id,
                url: url,
                title: dict["title"] as? String,
                artist: dict["artist"] as? String,
                artworkUri: dict["artworkUri"] as? String
            )
        }
        queue = parsed
        let idx = max(0, min(parsed.count - 1, startIndex))
        if parsed.isEmpty {
            activeIndex = -1
            fileA = nil; fileB = nil
            nodeA.stop(); nodeB.stop()
            return
        }
        activeIndex = idx
        loadTrack(at: idx, into: activeSlot)
        pausedPosition = 0
        seekOffset = 0
        emitTrackChange()
    }

    @discardableResult
    private func loadTrack(at index: Int, into slot: Slot) -> AVAudioFile? {
        guard index >= 0 && index < queue.count else { return nil }
        let track = queue[index]
        do {
            let file = try AVAudioFile(forReading: track.url)
            if slot == .a { fileA = file } else { fileB = file }
            let node = slot == .a ? nodeA : nodeB
            node.stop()
            node.volume = 1.0
            scheduleWholeFile(file, on: node)
            return file
        } catch {
            NSLog("RunplayerAudio: load failed for \(track.url): \(error)")
            return nil
        }
    }

    private func scheduleWholeFile(_ file: AVAudioFile, on node: AVAudioPlayerNode) {
        node.scheduleFile(file, at: nil) { [weak self, weak node] in
            DispatchQueue.main.async {
                guard let self = self, let node = node else { return }
                self.handleScheduledPlaybackEnd(on: node)
            }
        }
    }

    private func handleScheduledPlaybackEnd(on node: AVAudioPlayerNode) {
        guard node === currentNode else { return }
        guard _isPlaying else { return }
        skipToNext()
    }

    // MARK: - Transport

    func play() {
        tryStartEngine()
        if currentFile == nil, activeIndex >= 0 {
            loadTrack(at: activeIndex, into: activeSlot)
        }
        if !currentNode.isPlaying {
            currentNode.play()
        }
        playAnchorHostTime = CACurrentMediaTime()
        seekOffset = pausedPosition
        _isPlaying = true
        delegate?.playerDidChangeState(isPlaying: true)
        startPositionTimer()
        pushNowPlaying()
    }

    func pause() {
        pausedPosition = currentPosition
        currentNode.pause()
        _isPlaying = false
        delegate?.playerDidChangeState(isPlaying: false)
        stopPositionTimer()
        pushNowPlaying()
    }

    func seek(to position: Double) {
        guard let file = currentFile else { return }
        let sampleRate = file.processingFormat.sampleRate
        let targetFrame = max(0, Int64(position * sampleRate))
        let totalFrames = file.length
        let startFrame = min(AVAudioFramePosition(targetFrame), totalFrames - 1)
        let frames = AVAudioFrameCount(max(0, totalFrames - startFrame))

        currentNode.stop()
        currentNode.scheduleSegment(
            file,
            startingFrame: startFrame,
            frameCount: frames,
            at: nil
        ) { [weak self, weak node = currentNode] in
            DispatchQueue.main.async {
                guard let self = self, let node = node else { return }
                self.handleScheduledPlaybackEnd(on: node)
            }
        }

        pausedPosition = Double(startFrame) / sampleRate
        if _isPlaying {
            currentNode.play()
            playAnchorHostTime = CACurrentMediaTime()
            seekOffset = pausedPosition
        }
        pushNowPlaying()
    }

    func skipToNext() {
        guard !queue.isEmpty else { return }
        let next = activeIndex + 1 < queue.count ? activeIndex + 1 : 0
        skip(to: next)
    }

    func skipToPrevious() {
        guard !queue.isEmpty else { return }
        if currentPosition > 3.0 {
            seek(to: 0)
            return
        }
        let prev = activeIndex - 1 >= 0 ? activeIndex - 1 : queue.count - 1
        skip(to: prev)
    }

    func skip(to index: Int) {
        guard index >= 0 && index < queue.count else { return }
        cancelCrossfade()
        activeIndex = index
        // Reset volume on both nodes
        nodeA.stop(); nodeB.stop()
        nodeA.volume = 1.0; nodeB.volume = 1.0
        loadTrack(at: index, into: activeSlot)
        pausedPosition = 0
        seekOffset = 0
        emitTrackChange()
        if _isPlaying {
            play()
        } else {
            pushNowPlaying()
        }
    }

    func setVolume(_ volume: Float) {
        let v = max(0, min(1, volume))
        currentNode.volume = v
    }

    // MARK: - Crossfade

    func startCrossfade(durationSec: Double) {
        guard !queue.isEmpty else { return }
        let nextIndex = activeIndex + 1 < queue.count ? activeIndex + 1 : 0
        if nextIndex == activeIndex { return }

        let otherSlot: Slot = activeSlot == .a ? .b : .a
        guard let nextFile = loadTrack(at: nextIndex, into: otherSlot) else { return }

        let nextNode = otherNode
        nextNode.volume = 0
        nextNode.play()

        crossfadeTimer?.invalidate()
        let startHost = CACurrentMediaTime()
        let currentStartVolume: Float = currentNode.volume
        let nodeRef = currentNode
        let nextRef = nextNode
        let nextIndexCaptured = nextIndex
        let nextFileCaptured = nextFile

        crossfadeTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] timer in
            guard let self = self else { timer.invalidate(); return }
            let elapsed = CACurrentMediaTime() - startHost
            let t = min(1, elapsed / durationSec)
            let outVol = currentStartVolume * Float(1 - t)
            let inVol = Float(t)
            nodeRef.volume = outVol
            nextRef.volume = inVol
            if t >= 1 {
                timer.invalidate()
                // Swap: next becomes current
                nodeRef.stop()
                nodeRef.volume = 1.0
                self.activeSlot = otherSlot
                self.activeIndex = nextIndexCaptured
                // The next node has been playing for durationSec so far.
                // Set anchors so currentPosition continues from there.
                self.pausedPosition = durationSec
                self.seekOffset = durationSec
                self.playAnchorHostTime = CACurrentMediaTime()
                _ = nextFileCaptured
                self.emitTrackChange()
                self.pushNowPlaying()
            }
        }
    }

    func cancelCrossfade() {
        crossfadeTimer?.invalidate()
        crossfadeTimer = nil
        otherNode.stop()
        otherNode.volume = 1.0
        currentNode.volume = 1.0
    }

    // MARK: - Position

    var currentPosition: Double {
        if !_isPlaying { return pausedPosition }
        let elapsed = CACurrentMediaTime() - playAnchorHostTime
        return seekOffset + max(0, elapsed)
    }

    var currentDuration: Double {
        guard let file = currentFile else { return 0 }
        return Double(file.length) / file.processingFormat.sampleRate
    }

    var isPlaying: Bool { _isPlaying }

    private func startPositionTimer() {
        positionTimer?.invalidate()
        positionTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            self.delegate?.playerDidChangePosition(self.currentPosition, duration: self.currentDuration)
        }
    }

    private func stopPositionTimer() {
        positionTimer?.invalidate()
        positionTimer = nil
    }

    // MARK: - Now Playing

    func setNowPlayingMetadata(
        title: String,
        artist: String,
        artworkUri: String?,
        durationSec: Double
    ) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyTitle] = title
        info[MPMediaItemPropertyArtist] = artist
        info[MPMediaItemPropertyPlaybackDuration] = durationSec
        if let uri = artworkUri, !uri.isEmpty {
            let path = uri.hasPrefix("file://") ? String(uri.dropFirst(7)) : uri
            if let image = UIImage(contentsOfFile: path) {
                let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                info[MPMediaItemPropertyArtwork] = artwork
            }
        } else {
            info[MPMediaItemPropertyArtwork] = nil
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func pushNowPlaying() {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyPlaybackRate] = _isPlaying ? 1.0 : 0.0
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentPosition
        info[MPMediaItemPropertyPlaybackDuration] = currentDuration
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func emitTrackChange() {
        guard activeIndex >= 0 && activeIndex < queue.count else { return }
        delegate?.playerDidChangeTrack(index: activeIndex, trackId: queue[activeIndex].id)
    }

    // MARK: - Remote commands

    private func setupRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
        center.changePlaybackPositionCommand.isEnabled = true

        center.playCommand.addTarget { [weak self] _ in
            self?.delegate?.playerRemoteCommand("play")
            self?.play()
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            self?.delegate?.playerRemoteCommand("pause")
            self?.pause()
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.delegate?.playerRemoteCommand("next")
            self?.skipToNext()
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            self?.delegate?.playerRemoteCommand("prev")
            self?.skipToPrevious()
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] evt in
            guard let event = evt as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            self?.seek(to: event.positionTime)
            return .success
        }
    }
}
