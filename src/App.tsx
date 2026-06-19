import { useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { Settings, WhisperModel, VoskModelInfo, SherpaModelInfo, DownloadEvent, LocalModelInfo } from "./types";
import { LANGUAGES, AUTO_LANGUAGE } from "./languages";

// --- Types (must match backend) ---

type AppState =
  | "idle"
  | "recording"
  | "transcribing"
  | "injecting"
  | "error";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

const DEFAULT_SETTINGS: Settings = {
  input_device: null,
  model_path: "models/ggml-small.bin",
  language: "auto",
  hotkey: isMac ? "Super+Q" : "Ctrl+Q",
  hotkey_mode: "toggle",
  injection_mode: "auto",
  vad_enabled: true,
  vad_silence_ms: 1200,
  vad_aggressiveness: 2,
  api_provider: "whisper",
  api_key: null,
  groq_api_key: null,
  deepgram_api_key: null,
  assemblyai_api_key: null,
  has_completed_onboarding: false,
  launch_on_startup: false,
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

type UpdateInfo = {
  version: string;
  date?: string;
  body?: string;
};

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
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null);
  const [updateProgress, setUpdateProgress] = useState<null | "downloading" | "installed">(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

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
    let unU: UnlistenFn | undefined;
    let unUP: UnlistenFn | undefined;
    (async () => {
      un = await listen<{ state: AppState; previous: AppState }>(
        "app://state-changed",
        (e) => setState(e.payload.state),
      );
      unT = await listen<string>("app://transcript", (e) => {
        setLastTranscript(e.payload);
        copyToClipboard(e.payload);
      });
      unU = await listen<UpdateInfo>("app://update-available", (e) => {
        setUpdateAvailable(e.payload);
      });
      unUP = await listen<string>("app://update-progress", (e) => {
        if (e.payload === "downloading" || e.payload === "installed") {
          setUpdateProgress(e.payload);
        }
      });
    })();
    return () => {
      un?.();
      unT?.();
      unU?.();
      unUP?.();
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
        <div className="flex items-start gap-3 p-6">
          <img
            src="/logo.svg"
            alt="8voice"
            className="h-12 w-12 shrink-0"
          />
          <div>
            <h1 className="text-lg font-bold tracking-tight">8voice</h1>
            <p className="text-xs text-neutral-400">Settings</p>
          </div>
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
          {/* Update banner */}
          {updateAvailable && (
            <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 shadow-lg">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-emerald-300">
                    New version available: {updateAvailable.version}
                  </p>
                  {updateAvailable.body && (
                    <p className="mt-1 line-clamp-2 text-xs text-emerald-200/70">
                      {updateAvailable.body}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {updateProgress === "downloading" ? (
                    <span className="text-xs font-medium text-emerald-300">Downloading…</span>
                  ) : updateProgress === "installed" ? (
                    <span className="text-xs font-medium text-emerald-300">Restarting…</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setUpdateAvailable(null)}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-emerald-200/80 transition hover:bg-emerald-500/10 hover:text-emerald-200"
                      >
                        Later
                      </button>
                      <button
                        type="button"
                        onClick={() => invoke("cmd_install_update")}
                        className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-neutral-950 transition hover:bg-emerald-400"
                      >
                        Update now
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

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

          {/* Updates */}
          <div className="mt-6 flex items-center justify-between rounded-2xl bg-neutral-900 p-5 shadow-lg ring-1 ring-white/5">
            <div>
              <p className="text-sm font-semibold">Updates</p>
              <p className="text-xs text-neutral-400">
                {checkingUpdate
                  ? "Checking for updates…"
                  : updateAvailable
                    ? `Version ${updateAvailable.version} is ready to install.`
                    : "8voice checks for updates automatically on startup."}
              </p>
            </div>
            <button
              type="button"
              disabled={checkingUpdate}
              onClick={async () => {
                setCheckingUpdate(true);
                try {
                  const info = await invoke<UpdateInfo | null>("cmd_check_update");
                  if (info) {
                    setUpdateAvailable(info);
                  } else {
                    setUpdateAvailable(null);
                  }
                } catch (e) {
                  console.error("Update check failed:", e);
                } finally {
                  setCheckingUpdate(false);
                }
              }}
              className="shrink-0 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-200 transition hover:bg-neutral-700 hover:text-white disabled:opacity-50"
            >
              Check now
            </button>
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
            <option value={AUTO_LANGUAGE}>Auto</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
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
            label="Launch on startup"
            description="Start 8voice automatically when you log in."
            checked={settings.launch_on_startup}
            onChange={(checked) => update({ launch_on_startup: checked })}
          />
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-neutral-300">Setup</h3>
        <p className="mb-4 text-sm text-neutral-400">Re-run the initial setup wizard.</p>
        <button
          type="button"
          onClick={async () => {
            await invoke("cmd_save_settings", {
              settings: { ...settings, has_completed_onboarding: false },
            });
            window.location.reload();
          }}
          className="w-full rounded-xl bg-neutral-800 py-2.5 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700"
        >
          Re-run onboarding
        </button>
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
  const [showDownloader, setShowDownloader] = useState(false);
  const [models, setModels] = useState<WhisperModel[]>([]);
  const [progress, setProgress] = useState<{ downloaded: number; total?: number; percent?: number }>({ downloaded: 0 });
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadedFilenames, setDownloadedFilenames] = useState<Set<string>>(new Set());

  useEffect(() => {
    invoke<LocalModelInfo[]>("cmd_list_downloaded_models")
      .then((infos) => {
        const set = new Set<string>();
        for (const info of infos) {
          const fn = info.path.split(/[\\/]/).pop();
          if (fn) set.add(fn);
        }
        setDownloadedFilenames(set);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (showDownloader) {
      invoke<WhisperModel[]>("cmd_list_whisper_models")
        .then(setModels)
        .catch((e) => setDownloadError("Could not load model list: " + String(e)));
      invoke<LocalModelInfo[]>("cmd_list_downloaded_models")
        .then((infos) => {
          const set = new Set<string>();
          for (const info of infos) {
            const fn = info.path.split(/[\\/]/).pop();
            if (fn) set.add(fn);
          }
          setDownloadedFilenames(set);
        })
        .catch(() => {});
    }
  }, [showDownloader]);

  const startDownload = async (model: WhisperModel) => {
    setDownloadingId(model.id);
    setProgress({ downloaded: 0 });
    setDownloadError(null);

    const channel = new Channel<DownloadEvent>();
    channel.onmessage = (event) => {
      switch (event.event) {
        case "Started":
          setProgress((p) => ({ ...p, total: event.data.total }));
          break;
        case "Progress":
          setProgress({
            downloaded: event.data.downloaded,
            total: event.data.total,
            percent: event.data.percent,
          });
          break;
        case "Done":
          setDownloadingId(null);
          setDownloadedFilenames((prev) => new Set(prev).add(model.filename));
          break;
        case "Error":
          setDownloadingId(null);
          setDownloadError("Download error: " + event.data.message);
          break;
        case "Cancelled":
          setDownloadingId(null);
          break;
      }
    };

    try {
      await invoke("cmd_download_whisper_model", {
        modelUrl: model.url,
        filename: model.filename,
        channel,
      });
    } catch (e) {
      setDownloadingId(null);
      setDownloadError((prev) => prev ?? "Could not start download: " + String(e));
    }
  };

  const deleteModel = async (model: WhisperModel) => {
    setDownloadError(null);
    try {
      await invoke("cmd_delete_downloaded_model", { filename: model.filename });
      setDownloadedFilenames((prev) => {
        const next = new Set(prev);
        next.delete(model.filename);
        return next;
      });
    } catch (e) {
      setDownloadError("Could not delete model: " + String(e));
    }
  };

  const cancelDownload = () => {
    invoke("cmd_cancel_download").catch((e) => console.error("Cancel failed:", e));
  };

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
          <optgroup label="Local engines">
            <option value="whisper">Whisper (whisper.cpp)</option>
            <option value="sherpa_onnx">Sherpa-ONNX</option>
            <option value="vosk">Vosk</option>
          </optgroup>
          <optgroup label="Cloud API">
            <option value="groq">Groq Whisper API</option>
            <option value="deepgram">Deepgram Nova-2</option>
            <option value="assembly_ai">AssemblyAI Universal-2</option>
          </optgroup>
        </select>
      </Field>

      {settings.api_provider === "whisper" ? (
        <>
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

          {/* Download model section */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-800/30">
            <button
              type="button"
              onClick={() => setShowDownloader(!showDownloader)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-neutral-300 transition hover:text-white"
            >
              <span className="flex items-center gap-2">
                <DownloadIcon className="h-4 w-4" />
                Download model
              </span>
              <ChevronIcon className={`h-4 w-4 transition ${showDownloader ? "rotate-180" : ""}`} />
            </button>

            {showDownloader && (
              <div className="border-t border-neutral-800 px-4 pb-4 pt-3">
                {downloadError && (
                  <div className="mb-3 rounded-lg bg-rose-500/10 p-3 text-xs text-rose-400">
                    {downloadError}
                  </div>
                )}

                <div className="space-y-3">
                  {models.map((m) => {
                    const mm = MODEL_META[m.id] ?? { accuracy: 3, speed: 3, languages: "Multi-language" };
                    const isDownloaded = downloadedFilenames.has(m.filename);
                    const isRecommended = RECOMMENDED_MODELS.has(m.id);
                    const isDownloading = downloadingId === m.id;
                    const isActive = settings.model_path.includes(m.filename);
                    return (
                      <div
                        key={m.id}
                        className={`w-full rounded-xl border p-4 transition ${
                          isActive
                            ? "border-emerald-500/50 bg-emerald-500/10"
                            : "border-neutral-800 bg-neutral-800/50 hover:bg-neutral-800"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div
                            className={`flex-1 ${isDownloaded ? "cursor-pointer" : ""}`}
                            onClick={() => {
                              if (isDownloaded) {
                                update({ api_provider: "whisper", model_path: `models/${m.filename}` });
                              }
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{m.name}</span>
                              {isRecommended && (
                                <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
                                  Recommended
                                </span>
                              )}
                              {isActive && (
                                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                                  Active
                                </span>
                              )}
                              {isDownloaded && !isActive && (
                                <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-medium text-sky-400">
                                  Downloaded
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-neutral-500">{m.description}</p>
                            <div className="mt-3 flex items-center gap-2">
                              <span className="rounded-full bg-neutral-700/50 px-2 py-0.5 text-[10px] font-medium text-neutral-300">
                                {mm.languages}
                              </span>
                              <span className="text-xs text-neutral-400">{m.size_human}</span>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <RatingBar label="Accuracy" value={mm.accuracy} />
                            <RatingBar label="Speed" value={mm.speed} />
                            <div className="mt-1 flex items-center gap-1">
                              {isDownloaded ? (
                                <button
                                  type="button"
                                  onClick={() => deleteModel(m)}
                                  title="Delete"
                                  className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-rose-500/10 hover:text-rose-400"
                                >
                                  <TrashIcon className="h-4 w-4" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => startDownload(m)}
                                  disabled={isDownloading || downloadingId !== null}
                                  title={isDownloading ? "Downloading…" : "Download"}
                                  className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-emerald-500/10 hover:text-emerald-400 disabled:opacity-40"
                                >
                                  {isDownloading ? (
                                    <SpinnerIcon className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <DownloadIcon className="h-4 w-4" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        {isDownloading && (
                          <div className="mt-3">
                            <div className="mb-1 flex items-center justify-between text-xs">
                              <span className="text-neutral-300">Downloading…</span>
                              <span className="text-neutral-400">
                                {formatSize(progress.downloaded)}
                                {progress.total ? ` / ${formatSize(progress.total)}` : ""}
                                {progress.percent != null ? ` (${progress.percent.toFixed(1)}%)` : ""}
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-700">
                              <div
                                className="h-full bg-emerald-500 transition-all"
                                style={{ width: `${progress.percent ?? 0}%` }}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={cancelDownload}
                              className="mt-2 text-xs text-neutral-400 transition hover:text-rose-400"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      ) : settings.api_provider === "groq" ? (
        <Field label="Groq API key" icon={<KeyIcon className="h-3.5 w-3.5" />}>
          <input
            type="password"
            className="voice-input font-mono text-xs"
            value={settings.groq_api_key ?? ""}
            onChange={(e) =>
              update({ groq_api_key: e.target.value || null })
            }
            placeholder="gsk_..."
          />
        </Field>
      ) : settings.api_provider === "deepgram" ? (
        <Field label="Deepgram API key" icon={<KeyIcon className="h-3.5 w-3.5" />}>
          <input
            type="password"
            className="voice-input font-mono text-xs"
            value={settings.deepgram_api_key ?? ""}
            onChange={(e) =>
              update({ deepgram_api_key: e.target.value || null })
            }
            placeholder="DEEPGRAM_API_KEY"
          />
        </Field>
      ) : settings.api_provider === "assembly_ai" ? (
        <Field label="AssemblyAI API key" icon={<KeyIcon className="h-3.5 w-3.5" />}>
          <input
            type="password"
            className="voice-input font-mono text-xs"
            value={settings.assemblyai_api_key ?? ""}
            onChange={(e) =>
              update({ assemblyai_api_key: e.target.value || null })
            }
            placeholder="ASSEMBLYAI_API_KEY"
          />
        </Field>
      ) : settings.api_provider === "vosk" ? (
        <VoskModelSection settings={settings} update={update} />
      ) : settings.api_provider === "sherpa_onnx" ? (
        <SherpaModelSection settings={settings} update={update} />
      ) : null}
    </div>
  );
}

function VoskModelSection({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  const [models, setModels] = useState<VoskModelInfo[]>([]);
  const [valid, setValid] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<VoskModelInfo[]>("cmd_list_vosk_models").then(setModels).catch(() => {});
  }, []);

  useEffect(() => {
    if (settings.model_path) {
      invoke<boolean>("cmd_validate_vosk_model", { path: settings.model_path })
        .then(setValid)
        .catch(() => setValid(null));
    }
  }, [settings.model_path]);

  return (
    <div className="grid gap-6">
      <Field label="Vosk model directory" icon={<FileIcon className="h-3.5 w-3.5" />}>
        <div className="flex gap-2">
          <input
            className="voice-input font-mono text-xs"
            value={settings.model_path}
            onChange={(e) => update({ model_path: e.target.value })}
            placeholder="C:\vosk-models\vosk-model-small-tr-0.3"
          />
          <button
            type="button"
            onClick={async () => {
              try {
                const selected = await open({
                  multiple: false,
                  directory: true,
                  title: "Choose Vosk model directory",
                });
                if (selected && typeof selected === "string") {
                  update({ model_path: selected });
                }
              } catch (e) {
                console.error("Could not select Vosk model:", e);
              }
            }}
            className="shrink-0 rounded-lg bg-neutral-800 px-3 text-xs font-semibold text-neutral-200 transition hover:bg-neutral-700 hover:text-white"
          >
            Browse
          </button>
        </div>
        {valid === false && (
          <p className="mt-1 text-xs text-rose-400">
            Directory does not contain a valid Vosk model (missing am/conf files).
          </p>
        )}
        {valid === true && (
          <p className="mt-1 text-xs text-emerald-400">Valid Vosk model directory.</p>
        )}
      </Field>

      <div className="rounded-xl border border-neutral-800 bg-neutral-800/30 p-4">
        <p className="mb-3 text-xs font-medium text-neutral-400">Available Vosk models (download manually)</p>
        <div className="space-y-2">
          {models.map((m) => (
            <a
              key={m.id}
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-lg bg-neutral-800/50 px-3 py-2 transition hover:bg-neutral-700"
            >
              <div>
                <span className="text-sm text-neutral-200">{m.name}</span>
                <span className="ml-2 text-xs text-neutral-500">{m.size_human}</span>
              </div>
              <DownloadIcon className="h-3.5 w-3.5 text-neutral-400" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function SherpaModelSection({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  const [models, setModels] = useState<SherpaModelInfo[]>([]);
  const [valid, setValid] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<SherpaModelInfo[]>("cmd_list_sherpa_models").then(setModels).catch(() => {});
  }, []);

  useEffect(() => {
    if (settings.model_path) {
      invoke<boolean>("cmd_validate_sherpa_model", { path: settings.model_path })
        .then(setValid)
        .catch(() => setValid(null));
    }
  }, [settings.model_path]);

  return (
    <div className="grid gap-6">
      <Field label="Sherpa-ONNX model directory" icon={<FileIcon className="h-3.5 w-3.5" />}>
        <div className="flex gap-2">
          <input
            className="voice-input font-mono text-xs"
            value={settings.model_path}
            onChange={(e) => update({ model_path: e.target.value })}
            placeholder="C:\sherpa-models\sherpa-onnx-whisper-tiny"
          />
          <button
            type="button"
            onClick={async () => {
              try {
                const selected = await open({
                  multiple: false,
                  directory: true,
                  title: "Choose Sherpa-ONNX model directory",
                });
                if (selected && typeof selected === "string") {
                  update({ model_path: selected });
                }
              } catch (e) {
                console.error("Could not select Sherpa model:", e);
              }
            }}
            className="shrink-0 rounded-lg bg-neutral-800 px-3 text-xs font-semibold text-neutral-200 transition hover:bg-neutral-700 hover:text-white"
          >
            Browse
          </button>
        </div>
        {valid === false && (
          <p className="mt-1 text-xs text-rose-400">
            Directory does not contain a valid Sherpa-ONNX model (missing encoder.onnx, decoder.onnx, or tokens.txt).
          </p>
        )}
        {valid === true && (
          <p className="mt-1 text-xs text-emerald-400">Valid Sherpa-ONNX model directory.</p>
        )}
      </Field>

      <div className="rounded-xl border border-neutral-800 bg-neutral-800/30 p-4">
        <p className="mb-3 text-xs font-medium text-neutral-400">Available Sherpa-ONNX Whisper models (download manually)</p>
        <div className="space-y-2">
          {models.map((m) => (
            <a
              key={m.id}
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-lg bg-neutral-800/50 px-3 py-2 transition hover:bg-neutral-700"
            >
              <div>
                <span className="text-sm text-neutral-200">{m.name}</span>
                <span className="ml-2 text-xs text-neutral-500">{m.size_human}</span>
              </div>
              <DownloadIcon className="h-3.5 w-3.5 text-neutral-400" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes?: number) {
  if (bytes == null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
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

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function RatingBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-right text-[10px] text-neutral-500">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`h-1.5 w-5 rounded-full ${i <= value ? "bg-emerald-500" : "bg-neutral-700"}`}
          />
        ))}
      </div>
    </div>
  );
}

const RECOMMENDED_MODELS = new Set(["small", "large-v3-turbo"]);

const MODEL_META: Record<string, { accuracy: number; speed: number; languages: string }> = {
  tiny: { accuracy: 1, speed: 5, languages: "Multi-language" },
  base: { accuracy: 2, speed: 4, languages: "Multi-language" },
  small: { accuracy: 3, speed: 3, languages: "Multi-language" },
  medium: { accuracy: 4, speed: 2, languages: "Multi-language" },
  "large-v3": { accuracy: 5, speed: 1, languages: "Multi-language" },
  "large-v3-turbo": { accuracy: 4, speed: 4, languages: "Multi-language" },
  "distil-medium.en": { accuracy: 4, speed: 4, languages: "English" },
};

export default App;
