// Shared TypeScript types matching the Tauri backend.

export type ApiProvider = "offline" | "groq";
export type HotkeyMode = "push_to_talk" | "toggle";
export type InjectionMode = "auto" | "typing" | "paste";

export interface Settings {
  input_device: string | null;
  model_path: string;
  language: string;
  hotkey: string;
  hotkey_mode: HotkeyMode;
  injection_mode: InjectionMode;
  vad_enabled: boolean;
  vad_silence_ms: number;
  vad_aggressiveness: number;
  api_provider: ApiProvider;
  api_key: string | null;
  has_completed_onboarding: boolean;
  start_hidden: boolean;
  launch_on_startup: boolean;
  show_tray_icon: boolean;
}

export interface WhisperModel {
  id: string;
  name: string;
  filename: string;
  size_bytes: number;
  size_human: string;
  description: string;
}

export interface LocalModelInfo {
  path: string;
  exists: boolean;
  valid_extension: boolean;
  size_bytes: number;
}

export type DownloadEvent =
  | { event: "Started"; data: { total?: number } }
  | {
      event: "Progress";
      data: { downloaded: number; total?: number; percent?: number };
    }
  | { event: "Done"; data: { path: string } }
  | { event: "Error"; data: { message: string } }
  | { event: "Cancelled" };
