import ActivityKit
import SwiftUI
import WidgetKit

private let supPurple = Color(red: 0x52 / 255, green: 0x22 / 255, blue: 0xAE / 255)

@main
struct SupLiveActivityBundle: WidgetBundle {
  var body: some Widget {
    SupLiveActivityWidget()
  }
}

/// The coloured posture dot at the start of the body text ("🟢 good alignment · …"),
/// or a neutral dot when there isn't one yet.
private func postureDot(_ body: String) -> String {
  guard let first = body.first else { return "•" }
  return first.isLetter ? "•" : String(first)
}

/// Counts up from the session start (updates every second without the app),
/// or nothing before the session has started.
@ViewBuilder
private func sessionTimer(_ state: SupSessionAttributes.ContentState) -> some View {
  if let start = state.sessionStartedAt {
    Text(start, style: .timer)
      .monospacedDigit()
      .multilineTextAlignment(.trailing)
  }
}

struct SupLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: SupSessionAttributes.self) { context in
      // Lock screen / notification banner
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          Text("s'up").font(.caption.bold()).foregroundColor(supPurple)
          Spacer()
          sessionTimer(context.state).font(.caption.bold()).foregroundColor(supPurple)
        }
        Text(context.state.title).font(.headline)
        if context.isStale {
          // No update for a while: the app was probably closed.
          Text("open s'up to keep tracking").font(.subheadline).foregroundColor(.secondary)
        } else {
          Text(context.state.body).font(.subheadline)
        }
      }
      .padding(16)
      .activityBackgroundTint(Color(.systemBackground))
      .activitySystemActionForegroundColor(supPurple)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text("s'up").font(.caption.bold()).foregroundColor(supPurple)
        }
        DynamicIslandExpandedRegion(.trailing) {
          sessionTimer(context.state).font(.caption.bold())
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 2) {
            Text(context.state.title).font(.caption.bold())
            Text(context.isStale ? "open s'up to keep tracking" : context.state.body).font(.caption)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      } compactLeading: {
        Text(postureDot(context.state.body))
      } compactTrailing: {
        sessionTimer(context.state).frame(maxWidth: 52).font(.caption2)
      } minimal: {
        Text(postureDot(context.state.body))
      }
      .keylineTint(supPurple)
    }
  }
}
