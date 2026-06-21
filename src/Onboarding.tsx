import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { LANGUAGES, AUTO_LANGUAGE } from "./languages";
import type { Settings, WhisperModel, DownloadEvent, LocalModelInfo, ApiProvider } from "./types";

interface OnboardingProps {
  initialSettings: Settings;
  onComplete: (settings: Settings) => void;
}

const STEPS = [
  { id: "provider", label: "Transcription" },
  { id: "microphone", label: "Microphone" },
  { id: "language", label: "Language" },
  { id: "shortcut", label: "Shortcut" },
  { id: "injection", label: "Injection" },
  { id: "finish", label: "Finish" },
] as const;

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

const DEFAULT_HOTKEY = isMac ? "Super+Q" : "Ctrl+Q";

export default function Onboarding({ initialSettings, onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // --- Wizard settings (accumulated across steps) ---
  type ProviderTab = "cloud" | "local" | "local_model";
  const initialTab: ProviderTab = initialSettings.api_provider === "whisper" && initialSettings.model_path !== "" && !initialSettings.model_path.startsWith("models/") ? "local_model" : ["groq", "deepgram", "assembly_ai"].includes(initialSettings.api_provider) ? "cloud" : "local";
  const [provider, setProvider] = useState<ApiProvider>(initialSettings.api_provider);
  const [providerTab, setProviderTab] = useState<ProviderTab>(initialTab);
  const [modelPath, setModelPath] = useState(initialSettings.model_path);
  const [groqKey, setGroqKey] = useState(initialSettings.groq_api_key ?? initialSettings.api_key ?? "");
  const [deepgramKey, setDeepgramKey] = useState(initialSettings.deepgram_api_key ?? "");
  const [assemblyAIKey, setAssemblyAIKey] = useState(initialSettings.assemblyai_api_key ?? "");
  const [inputDevice, setInputDevice] = useState<string | null>(initialSettings.input_device);
  const [language, setLanguage] = useState(initialSettings.language);
  const [hotkey, setHotkey] = useState(initialSettings.hotkey || DEFAULT_HOTKEY);
  const [hotkeyMode, setHotkeyMode] = useState(initialSettings.hotkey_mode);
  const [injectionMode, setInjectionMode] = useState(initialSettings.injection_mode);

  // --- Provider step state ---
  // Download flow
  const [models, setModels] = useState<WhisperModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("small");
  const [progress, setProgress] = useState<{ downloaded: number; total?: number; percent?: number }>({ downloaded: 0 });
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadedFilenames, setDownloadedFilenames] = useState<Set<string>>(new Set());
  // Local model flow
  const [localPath, setLocalPath] = useState("");
  const [localInfo, setLocalInfo] = useState<LocalModelInfo | null>(null);
  // Groq validation
  const [groqValid, setGroqValid] = useState<boolean | null>(null);
  const [validatingGroq, setValidatingGroq] = useState(false);
  // Deepgram validation
  const [deepgramValid, setDeepgramValid] = useState<boolean | null>(null);
  const [validatingDeepgram, setValidatingDeepgram] = useState(false);
  // AssemblyAI validation
  const [assemblyAIValid, setAssemblyAIValid] = useState<boolean | null>(null);
  const [validatingAssemblyAI, setValidatingAssemblyAI] = useState(false);

  // --- Microphone step state ---
  const [devices, setDevices] = useState<string[]>([]);

  // --- Shortcut step state ---
  const [capturingHotkey, setCapturingHotkey] = useState(false);

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

  // Switch provider when toggling tabs
  useEffect(() => {
    if (providerTab === "local" && !["whisper", "sherpa_onnx", "vosk"].includes(provider)) {
      setProvider("whisper");
    } else if (providerTab === "local_model") {
      setProvider("whisper");
    } else if (providerTab === "cloud" && ["whisper", "sherpa_onnx", "vosk"].includes(provider)) {
      setProvider("groq");
    }
  }, [providerTab]);

  useEffect(() => {
    invoke<string[]>("cmd_list_devices")
      .then(setDevices)
      .catch(() => {});
  }, []);

  // --- Provider helpers ---

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId) ?? models[0],
    [models, selectedModelId],
  );

  const startDownload = async (model: WhisperModel) => {
    setDownloadingId(model.id);
    setProgress({ downloaded: 0 });
    setError(null);

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
          setDownloadedFilenames((prev) => new Set(prev).add(model.filename));
          setDownloadingId(null);
          break;
        case "Error":
          setDownloadingId(null);
          setError("Download error: " + event.data.message);
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
      setError((prev) => prev ?? "Could not start download: " + String(e));
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
        setSelectedModelId("");       // deselect any download model
        setModelPath(selected);         // use the local file
        const info = await invoke<LocalModelInfo>("cmd_validate_local_model", { path: selected });
        setLocalInfo(info);
      }
    } catch (e) {
      setError("Could not select file: " + String(e));
    }
  };

  const validateGroq = async () => {
    if (!groqKey.trim()) { setGroqValid(false); return; }
    setValidatingGroq(true);
    setGroqValid(null);
    setError(null);
    try {
      const ok = await invoke<boolean>("cmd_validate_groq_key", { apiKey: groqKey.trim() });
      setGroqValid(ok);
      if (!ok) setError("Groq API key is invalid.");
    } catch (e) {
      setGroqValid(false);
      setError("Groq validation error: " + String(e));
    } finally {
      setValidatingGroq(false);
    }
  };

  const validateDeepgram = async () => {
    if (!deepgramKey.trim()) { setDeepgramValid(false); return; }
    setValidatingDeepgram(true);
    setDeepgramValid(null);
    setError(null);
    try {
      const ok = await invoke<boolean>("cmd_validate_deepgram_key", { apiKey: deepgramKey.trim() });
      setDeepgramValid(ok);
      if (!ok) setError("Deepgram API key is invalid.");
    } catch (e) {
      setDeepgramValid(false);
      setError("Deepgram validation error: " + String(e));
    } finally {
      setValidatingDeepgram(false);
    }
  };

  const validateAssemblyAI = async () => {
    if (!assemblyAIKey.trim()) { setAssemblyAIValid(false); return; }
    setValidatingAssemblyAI(true);
    setAssemblyAIValid(null);
    setError(null);
    try {
      const ok = await invoke<boolean>("cmd_validate_assemblyai_key", { apiKey: assemblyAIKey.trim() });
      setAssemblyAIValid(ok);
      if (!ok) setError("AssemblyAI API key is invalid.");
    } catch (e) {
      setAssemblyAIValid(false);
      setError("AssemblyAI validation error: " + String(e));
    } finally {
      setValidatingAssemblyAI(false);
    }
  };

  // --- Navigation ---

  const canProceed = () => {
    switch (step) {
      case 0: { // Provider
        if (provider === "whisper") {
          if (providerTab === "local_model") return localPath !== "" && localInfo?.exists && localInfo?.valid_extension;
          return !!selectedModel && downloadedFilenames.has(selectedModel.filename) && !downloadingId;
        }
        if (provider === "groq") return groqValid === true;
        if (provider === "deepgram") return deepgramValid === true;
        if (provider === "assembly_ai") return assemblyAIValid === true;
        // sherpa_onnx / vosk: model path is required
        return !!modelPath;
      }
      case 1: return true; // microphone — default is fine
      case 2: return true; // language — auto is fine
      case 3: return true; // shortcut — default is fine
      case 4: return true; // injection — default is fine
      case 5: return true;
      default: return false;
    }
  };

  const handleNext = () => {
    if (step < STEPS.length - 1 && canProceed()) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  // --- Save ---

  const buildSettings = (): Settings => ({
    ...initialSettings,
    input_device: inputDevice,
    model_path: modelPath,
    language,
    hotkey,
    hotkey_mode: hotkeyMode,
    injection_mode: injectionMode,
    api_provider: provider,
    groq_api_key: groqKey.trim() || null,
    deepgram_api_key: deepgramKey.trim() || null,
    assemblyai_api_key: assemblyAIKey.trim() || null,
    has_completed_onboarding: true,
  });

  const finish = async () => {
    setSaving(true);
    setError(null);
    const s = buildSettings();
    try {
      await invoke("cmd_save_settings", { settings: s });
      onComplete(s);
    } catch (e) {
      setError("Could not save settings: " + String(e));
    } finally {
      setSaving(false);
    }
  };

  // --- Helpers ---

  const formatBytes = (bytes?: number) => {
    if (bytes == null) return "—";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const iconForStep = (i: number) => {
    switch (i) {
      case 0: return <CloudIcon className="h-5 w-5" />;
      case 1: return <MicIcon className="h-5 w-5" />;
      case 2: return <GlobeIcon className="h-5 w-5" />;
      case 3: return <KeyboardIcon className="h-5 w-5" />;
      case 4: return <TypeIcon className="h-5 w-5" />;
      case 5: return <CheckIcon className="h-5 w-5" />;
      default: return null;
    }
  };

  // --- Render ---

  return (
    <main className="flex h-screen w-screen bg-neutral-950 text-neutral-100">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-white/10 bg-neutral-900/50">
        <div className="flex items-start gap-3 p-6">
          <img src="/logo.svg" alt="8voice" className="h-12 w-12" />
          <div>
            <h1 className="text-lg font-bold tracking-tight">8voice</h1>
            <p className="text-xs text-neutral-400">Setup wizard</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 pb-6">
          {STEPS.map((s, i) => (
            <StepButton
              key={i}
              active={step === i}
              completed={i < step}
              icon={iconForStep(i)}
            >
              {s.label}
            </StepButton>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <section className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-8">
          {/* Progress */}
          <div className="mb-6">
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span>Step {step + 1} of {STEPS.length}</span>
              <span>{Math.round(((step + 1) / STEPS.length) * 100)}%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
              />
            </div>
          </div>

          {error && (
            <div className="mb-6 rounded-xl bg-rose-500/10 p-4 text-sm text-rose-400 ring-1 ring-rose-500/20">
              {error}
            </div>
          )}

          {/* Step: Provider */}
          {step === 0 && (
            <div className="mx-auto max-w-2xl">
              <h2 className="mb-2 text-xl font-semibold">Transcription provider</h2>
              <p className="mb-6 text-sm text-neutral-400">
                Choose how your speech is converted to text.
              </p>

              {/* Tab switcher */}
              <div className="mb-6 flex rounded-xl bg-neutral-900 p-1">
                <button
                  type="button"
                  onClick={() => setProviderTab("cloud")}
                  className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                    providerTab === "cloud" ? "bg-emerald-600 text-white shadow" : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  Cloud API
                </button>
                <button
                  type="button"
                  onClick={() => setProviderTab("local")}
                  className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                    providerTab === "local" ? "bg-emerald-600 text-white shadow" : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  Local Engine
                </button>
                <button
                  type="button"
                  onClick={() => setProviderTab("local_model")}
                  className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                    providerTab === "local_model" ? "bg-emerald-600 text-white shadow" : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  Local Model
                </button>
              </div>

              {providerTab === "cloud" && (
                <div className="mx-auto max-w-xl space-y-3">
                  <ProviderCard
                    selected={provider === "groq"}
                    onSelect={() => setProvider("groq")}
                    name="Groq Whisper API"
                    desc="Fast cloud transcription using Groq's LPU inference engine."
                    recommended
                  >
                    <label className="mt-3 block text-sm text-neutral-400">
                      <span className="mb-1 flex items-center justify-between">
                        Enter your Groq API key:
                        <ApiKeyGuide provider="groq" />
                      </span>
                      <input
                        type="password"
                        value={groqKey}
                        onChange={(e) => { setGroqKey(e.target.value); setGroqValid(null); }}
                        placeholder="gsk_..."
                        className="voice-input mt-1 font-mono"
                      />
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={validateGroq}
                        disabled={validatingGroq || !groqKey.trim()}
                        className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700 disabled:opacity-50"
                      >
                        {validatingGroq ? "Validating…" : "Validate"}
                      </button>
                      {groqValid === true && <span className="text-xs text-emerald-400">Valid</span>}
                      {groqValid === false && <span className="text-xs text-rose-400">Invalid</span>}
                    </div>
                  </ProviderCard>

                  <ProviderCard
                    selected={provider === "deepgram"}
                    onSelect={() => setProvider("deepgram")}
                    name="Deepgram Nova-2"
                    desc="Cloud transcription using Deepgram's Nova-2 model."
                  >
                    <label className="mt-3 block text-sm text-neutral-400">
                      <span className="mb-1 flex items-center justify-between">
                        Enter your Deepgram API key:
                        <ApiKeyGuide provider="deepgram" />
                      </span>
                      <input
                        type="password"
                        value={deepgramKey}
                        onChange={(e) => { setDeepgramKey(e.target.value); setDeepgramValid(null); }}
                        placeholder="DEEPGRAM_API_KEY"
                        className="voice-input mt-1 font-mono"
                      />
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={validateDeepgram}
                        disabled={validatingDeepgram || !deepgramKey.trim()}
                        className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700 disabled:opacity-50"
                      >
                        {validatingDeepgram ? "Validating…" : "Validate"}
                      </button>
                      {deepgramValid === true && <span className="text-xs text-emerald-400">Valid</span>}
                      {deepgramValid === false && <span className="text-xs text-rose-400">Invalid</span>}
                    </div>
                  </ProviderCard>

                  <ProviderCard
                    selected={provider === "assembly_ai"}
                    onSelect={() => setProvider("assembly_ai")}
                    name="AssemblyAI Universal-2"
                    desc="Cloud transcription with AssemblyAI's Universal-2 model."
                  >
                    <label className="mt-3 block text-sm text-neutral-400">
                      <span className="mb-1 flex items-center justify-between">
                        Enter your AssemblyAI API key:
                        <ApiKeyGuide provider="assembly_ai" />
                      </span>
                      <input
                        type="password"
                        value={assemblyAIKey}
                        onChange={(e) => { setAssemblyAIKey(e.target.value); setAssemblyAIValid(null); }}
                        placeholder="ASSEMBLYAI_API_KEY"
                        className="voice-input mt-1 font-mono"
                      />
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={validateAssemblyAI}
                        disabled={validatingAssemblyAI || !assemblyAIKey.trim()}
                        className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700 disabled:opacity-50"
                      >
                        {validatingAssemblyAI ? "Validating…" : "Validate"}
                      </button>
                      {assemblyAIValid === true && <span className="text-xs text-emerald-400">Valid</span>}
                      {assemblyAIValid === false && <span className="text-xs text-rose-400">Invalid</span>}
                    </div>
                  </ProviderCard>
                </div>
              )}

              {providerTab === "local" && (
                <div className="flex gap-4">
                  {/* Left panel: provider list */}
                  <div className="w-48 shrink-0 space-y-2">
                    <LocalButton
                      selected={provider === "whisper"}
                      onSelect={() => setProvider("whisper")}
                      recommended
                    >
                      Whisper (whisper.cpp)
                    </LocalButton>
                    <LocalButton
                      selected={provider === "sherpa_onnx"}
                      onSelect={() => setProvider("sherpa_onnx")}
                    >
                      Sherpa-ONNX
                    </LocalButton>
                    <LocalButton
                      selected={provider === "vosk"}
                      onSelect={() => setProvider("vosk")}
                    >
                      Vosk
                    </LocalButton>
                  </div>

                  {/* Right panel: content */}
                  <div className="min-w-0 flex-1">
                    {provider === "whisper" && (
                      <div className="space-y-3 rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Whisper (whisper.cpp)</span>
                          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                            Selected
                          </span>
                        </div>
                        <p className="text-xs text-neutral-400">
                          Download a Whisper model for local on-device transcription.
                        </p>
                        <div className="space-y-2">
                          {downloadedFilenames.has(selectedModel?.filename) && (
                            <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                              {selectedModel?.name} ready to use.
                            </div>
                          )}
                          <div className="space-y-2">
                            {models.map((m) => {
                              const mm = MODEL_META[m.id] ?? { accuracy: 3, speed: 3, languages: "Multi-language" };
                              const isLocalMode = localPath !== "";
                              const isSel = selectedModelId === m.id;
                              const isDl = downloadedFilenames.has(m.filename);
                              const isDling = downloadingId === m.id;
                              const isRec = RECOMMENDED_MODELS.has(m.id);
                              return (
                                <div key={m.id} className={`rounded-lg border p-3 transition ${isSel && !isLocalMode ? "border-emerald-500/50 bg-emerald-500/10" : "border-neutral-800 bg-neutral-800/50"}`}>
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1 cursor-pointer" onClick={() => { setSelectedModelId(m.id); setModelPath(`models/${m.filename}`); setLocalPath(""); setLocalInfo(null); }}>
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-sm font-medium">{m.name}</span>
                                        {isRec && <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">Recommended</span>}
                                        {isSel && !isLocalMode && <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">Selected</span>}
                                        {isDl && !isSel && <span className="rounded-full bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-medium text-sky-400">Downloaded</span>}
                                      </div>
                                      <div className="mt-1 flex items-center gap-2">
                                        <span className="rounded-full bg-neutral-700/50 px-1.5 py-0.5 text-[9px] text-neutral-300">{mm.languages}</span>
                                        <span className="text-[10px] text-neutral-400">{m.size_human}</span>
                                      </div>
                                    </div>
                                    <div className="shrink-0">
                                      {isDl ? (
                                        <button type="button" onClick={() => deleteModel(m)} title="Delete" className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-rose-500/10 hover:text-rose-400">
                                          <TrashIcon className="h-3.5 w-3.5" />
                                        </button>
                                      ) : (
                                        <button type="button" onClick={() => startDownload(m)} disabled={isDling || downloadingId !== null} title={isDling ? "Downloading…" : "Download"} className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-emerald-500/10 hover:text-emerald-400 disabled:opacity-40">
                                          {isDling ? <SpinnerIcon className="h-3.5 w-3.5 animate-spin" /> : <DownloadIcon className="h-3.5 w-3.5" />}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  {isDling && (
                                    <div className="mt-2">
                                      <div className="mb-1 flex items-center justify-between text-[10px]">
                                        <span className="text-neutral-300">Downloading…</span>
                                        <span className="text-neutral-400">{formatBytes(progress.downloaded)}{progress.total ? ` / ${formatBytes(progress.total)}` : ""}</span>
                                      </div>
                                      <div className="h-1 w-full overflow-hidden rounded-full bg-neutral-700">
                                        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress.percent ?? 0}%` }} />
                                      </div>
                                      <button type="button" onClick={cancelDownload} className="mt-1 text-[10px] text-neutral-400 hover:text-rose-400">Cancel</button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            </div>
                          </div>
                      </div>
                    )}

                    {provider === "sherpa_onnx" && (
                      <div className="rounded-xl border border-neutral-800 bg-neutral-800/50 p-4">
                        <p className="text-sm font-medium">Sherpa-ONNX</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          Local engine (stub). Requires separate ONNX runtime setup.
                        </p>
                      </div>
                    )}

                    {provider === "vosk" && (
                      <div className="rounded-xl border border-neutral-800 bg-neutral-800/50 p-4">
                        <p className="text-sm font-medium">Vosk</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          Local engine (stub). Requires separate Vosk API installation.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {providerTab === "local_model" && (
                <div className="mx-auto max-w-xl">
                  <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Local Model</span>
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                        Whisper
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-400">
                      Use an existing .bin or .gguf model file from your computer.
                    </p>
                    <div className="mt-4 space-y-3">
                      <button type="button" onClick={chooseLocalFile} className="w-full rounded-lg bg-neutral-800 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700">
                        Select .bin / .gguf file
                      </button>
                      {localPath && localInfo && (
                        <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-medium text-emerald-400">Using local file</span>
                            <button type="button" onClick={() => { setLocalPath(""); setLocalInfo(null); setModelPath(""); setSelectedModelId("small"); }} className="text-[10px] text-neutral-400 hover:text-rose-400">Clear</button>
                          </div>
                          <p className="mt-1 break-all font-mono text-[10px] text-neutral-200">{localPath}</p>
                          {localInfo.exists && localInfo.valid_extension && <p className="mt-0.5 text-[10px] text-emerald-400">{formatBytes(localInfo.size_bytes)}</p>}
                          {(!localInfo.exists || !localInfo.valid_extension) && <p className="mt-0.5 text-[10px] text-rose-400">File not found or invalid extension.</p>}
                        </div>
                      )}
                      {!localPath && (
                        <p className="text-center text-[10px] text-neutral-500">
                          Select a previously downloaded Whisper model file to use it for transcription.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step: Microphone */}
          {step === 1 && (
            <div className="mx-auto max-w-2xl">
              <h2 className="mb-2 text-xl font-semibold">Microphone</h2>
              <p className="mb-6 text-sm text-neutral-400">
                Select the microphone you want to use for dictation.
              </p>

              <label className="block text-sm text-neutral-400">
                <span className="mb-1 flex items-center gap-1.5">
                  <MicIcon className="h-3.5 w-3.5 text-neutral-500" />
                  Input device
                </span>
                <select
                  className="voice-input mt-1"
                  value={inputDevice ?? ""}
                  onChange={(e) => setInputDevice(e.target.value || null)}
                >
                  <option value="">System default</option>
                  {devices.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
              <p className="mt-2 text-xs text-neutral-500">
                You can change this later in Settings.
              </p>
            </div>
          )}

          {/* Step: Language */}
          {step === 2 && (
            <div className="mx-auto max-w-2xl">
              <h2 className="mb-2 text-xl font-semibold">Language</h2>
              <p className="mb-6 text-sm text-neutral-400">
                Set the transcription language. Choose "Auto" for automatic detection (Whisper only).
              </p>

              <label className="block text-sm text-neutral-400">
                <span className="mb-1 flex items-center gap-1.5">
                  <GlobeIcon className="h-3.5 w-3.5 text-neutral-500" />
                  Language
                </span>
                <select
                  className="voice-input mt-1"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  <option value={AUTO_LANGUAGE}>Auto (detect)</option>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>{l.name}</option>
                  ))}
                </select>
              </label>
              <p className="mt-2 text-xs text-neutral-500">
                Cloud APIs (Groq, Deepgram, AssemblyAI) use "en" when available, others fall back to the selected language.
              </p>
            </div>
          )}

          {/* Step: Shortcut */}
          {step === 3 && (
            <div className="mx-auto max-w-2xl">
              <h2 className="mb-2 text-xl font-semibold">Shortcut</h2>
              <p className="mb-6 text-sm text-neutral-400">
                Set a global keyboard shortcut to start/stop recording.
              </p>

              <div className="grid gap-5 md:grid-cols-2">
                <label className="block text-sm text-neutral-400">
                  <span className="mb-1 flex items-center gap-1.5">
                    <KeyboardIcon className="h-3.5 w-3.5 text-neutral-500" />
                    Shortcut
                  </span>
                  <HotkeyCapture
                    value={hotkey}
                    capturing={capturingHotkey}
                    onStart={() => setCapturingHotkey(true)}
                    onCapture={(k) => { setCapturingHotkey(false); setHotkey(k); }}
                    onCancel={() => setCapturingHotkey(false)}
                  />
                </label>

                <label className="block text-sm text-neutral-400">
                  <span className="mb-1 flex items-center gap-1.5">
                    <SwitchIcon className="h-3.5 w-3.5 text-neutral-500" />
                    Mode
                  </span>
                  <select
                    className="voice-input mt-1"
                    value={hotkeyMode}
                    onChange={(e) => setHotkeyMode(e.target.value as Settings["hotkey_mode"])}
                  >
                    <option value="toggle">Toggle (press once to start/stop)</option>
                    <option value="push_to_talk">Hold to talk</option>
                  </select>
                </label>
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                You can change both in Settings later.
              </p>
            </div>
          )}

          {/* Step: Injection */}
          {step === 4 && (
            <div className="mx-auto max-w-2xl">
              <h2 className="mb-2 text-xl font-semibold">Injection mode</h2>
              <p className="mb-6 text-sm text-neutral-400">
                How should the transcribed text be inserted into the active window?
              </p>

              <div className="space-y-3">
                <InjectionCard
                  selected={injectionMode === "auto"}
                  onSelect={() => setInjectionMode("auto")}
                  name="Auto"
                  desc="Uses paste for long text, keyboard typing for short snippets."
                />
                <InjectionCard
                  selected={injectionMode === "typing"}
                  onSelect={() => setInjectionMode("typing")}
                  name="Always type"
                  desc="Simulates keystrokes for every character. Works everywhere but slower for long text."
                />
                <InjectionCard
                  selected={injectionMode === "paste"}
                  onSelect={() => setInjectionMode("paste")}
                  name="Always paste"
                  desc="Copies to clipboard and simulates Ctrl+V. Fast but may not work in some fields."
                />
              </div>
            </div>
          )}

          {/* Step: Finish */}
          {step === 5 && (
            <div className="mx-auto max-w-2xl">
              <h2 className="mb-2 text-xl font-semibold">Ready to go</h2>
              <p className="mb-6 text-sm text-neutral-400">
                Review your choices below, then click "Get started".
              </p>

              <div className="space-y-4">
                <SummaryRow label="Provider" value={providerLabel(provider)} />
                {provider === "whisper" && <SummaryRow label="Model" value={modelPath} />}
                {provider === "groq" && <SummaryRow label="Groq API key" value={groqKey ? `${groqKey.slice(0, 8)}…` : "—"} />}
                {provider === "deepgram" && <SummaryRow label="Deepgram API key" value={deepgramKey ? `${deepgramKey.slice(0, 8)}…` : "—"} />}
                {provider === "assembly_ai" && <SummaryRow label="AssemblyAI API key" value={assemblyAIKey ? `${assemblyAIKey.slice(0, 8)}…` : "—"} />}
                <SummaryRow label="Microphone" value={inputDevice || "System default"} />
                <SummaryRow label="Language" value={language === "auto" ? "Auto (detect)" : LANGUAGES.find((l) => l.code === language)?.name ?? language} />
                <SummaryRow label="Shortcut" value={hotkey} />
                <SummaryRow label="Mode" value={hotkeyMode === "toggle" ? "Toggle" : "Hold to talk"} />
                <SummaryRow label="Injection" value={injectionMode === "auto" ? "Auto" : injectionMode === "typing" ? "Always type" : "Always paste"} />
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between border-t border-white/10 px-8 py-4">
          <button
            type="button"
            onClick={handleBack}
            disabled={step === 0}
            className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={!canProceed()}
              className="rounded-xl bg-emerald-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              disabled={saving}
              className="rounded-xl bg-emerald-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Get started"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

// --- Sub-components ---

function StepButton({
  active,
  completed,
  icon,
  children,
}: {
  active: boolean;
  completed: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
        active
          ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30"
          : completed
            ? "text-neutral-300"
            : "text-neutral-500"
      }`}
    >
      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
        completed
          ? "bg-emerald-500/20 text-emerald-400"
          : active
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-neutral-800 text-neutral-500"
      }`}>
        {completed ? <CheckIcon className="h-3 w-3" /> : icon}
      </span>
      {children}
    </button>
  );
}

function LocalButton({
  selected,
  onSelect,
  recommended,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  recommended?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
        selected
          ? "border-emerald-500/50 bg-emerald-500/10"
          : "border-neutral-800 bg-neutral-800/50 hover:bg-neutral-800"
      }`}
    >
      <span className="font-medium">{children}</span>
      {recommended && !selected && (
        <span className="ml-1 text-[9px] text-amber-400">★</span>
      )}
    </button>
  );
}

function ProviderCard({
  selected,
  onSelect,
  name,
  desc,
  recommended,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  name: string;
  desc: string;
  recommended?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`w-full rounded-xl border p-4 transition cursor-pointer ${
        selected
          ? "border-emerald-500/50 bg-emerald-500/10"
          : "border-neutral-800 bg-neutral-800/50 hover:bg-neutral-800"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{name}</span>
            {selected && (
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                Selected
              </span>
            )}
            {recommended && !selected && (
              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
                Recommended
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-neutral-500">{desc}</p>
        </div>
        <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 transition ${
          selected ? "border-emerald-500 bg-emerald-500" : "border-neutral-600"
        }`}>
          {selected && <div className="m-0.5 h-2.5 w-2.5 rounded-full bg-white" />}
        </div>
      </div>
      {selected && children}
    </div>
  );
}

function InjectionCard({
  selected,
  onSelect,
  name,
  desc,
}: {
  selected: boolean;
  onSelect: () => void;
  name: string;
  desc: string;
}) {
  return (
    <div
      className={`w-full rounded-xl border p-4 transition cursor-pointer ${
        selected
          ? "border-emerald-500/50 bg-emerald-500/10"
          : "border-neutral-800 bg-neutral-800/50 hover:bg-neutral-800"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{name}</span>
            {selected && (
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                Selected
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-neutral-500">{desc}</p>
        </div>
        <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 transition ${
          selected ? "border-emerald-500 bg-emerald-500" : "border-neutral-600"
        }`}>
          {selected && <div className="m-0.5 h-2.5 w-2.5 rounded-full bg-white" />}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-neutral-800/50 px-4 py-3">
      <span className="text-sm text-neutral-400">{label}</span>
      <span className="max-w-[60%] truncate text-right text-sm font-medium text-neutral-200">{value}</span>
    </div>
  );
}

function ApiKeyGuide({ provider }: { provider: "groq" | "deepgram" | "assembly_ai" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const guides: Record<string, { site: string; steps: string[] }> = {
    groq: {
      site: "https://console.groq.com/keys",
      steps: [
        "Go to console.groq.com and log in (or sign up for free).",
        'Click "Create API Key" in the API Keys page.',
        'Give it a name (e.g. "8voice") and copy the key.',
        "Paste the key (starts with gsk_) in the field below.",
      ],
    },
    deepgram: {
      site: "https://console.deepgram.com",
      steps: [
        "Go to console.deepgram.com and log in (or sign up for free — $200 credit).",
        "Navigate to API Keys in the sidebar.",
        'Click "Create Key" and copy the generated key.',
        "Paste the key in the field below.",
      ],
    },
    assembly_ai: {
      site: "https://app.assemblyai.com",
      steps: [
        "Go to app.assemblyai.com and log in (or sign up — free $50 credit).",
        "Your API key is shown on the Dashboard page.",
        "Click the copy icon next to the key.",
        "Paste the key in the field below.",
      ],
    },
  };

  const g = guides[provider];
  if (!g) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-neutral-700 text-[10px] font-bold text-neutral-300 transition hover:bg-neutral-600 hover:text-white"
        title="How to get this API key"
      >
        ?
      </button>
      {open && (
        <div ref={ref} className="absolute right-0 top-6 z-20 w-80 rounded-xl border border-neutral-700 bg-neutral-900 p-4 shadow-xl">
          <p className="mb-2 text-xs font-semibold text-neutral-300">
            Get your API key:
          </p>
          <ol className="mb-3 list-inside list-decimal space-y-1.5 text-xs text-neutral-400">
            {g.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <a
            href={g.site}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 transition hover:text-emerald-300"
          >
            <ExternalIcon className="h-3 w-3" />
            Open {new URL(g.site).hostname}
          </a>
        </div>
      )}
    </div>
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
      if (e.key === "Escape") { onCancel(); return; }
      const modifiers: string[] = [];
      if (e.ctrlKey) modifiers.push("Ctrl");
      if (e.altKey) modifiers.push("Alt");
      if (e.shiftKey) modifiers.push("Shift");
      if (e.metaKey) modifiers.push("Super");
      const main = mainKeyFromEvent(e);
      if (!main || main.trim() === "") return;
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
      className={`voice-input mt-1 text-left font-mono text-xs transition ${
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
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key) ||
    e.code === "ControlLeft" || e.code === "ControlRight" ||
    e.code === "AltLeft" || e.code === "AltRight" ||
    e.code === "ShiftLeft" || e.code === "ShiftRight" ||
    e.code === "MetaLeft" || e.code === "MetaRight") return null;
  if (e.code.startsWith("Key")) return e.code.slice(3);
  if (e.code.startsWith("Digit")) return e.code.slice(5);
  if (e.code.startsWith("F") && e.code.length > 1) return e.code;
  switch (e.code) {
    case "Space": return "Space";
    case "ArrowUp": return "Up";
    case "ArrowDown": return "Down";
    case "ArrowLeft": return "Left";
    case "ArrowRight": return "Right";
    case "Comma": return "Comma";
    case "Period": return "Period";
    case "Slash": return "Slash";
    case "Semicolon": return "Semicolon";
    case "Quote": return "Quote";
    case "BracketLeft": return "BracketLeft";
    case "BracketRight": return "BracketRight";
    case "Backslash": return "Backslash";
    case "Minus": return "Minus";
    case "Equal": return "Equal";
    case "Backquote": return "Backquote";
    case "Escape": return "Escape";
    case "Enter": return "Return";
    case "Backspace": return "Backspace";
    case "Tab": return "Tab";
    default: return e.key.length === 1 ? e.key.toUpperCase() : e.code;
  }
}

function providerLabel(p: ApiProvider): string {
  switch (p) {
    case "whisper": return "Whisper (whisper.cpp)";
    case "groq": return "Groq Whisper API";
    case "deepgram": return "Deepgram Nova-2";
    case "assembly_ai": return "AssemblyAI Universal-2";
    case "sherpa_onnx": return "Sherpa-ONNX";
    case "vosk": return "Vosk";
  }
}

// --- Icons ---

function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
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

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19c0-1.7-1.3-3-3-3h-11a3 3 0 0 1-3-3c0-1.6 1.2-2.9 2.8-3a5 5 0 0 1 9.4-1.6 3 3 0 0 1 4.3 2.6 3.5 3.5 0 0 1 .5 6.9V19z" />
    </svg>
  );
}

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

function KeyboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <line x1="6" y1="8" x2="6.01" y2="8" />
      <line x1="10" y1="8" x2="10.01" y2="8" />
      <line x1="14" y1="8" x2="14.01" y2="8" />
      <line x1="18" y1="8" x2="18.01" y2="8" />
      <line x1="8" y1="12" x2="8.01" y2="12" />
      <line x1="12" y1="12" x2="12.01" y2="12" />
      <line x1="16" y1="12" x2="16.01" y2="12" />
      <line x1="6" y1="16" x2="18" y2="16" />
    </svg>
  );
}

function SwitchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="5" width="22" height="14" rx="7" />
      <circle cx="8" cy="12" r="3.5" />
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

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
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

// --- Constants ---

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
