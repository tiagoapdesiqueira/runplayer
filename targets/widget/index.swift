import WidgetKit
import SwiftUI

let appGroupId = "group.com.tiago.runplayer"
let keyTitle = "nowPlayingTitle"
let keyArtist = "nowPlayingArtist"
let keyState = "nowPlayingState"

struct NowPlayingEntry: TimelineEntry {
    let date: Date
    let title: String
    let artist: String
    let playing: Bool
    let hasTrack: Bool
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> NowPlayingEntry {
        NowPlayingEntry(date: Date(), title: "RunPlayer", artist: "Toque para abrir", playing: false, hasTrack: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (NowPlayingEntry) -> Void) {
        completion(readEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NowPlayingEntry>) -> Void) {
        let entry = readEntry()
        let refresh = Date().addingTimeInterval(15 * 60)
        completion(Timeline(entries: [entry], policy: .after(refresh)))
    }

    private func readEntry() -> NowPlayingEntry {
        let defaults = UserDefaults(suiteName: appGroupId)
        let title = defaults?.string(forKey: keyTitle) ?? ""
        let artist = defaults?.string(forKey: keyArtist) ?? ""
        let state = defaults?.string(forKey: keyState) ?? ""
        let hasTrack = !title.isEmpty
        return NowPlayingEntry(
            date: Date(),
            title: hasTrack ? title : "RunPlayer",
            artist: hasTrack ? artist : "Toque para abrir",
            playing: state == "playing",
            hasTrack: hasTrack
        )
    }
}

struct WidgetArtIcon: View {
    let playing: Bool
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color(red: 1.0, green: 0.416, blue: 0.239))
                .frame(width: 36, height: 36)
            Image(systemName: playing ? "waveform" : "music.note")
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(Color(red: 0.043, green: 0.043, blue: 0.051))
        }
    }
}

struct RunPlayerWidgetEntryView: View {
    var entry: Provider.Entry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                WidgetArtIcon(playing: entry.playing)
                Spacer()
                if entry.hasTrack {
                    Text(entry.playing ? "TOCANDO" : "PAUSADO")
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundColor(Color(red: 0.6, green: 0.6, blue: 0.65))
                        .kerning(1.0)
                }
            }
            Spacer()
            Text(entry.title)
                .font(.system(size: 16, weight: .heavy))
                .foregroundColor(.white)
                .lineLimit(1)
            if !entry.artist.isEmpty {
                Text(entry.artist)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color(red: 0.6, green: 0.6, blue: 0.65))
                    .lineLimit(1)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(for: .widget) {
            Color(red: 0.043, green: 0.043, blue: 0.051)
        }
    }
}

@main
struct RunPlayerWidget: Widget {
    let kind: String = "RunPlayerWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            RunPlayerWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("RunPlayer")
        .description("Mostra a musica tocando no RunPlayer.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
