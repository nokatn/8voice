//! Settings management — persistent settings via tauri-plugin-store (JSON).
//!
//! Contract:
//! - Input: get/set keys
//! - Output: typed [`Settings`] or error
//! - Accept: settings persist across restarts

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// Application settings. Serialized to JSON and written to the store.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// Selected microphone device name; `None` = system default.
    #[serde(default)]
    pub input_device: Option<String>,
    /// Path to the model file (Whisper .bin) or model directory (Sherpa/Vosk).
    #[serde(default = "default_model_path")]
    pub model_path: String,
    /// Transcription language: `"tr"`, `"en"`, `"auto"`, or any Whisper code.
    #[serde(default = "default_language")]
    pub language: String,
    /// Global shortcut (e.g. `"Ctrl+Shift+Space"`).
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    /// Shortcut mode: push-to-talk or toggle.
    #[serde(default = "default_hotkey_mode")]
    pub hotkey_mode: HotkeyMode,
    /// Injection mode: auto, always type, or always paste.
    #[serde(default = "default_injection_mode")]
    pub injection_mode: InjectionMode,
    /// Whether VAD auto-stop is enabled (stop recording when speech ends).
    #[serde(default = "default_vad_enabled")]
    pub vad_enabled: bool,
    /// Continuous silence required for auto-stop (ms).
    #[serde(default = "default_vad_silence_ms")]
    pub vad_silence_ms: u32,
    /// VAD aggressiveness: 1 = Medium, 2 = Aggressive, 3 = VeryAggressive.
    #[serde(default = "default_vad_aggressiveness")]
    pub vad_aggressiveness: u8,
    /// Transcription provider.
    #[serde(default = "default_api_provider")]
    pub api_provider: ApiProvider,
    /// Legacy Groq API key (kept for backwards compat; migrated to `groq_api_key`).
    #[serde(default)]
    pub api_key: Option<String>,
    /// Groq API key.
    #[serde(default)]
    pub groq_api_key: Option<String>,
    /// Deepgram API key.
    #[serde(default)]
    pub deepgram_api_key: Option<String>,
    /// AssemblyAI API key.
    #[serde(default)]
    pub assemblyai_api_key: Option<String>,
    /// Whether the first-run onboarding has been completed.
    #[serde(default)]
    pub has_completed_onboarding: bool,
    /// Launch the app when the user logs in.
    #[serde(default = "default_launch_on_startup")]
    pub launch_on_startup: bool,
}

/// VAD configuration passed to the audio layer. Derived from `Settings`.
#[derive(Debug, Clone, Copy)]
pub struct VadCfg {
    pub enabled: bool,
    pub silence_ms: u32,
    pub aggressiveness: u8,
}

impl Settings {
    /// Extracts the VAD configuration for the audio layer.
    pub fn vad_cfg(&self) -> VadCfg {
        VadCfg {
            enabled: self.vad_enabled,
            silence_ms: self.vad_silence_ms,
            aggressiveness: self.vad_aggressiveness,
        }
    }

    /// Sanitizes critical fields; e.g. empty hotkey falls back to default.
    pub fn sanitize(&mut self) {
        if self.hotkey.trim().is_empty() {
            self.hotkey = default_hotkey();
        }
        // Migrate legacy `api_key` → `groq_api_key` if groq_api_key is empty
        if self.groq_api_key.is_none() || self.groq_api_key.as_deref().unwrap_or("").trim().is_empty() {
            if let Some(ref k) = self.api_key {
                if !k.trim().is_empty() {
                    self.groq_api_key = Some(k.clone());
                }
            }
        }
        // If a cloud provider is selected but its key is missing, fall back to Whisper
        match self.api_provider {
            ApiProvider::Groq if self.groq_api_key.as_deref().unwrap_or("").trim().is_empty() => {
                // also check legacy api_key
                if self.api_key.as_deref().unwrap_or("").trim().is_empty() {
                    self.api_provider = ApiProvider::Whisper;
                } else {
                    // migrate before fallback check
                    self.groq_api_key = self.api_key.clone();
                }
            }
            ApiProvider::Deepgram if self.deepgram_api_key.as_deref().unwrap_or("").trim().is_empty() => {
                self.api_provider = ApiProvider::Whisper;
            }
            ApiProvider::AssemblyAi if self.assemblyai_api_key.as_deref().unwrap_or("").trim().is_empty() => {
                self.api_provider = ApiProvider::Whisper;
            }
            _ => {}
        }
    }
}

