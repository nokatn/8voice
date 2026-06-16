//! Recording state machine — Idle → Recording → Transcribing → Injecting → Idle.
//!
//! Contract:
//! - Input: transition requests ([`StateEvent`])
//! - Output: current [`AppState`]; emits `app://state-changed` to the frontend on every transition
//! - Accept: invalid transitions are blocked; errors always safely return to Idle

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Application states. Reflected in the UI.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppState {
    Idle,
    Recording,
    Transcribing,
    Injecting,
    Error,
}

impl Default for AppState {
    fn default() -> Self {
        Self::Idle
    }
}

/// Events sent to the state machine.
#[derive(Debug)]
pub enum StateEvent {
    StartRecording,
    StopRecording,
    TranscriptionDone,
    InjectionDone,
    Fail(String),
}

/// Global state holder; accessed via [`tauri::State`].
pub struct StateMachine {
    inner: Mutex<AppState>,
    /// Latest error message (for the UI).
    last_error: Mutex<Option<String>>,
    /// Pipeline flag triggered when transitioning to Transcribing.
    /// `run_pipeline_watcher` monitors this.
    pending_transcribe: Mutex<bool>,
}

impl StateMachine {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(AppState::default()),
            last_error: Mutex::new(None),
            pending_transcribe: Mutex::new(false),
        }
    }

    pub fn current(&self) -> AppState {
        *self.inner.lock()
    }

    pub fn last_error(&self) -> Option<String> {
        self.last_error.lock().clone()
    }

    /// Returns true and clears the flag if a transition to Transcribing happened.
    pub fn take_pending_transcribe(&self) -> bool {
        let mut p = self.pending_transcribe.lock();
        let v = *p;
        *p = false;
        v
    }

    /// Applies a transition. Returns `true` if valid, `false` if invalid.
    /// Emits an event to the frontend on every successful transition.
    pub fn transition(&self, app: &AppHandle, event: StateEvent) -> bool {
        let mut state = self.inner.lock();
        let prev = *state;
        let (next, pipeline) = match (*state, &event) {
            (AppState::Idle, StateEvent::StartRecording) => (Some(AppState::Recording), false),
            (AppState::Recording, StateEvent::StopRecording) => (Some(AppState::Transcribing), true),
            (AppState::Transcribing, StateEvent::TranscriptionDone) => {
                (Some(AppState::Injecting), false)
            }
            (AppState::Injecting, StateEvent::InjectionDone) => (Some(AppState::Idle), false),
            (_, StateEvent::Fail(msg)) => {
                *self.last_error.lock() = Some(msg.to_string());
                (Some(AppState::Error), false)
            }
            _ => (None, false),
        };

        match next {
            Some(new_state) => {
                *state = new_state;
                if pipeline {
                    *self.pending_transcribe.lock() = true;
                }
                drop(state);
                emit_state(app, new_state, prev);
                // Automatically return to Idle from Error
                if new_state == AppState::Error {
                    let mut s = self.inner.lock();
                    *s = AppState::Idle;
                    emit_state(app, AppState::Idle, AppState::Error);
                }
                true
            }
            None => false,
        }
    }
}

/// Emits the state change to the frontend and updates tray icon/tooltip.
fn emit_state(app: &AppHandle, state: AppState, previous: AppState) {
    let _ = app.emit(
        "app://state-changed",
        StatePayload { state, previous },
    );
    // Update tray icon for the new state (color + tooltip).
    crate::tray::update_icon(app, state);
}

#[derive(Clone, Serialize)]
struct StatePayload {
    state: AppState,
    previous: AppState,
}
