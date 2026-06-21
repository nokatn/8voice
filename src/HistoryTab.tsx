import { useEffect, useState } from "react";
import type { HistoryEntry } from "./history";
import { loadHistory, deleteEntry, clearHistory } from "./history";

function groupByDay(entries: HistoryEntry[]): Map<string, HistoryEntry[]> {
  const groups = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const day = e.timestamp.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(e);
  }
  return groups;
}

function formatDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);
  if (iso === today) return "Today";
  if (iso === yStr) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function HistoryTab() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadHistory().then(setEntries);
  }, []);

  const copyEntry = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // ignore
    }
  };

  const handleClear = async () => {
    await clearHistory();
    setEntries([]);
  };

  const handleDelete = async (id: string) => {
    await deleteEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const groups = groupByDay(entries);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-neutral-500">
        <p className="text-sm font-medium">No transcription history yet</p>
        <p className="mt-1 text-xs">Your transcriptions will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {entries.length} {entries.length === 1 ? "entry" : "entries"} (last 100)
        </p>
        <button
          type="button"
          onClick={handleClear}
          className="flex items-center gap-1 rounded-md bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-400 transition hover:bg-rose-500/20 hover:text-rose-400"
        >
          <TrashIcon className="h-3 w-3" />
          Clear all
        </button>
      </div>

      {Array.from(groups.entries()).map(([day, dayEntries]) => (
        <section key={day}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {formatDay(day)}
          </h3>
          <div className="space-y-2">
            {dayEntries.map((entry) => (
              <div
                key={entry.id}
                className="group rounded-xl border border-neutral-800 bg-neutral-800/30 p-3 transition hover:border-neutral-700 hover:bg-neutral-800/50"
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-medium text-neutral-500">
                    {formatTime(entry.timestamp)}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => copyEntry(entry.text, entry.id)}
                      className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 transition hover:bg-neutral-700 hover:text-white"
                    >
                      {copiedId === entry.id ? (
                        <span className="flex items-center gap-0.5 text-emerald-400">
                          <CheckIcon className="h-3 w-3" /> Copied
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5">
                          <CopyIcon className="h-3 w-3" /> Copy
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(entry.id)}
                      className="rounded-md px-1.5 py-0.5 text-[10px] text-neutral-500 transition hover:bg-neutral-700 hover:text-rose-400"
                    >
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-200">
                  {entry.text}
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
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
