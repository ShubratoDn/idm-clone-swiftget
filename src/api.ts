import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Status = "queued" | "downloading" | "paused" | "completed" | "failed";
export type Kind = "http" | "hls";
export type PostAction = "none" | "exit" | "sleep" | "shutdown";

export interface Segment {
  start: number;
  end: number;
  pos: number;
  active: boolean;
}

export interface Download {
  id: number;
  url: string;
  kind: Kind;
  fileName: string;
  saveDir: string;
  category: string;
  size: number | null;
  downloaded: number;
  status: Status;
  resumable: boolean;
  connections: number;
  segments: Segment[];
  referrer: string | null;
  error: string | null;
  description: string;
  addedAt: number;
  lastTryAt: number | null;
  completedAt: number | null;
  hlsTotal: number;
  hlsDone: number;
  // Live values merged in from progress events.
  speed?: number;
  eta?: number | null;
  activeConnections?: number;
}

export interface Progress {
  id: number;
  downloaded: number;
  size: number | null;
  speed: number;
  eta: number | null;
  connections: number;
  segments: Segment[];
  hlsTotal: number;
  hlsDone: number;
}

export interface Settings {
  downloadDir: string;
  connections: number;
  maxConcurrent: number;
  speedLimitKbps: number;
  maxRetries: number;
  clipboardMonitor: boolean;
  minimizeToTray: boolean;
  notifyOnComplete: boolean;
  showCompleteDialog: boolean;
  showProgressWindow: boolean;
  browserPort: number;
  browserAutoStart: boolean;
  captureExtensions: string;
  launchAtStartup: boolean;
  useCategoryFolders: boolean;
  userAgent: string;
}

export interface Schedule {
  startEnabled: boolean;
  startTime: string;
  stopEnabled: boolean;
  stopTime: string;
  days: number[];
  onComplete: PostAction;
}

export interface Snapshot {
  downloads: Download[];
  settings: Settings;
  schedule: Schedule;
}

export interface AddRequest {
  url: string;
  fileName?: string | null;
  saveDir?: string | null;
  description?: string | null;
  connections?: number | null;
  start?: boolean;
  referrer?: string | null;
  cookies?: string | null;
  userAgent?: string | null;
  kind?: Kind | null;
  size?: number | null;
  resumable?: boolean | null;
}

export interface ProbeInfo {
  finalUrl: string;
  size: number | null;
  resumable: boolean;
  fileName: string;
  contentType: string | null;
  kind: Kind;
  category: string;
  saveDir: string;
}

export const api = {
  snapshot: () => invoke<Snapshot>("get_snapshot"),
  getDownload: (id: number) => invoke<Download | null>("get_download", { id }),
  takePendingAdd: (token: string) => invoke<AddRequest | null>("take_pending_add", { token }),
  probe: (req: AddRequest) => invoke<ProbeInfo>("probe_url", { req }),
  suggestFolder: (fileName: string) => invoke<[string, string]>("suggest_folder", { fileName }),
  add: (req: AddRequest) => invoke<number>("add_download", { req }),
  start: (ids: number[]) => invoke<void>("start_downloads", { ids }),
  pause: (ids: number[]) => invoke<void>("pause_downloads", { ids }),
  remove: (ids: number[], deleteFiles: boolean) => invoke<void>("remove_downloads", { ids, deleteFiles }),
  redownload: (id: number) => invoke<void>("redownload", { id }),
  startQueue: () => invoke<void>("start_queue"),
  stopQueue: () => invoke<void>("stop_queue"),
  openFile: (id: number) => invoke<void>("open_file", { id }),
  openFolder: (id: number) => invoke<void>("open_folder", { id }),
  openProgress: (id: number) => invoke<void>("open_progress_window", { id }),
  openAdd: (url: string) => invoke<void>("open_add_window", { url }),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  saveSchedule: (schedule: Schedule) => invoke<void>("save_schedule", { schedule }),
  setSpeedLimit: (kbps: number) => invoke<void>("set_speed_limit", { kbps }),
  clipboardUrl: () => invoke<string | null>("clipboard_url"),
  showMain: () => invoke<void>("show_main_window"),
  quit: () => invoke<void>("quit_app"),
};

export const events = {
  onUpdated: (cb: (d: Download) => void): Promise<UnlistenFn> => listen<Download>("download-updated", (e) => cb(e.payload)),
  onRemoved: (cb: (id: number) => void): Promise<UnlistenFn> => listen<number>("download-removed", (e) => cb(e.payload)),
  onProgress: (cb: (p: Progress[]) => void): Promise<UnlistenFn> => listen<Progress[]>("progress", (e) => cb(e.payload)),
  onSettings: (cb: (s: Settings) => void): Promise<UnlistenFn> => listen<Settings>("settings-changed", (e) => cb(e.payload)),
  onSchedule: (cb: (s: Schedule) => void): Promise<UnlistenFn> => listen<Schedule>("schedule-changed", (e) => cb(e.payload)),
  onMenuAddUrl: (cb: () => void): Promise<UnlistenFn> => listen("menu-add-url", () => cb()),
};

/** Subscribes on mount and unsubscribes on unmount, even if the listen promise resolves late. */
export function subscribe(subs: Promise<UnlistenFn>[]): () => void {
  let active = true;
  const fns: UnlistenFn[] = [];
  subs.forEach((p) =>
    p.then((fn) => {
      if (active) fns.push(fn);
      else fn();
    }),
  );
  return () => {
    active = false;
    fns.forEach((fn) => fn());
  };
}

export function applyProgress(d: Download, p: Progress): Download {
  return {
    ...d,
    downloaded: p.downloaded,
    size: p.size,
    speed: p.speed,
    eta: p.eta,
    activeConnections: p.connections,
    segments: p.segments,
    hlsTotal: p.hlsTotal,
    hlsDone: p.hlsDone,
  };
}
