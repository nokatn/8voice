//! Text injection — enigo (typing) + clipboard (paste).
//!
//! Contract:
//! - Input: text, mode (Typing | Paste | Auto)
//! - Output: Result<()> — success/failure
//! - Accept: paste for >200 chars; Unicode preserved; macOS Accessibility check
//! - Cross-platform:
//!   - Windows: enigo SendInput; cannot type into elevated apps
//!   - macOS: Accessibility permission required
//!   - Linux: X11 works; Wayland uses clipboard fallback

use anyhow::{anyhow, Result};
use arboard::Clipboard;
use enigo::{Enigo, Key, Keyboard, Settings};

use crate::settings::InjectionMode;

/// Paste-mode threshold in Auto mode.
const PASTE_THRESHOLD: usize = 200;

/// Injects text into the focused window.
pub fn inject(text: &str, mode: InjectionMode) -> Result<()> {
    if text.is_empty() {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    check_accessibility_permission()?;

    let use_paste = match mode {
        InjectionMode::Paste => true,
        InjectionMode::Typing => false,
        InjectionMode::Auto => text.chars().count() > PASTE_THRESHOLD,
    };

    if use_paste {
        inject_paste(text)
    } else {
        inject_typing(text)
    }
}

/// Paste (clipboard) mode. Previous clipboard content is saved and restored.
fn inject_paste(text: &str) -> Result<()> {
    let mut clipboard =
        Clipboard::new().map_err(|e| anyhow!("Clipboard not accessible: {e}"))?;

    // Save previous clipboard text (ignore non-text content)
    let old = clipboard.get_text().ok();

    clipboard
        .set_text(text)
        .map_err(|e| anyhow!("Could not write to clipboard: {e}"))?;

    // Short wait so the OS can read the clipboard
    std::thread::sleep(std::time::Duration::from_millis(50));

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| anyhow!("Could not initialize Enigo: {e}"))?;
    // Ctrl+V (Windows/Linux) or Cmd+V (macOS)
    #[cfg(target_os = "macos")]
    let modifier = Key::Super;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;
    enigo.key(modifier, enigo::Direction::Press)?;
    enigo.key(Key::Unicode('v'), enigo::Direction::Click)?;
    enigo.key(modifier, enigo::Direction::Release)?;

    // Restore previous clipboard content after paste completes
    std::thread::sleep(std::time::Duration::from_millis(150));
    if let Some(prev) = old {
        let _ = clipboard.set_text(prev);
    }
    Ok(())
}

/// Key simulation (typing) mode.
fn inject_typing(text: &str) -> Result<()> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| anyhow!("Could not initialize Enigo: {e}"))?;
    enigo.text(text).map_err(|e| anyhow!("Typing error: {e}"))?;
    Ok(())
}

/// macOS Accessibility permission check and user guidance.
#[cfg(target_os = "macos")]
fn check_accessibility_permission() -> Result<()> {
    use std::process::Command;
    // Simple approach: rely on enigo's own check; without permission typing fails.
    // More robust: query via ApplicationServices API. In the MVP we just show a warning.
    let ok: bool = {
        // Is UI elements enabled (trusted)?
        let script = "tell application \"System Events\" to UI elements enabled";
        Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };
    if !ok {
        return Err(anyhow!(
            "macOS Accessibility permission required. Enable 8voice in System Settings → Privacy & Security → Accessibility."
        ));
    }
    Ok(())
}
