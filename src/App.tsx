import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { Settings } from "./types";

// --- Types (must match backend) ---

type AppState =
  | "idle"
  | "recording"
  | "transcribing"
  | "injecting"
  | "error";

const DEFAULT_SETTINGS: Settings = {
  input_device: null,
  model_path: "models/ggml-small.bin",
  language: "auto",
  hotkey: "Ctrl+Shift+Space",
  hotkey_mode: "push_to_talk",
  injection_mode: "auto",
  vad_enabled: true,
  vad_silence_ms: 1200,
  vad_aggressiveness: 2,
  api_provider: "offline",
  api_key: null,
  has_completed_onboarding: false,
  start_hidden: false,
  launch_on_startup: false,
  show_tray_icon: true,
};

const STATE_META: Record<
  AppState,
  {
    label: string;
    description: string;
    bars: string;
    ring: string;
    glow: string;
    animate: boolean;
  }
> = {
  idle: {
    label: "Ready",
    description: "Use the widget mic or shortcut to start recording.",
    bars: "bg-emerald-500",
    ring: "ring-emerald-500/20",
    glow: "shadow-emerald-500/10",
    animate: false,
  },
  recording: {
    label: "Recording",
    description: "Listening to your speech…",
    bars: "bg-red-500",
    ring: "ring-red-500/20",
    glow: "shadow-red-500/10",
    animate: true,
  },
  transcribing: {
    label: "Transcribing",
    description: "Converting speech to text…",
    bars: "bg-amber-500",
    ring: "ring-amber-500/20",
    glow: "shadow-amber-500/10",
    animate: true,
  },
  injecting: {
    label: "Injecting",
    description: "Sending text to the active window…",
    bars: "bg-cyan-500",
    ring: "ring-cyan-500/20",
    glow: "shadow-cyan-500/10",
    animate: true,
  },
  error: {
    label: "Error",
    description: "Something went wrong.",
    bars: "bg-rose-500",
    ring: "ring-rose-500/20",
    glow: "shadow-rose-500/10",
    animate: false,
  },
};

type SettingsTab = "general" | "transcription" | "injection" | "autostop";

// --- Component ---

