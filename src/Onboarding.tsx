import { useEffect, useMemo, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Settings, WhisperModel, DownloadEvent, LocalModelInfo } from "./types";

interface OnboardingProps {
  initialSettings: Settings;
  onComplete: (settings: Settings) => void;
}

type OnboardingMode = "download" | "local" | "groq";
type DownloadStatus = "idle" | "downloading" | "done" | "error";

export default function Onboarding({ initialSettings, onComplete }: OnboardingProps) {
  const [mode, setMode] = useState<OnboardingMode>("download");

  // Download flow
  const [models, setModels] = useState<WhisperModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("small");
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>("idle");
  const [progress, setProgress] = useState<{ downloaded: number; total?: number; percent?: number }>({ downloaded: 0 });
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);

  // Local model flow
  const [localPath, setLocalPath] = useState<string>("");
  const [localInfo, setLocalInfo] = useState<LocalModelInfo | null>(null);

  // Groq flow
  const [apiKey, setApiKey] = useState<string>(initialSettings.api_key ?? "");
  const [groqValid, setGroqValid] = useState<boolean | null>(null);
  const [validatingGroq, setValidatingGroq] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invoke<WhisperModel[]>("cmd_list_whisper_models")
      .then(setModels)
      .catch((e) => setError("Could not load model list: " + String(e)));
  }, []);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId) ?? models[0],
    [models, selectedModelId],
  );

  const startDownload = async () => {
    if (!selectedModel) return;
    setDownloadStatus("downloading");
    setProgress({ downloaded: 0 });
    setError(null);
    setDownloadedPath(null);

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
          setDownloadStatus("done");
          setDownloadedPath(event.data.path);
          break;
        case "Error":
          setDownloadStatus("error");
          setError("Download error: " + event.data.message);
          break;
        case "Cancelled":
          setDownloadStatus("idle");
          break;
      }
    };

    try {
      await invoke("cmd_download_whisper_model", {
        filename: selectedModel.filename,
        channel,
      });
    } catch (e) {
      setDownloadStatus("error");
      setError("Could not start download: " + String(e));
    }
  };

  const cancelDownload = () => {
    invoke("cmd_cancel_download").catch((e) => console.error("Cancel failed:", e));
  };

  const chooseLocalFile = async () => {
    setError(null);
    setLocalInfo(null);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          { name: "Whisper model", extensions: ["bin", "gguf"] },
          { name: "All files", extensions: ["*"] },
        ],
        title: "Select Whisper model file",
      });
      if (selected && typeof selected === "string") {
        setLocalPath(selected);
        const info = await invoke<LocalModelInfo>("cmd_validate_local_model", { path: selected });
        setLocalInfo(info);
      }
    } catch (e) {
      setError("Could not select file: " + String(e));
    }
  };

  const validateGroq = async () => {
    if (!apiKey.trim()) {
      setGroqValid(false);
      return;
    }
    setValidatingGroq(true);
    setGroqValid(null);
    setError(null);
    try {
      const ok = await invoke<boolean>("cmd_validate_groq_key", { apiKey: apiKey.trim() });
      setGroqValid(ok);
      if (!ok) setError("Groq API key is invalid.");
    } catch (e) {
      setGroqValid(false);
      setError("Groq validation error: " + String(e));
    } finally {
      setValidatingGroq(false);
    }
  };

  const saveAndFinish = async (patch: Partial<Settings>) => {
    setSaving(true);
    setError(null);
    const finalSettings: Settings = {
      ...initialSettings,
      ...patch,
      has_completed_onboarding: true,
    };
    try {
      await invoke("cmd_save_settings", { settings: finalSettings });
      onComplete(finalSettings);
    } catch (e) {
      setError("Could not save settings: " + String(e));
    } finally {
      setSaving(false);
    }
  };

  const finishDownload = () => {
    if (!selectedModel) return;
    saveAndFinish({
      api_provider: "offline",
      model_path: `models/${selectedModel.filename}`,
    });
  };

  const finishLocal = () => {
    if (!localInfo?.exists || !localInfo.valid_extension) return;
    saveAndFinish({
      api_provider: "offline",
      model_path: localPath,
    });
  };

  const finishGroq = () => {
    if (!groqValid) return;
    saveAndFinish({
      api_provider: "groq",
      api_key: apiKey.trim(),
    });
  };

  const formatBytes = (bytes?: number) => {
    if (bytes == null) return "—";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <main className="flex h-screen w-screen bg-neutral-950 text-neutral-100">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-white/10 bg-neutral-900/50">
        <div className="p-6">
          <img
            src="/logo.svg"
            alt="8voice"
            className="mb-4 h-12 w-12"
          />
          <h1 className="text-lg font-bold tracking-tight">8voice</h1>
          <p className="text-xs text-neutral-400">Complete the initial setup</p>
        </div>

        <nav className="flex-1 space-y-1 px-3 pb-6">
          <TabButton
            active={mode === "download"}
            onClick={() => setMode("download")}
            icon={<DownloadIcon className="h-5 w-5" />}
          >
            Download model
          </TabButton>
          <TabButton
            active={mode === "local"}
            onClick={() => setMode("local")}
            icon={<FolderIcon className="h-5 w-5" />}
          >
            Local model
          </TabButton>
          <TabButton
            active={mode === "groq"}
            onClick={() => setMode("groq")}
            icon={<CloudIcon className="h-5 w-5" />}
          >
            Groq API
          </TabButton>
        </nav>
      </aside>

      {/* Content */}
      <section className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-8">
          {error && (
            <div className="mb-6 rounded-xl bg-rose-500/10 p-4 text-sm text-rose-400 ring-1 ring-rose-500/20">
              {error}
            </div>
          )}

          {mode === "download" && (
            <div className="mx-auto max-w-2xl">
              <h2 className="mb-2 text-xl font-semibold">Download model</h2>
              <p className="mb-6 text-sm text-neutral-400">
                Download a Whisper model from HuggingFace.
              </p>

              <div className="mb-6 space-y-3">
                {models.map((m) => (
                  <label
                    key={m.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                      selectedModelId === m.id
                        ? "border-emerald-500/50 bg-emerald-500/10"
                        : "border-neutral-800 bg-neutral-800/50 hover:bg-neutral-800"
                    }`}
                  >
                    <input
                      type="radio"
                      name="model"
                      className="mt-1 accent-emerald-500"
                      checked={selectedModelId === m.id}
                      onChange={() => setSelectedModelId(m.id)}
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{m.name}</span>
                        <span className="text-xs text-neutral-400">{m.size_human}</span>
                      </div>
                      <p className="text-xs text-neutral-500">{m.description}</p>
                    </div>
                  </label>
                ))}
              </div>

              {downloadStatus === "downloading" && (
                <div className="mb-6 rounded-xl bg-neutral-800 p-4">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="text-neutral-300">Downloading…</span>
                    <span className="text-neutral-400">
                      {formatBytes(progress.downloaded)}
                      {progress.total ? ` / ${formatBytes(progress.total)}` : ""}
                      {progress.percent != null ? ` (%${progress.percent.toFixed(1)})` : ""}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-700">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${progress.percent ?? 0}%` }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={cancelDownload}
                    className="mt-4 w-full rounded-lg bg-neutral-700 py-2 text-xs font-medium text-neutral-200 transition hover:bg-neutral-600"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {downloadStatus === "done" && selectedModel && (
                <div className="mb-6 rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-400 ring-1 ring-emerald-500/20">
                  <p className="font-medium">{selectedModel.name} downloaded.</p>
                  <p className="text-xs text-emerald-300/70">{downloadedPath}</p>
                </div>
              )}

              {downloadStatus !== "downloading" && (
                <button
                  type="button"
                  onClick={downloadStatus === "done" ? finishDownload : startDownload}
                  disabled={saving}
                  className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  {downloadStatus === "done"
                    ? saving
                      ? "Saving…"
                      : "Use this model"
                    : "Start download"}
                </button>
              )}
            </div>
          )}

          {mode === "local" && (
            <div className="mx-auto max-w-2xl">
              <h2 className="mb-2 text-xl font-semibold">Use local model</h2>
              <p className="mb-6 text-sm text-neutral-400">
                Use a previously downloaded .bin/.gguf file.
              </p>

              <button
                type="button"
                onClick={chooseLocalFile}
                className="w-full rounded-xl bg-neutral-800 py-3 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700"
              >
                Choose model file (.bin / .gguf)
              </button>

              {localPath && (
                <div className="mt-4 rounded-xl bg-neutral-800/50 p-4 text-sm">
                  <p className="mb-1 break-all font-mono text-xs text-neutral-300">{localPath}</p>
                  {localInfo ? (
                    <div className="text-xs">
                      {!localInfo.exists && <p className="text-rose-400">File not found.</p>}
                      {localInfo.exists && !localInfo.valid_extension && (
                        <p className="text-rose-400">Extension must be .bin or .gguf.</p>
                      )}
                      {localInfo.exists && localInfo.valid_extension && (
                        <p className="text-emerald-400">
                          Valid model · {formatBytes(localInfo.size_bytes)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-500">Validating…</p>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={finishLocal}
                disabled={!localInfo?.exists || !localInfo?.valid_extension || saving}
                className="mt-6 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Use this model"}
              </button>
            </div>
          )}

          {mode === "groq" && (
            <div className="mx-auto max-w-2xl">
              <h2 className="mb-2 text-xl font-semibold">Groq API key</h2>
              <p className="mb-6 text-sm text-neutral-400">
                Cloud transcription via API key.
              </p>

              <label className="mb-4 block text-sm text-neutral-400">
                Enter your Groq API key:
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setGroqValid(null);
                  }}
                  placeholder="gsk_..."
                  className="voice-input mt-2 font-mono"
                />
              </label>

              <button
                type="button"
                onClick={validateGroq}
                disabled={validatingGroq || !apiKey.trim()}
                className="mb-4 w-full rounded-xl bg-neutral-800 py-2.5 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700 disabled:opacity-50"
              >
                {validatingGroq ? "Validating…" : "Validate key"}
              </button>

              {groqValid === true && (
                <p className="mb-4 text-sm text-emerald-400">API key is valid.</p>
              )}
              {groqValid === false && !error && (
                <p className="mb-4 text-sm text-rose-400">API key is invalid.</p>
              )}

              <button
                type="button"
                onClick={finishGroq}
                disabled={!groqValid || saving}
                className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Continue with Groq"}
              </button>
            </div>
          )}
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

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
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
