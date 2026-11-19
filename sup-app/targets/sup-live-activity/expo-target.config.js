/**
 * iOS widget extension that draws the live s'ession status as a Live Activity
 * (lock screen + Dynamic Island). Generated into the Xcode project by
 * @bacons/apple-targets at prebuild / EAS build time.
 *
 * The app starts / updates / ends the activity through
 * modules/sup-foreground-service (iOS side), with the same text the Android
 * foreground service notification shows.
 */
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "widget",
  name: "SupLiveActivity",
  displayName: "s'up",
  bundleIdentifier: ".liveactivity",
  // Live Activities with ActivityContent / stale dates need iOS 16.2.
  deploymentTarget: "16.2",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
  colors: {
    $accent: "#5222AE",
  },
};
