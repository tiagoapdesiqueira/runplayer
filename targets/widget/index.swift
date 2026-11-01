import WidgetKit
import SwiftUI

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SimpleEntry {
        SimpleEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> Void) {
        completion(SimpleEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SimpleEntry>) -> Void) {
        let entry = SimpleEntry(date: Date())
        let timeline = Timeline(entries: [entry], policy: .never)
        completion(timeline)
    }
}

struct SimpleEntry: TimelineEntry {
    let date: Date
}

struct RunPlayerWidgetEntryView: View {
    var entry: Provider.Entry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color(red: 1.0, green: 0.416, blue: 0.239))
                        .frame(width: 36, height: 36)
                    Image(systemName: "music.note")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(Color(red: 0.043, green: 0.043, blue: 0.051))
                }
                Spacer()
            }
            Spacer()
            Text("RunPlayer")
                .font(.system(size: 20, weight: .heavy))
                .foregroundColor(.white)
                .lineLimit(1)
            Text("Toque para abrir")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Color(red: 0.6, green: 0.6, blue: 0.65))
                .padding(.top, 2)
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
        .description("Atalho rapido para abrir o RunPlayer.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
