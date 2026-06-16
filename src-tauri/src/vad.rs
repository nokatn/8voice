//! Voice Activity Detection — webrtc-vad (libfvad) wrapper.
//!
//! Contract:
//! - Input: 16 kHz mono f32 PCM (output of audio.rs resampler)
//! - Output: `is_speech: bool` for each frame
//! - Accept: 30 ms frames (480 samples @16kHz); partial frames are buffered for
//!   the next call; silence decision is made by libfvad after f32→i16 conversion
//!
//! Design: `VadEngine` is called from the audio callback for each incoming PCM
//! chunk. Its frame buffering means the callback does not have to deliver
//! exactly 480 samples every time.

use anyhow::{anyhow, Result};
use webrtc_vad::{SampleRate, Vad, VadMode};

use crate::audio::TARGET_SAMPLE_RATE;

/// Number of samples in a 30 ms VAD frame at 16 kHz.
pub const FRAME_SAMPLES: usize = TARGET_SAMPLE_RATE * 30 / 1000; // 480
/// Duration represented by one frame (ms).
pub const FRAME_MS: u32 = 30;

/// Maps the unit aggressiveness value (1-3) to a libfvad mode.
///
/// - `1` → `Quality` (least aggressive; avoids missing speech)
/// - `2` → `Aggressive` (recommended balance)
/// - `3` → `VeryAggressive` (clean stop even with background noise)
fn aggressiveness_to_mode(aggressiveness: u8) -> Result<VadMode> {
    Ok(match aggressiveness {
        1 => VadMode::Quality,
        2 => VadMode::Aggressive,
        3 => VadMode::VeryAggressive,
        other => {
            return Err(anyhow!(
                "Invalid VAD aggressiveness: {other} (must be 1-3)"
            ))
        }
    })
}

/// WebRTC VAD engine. Buffers partial frames.
///
/// # Send safety
/// `webrtc_vad::Vad` carries a `*mut Fvad` raw pointer and is therefore not
/// `Send`. We only use `VadEngine` inside the audio callback thread under a
/// `Mutex` — never moving it between threads. Therefore marking it `Send` is
/// safe here.
pub struct VadEngine {
    vad: Vad,
    /// Leftover samples from the previous call that do not make a full frame.
    carry: Vec<i16>,
}

// Safe: VadEngine is only accessed under a Mutex on a single thread.
// Although the underlying Fvad pointer is not thread-safe, we never share it cross-thread.
unsafe impl Send for VadEngine {}

impl VadEngine {
    /// New engine. `aggressiveness` must be 1-3.
    pub fn new(aggressiveness: u8) -> Result<Self> {
        let mode = aggressiveness_to_mode(aggressiveness)?;
        // webrtc-vad 0.4: constructor returns a builder instead of panicking.
        let vad = Vad::new_with_rate_and_mode(SampleRate::Rate16kHz, mode);
        Ok(Self { vad, carry: Vec::new() })
    }

    /// Processes mono f32 PCM. Splits into full frames and runs voice detection
    /// for each. Return value: `true` if **any** processed frame contains speech.
    /// Partial samples are stored for the next call.
    ///
    /// `out_silence_ms` equals the number of silent frames processed in this
    /// call × FRAME_MS; the caller uses it to update the silence counter.
    pub fn process(&mut self, mono_f32: &[f32]) -> VadFrameResult {
        // f32 [-1.0, 1.0] → i16 full scale, with saturation protection.
        self.carry.reserve(mono_f32.len());
        for &s in mono_f32 {
            let clamped = s.clamp(-1.0, 1.0);
            self.carry.push((clamped * i16::MAX as f32) as i16);
        }

        let mut any_speech = false;
        let mut silent_frames: u32 = 0;
        let mut speech_frames: u32 = 0;

        let n_full = self.carry.len() / FRAME_SAMPLES;
        for i in 0..n_full {
            let start = i * FRAME_SAMPLES;
            let frame = &self.carry[start..start + FRAME_SAMPLES];
            let is_voice = self.vad.is_voice_segment(frame).unwrap_or(false);
            if is_voice {
                speech_frames += 1;
                any_speech = true;
            } else {
                silent_frames += 1;
            }
        }

        // Remove processed full frames from carry, keep leftover partial samples.
        let consumed = n_full * FRAME_SAMPLES;
        self.carry.drain(..consumed);

        VadFrameResult {
            any_speech,
            silent_frames,
            speech_frames,
        }
    }
}