/// Runtime-managed settings shared as Tauri state.
/// The `Arc<RwLock>` lets commands and the hotkey handler read/write safely.
pub type SharedSettings = Arc<RwLock<Settings>>;

/// Creates a new shared settings wrapper.
pub fn shared(settings: Settings) -> SharedSettings {
    Arc::new(RwLock::new(settings))
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HotkeyMode {
    PushToTalk,
    Toggle,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InjectionMode {
    Auto,
    Typing,
    Paste,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ApiProvider {
    /// Local whisper.cpp model (ggml/bin).
    #[serde(alias = "offline")]
    #[default]
    Whisper,
    /// Local Sherpa-ONNX engine.
    SherpaOnnx,
    /// Local Vosk engine.
    Vosk,
    /// Groq Whisper API (cloud, requires API key).
    Groq,
    /// Deepgram Nova-2 (cloud, requires API key).
    Deepgram,
    /// AssemblyAI Universal-2 (cloud, requires API key).
    AssemblyAi,
}

fn default_model_path() -> String {
    "models/ggml-small.bin".to_string()
}
fn default_language() -> String {
    "auto".to_string()
}
fn default_hotkey() -> String {
    // macOS uses the Command key ("Super" in Tauri's accelerator syntax);
    // Windows and Linux use Ctrl.
    #[cfg(target_os = "macos")]
    {
        "Super+Q".to_string()
    }
    #[cfg(not(target_os = "macos"))]
    {
        "Ctrl+Q".to_string()
    }
}
fn default_hotkey_mode() -> HotkeyMode {
    HotkeyMode::Toggle
}
fn default_injection_mode() -> InjectionMode {
    InjectionMode::Auto
}
fn default_vad_enabled() -> bool {
    true
}
fn default_vad_silence_ms() -> u32 {
    1200
}
fn default_vad_aggressiveness() -> u8 {
    2
}
fn default_api_provider() -> ApiProvider {
    ApiProvider::Whisper
}
fn default_launch_on_startup() -> bool {
    false
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            input_device: None,
            model_path: default_model_path(),
            language: default_language(),
            hotkey: default_hotkey(),
            hotkey_mode: default_hotkey_mode(),
            injection_mode: default_injection_mode(),
            vad_enabled: default_vad_enabled(),
            vad_silence_ms: default_vad_silence_ms(),
            vad_aggressiveness: default_vad_aggressiveness(),
            api_provider: default_api_provider(),
            api_key: None,
            groq_api_key: None,
            deepgram_api_key: None,
            assemblyai_api_key: None,
            has_completed_onboarding: false,
            launch_on_startup: default_launch_on_startup(),
        }
    }
}

const STORE_FILE: &str = "settings.json";
const STORE_KEY: &str = "settings";

/// Loads settings from the store; creates and saves defaults if missing.
/// Invalid/empty critical fields are corrected to defaults.
pub fn load(app: &AppHandle) -> anyhow::Result<Settings> {
    let store = app.store(STORE_FILE)?;
    // Force reload from disk to pick up any persisted changes.
    if let Err(e) = store.reload() {
        tracing::warn!("Store reload failed: {e:#}");
    }
    let raw = store.get(STORE_KEY);
    let mut settings = match raw {
        Some(v) => match serde_json::from_value::<Settings>(v.clone()) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("Settings deserialization failed: {e:?}, value={v}");
                Settings::default()
            }
        },
        None => {
            tracing::warn!("Store key '{STORE_KEY}' not found in {STORE_FILE}");
            Settings::default()
        }
    };
    tracing::info!("Loaded settings: has_completed_onboarding={}", settings.has_completed_onboarding);
    settings.sanitize();
    Ok(settings)
}

/// Writes settings to the store.
pub fn save(app: &AppHandle, settings: &Settings) -> anyhow::Result<()> {
    let store = app.store(STORE_FILE)?;
    let value = serde_json::to_value(settings)?;
    tracing::info!("Saving settings: has_completed_onboarding={}", settings.has_completed_onboarding);
    store.set(STORE_KEY, value);
    store.save()?;
    Ok(())
}
