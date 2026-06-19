//! Global shortcut — tauri-plugin-global-shortcut.
//!
//! Contract:
//! - Input: shortcut combination, mode (PushToTalk | Toggle)
//! - Output: StartRecording / StopRecording events → state machine
//! - Accept: works in the background; re-register when settings change; clear error on conflict
//!
//! Note: Push-to-talk needs both Pressed and Released events.
//! In Toggle mode only Pressed matters.

use anyhow::{anyhow, Result};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::settings::HotkeyMode;
use crate::state::{AppState, StateMachine};

/// Registers the shortcut. Unregisters any previous shortcuts first.
pub fn register(app: &AppHandle, hotkey: &str, mode: HotkeyMode) -> Result<()> {
    let manager = app.global_shortcut();
    manager.unregister_all()?;

    let shortcut: Shortcut = hotkey
        .parse()
        .map_err(|e| anyhow!("Invalid shortcut '{hotkey}': {e}"))?;

    manager.on_shortcut(shortcut, move |app, _shortcut, event| {
        let pressed = event.state == ShortcutState::Pressed;
        let released = event.state == ShortcutState::Released;

        let (do_start, do_stop) = match mode {
            HotkeyMode::PushToTalk => {
                if pressed {
                    (true, false)
                } else if released {
                    (false, true)
                } else {
                    (false, false)
                }
            }
            HotkeyMode::Toggle => {
                if pressed {
                    // Let idempotent start_recording / stop_recording helpers
                    // decide based on the current state.
                    match app.state::<StateMachine>().current() {
                        AppState::Idle => (true, false),
                        AppState::Recording => (false, true),
                        _ => (false, false),
                    }
                } else {
                    (false, false)
                }
            }
        };

        if do_start {
            if let Err(e) = crate::start_recording(app) {
                tracing::warn!("Could not start recording: {e}");
            }
        }
        if do_stop {
            // stop_recording is idempotent: works regardless of VAD or manual stop.
            crate::stop_recording(app);
        }
    })?;

    tracing::info!("Shortcut registered: {hotkey} (mode: {mode:?})");
    Ok(())
}


