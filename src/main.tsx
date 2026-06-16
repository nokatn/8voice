import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import Onboarding from "./Onboarding";
import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/500.css";
import "@fontsource/open-sans/600.css";
import "@fontsource/open-sans/700.css";
import "./index.css";
import type { Settings } from "./types";

function Root() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<Settings>("cmd_get_settings")
      .then(setSettings)
      .catch((e) => setError("Ayarlar yüklenemedi: " + String(e)));
  }, []);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-rose-400">
        <p>{error}</p>
      </main>
    );
  }

  if (!settings) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-neutral-400">
        <p>Yükleniyor…</p>
      </main>
    );
  }

  if (!settings.has_completed_onboarding) {
    return (
      <Onboarding
        initialSettings={settings}
        onComplete={(s) => setSettings(s)}
      />
    );
  }

  return <App initialSettings={settings} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