function App({ initialSettings }: { initialSettings?: Settings }) {
  const [state, setState] = useState<AppState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(
    initialSettings ?? DEFAULT_SETTINGS,
  );
  const [devices, setDevices] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [capturingHotkey, setCapturingHotkey] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  useEffect(() => {
    (async () => {
      try {
        const [s, st, devs] = await Promise.all([
          invoke<Settings>("cmd_get_settings"),
          invoke<[AppState, string | null]>("cmd_get_state"),
          invoke<string[]>("cmd_list_devices"),
        ]);
        setSettings(s);
        setState(st[0]);
        setError(st[1]);
        setDevices(devs);
      } catch (e) {
        console.error("Could not load initial data:", e);
      }
    })();
  }, []);

  useEffect(() => {
    let un: UnlistenFn | undefined;
    let unT: UnlistenFn | undefined;
    (async () => {
      un = await listen<{ state: AppState; previous: AppState }>(
        "app://state-changed",
        (e) => setState(e.payload.state),
      );
      unT = await listen<string>("app://transcript", (e) => {
        setLastTranscript(e.payload);
        copyToClipboard(e.payload);
      });
    })();
    return () => {
      un?.();
      unT?.();
    };
  }, []);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("Could not copy to clipboard:", e);
    }
  };

  const update = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      setSaving(true);
      invoke("cmd_save_settings", { settings: next })
        .catch((e) => {
          console.error("Could not save settings:", e);
          setError(String(e));
        })
        .finally(() => setSaving(false));
      return next;
    });
  };

  const meta = STATE_META[state];

  return (
    <main className="flex h-screen w-screen bg-neutral-950 text-neutral-100">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-white/10 bg-neutral-900/50">
        <div className="p-6">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-lg ring-1 ring-white/20">
            <span className="block h-4 w-4 rounded-full bg-neutral-900" />
          </div>
          <h1 className="text-lg font-bold tracking-tight">8voice</h1>
          <p className="text-xs text-neutral-400">Settings</p>
        </div>

        <nav className="flex-1 space-y-1 px-3 pb-6">
          <TabButton
            active={activeTab === "general"}
            onClick={() => setActiveTab("general")}
            icon={<MicIcon className="h-5 w-5" />}
          >
            General
          </TabButton>
          <TabButton
            active={activeTab === "transcription"}
            onClick={() => setActiveTab("transcription")}
            icon={<CloudIcon className="h-5 w-5" />}
          >
            Transcription
          </TabButton>
          <TabButton
            active={activeTab === "injection"}
            onClick={() => setActiveTab("injection")}
            icon={<TypeIcon className="h-5 w-5" />}
          >
            Injection
          </TabButton>
          <TabButton
            active={activeTab === "autostop"}
            onClick={() => setActiveTab("autostop")}
            icon={<StopwatchIcon className="h-5 w-5" />}
          >
            Auto stop
          </TabButton>
        </nav>
      </aside>

      {/* Content */}
      <section className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-8">
          {/* Status card */}
          <div
            className={`mb-6 flex items-center gap-4 rounded-2xl bg-neutral-900 p-5 shadow-lg ring-1 ring-white/5 ${meta.glow}`}
          >
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-neutral-800/80 ring-1 ${meta.ring}`}
            >
              <WaveIndicator color={meta.bars} animate={meta.animate} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">{meta.label}</p>
              <p className="truncate text-sm text-neutral-400">
                {error ?? meta.description}
              </p>
            </div>
            <span className="rounded-lg bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-400 ring-1 ring-white/5">
              {settings.hotkey_mode === "push_to_talk" ? "PTT" : "TGL"}
            </span>
          </div>

          {/* Last transcript */}
          {lastTranscript && (
            <section className="mb-6 rounded-2xl border border-neutral-800/60 bg-neutral-900/60 p-4 backdrop-blur-sm">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Last transcript
                </p>
                <button
                  type="button"
                  onClick={() => copyToClipboard(lastTranscript)}
                  className="flex items-center gap-1 rounded-md bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-300 transition hover:bg-neutral-700 hover:text-white"
                >
                  {copied ? (
                    <>
                      <CheckIcon className="h-3 w-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <CopyIcon className="h-3 w-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-200">
                {lastTranscript}
              </p>
            </section>
          )}

          {/* Tab content */}
          <div className="rounded-2xl bg-neutral-900 p-6 shadow-lg ring-1 ring-white/5">
            {activeTab === "general" && (
              <GeneralTab
                settings={settings}
                devices={devices}
                capturingHotkey={capturingHotkey}
                setCapturingHotkey={setCapturingHotkey}
                update={update}
              />
            )}
            {activeTab === "transcription" && (
              <TranscriptionTab settings={settings} update={update} />
            )}
            {activeTab === "injection" && (
              <InjectionTab settings={settings} update={update} />
            )}
            {activeTab === "autostop" && (
              <AutoStopTab settings={settings} update={update} />
            )}
          </div>

          <p className="mt-4 text-xs text-neutral-500">
            {saving ? "Saving…" : "Changes are saved automatically."}
          </p>
        </div>
      </section>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
        active
          ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30"
          : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function GeneralTab({
  settings,
  devices,
  capturingHotkey,
  setCapturingHotkey,
  update,
}: {
  settings: Settings;
  devices: string[];
  capturingHotkey: boolean;
  setCapturingHotkey: (v: boolean) => void;
  update: (patch: Partial<Settings>) => void;
}) {
  return (
    <div className="grid gap-6">
      <div>
        <h2 className="mb-1 text-lg font-semibold">General</h2>
        <p className="text-sm text-neutral-400">Microphone, language and shortcut preferences.</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Microphone" icon={<MicIcon className="h-3.5 w-3.5" />}>
          <select
            className="voice-input"
            value={settings.input_device ?? ""}
            onChange={(e) =>
              update({
                input_device: e.target.value || null,
              })
            }
          >
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Language" icon={<GlobeIcon className="h-3.5 w-3.5" />}>
          <select
            className="voice-input"
            value={settings.language}
            onChange={(e) => update({ language: e.target.value })}
          >
            <option value="auto">Auto</option>
            <option value="tr">Turkish</option>
            <option value="en">English</option>
          </select>
        </Field>

        <Field label="Shortcut mode">
          <select
            className="voice-input"
            value={settings.hotkey_mode}
            onChange={(e) =>
              update({
                hotkey_mode: e.target.value as Settings["hotkey_mode"],
              })
            }
          >
            <option value="push_to_talk">Hold to talk</option>
            <option value="toggle">Toggle</option>
          </select>
        </Field>

        <Field label="Shortcut">
          <HotkeyCapture
            value={settings.hotkey}
            capturing={capturingHotkey}
            onStart={() => setCapturingHotkey(true)}
            onCapture={(hotkey) => {
              setCapturingHotkey(false);
              update({ hotkey });
            }}
            onCancel={() => setCapturingHotkey(false)}
          />
        </Field>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-neutral-300">Application behavior</h3>
        <p className="mb-4 text-sm text-neutral-400">Control how 8voice starts and appears.</p>
        <div className="grid gap-3">
          <Toggle
            label="Start hidden"
            description="Launch without showing any windows."
            checked={settings.start_hidden}
            onChange={(checked) =>
              update({ start_hidden: checked, show_tray_icon: true })
            }
          />
          <Toggle
            label="Launch on startup"
            description="Start 8voice automatically when you log in."
            checked={settings.launch_on_startup}
            onChange={(checked) => update({ launch_on_startup: checked })}
          />
          <Toggle
            label="Show tray icon"
            description="Show the 8voice icon in the system tray."
            checked={settings.show_tray_icon}
            onChange={(checked) =>
              update({
                show_tray_icon: checked,
                start_hidden: checked ? settings.start_hidden : false,
              })
            }
          />
        </div>
      </div>
    </div>
  );
}

function TranscriptionTab({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  return (
    <div className="grid gap-6">
      <div>
        <h2 className="mb-1 text-lg font-semibold">Transcription</h2>
        <p className="text-sm text-neutral-400">Choose how your speech is converted to text.</p>
      </div>

      <Field label="Transcription provider" icon={<CloudIcon className="h-3.5 w-3.5" />}>
        <select
          className="voice-input"
          value={settings.api_provider}
          onChange={(e) =>
            update({
              api_provider: e.target.value as Settings["api_provider"],
            })
          }
        >
          <option value="offline">Local model (offline)</option>
          <option value="groq">Groq Whisper API</option>
        </select>
      </Field>

      {settings.api_provider === "offline" ? (
        <Field label="Model path" icon={<FileIcon className="h-3.5 w-3.5" />}>
          <div className="flex gap-2">
            <input
              className="voice-input font-mono text-xs"
              value={settings.model_path}
              onChange={(e) => update({ model_path: e.target.value })}
              placeholder="models/ggml-small.bin"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  const selected = await open({
                    multiple: false,
                    directory: false,
                    filters: [
                      { name: "GGML/Whisper model", extensions: ["bin"] },
                      { name: "All files", extensions: ["*"] },
                    ],
                    title: "Choose Whisper model file",
                  });
                  if (selected && typeof selected === "string") {
                    update({ model_path: selected });
                  }
                } catch (e) {
                  console.error("Could not select model:", e);
                }
              }}
              className="shrink-0 rounded-lg bg-neutral-800 px-3 text-xs font-semibold text-neutral-200 transition hover:bg-neutral-700 hover:text-white"
            >
              Browse
            </button>
          </div>
        </Field>
      ) : (
        <Field label="Groq API key" icon={<KeyIcon className="h-3.5 w-3.5" />}>
          <input
            type="password"
            className="voice-input font-mono text-xs"
            value={settings.api_key ?? ""}
            onChange={(e) =>
              update({ api_key: e.target.value || null })
            }
            placeholder="gsk_..."
          />
        </Field>
      )}
    </div>
  );
}

function InjectionTab({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  return (
    <div className="grid gap-6">
      <div>
        <h2 className="mb-1 text-lg font-semibold">Injection</h2>
        <p className="text-sm text-neutral-400">How the transcribed text is inserted into the active window.</p>
      </div>

      <Field label="Injection mode" icon={<TypeIcon className="h-3.5 w-3.5" />}>
        <select
          className="voice-input"
          value={settings.injection_mode}
          onChange={(e) =>
            update({
              injection_mode: e.target.value as Settings["injection_mode"],
            })
          }
        >
          <option value="auto">Auto (paste long text)</option>
          <option value="typing">Always type</option>
          <option value="paste">Always paste</option>
        </select>
      </Field>
    </div>
  );
}

function AutoStopTab({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  return (
    <div className="grid gap-6">
      <div>
        <h2 className="mb-1 text-lg font-semibold">Auto stop</h2>
        <p className="text-sm text-neutral-400">Stop recording automatically when you stop speaking.</p>
      </div>

      <Toggle
        label="Enable voice activity detection"
        description="Recording stops after silence is detected."
        checked={settings.vad_enabled}
        onChange={(checked) => update({ vad_enabled: checked })}
      />

      {settings.vad_enabled ? (
        <div className="grid gap-5 md:grid-cols-2">
          <Field label={`Silence threshold: ${settings.vad_silence_ms} ms`}>
            <input
              type="range"
              min={400}
              max={3000}
              step={100}
              className="w-full accent-emerald-500"
              value={settings.vad_silence_ms}
              onChange={(e) =>
                update({ vad_silence_ms: Number(e.target.value) })
              }
            />
          </Field>

          <Field label="Aggressiveness">
            <select
              className="voice-input"
              value={settings.vad_aggressiveness}
              onChange={(e) =>
                update({ vad_aggressiveness: Number(e.target.value) })
              }
            >
              <option value={1}>1 — Low (may miss speech)</option>
              <option value={2}>2 — Balanced (recommended)</option>
              <option value={3}>3 — High (clean stop in noise)</option>
            </select>
          </Field>
        </div>
      ) : (
        <p className="text-sm text-neutral-400">Off — manual stop via shortcut only.</p>
      )}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-neutral-800/50 p-4">
      <div>
        <p className="font-medium">{label}</p>
        {description && (
          <p className="text-xs text-neutral-400">{description}</p>
        )}
      </div>
      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="h-6 w-11 rounded-full bg-neutral-700 transition peer-checked:bg-emerald-500 peer-focus:ring-2 peer-focus:ring-emerald-500/30 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-5" />
      </label>
    </div>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-400">
        {icon && <span className="text-neutral-500">{icon}</span>}
        {label}
      </span>
      {children}
    </label>
  );
}

/** Input that captures key combinations. */
function HotkeyCapture({
  value,
  capturing,
  onStart,
  onCapture,
  onCancel,
}: {
  value: string;
  capturing: boolean;
  onStart: () => void;
  onCapture: (hotkey: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!capturing) return;
    ref.current?.focus();

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        onCancel();
        return;
      }

      const modifiers: string[] = [];
      if (e.ctrlKey) modifiers.push("Ctrl");
      if (e.altKey) modifiers.push("Alt");
      if (e.shiftKey) modifiers.push("Shift");
      if (e.metaKey) modifiers.push("Super");

      const main = mainKeyFromEvent(e);
      if (!main || main.trim() === "") return; // only a modifier was pressed, wait

      const hotkey = [...modifiers, main].join("+");
      if (hotkey.trim() === "") return;
      onCapture(hotkey);
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [capturing, onCapture, onCancel]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onStart}
      className={`voice-input text-left font-mono text-xs transition ${
        capturing
          ? "border-emerald-500 text-emerald-400 ring-1 ring-emerald-500/30"
          : "text-neutral-200"
      }`}
    >
      {capturing ? "Press keys for shortcut…" : value || "Set shortcut"}
    </button>
  );
}

function mainKeyFromEvent(e: KeyboardEvent): string | null {
  // Modifier keys alone do not count as the main key
  if (
    ["Control", "Alt", "Shift", "Meta"].includes(e.key) ||
    e.code === "ControlLeft" ||
    e.code === "ControlRight" ||
    e.code === "AltLeft" ||
    e.code === "AltRight" ||
    e.code === "ShiftLeft" ||
    e.code === "ShiftRight" ||
    e.code === "MetaLeft" ||
    e.code === "MetaRight"
  ) {
    return null;
  }

  if (e.code.startsWith("Key")) return e.code.slice(3);
  if (e.code.startsWith("Digit")) return e.code.slice(5);
  if (e.code.startsWith("F") && e.code.length > 1) return e.code;

  switch (e.code) {
    case "Space":
      return "Space";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "Comma":
      return "Comma";
    case "Period":
      return "Period";
    case "Slash":
      return "Slash";
    case "Semicolon":
      return "Semicolon";
    case "Quote":
      return "Quote";
    case "BracketLeft":
      return "BracketLeft";
    case "BracketRight":
      return "BracketRight";
    case "Backslash":
      return "Backslash";
    case "Minus":
      return "Minus";
    case "Equal":
      return "Equal";
    case "Backquote":
      return "Backquote";
    case "Escape":
      return "Escape";
    case "Enter":
      return "Return";
    case "Backspace":
      return "Backspace";
    case "Tab":
      return "Tab";
    default:
      return e.key.length === 1 ? e.key.toUpperCase() : e.code;
  }
}

/** Equalizer-style wave indicator. */
function WaveIndicator({
  color,
  animate,
}: {
  color: string;
  animate: boolean;
}) {
  const bars = [0, 1, 2, 3, 4];
  return (
    <div className="flex h-7 w-10 items-center justify-center gap-[3px]">
      {bars.map((i) => (
        <span
          key={i}
          className={`w-[4px] rounded-full ${color} ${
            animate ? "voice-wave" : "h-2"
          }`}
          style={
            animate
              ? { animationDelay: `${i * 0.13}s` }
              : { height: `${[8, 14, 18, 14, 8][i]}px` }
          }
        />
      ))}
    </div>
  );
}

// --- Icons ---

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function TypeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  );
}

function StopwatchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 3" />
      <path d="M12 2v2" />
      <path d="M20.39 4.22l-1.64 1.64" />
      <path d="M3.61 4.22l1.64 1.64" />
    </svg>
  );
}

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19c0-1.7-1.3-3-3-3h-11a3 3 0 0 1-3-3c0-1.6 1.2-2.9 2.8-3a5 5 0 0 1 9.4-1.6 3 3 0 0 1 4.3 2.6 3.5 3.5 0 0 1 .5 6.9V19z" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="M15.5 7.5 21 2l-3-3-3.5 3.5z" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default App;
