import ActivityKit
import ExpoModulesCore
import Foundation

/// iOS side of "SupForegroundService". Android runs a foreground service with a
/// pinned notification; iOS has no foreground services (sessions keep running in
/// the background through the bluetooth-central mode), so the same start/stop
/// calls drive a Live Activity instead: the live s'ession status on the lock
/// screen and in the Dynamic Island (drawn by targets/sup-live-activity).
///
///   start(title, body, startedAtMs?) — show it, or update it in place
///   stop()                           — end it
public class SupForegroundServiceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SupForegroundService")

    // Safe to call repeatedly: the first call starts the activity, later ones update it.
    Function("start") { (title: String, body: String, startedAtMs: Double?) in
      if #available(iOS 16.2, *) {
        Task { @MainActor in SupLiveActivity.startOrUpdate(title: title, body: body, startedAtMs: startedAtMs) }
      }
    }

    Function("stop") {
      if #available(iOS 16.2, *) {
        Task { @MainActor in SupLiveActivity.end() }
      }
    }
  }
}

@available(iOS 16.2, *)
@MainActor
enum SupLiveActivity {
  /// After this long without an update the widget shows "open s'up to keep
  /// tracking" (e.g. the app was closed). Updates come at least once a minute
  /// (the minutes in the title), so a running session never goes stale.
  private static let staleAfter: TimeInterval = 2 * 60

  private static var current: Activity<SupSessionAttributes>?
  /// Runs ActivityKit calls one after another, in the order JS sent them.
  private static var chain: Task<Void, Never>?

  static func startOrUpdate(title: String, body: String, startedAtMs: Double?) {
    let state = SupSessionAttributes.ContentState(
      title: title,
      body: body,
      sessionStartedAt: startedAtMs.map { Date(timeIntervalSince1970: $0 / 1000) }
    )
    let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(staleAfter))
    enqueue {
      // Re-adopt one that survived an app relaunch (iOS Bluetooth state restoration).
      if current == nil { current = Activity<SupSessionAttributes>.activities.first }
      if let activity = current, activity.activityState == .active || activity.activityState == .stale {
        await activity.update(content)
        return
      }
      // None running, or the user dismissed it. Starting one is only allowed
      // while the app is in the foreground; in the background this just fails
      // and the next foreground update starts it again.
      current = nil
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
      current = try? Activity.request(attributes: SupSessionAttributes(), content: content, pushType: nil)
    }
  }

  static func end() {
    enqueue {
      for activity in Activity<SupSessionAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      current = nil
    }
  }

  private static func enqueue(_ work: @escaping @MainActor () async -> Void) {
    let previous = chain
    chain = Task { @MainActor in
      await previous?.value
      await work()
    }
  }
}
