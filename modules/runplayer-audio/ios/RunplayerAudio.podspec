require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'RunplayerAudio'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = { 'Tiago' => 'tiagoapdesiqueira@gmail.com' }
  s.homepage       = 'https://github.com/tiagoapdesiqueira/runplayer'
  s.platform       = :ios, '15.1'
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/tiagoapdesiqueira/runplayer.git', :tag => "#{s.version}" }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
