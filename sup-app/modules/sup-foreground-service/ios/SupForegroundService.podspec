Pod::Spec.new do |s|
  s.name           = 'SupForegroundService'
  s.version        = '1.0.0'
  s.summary        = "s'up live s'ession status: iOS Live Activity (Android side is a foreground service)"
  s.description    = s.summary
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # ActivityKit only exists on iOS 16.1+; weak-link it so the app still launches on iOS 15.
  s.weak_frameworks = 'ActivityKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,swift}"
end
