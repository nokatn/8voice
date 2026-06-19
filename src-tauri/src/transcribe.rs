//! Transcription — whisper-rs (whisper.cpp) FFI wrapper + cloud API clients.
//!
//! Contract:
//! - Input: `&[f32]` 16 kHz mono PCM, language code, model path / API key
//! - Output: `String` transcript
//! - Accept: model is loaded once and kept in memory; clear error on failure;
//!   <3 s for 10 s audio (modern CPU, CPU mode); Groq/DG/AAI modes require internet

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use serde::Deserialize;
use std::path::Path;
use std::sync::OnceLock;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Global whisper context — loaded once and kept in memory.
static CONTEXT: OnceLock<Mutex<Option<WhisperContext>>> = OnceLock::new();

/// Transcriber. Model path is set with `load()` on first call.
pub struct Transcriber;

impl Transcriber {
    /// (Re)loads the model. Called at app startup or when the model path changes.
    pub fn load(model_path: &Path) -> Result<()> {
        if !model_path.exists() {
            return Err(anyhow!(
                "Model file not found: {}. Download a GGUF model such as ggml-small.bin.",
                model_path.display()
            ));
        }
        tracing::info!("Loading Whisper model: {}", model_path.display());
        let t0 = std::time::Instant::now();
        let ctx = WhisperContext::new_with_params(
            model_path.to_str().context("Model path is not valid UTF-8")?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| anyhow!("Could not load Whisper context: {e}"))?;

        let mutex = CONTEXT.get_or_init(|| Mutex::new(None));
        let mut guard = mutex.lock();
        *guard = Some(ctx);
        tracing::info!(
            "Model loaded ({:.2}s)",
            t0.elapsed().as_secs_f64()
        );
        Ok(())
    }

    /// PCM → text. `lang` `"auto"` enables automatic language detection.
    pub fn transcribe(pcm: &[f32], lang: &str) -> Result<String> {
        let mutex = CONTEXT
            .get()
            .ok_or_else(|| anyhow!("Model not loaded; load() must be called first"))?;
        let guard = mutex.lock();
        let ctx = guard
            .as_ref()
            .ok_or_else(|| anyhow!("Model not loaded; load() must be called first"))?;

        // At least 16 samples (~1 ms) required; return empty for very short recordings
        let pcm_owned: Vec<f32> = if pcm.len() < 16 {
            return Ok(String::new());
        } else {
            pcm.to_vec()
        };

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(num_cpu_threads());
        if lang == "auto" {
            params.set_language(None);
        } else {
            params.set_language(Some(lang));
        }
        // Text-only output (translate / special / progress disabled)
        params.set_translate(false);
        params.set_print_progress(false);
        params.set_print_special(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        let mut state = ctx
            .create_state()
            .map_err(|e| anyhow!("Could not create Whisper state: {e}"))?;
        state
            .full(params, &pcm_owned)
            .map_err(|e| anyhow!("Whisper processing error: {e}"))?;

        // whisper-rs 0.16 API: full_n_segments returns c_int directly,
        // segment data is retrieved with get_segment(i)?.
        //
        // Note: whisper.cpp may occasionally return invalid UTF-8 bytes in segment
        // text (auto language detection, truncated multi-byte characters).
        // `to_str()` does strict validation and throws; instead we use
        // `to_string_lossy()` so corrupt bytes are replaced with U+FFFD and the
        // text is preserved.
        let n = state.full_n_segments();
        let mut text = String::new();
        for i in 0..n {
            let seg = state
                .get_segment(i)
                .ok_or_else(|| anyhow!("Segment {i} not found"))?;
            // to_str_lossy(): invalid UTF-8 bytes become U+FFFD instead of
            // throwing, so truncated multi-byte characters are skipped safely.
            let seg_text = seg
                .to_str_lossy()
                .map_err(|e| anyhow!("Could not read segment {i} text: {e}"))?;
            text.push_str(&seg_text);
        }
        Ok(text.trim().to_string())
    }
}

fn num_cpu_threads() -> std::os::raw::c_int {
    let n = std::thread::available_parallelism()
        .map(|v| v.get())
        .unwrap_or(4);
    n.min(8) as std::os::raw::c_int
}

// ---------------------------------------------------------------------------
// Groq Whisper API
// ---------------------------------------------------------------------------

const GROQ_API_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL: &str = "whisper-large-v3";
const GROQ_SAMPLE_RATE: u32 = 16_000;

/// Groq API JSON response.
#[derive(Debug, Deserialize)]
struct GroqTranscriptionResponse {
    text: String,
}

/// PCM → Groq Whisper API → text (async).
/// `api_key` is the secret key from your Groq account.
pub async fn transcribe_groq(pcm: &[f32], lang: &str, api_key: &str) -> Result<String> {
    if pcm.len() < 16 {
        return Ok(String::new());
    }

    let wav = pcm_f32_to_wav(pcm, GROQ_SAMPLE_RATE);
    transcribe_groq_async(wav, lang, api_key).await
}

async fn transcribe_groq_async(wav: Vec<u8>, lang: &str, api_key: &str) -> Result<String> {
    let client = reqwest::Client::new();
    let mut form = reqwest::multipart::Form::new()
        .text("model", GROQ_MODEL.to_string())
        .part(
            "file",
            reqwest::multipart::Part::bytes(wav)
                .file_name("recording.wav")
                .mime_str("audio/wav")
                .context("Could not create WAV form part")?,
        );

    if lang != "auto" {
        form = form.text("language", lang.to_string());
    }

    let resp = client
        .post(GROQ_API_URL)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .context("Groq API request failed")?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow!("Groq API error {status}: {body}"));
    }

    let data: GroqTranscriptionResponse = resp
        .json()
        .await
        .context("Could not parse Groq response as JSON")?;

    Ok(data.text.trim().to_string())
}

