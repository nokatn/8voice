import { useEffect, useMemo, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Settings, WhisperModel, DownloadEvent, LocalModelInfo } from "./types";

interface OnboardingProps {
  initialSettings: Settings;
  onComplete: (settings: Settings) => void;
}

type OnboardingMode = "welcome" | "download" | "local" | "groq";
type DownloadStatus = "idle" | "downloading" | "done" | "error";

export default function Onboarding({ initialSettings, onComplete }: OnboardingProps) {
  const [mode, setMode] = useState<OnboardingMode>("welcome");

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
      .catch((e) => setError("Model listesi alınamadı: " + String(e)));
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
          setError("İndirme hatası: " + event.data.message);
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
      setError("İndirme başlatılamadı: " + String(e));
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
          { name: "Tüm dosyalar", extensions: ["*"] },
        ],
        title: "Whisper model dosyası seç",
      });
      if (selected && typeof selected === "string") {
        setLocalPath(selected);
        const info = await invoke<LocalModelInfo>("cmd_validate_local_model", { path: selected });
        setLocalInfo(info);
      }
    } catch (e) {
      setError("Dosya seçilemedi: " + String(e));
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
      if (!ok) setError("Groq API anahtarı geçersiz.");
    } catch (e) {
      setGroqValid(false);
      setError("Groq doğrulama hatası: " + String(e));
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
      setError("Ayarlar kaydedilemedi: " + String(e));
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
    <main className="flex min-h-screen justify-center bg-neutral-950 px-4 py-6 text-neutral-100">
      <div className="w-full max-w-md">
        <header className="mb-6 flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white shadow-lg ring-1 ring-white/20">
            <span className="block h-5 w-5 rounded-full bg-neutral-900" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">8voice</h1>
            <p className="text-sm text-neutral-400">İlk kurulumu tamamlayın</p>
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-400 ring-1 ring-rose-500/20">
            {error}
          </div>
        )}

        {mode === "welcome" && (
          <section className="rounded-2xl bg-neutral-900 p-5 shadow-lg ring-1 ring-white/5">
            <h2 className="mb-4 text-base font-semibold">Transkripsiyon ayarını seçin</h2>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setMode("download")}
                className="flex items-center gap-4 rounded-xl bg-neutral-800 p-4 text-left transition hover:bg-neutral-700"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                  <DownloadIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">Model indir</p>
                  <p className="text-xs text-neutral-400">HuggingFace&apos;ten Whisper modeli indir.</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode("local")}
                className="flex items-center gap-4 rounded-xl bg-neutral-800 p-4 text-left transition hover:bg-neutral-700"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400">
                  <FolderIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">Bilgisayarımdan seç</p>
                  <p className="text-xs text-neutral-400">Daha önce indirdiğin .bin/.gguf dosyasını kullan.</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode("groq")}
                className="flex items-center gap-4 rounded-xl bg-neutral-800 p-4 text-left transition hover:bg-neutral-700"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/20 text-purple-400">
                  <CloudIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">Groq API kullan</p>
                  <p className="text-xs text-neutral-400">API key ile bulut üzerinden transkripsiyon.</p>
                </div>
              </button>
            </div>
          </section>
        )}

        {mode === "download" && (
          <section className="rounded-2xl bg-neutral-900 p-5 shadow-lg ring-1 ring-white/5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Model indir</h2>
              <button
                type="button"
                onClick={() => setMode("welcome")}
                className="text-xs text-neutral-400 hover:text-white"
              >
                Geri
              </button>
            </div>

            <div className="mb-4 flex flex-col gap-2">
              {models.map((m) => (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
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
              <div className="mb-4 rounded-xl bg-neutral-800 p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="text-neutral-300">İndiriliyor…</span>
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
                  className="mt-3 w-full rounded-lg bg-neutral-700 py-2 text-xs font-medium text-neutral-200 transition hover:bg-neutral-600"
                >
                  İptal et
                </button>
              </div>
            )}

            {downloadStatus === "done" && selectedModel && (
              <div className="mb-4 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-400 ring-1 ring-emerald-500/20">
                <p className="font-medium">{selectedModel.name} indirildi.</p>
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
                    ? "Kaydediliyor…"
                    : "Bu modeli kullan"
                  : "İndirmeyi başlat"}
              </button>
            )}
          </section>
        )}

        {mode === "local" && (
          <section className="rounded-2xl bg-neutral-900 p-5 shadow-lg ring-1 ring-white/5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Yerel model kullan</h2>
              <button
                type="button"
                onClick={() => setMode("welcome")}
                className="text-xs text-neutral-400 hover:text-white"
              >
                Geri
              </button>
            </div>

            <button
              type="button"
              onClick={chooseLocalFile}
              className="w-full rounded-xl bg-neutral-800 py-3 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700"
            >
              Model dosyası seç (.bin / .gguf)
            </button>

            {localPath && (
              <div className="mt-4 rounded-xl bg-neutral-800/50 p-3 text-sm">
                <p className="mb-1 break-all font-mono text-xs text-neutral-300">{localPath}</p>
                {localInfo ? (
                  <div className="text-xs">
                    {!localInfo.exists && <p className="text-rose-400">Dosya bulunamadı.</p>}
                    {localInfo.exists && !localInfo.valid_extension && (
                      <p className="text-rose-400">Uzantı .bin veya .gguf olmalı.</p>
                    )}
                    {localInfo.exists && localInfo.valid_extension && (
                      <p className="text-emerald-400">Geçerli model · {formatBytes(localInfo.size_bytes)}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-neutral-500">Doğrulanıyor…</p>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={finishLocal}
              disabled={!localInfo?.exists || !localInfo?.valid_extension || saving}
              className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? "Kaydediliyor…" : "Bu modeli kullan"}
            </button>
          </section>
        )}

        {mode === "groq" && (
          <section className="rounded-2xl bg-neutral-900 p-5 shadow-lg ring-1 ring-white/5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Groq API key</h2>
              <button
                type="button"
                onClick={() => setMode("welcome")}
                className="text-xs text-neutral-400 hover:text-white"
              >
                Geri
              </button>
            </div>

            <label className="mb-3 block text-xs text-neutral-400">
              Groq API anahtarınızı girin:
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setGroqValid(null);
                }}
                placeholder="gsk_..."
                className="voice-input mt-1.5 font-mono"
              />
            </label>

            <button
              type="button"
              onClick={validateGroq}
              disabled={validatingGroq || !apiKey.trim()}
              className="mb-4 w-full rounded-xl bg-neutral-800 py-2.5 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700 disabled:opacity-50"
            >
              {validatingGroq ? "Doğrulanıyor…" : "Key’i doğrula"}
            </button>

            {groqValid === true && (
              <p className="mb-4 text-sm text-emerald-400">API anahtarı geçerli.</p>
            )}
            {groqValid === false && !error && (
              <p className="mb-4 text-sm text-rose-400">API anahtarı geçersiz.</p>
            )}

            <button
              type="button"
              onClick={finishGroq}
              disabled={!groqValid || saving}
              className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? "Kaydediliyor…" : "Groq ile devam et"}
            </button>
          </section>
        )}
      </div>
    </main>
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