/// Result of a single `process()` call.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct VadFrameResult {
    /// `true` if at least one processed frame contains speech.
    pub any_speech: bool,
    /// Number of silent frames processed in this call.
    pub silent_frames: u32,
    /// Number of speech frames processed in this call.
    pub speech_frames: u32,
}

impl VadFrameResult {
    /// Total silence duration processed in this call (ms).
    pub fn silence_ms(&self) -> u32 {
        self.silent_frames * FRAME_MS
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn silence(samples: usize) -> Vec<f32> {
        vec![0.0; samples]
    }

    /// A simple tone (440 Hz). WebRTC VAD may or may not detect it as speech,
    /// but it produces something other than pure silence. The test only relies
    /// on silence returning false; the tone is only checked to not panic
    /// (actual true/false depends on the VAD mode).
    fn tone(freq: usize, samples: usize) -> Vec<f32> {
        (0..samples)
            .map(|i| {
                let t = i as f32 / TARGET_SAMPLE_RATE as f32;
                (2.0 * std::f32::consts::PI * freq as f32 * t).sin() * 0.3
            })
            .collect()
    }

    #[test]
    fn silence_yields_no_speech() {
        let mut engine = VadEngine::new(2).unwrap();
        // 3 frames of silence (1440 samples)
        let r = engine.process(&silence(FRAME_SAMPLES * 3));
        assert!(!r.any_speech, "silence should not be detected as speech");
        assert_eq!(r.silent_frames, 3);
        assert_eq!(r.speech_frames, 0);
        assert_eq!(r.silence_ms(), 90);
    }

    #[test]
    fn partial_frame_is_buffered() {
        let mut engine = VadEngine::new(2).unwrap();
        // 200 samples (< 1 frame) → no full frame processed
        let r = engine.process(&silence(200));
        assert_eq!(r.silent_frames, 0);
        assert_eq!(r.speech_frames, 0);
        // 200 samples should remain in carry
        assert_eq!(engine.carry.len(), 200);
    }

    #[test]
    fn partial_then_completes_frame() {
        let mut engine = VadEngine::new(2).unwrap();
        // First call: 240 samples (half frame)
        let _ = engine.process(&silence(240));
        assert_eq!(engine.carry.len(), 240);
        // Second call: 240 more samples → total 480 = 1 frame
        let r = engine.process(&silence(240));
        assert_eq!(r.silent_frames + r.speech_frames, 1);
        assert!(engine.carry.is_empty(), "full frame should be consumed");
    }

    #[test]
    fn tone_does_not_panic() {
        let mut engine = VadEngine::new(2).unwrap();
        // 440 Hz tone, 3 frames
        let _ = engine.process(&tone(440, FRAME_SAMPLES * 3));
        // Whether the tone is detected as speech depends on VAD mode;
        // here we only verify it does not panic.
    }

    #[test]
    fn clamp_prevents_overflow() {
        let mut engine = VadEngine::new(2).unwrap();
        // Saturated sample [-2.0, 2.0] — without clamp it would overflow i16
        let over: Vec<f32> = vec![2.0, -2.0, 1.5, -1.5];
        let _ = engine.process(&over);
        // No panic → test passes
    }

    #[test]
    fn invalid_aggressiveness_errors() {
        assert!(VadEngine::new(0).is_err());
        assert!(VadEngine::new(4).is_err());
        assert!(VadEngine::new(255).is_err());
    }

    #[test]
    fn all_aggressiveness_levels_init() {
        for a in 1..=3 {
            assert!(VadEngine::new(a).is_ok(), "aggressiveness {a} should be valid");
        }
    }
}
