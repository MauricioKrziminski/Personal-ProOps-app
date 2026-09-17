Pod::Spec.new do |s|
  s.name           = 'ProOpsPrivacidade'
  s.version        = '1.0.0'
  s.summary        = 'Esconde o app da foto do seletor de apps quando a trava está ligada.'
  s.description    = s.summary
  s.license        = 'UNLICENSED'
  s.author         = 'Personal ProOps app'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