/// Converts f32 16 kHz mono PCM to a standard WAV (PCM 16-bit) byte vector.
fn pcm_f32_to_wav(pcm: &[f32], sample_rate: u32) -> Vec<u8> {
    let channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let bytes_per_sample = bits_per_sample / 8;
    let block_align = channels * bytes_per_sample;
    let byte_rate = sample_rate * block_align as u32;
    let data_len = (pcm.len() * bytes_per_sample as usize) as u32;
    let total_len = 36 + data_len;

    let mut out = Vec::with_capacity(44 + data_len as usize);

    // RIFF chunk
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&total_len.to_le_bytes());
    out.extend_from_slice(b"WAVE");

    // fmt chunk
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data chunk
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());

    for &sample in pcm {
        let s = (sample * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        out.extend_from_slice(&s.to_le_bytes());
    }

    out
}

// ---------------------------------------------------------------------------
// Deepgram Nova-2 Cloud API
// ---------------------------------------------------------------------------

const DEEPGRAM_URL: &str = "https://api.deepgram.com/v1/listen";
const DEEPGRAM_MODEL: &str = "nova-2";

/// PCM → Deepgram Nova-2 API → text (async).
pub async fn transcribe_deepgram(
    pcm: &[f32],
    _lang: &str,
    api_key: &str,
) -> anyhow::Result<String> {
    if api_key.trim().is_empty() {
        return Err(anyhow::anyhow!("Deepgram API key is missing"));
    }
    if pcm.len() < 16 {
        return Ok(String::new());
    }

    let wav = pcm_f32_to_wav(pcm, 16_000);
    let client = reqwest::Client::new();
    let resp = client
        .post(DEEPGRAM_URL)
        .query(&[
            ("model", DEEPGRAM_MODEL),
            ("punctuate", "true"),
            ("encoding", "linear16"),
            ("sample_rate", "16000"),
            ("channels", "1"),
        ])
        .bearer_auth(api_key.trim())
        .header("Content-Type", "audio/wav")
        .body(wav)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Deepgram request failed: {e}"))?;

    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("Could not parse Deepgram response: {e}"))?;

    if !status.is_success() {
        return Err(anyhow::anyhow!(
            "Deepgram error {status}: {}",
            body["err_msg"].as_str().unwrap_or("unknown error"),
        ));
    }

    let text = body["results"]["channels"][0]["alternatives"][0]["transcript"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    Ok(text)
}

