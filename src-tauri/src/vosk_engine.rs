//! Vosk offline speech recognition engine (stub).
//!
//! The `vosk` crate is **not** included as a Cargo dependency because the
//! Vosk native library (vosk-api) must be pre-installed on the system
//! (https://alphacephei.com/vosk/install).
//!
//! Users who install vosk-api can set `VOSK_SYS_LIB_DIR` and/or add the DLL
//! path and re-enable the dependency. For now, `load()` and `transcribe()`
//! return a clear error message pointing to the Vosk install guide.
//!
//! Model listing and directory validation still work without the native lib.

use anyhow::{anyhow, Result};
use serde::Serialize;
use std::path::Path;

pub struct VoskTranscriber;

impl VoskTranscriber {
    /// Returns an error explaining that the Vosk native library must be installed.
    pub fn load(_model_dir: &Path) -> Result<()> {
        Err(anyhow!(
            "Vosk native library (vosk-api) is not installed. \
             Download it from https://alphacephei.com/vosk/install and place \
             vosk-api.dll in your PATH or set VOSK_SYS_LIB_DIR."
        ))
    }

    /// Returns an error — Vosk is not available without the native library.
    pub fn transcribe(_pcm: &[f32], _lang: &str) -> Result<String> {
        Err(anyhow!(
            "Vosk native library is not linked. Install vosk-api and rebuild."
        ))
    }
}

/// Information about a downloadable Vosk model.
#[derive(Debug, Clone, Serialize)]
pub struct VoskModelInfo {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub size_bytes: u64,
    pub size_human: String,
    pub description: String,
    pub url: String,
}

/// Returns the curated list of recommended Vosk models.
#[tauri::command]
pub fn cmd_list_vosk_models() -> Vec<VoskModelInfo> {
    vec![
        VoskModelInfo {
            id: "vosk-model-small-tr-0.3".into(),
            name: "Turkish (Small)".into(),
            filename: "vosk-model-small-tr-0.3.zip".into(),
            size_bytes: 42 * 1024 * 1024,
            size_human: "~42 MB".into(),
            description: "Turkish speech recognition model for Vosk.".into(),
            url: "https://alphacephei.com/vosk/models/vosk-model-small-tr-0.3.zip".into(),
        },
        VoskModelInfo {
            id: "vosk-model-small-en-us-0.15".into(),
            name: "English (Small)".into(),
            filename: "vosk-model-small-en-us-0.15.zip".into(),
            size_bytes: 40 * 1024 * 1024,
            size_human: "~40 MB".into(),
            description: "English (US) speech recognition model.".into(),
            url: "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip".into(),
        },
        VoskModelInfo {
            id: "vosk-model-small-de-0.15".into(),
            name: "German (Small)".into(),
            filename: "vosk-model-small-de-0.15.zip".into(),
            size_bytes: 40 * 1024 * 1024,
            size_human: "~40 MB".into(),
            description: "German speech recognition model.".into(),
            url: "https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip".into(),
        },
        VoskModelInfo {
            id: "vosk-model-small-fr-0.22".into(),
            name: "French (Small)".into(),
            filename: "vosk-model-small-fr-0.22.zip".into(),
            size_bytes: 40 * 1024 * 1024,
            size_human: "~40 MB".into(),
            description: "French speech recognition model.".into(),
            url: "https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip".into(),
        },
        VoskModelInfo {
            id: "vosk-model-small-es-0.42".into(),
            name: "Spanish (Small)".into(),
            filename: "vosk-model-small-es-0.42.zip".into(),
            size_bytes: 40 * 1024 * 1024,
            size_human: "~40 MB".into(),
            description: "Spanish speech recognition model.".into(),
            url: "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip".into(),
        },
        VoskModelInfo {
            id: "vosk-model-small-ru-0.22".into(),
            name: "Russian (Small)".into(),
            filename: "vosk-model-small-ru-0.22.zip".into(),
            size_bytes: 40 * 1024 * 1024,
            size_human: "~40 MB".into(),
            description: "Russian speech recognition model.".into(),
            url: "https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip".into(),
        },
        VoskModelInfo {
            id: "vosk-model-small-ja-0.22".into(),
            name: "Japanese (Small)".into(),
            filename: "vosk-model-small-ja-0.22.zip".into(),
            size_bytes: 40 * 1024 * 1024,
            size_human: "~40 MB".into(),
            description: "Japanese speech recognition model.".into(),
            url: "https://alphacephei.com/vosk/models/vosk-model-small-ja-0.22.zip".into(),
        },
        VoskModelInfo {
            id: "vosk-model-small-cn-0.22".into(),
            name: "Chinese (Small)".into(),
            filename: "vosk-model-small-cn-0.22.zip".into(),
            size_bytes: 42 * 1024 * 1024,
            size_human: "~42 MB".into(),
            description: "Chinese speech recognition model.".into(),
            url: "https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip".into(),
        },
    ]
}

/// Validates that a directory contains a valid Vosk model (am + conf files).
#[tauri::command]
pub fn cmd_validate_vosk_model(path: String) -> Result<bool, String> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_dir() {
        return Ok(false);
    }
    let has_am = p.join("am").exists();
    let has_conf = p.join("conf").is_dir();
    Ok(has_am && has_conf)
}


