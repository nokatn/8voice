//! Dynamic tray icon generation — programmatic icon whose color changes with state.
//!
//! Produces a 32×32 RGBA icon for every `AppState`. The design matches the
//! main app icon: white rounded square + dark center dot + thin state-colored border.
//! Colors are consistent with the UI:
//! - Idle: emerald (ready)
//! - Recording: red
//! - Transcribing: amber
//! - Injecting: cyan
//! - Error: rose
//!
//! Generation is fast (<1 ms) and the result is loaded into Tauri's tray via `Image::new_owned`.

use tauri::{image::Image, AppHandle};
use tauri::tray::TrayIcon;

use crate::state::AppState;

/// Icon size in pixels.
const SIZE: u32 = 32;
/// Rounded square width.
const BOX_W: f32 = 24.0;
/// Rounded square height.
const BOX_H: f32 = 24.0;
/// Corner radius.
const BOX_RADIUS: f32 = 7.0;
/// State border thickness.
const BORDER_WIDTH: f32 = 2.5;
/// Center dot radius.
const DOT_RADIUS: f32 = 5.0;

/// Produces the tray icon as RGBA for the given state.
///
/// No PNG encoding is needed — Tauri's `Image::new_owned` accepts raw RGBA.
pub fn render_icon(state: AppState) -> Image<'static> {
    let state_color = state_color(state);
    let mut rgba: Vec<u8> = Vec::with_capacity((SIZE * SIZE * 4) as usize);

    let cx = SIZE as f32 / 2.0;
    let cy = SIZE as f32 / 2.0;

    for y in 0..SIZE {
        for x in 0..SIZE {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let dist = rounded_rect_sdf(px, py, cx, cy, BOX_W, BOX_H, BOX_RADIUS);

            let (r, g, b, a) = if dist > 0.0 {
                // Outside — transparent
                (0, 0, 0, 0)
            } else if dist > -BORDER_WIDTH {
                // Border — state color
                (state_color[0], state_color[1], state_color[2], 255)
            } else {
                // Inside
                let dx = px - cx;
                let dy = py - cy;
                let d = (dx * dx + dy * dy).sqrt();
                if d <= DOT_RADIUS {
                    // Dark center dot (matches app icon)
                    (23, 23, 23, 255)
                } else {
                    // White background
                    (255, 255, 255, 255)
                }
            };
            rgba.extend_from_slice(&[r, g, b, a]);
        }
    }

    Image::new_owned(rgba, SIZE, SIZE)
}

/// Signed-distance value for a rounded rectangle.
/// Negative inside, positive outside.
fn rounded_rect_sdf(x: f32, y: f32, cx: f32, cy: f32, w: f32, h: f32, r: f32) -> f32 {
    let dx = (x - cx).abs() - (w / 2.0 - r);
    let dy = (y - cy).abs() - (h / 2.0 - r);
    let outside = (dx.max(0.0)).hypot(dy.max(0.0));
    let inside = dx.max(dy).min(0.0);
    outside + inside - r
}

/// Icon for the `Idle` state.
pub fn idle_icon() -> Image<'static> {
    render_icon(AppState::Idle)
}

/// RGBA color matching the UI for each state.
fn state_color(state: AppState) -> [u8; 3] {
    match state {
        // emerald-500  #10b981
        AppState::Idle => [16, 185, 129],
        // red-500      #ef4444
        AppState::Recording => [239, 68, 68],
        // amber-500    #f59e0b
        AppState::Transcribing => [245, 158, 11],
        // cyan-500     #06b6d4
        AppState::Injecting => [6, 182, 212],
        // rose-700     #be123c
        AppState::Error => [190, 18, 60],
    }
}

/// Finds the registered tray icon and updates it for the given state.
/// If the tray is not yet set up (early stage), this silently does nothing.
pub fn update_icon(app: &AppHandle, state: AppState) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = set_icon(&tray, state);
    }
}

fn set_icon(tray: &TrayIcon, state: AppState) -> tauri::Result<()> {
    let img = render_icon(state);
    tray.set_icon(Some(img))?;
    tray.set_tooltip(Some(tooltip_text(state)))?;
    Ok(())
}

fn tooltip_text(state: AppState) -> &'static str {
    match state {
        AppState::Idle => "8voice — Ready",
        AppState::Recording => "8voice — Recording…",
        AppState::Transcribing => "8voice — Transcribing…",
        AppState::Injecting => "8voice — Injecting…",
        AppState::Error => "8voice — Error",
    }
}