/// Validates a Deepgram API key by listing models.
pub async fn validate_deepgram_key(api_key: &str) -> Result<bool, String> {
    if api_key.trim().is_empty() {
        return Ok(false);
    }
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.deepgram.com/v1/models")
        .bearer_auth(api_key.trim())
        .send()
        .await
        .map_err(|e| format!("Deepgram validation request failed: {e}"))?;
    Ok(resp.status().is_success())
}

// ---------------------------------------------------------------------------
// AssemblyAI Universal-2 Cloud API
// ---------------------------------------------------------------------------

const ASSEMBLYAI_BASE: &str = "https://api.assemblyai.com/v2";

/// PCM → AssemblyAI Universal-2 API → text (async).
pub async fn transcribe_assemblyai(
    pcm: &[f32],
    _lang: &str,
    api_key: &str,
) -> anyhow::Result<String> {
    if api_key.trim().is_empty() {
        return Err(anyhow::anyhow!("AssemblyAI API key is missing"));
    }
    if pcm.len() < 16 {
        return Ok(String::new());
    }

    let client = reqwest::Client::new();

    // 1) Upload audio
    let wav = pcm_f32_to_wav(pcm, 16_000);
    let upload_url = format!("{}/upload", ASSEMBLYAI_BASE);
    let upload_resp = client
        .post(&upload_url)
        .header("Authorization", api_key.trim())
        .body(wav)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("AssemblyAI upload request failed: {e}"))?;

    let upload_status = upload_resp.status();
    let upload_body: serde_json::Value = upload_resp
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("Could not parse AssemblyAI upload response: {e}"))?;

    if !upload_status.is_success() {
        return Err(anyhow::anyhow!(
            "AssemblyAI upload error {upload_status}: {}",
            upload_body["error"].as_str().unwrap_or("unknown error"),
        ));
    }

    let audio_url = upload_body["upload_url"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("AssemblyAI upload response missing upload_url"))?
        .to_string();

    // 2) Submit transcription
    let transcript_url = format!("{}/transcript", ASSEMBLYAI_BASE);
    let submit_body = serde_json::json!({
        "audio_url": audio_url,
        "language_detection": true,
    });

    let submit_resp = client
        .post(&transcript_url)
        .header("Authorization", api_key.trim())
        .json(&submit_body)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("AssemblyAI submit request failed: {e}"))?;

    let submit_status = submit_resp.status();
    let submit_data: serde_json::Value = submit_resp
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("Could not parse AssemblyAI submit response: {e}"))?;

    if !submit_status.is_success() {
        return Err(anyhow::anyhow!(
            "AssemblyAI submit error {submit_status}: {}",
            submit_data["error"].as_str().unwrap_or("unknown error"),
        ));
    }

    let transcript_id = submit_data["id"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("AssemblyAI submit response missing id"))?
        .to_string();

    // 3) Poll for result
    let poll_url = format!("{}/transcript/{}", ASSEMBLYAI_BASE, transcript_id);
    let text = loop {
        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        let poll_resp = client
            .get(&poll_url)
            .header("Authorization", api_key.trim())
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("AssemblyAI poll request failed: {e}"))?;

        let poll_data: serde_json::Value = poll_resp
            .json()
            .await
            .map_err(|e| anyhow::anyhow!("Could not parse AssemblyAI poll response: {e}"))?;

        match poll_data["status"].as_str() {
            Some("completed") => {
                break poll_data["text"]
                    .as_str()
                    .unwrap_or("")
                    .trim()
                    .to_string();
            }
            Some("error") => {
                return Err(anyhow::anyhow!(
                    "AssemblyAI transcription error: {}",
                    poll_data["error"].as_str().unwrap_or("unknown"),
                ));
            }
            _ => continue,
        }
    };

    Ok(text)
}

/// Validates an AssemblyAI API key by listing accounts.
pub async fn validate_assemblyai_key(api_key: &str) -> Result<bool, String> {
    if api_key.trim().is_empty() {
        return Ok(false);
    }
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/account", ASSEMBLYAI_BASE))
        .header("Authorization", api_key.trim())
        .send()
        .await
        .map_err(|e| format!("AssemblyAI validation request failed: {e}"))?;
    Ok(resp.status().is_success())
}
