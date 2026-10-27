import { useEffect, useState } from "react";
import { api, applyProgress, events, subscribe, type Download, type Schedule, type Settings } from "./api";

/** Live mirror of the backend's downloads, settings and schedule. */
export function useStore() {
  const [downloads, setDownloads] = useState<Map<number, Download>>(new Map());
  const [settings, setSettings] = useState<Settings | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);

  useEffect(() => {
    api.snapshot().then((s) => {
      setDownloads((current) => {
        const m = new Map(s.downloads.map((d) => [d.id, d]));
        // Keep anything that arrived through events while the snapshot was loading.
        current.forEach((d, id) => m.set(id, d));
        return m;
      });
      setSettings(s.settings);
      setSchedule(s.schedule);
    });

    return subscribe([
      events.onUpdated((d) =>
        setDownloads((m) => {
          const n = new Map(m);
          const prev = n.get(d.id);
          const live = d.status === "downloading" && prev ? { speed: prev.speed, eta: prev.eta, activeConnections: prev.activeConnections } : {};
          n.set(d.id, { ...d, ...live });
          return n;
        }),
      ),
      events.onRemoved((id) =>
        setDownloads((m) => {
          const n = new Map(m);
          n.delete(id);
          return n;
        }),
      ),
      events.onProgress((list) =>
        setDownloads((m) => {
          const n = new Map(m);
          for (const p of list) {
            const d = n.get(p.id);
            if (d) n.set(p.id, applyProgress(d, p));
          }
          return n;
        }),
      ),
      events.onSettings(setSettings),
      events.onSchedule(setSchedule),
    ]);
  }, []);

  return { downloads, settings, schedule };
}

/** Live view of a single download, for the per-download windows. */
export function useDownload(id: number) {
  const [d, setD] = useState<Download | null>(null);
  useEffect(() => {
    api.getDownload(id).then((x) => x && setD((cur) => cur ?? x));
    return subscribe([
      events.onUpdated((x) => x.id === id && setD((cur) => ({ ...x, speed: x.status === "downloading" ? cur?.speed : undefined }))),
      events.onProgress((list) => {
        const p = list.find((p) => p.id === id);
        if (p) setD((cur) => (cur ? applyProgress(cur, p) : cur));
      }),
    ]);
  }, [id]);
  return d;
}

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`swg.${key}`);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`swg.${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}
