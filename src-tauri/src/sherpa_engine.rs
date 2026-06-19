//! Sherpa-ONNX offline speech recognition engine (stub).
//!
//! The `sherpa-onnx` crate is incompatible with `whisper-rs` at link time
//! (static vs dynamic MSVC CRT conflict). To use Sherpa-ONNX:
//!   1) Remove `whisper-rs` from Cargo.toml (or use a Cargo feature toggle)
//!   2) Uncomment `sherpa-onnx` in Cargo.toml
//!   3) Rebuild.
//! The model listing and directory-validation commands work without the crate.

use anyhow::{anyhow, Result};
use serde::Serialize;
use std::path::Path;

/// Global Sherpa-ONNX state (unused — stub).
static _PLACEHOLDER: std::sync::OnceLock<()> = std::sync::OnceLock::new();

pub struct SherpaTranscriber;

impl SherpaTranscriber {
    pub fn load(_model_dir: &Path) -> Result<()> {
        Err(anyhow!(
            "Sherpa-ONNX is not linked in this build. \
             Reason: the sherpa-onnx-sys crate uses /MT (static MSVC CRT) \
             while whisper-rs uses /MD (dynamic MSVC CRT) – they conflict at link time. \
             To use Sherpa-ONNX: remove whisper-rs from Cargo.toml, add back sherpa-onnx, and rebuild."
        ))
    }

    pub fn transcribe(_pcm: &[f32], _lang: &str) -> Result<String> {
        Err(anyhow!("Sherpa-ONNX not loaded (stub build)."))
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SherpaModelInfo {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
    pub size_human: String,
    pub description: String,
    pub url: String,
}

#[tauri::command]
pub fn cmd_list_sherpa_models() -> Vec<SherpaModelInfo> {
    vec![
        SherpaModelInfo {
            id: "sherpa-onnx-whisper-tiny".into(),
            name: "Whisper Tiny (multilingual)".into(),
            size_bytes: 150 * 1024 * 1024,
            size_human: "~150 MB".into(),
            description: "Fastest Sherpa-ONNX Whisper model. Supports 99 languages.".into(),
            url: "https://huggingface.co/k2-fsa/sherpa-onnx-whisper-tiny".into(),
        },
        SherpaModelInfo {
            id: "sherpa-onnx-whisper-base".into(),
            name: "Whisper Base (multilingual)".into(),
            size_bytes: 290 * 1024 * 1024,
            size_human: "~290 MB".into(),
            description: "Balanced speed/accuracy. Supports 99 languages.".into(),
            url: "https://huggingface.co/k2-fsa/sherpa-onnx-whisper-base".into(),
        },
        SherpaModelInfo {
            id: "sherpa-onnx-whisper-small".into(),
            name: "Whisper Small (multilingual)".into(),
            size_bytes: 930 * 1024 * 1024,
            size_human: "~930 MB".into(),
            description: "Good accuracy, moderate speed. Supports 99 languages.".into(),
            url: "https://huggingface.co/k2-fsa/sherpa-onnx-whisper-small".into(),
        },
        SherpaModelInfo {
            id: "sherpa-onnx-whisper-medium".into(),
            name: "Whisper Medium (multilingual)".into(),
            size_bytes: 3_100 * 1024 * 1024,
            size_human: "~3.1 GB".into(),
            description: "High accuracy, slower. Supports 99 languages.".into(),
            url: "https://huggingface.co/k2-fsa/sherpa-onnx-whisper-medium".into(),
        },
    ]
}

#[tauri::command]
pub fn cmd_validate_sherpa_model(path: String) -> Result<bool, String> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_dir() {
        return Ok(false);
    }
    let has_encoder = p.join("encoder.onnx").exists();
    let has_decoder = p.join("decoder.onnx").exists();
    let has_tokens = p.join("tokens.txt").exists();
    Ok(has_encoder && has_decoder && has_tokens)
}
