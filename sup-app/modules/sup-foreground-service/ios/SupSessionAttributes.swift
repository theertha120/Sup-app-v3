import ActivityKit
import Foundation

/// Data for the live s'ession Live Activity.
///
/// KEEP IN SYNC with targets/sup-live-activity/SupSessionAttributes.swift:
/// the app and the widget extension are separate targets, and ActivityKit
/// matches an activity to its widget by this type's name and shape.
@available(iOS 16.2, *)
struct SupSessionAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// e.g. "s'ession in progress · 24min"
    var title: String
    /// e.g. "🟢 good alignment · 10 xp so far"
    var body: String
    /// When the session started, for the live timer. Nil before a session starts.
    var sessionStartedAt: Date?
  }
}
