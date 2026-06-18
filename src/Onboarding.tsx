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
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadedFilenames, setDownloadedFilenames] = useState<Set<string>>(new Set());

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

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId) ?? models[0],
    [models, selectedModelId],
  );

  const startDownload = async (model: WhisperModel) => {
    setDownloadStatus("downloading");
    setDownloadingId(model.id);
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
          setDownloadedFilenames((prev) => new Set(prev).add(model.filename));
          setDownloadingId(null);
          break;
        case "Error":
          setDownloadStatus("error");
          setDownloadingId(null);
          setError("Download error: " + event.data.message);
          break;
        case "Cancelled":
          setDownloadStatus("idle");
          setDownloadingId(null);
          break;
      }
    };

    try {
      await invoke("cmd_download_whisper_model", {
        filename: model.filename,
        channel,
      });
    } catch (e) {
      setDownloadStatus("error");
      setDownloadingId(null);
      setError("Could not start download: " + String(e));
    }
  };

  const deleteModel = async (model: WhisperModel) => {
    setError(null);
    try {
      await invoke("cmd_delete_downloaded_model", { filename: model.filename });
      setDownloadedFilenames((prev) => {
        const next = new Set(prev);
        next.delete(model.filename);
        return next;
      });
    } catch (e) {
      setError("Could not delete model: " + String(e));
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
        <div className="flex items-start justify-between p-6">
          <img
            src="/logo.svg"
            alt="8voice"
            className="h-12 w-12"
          />
          <div>
            <h1 className="text-lg font-bold tracking-tight">8voice</h1>
            <p className="text-xs text-neutral-400">Complete the initial setup</p>
          </div>
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
                {models.map((m) => {
                  const mm = MODEL_META[m.id] ?? { accuracy: 3, speed: 3, languages: "Multi-language" };
                  const isSelected = selectedModelId === m.id;
                  const isDownloaded = downloadedFilenames.has(m.filename);
                  const isDownloading = downloadingId === m.id;
                  return (
                    <div
                      key={m.id}
                      className={`w-full rounded-xl border p-4 transition ${
                        isSelected
                          ? "border-emerald-500/50 bg-emerald-500/10"
                          : "border-neutral-800 bg-neutral-800/50 hover:bg-neutral-800"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div
                          className="flex-1 cursor-pointer"
                          onClick={() => setSelectedModelId(m.id)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{m.name}</span>
                            {isSelected && (
                              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                                Selected
                              </span>
                            )}
                            {isDownloaded && (
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
                              {formatBytes(progress.downloaded)}
                              {progress.total ? ` / ${formatBytes(progress.total)}` : ""}
                              {progress.percent != null ? ` (%${progress.percent.toFixed(1)})` : ""}
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

              {downloadStatus === "done" && selectedModel && downloadedPath && (
                <div className="mb-6 rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-400 ring-1 ring-emerald-500/20">
                  <p className="font-medium">{selectedModel.name} downloaded.</p>
                  <p className="text-xs text-emerald-300/70">{downloadedPath}</p>
                </div>
              )}

              <button
                type="button"
                onClick={finishDownload}
                disabled={!selectedModel || !downloadedFilenames.has(selectedModel.filename) || saving}
                className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Use this model"}
              </button>
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

const MODEL_META: Record<string, { accuracy: number; speed: number; languages: string }> = {
  tiny: { accuracy: 1, speed: 5, languages: "Multi-language" },
  base: { accuracy: 2, speed: 4, languages: "Multi-language" },
  small: { accuracy: 3, speed: 3, languages: "Multi-language" },
  medium: { accuracy: 4, speed: 2, languages: "Multi-language" },
  "large-v3": { accuracy: 5, speed: 1, languages: "Multi-language" },
  "large-v3-turbo": { accuracy: 4, speed: 4, languages: "Multi-language" },
};
