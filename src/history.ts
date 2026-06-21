import { Store } from "@tauri-apps/plugin-store";

export interface HistoryEntry {
  id: string;
  text: string;
  timestamp: string;
}

const STORE_FILE = "history.json";
const STORE_KEY = "entries";

let _store: Store | null = null;

async function store(): Promise<Store> {
  if (!_store) _store = await Store.load(STORE_FILE);
  return _store;
}

const MAX_ENTRIES = 100;

export async function loadHistory(): Promise<HistoryEntry[]> {
  const s = await store();
  return ((await s.get<HistoryEntry[]>(STORE_KEY)) ?? []).slice(0, MAX_ENTRIES);
}

export async function addEntry(text: string): Promise<HistoryEntry> {
  const entry: HistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    timestamp: new Date().toISOString(),
  };
  const s = await store();
  const entries = await loadHistory();
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  await s.set(STORE_KEY, entries);
  await s.save();
  return entry;
}

export async function deleteEntry(id: string): Promise<void> {
  const s = await store();
  const entries = await loadHistory();
  const filtered = entries.filter((e) => e.id !== id);
  await s.set(STORE_KEY, filtered);
  await s.save();
}

export async function clearHistory(): Promise<void> {
  const s = await store();
  await s.set(STORE_KEY, []);
  await s.save();
}
