# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-16

### Added

- First-run onboarding screen with three setup options:
  - Download a Whisper model from HuggingFace with progress tracking.
  - Select an existing local `.bin` / `.gguf` model file.
  - Enter and validate a Groq API key for cloud transcription.
- `has_completed_onboarding` setting to control first-run experience.

## [0.1.0] - 2026-06-16

### Added

- Privacy-first on-device voice dictation using Whisper (whisper.cpp).
- Groq Whisper API support as an alternative transcription provider.
- Global shortcut support with push-to-talk and toggle modes.
- Floating widget for quick recording control.
- System tray integration with dynamic state icons.
- Settings UI for microphone, provider, model path, API key, language, shortcut, and injection mode.
- Voice Activity Detection (VAD) for automatic stop after silence.
- Last transcript panel with copy button and automatic clipboard copy.
- MIT license and open-source documentation (README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG).

### Changed

- Project branding unified as **8voice** across the codebase and documentation.

### Added

- Initial MVP release.
