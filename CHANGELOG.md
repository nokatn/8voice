# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.25] - 2026-06-18

### Added

- Diagnostic logging in the recording pipeline: capture stats (sample count, duration, RMS, peak), selected device, language, VAD config, and transcript summary on every run.
- Audio device info logged on stream open (name, sample rate, channels, format).

### Changed

- Brand logo is now circular (SVG + regenerated PNG/ICO/ICNS icons across the app, tray, store tiles, and favicon).
- Empty transcripts now surface a user-visible error (microphone silent / speech not detected) instead of silently returning to idle.
- macOS builds enable whisper-rs `metal` backend to avoid a crash in ggml 1.8.3's CPU/BLAS encoder path on M1 + macOS 12.3.

### Fixed

- macOS crash (`EXC_BAD_ACCESS` at `ggml_backend_sched_graph_compute_async`, PC=0) during transcription on Apple Silicon — encoder now runs on Metal.

## [0.2.24] - 2026-06-16

### Added

- Canonical SVG brand logo (`public/logo.svg`) and `scripts/generate-icons.py` generator.
- Consistent logo usage across the app header, onboarding, floating widget, system tray, favicon, and landing page.

### Changed

- All Tauri app icons and Microsoft Store tile images regenerated from the canonical logo.

### Removed

- Removed the "Start hidden" and "Show tray icon" settings toggles. The tray icon is now always shown and the app always opens its windows on startup after onboarding.
- Removed inconsistent `public/logo-light.jpeg` and `public/logo-dark.jpeg` assets.

## [0.2.19] - 2026-06-16

### Added

- Marketing site now highlights the floating widget with an interactive, click-to-try demo.
- New "Widget" section on the landing page shows the pill control, live wave indicator, and processing spinner.

### Changed

- README feature list and landing-page navigation now emphasize the floating widget as a primary interaction surface.

## [0.2.18] - 2026-06-16

### Fixed

- Made `windows`, `windows-core`, and `webview2-com` dependencies Windows-only via `[target.'cfg(windows)'.dependencies]` so that macOS and Linux release builds no longer try to compile the Windows-only `windows-future` crate.

## [0.2.17] - 2026-06-16

### Fixed

- CI: switched macOS to `KyleMayes/install-llvm-action@v2` so `bindgen` can locate `libclang`.
- CI: set an explicit `PKG_CONFIG_PATH` on Ubuntu so `alsa-sys` can find `alsa.pc`.

## [0.2.16] - 2026-06-16

### Fixed

- CI: added `libasound2-dev`, `clang`, and `pkg-config` to the Ubuntu release runner to satisfy `alsa-sys` and `bindgen`.
- CI: installed LLVM via Homebrew and exported `LIBCLANG_PATH` on macOS for `bindgen`.

## [0.2.15] - 2026-06-16

### Added

- GitHub Actions cross-platform release workflow that builds and drafts a GitHub Release for Windows (`.msi`), macOS universal (`.dmg`), and Linux (`.AppImage`/`.deb`) on every `v*` tag push.

## [0.2.14] - 2026-06-16

### Added

- Native right-click context menu on the floating widget with a "Quit 8voice" option.

## [0.2.13] - 2026-06-16

### Changed

- Increased the voice-reactive wave amplitude so the bars visibly reach the top and bottom edges of the widget.

## [0.2.12] - 2026-06-16

### Added

- New settings toggles: "Start hidden", "Launch on startup", and "Show tray icon".
- `tauri-plugin-autostart` integration so the app can start automatically with the system.

## [0.2.11] - 2026-06-16

### Changed

- Reworked the widget wave indicator into a center-pulsing heartbeat-style visualization.

## [0.2.10] - 2026-06-16

### Changed

- Fine-tuned the widget wave indicator: 15 thinner bars, log-scale amplitude normalization, and faster smoothing for more responsive visual feedback.

## [0.2.9] - 2026-06-16

### Changed

- Made the widget wave indicator full-width, more sensitive, and smoother.

## [0.2.8] - 2026-06-16

### Changed

- Translated onboarding and loading strings from Turkish to English.

## [0.2.7] - 2026-06-16

### Added

- Voice-reactive wave indicator on the floating widget that reflects live microphone amplitude. Rust side computes an RMS level and emits `app://audio-level` events; the widget renders a dynamic bar visualization.

## [0.2.6] - 2026-06-16

### Fixed

- Disabled the browser context menu inside the floating widget.

## [0.2.5] - 2026-06-16

### Fixed

- Corrected the HuggingFace Whisper model download URL by removing a duplicate `ggml-` prefix.

## [0.2.4] - 2026-06-16

### Fixed

- Avoided direct Tauri `State` injection in `cmd_get_settings`; now uses `AppHandle::state` for better compatibility.

## [0.2.3] - 2026-06-16

### Fixed

- Managed the settings state as an explicit `Arc<RwLock<Settings>>` for reliable Tauri state lookups.

## [0.2.2] - 2026-06-16

### Fixed

- Converted `SharedSettings` to a named-field struct to resolve Tauri state lookup issues.

## [0.2.1] - 2026-06-16

### Fixed

- Stabilized the Tauri `SharedSettings` state by wrapping it in a newtype.
- Improved onboarding and settings layouts for tablet-sized screens.

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
