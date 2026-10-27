import type { Download } from "./api";

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "";
  if (n < 1024) return `${n} Bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 1 : 2)} ${units[i]}`;
}

export function formatSpeed(bps: number | null | undefined): string {
  if (!bps) return "";
  if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(2)} MB/sec`;
  return `${(bps / 1024).toFixed(2)} KB/sec`;
}

export function formatEta(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return "";
  sec = Math.round(sec);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d} day(s) ${h} hr`;
  if (h > 0) return `${h} hr ${m} min`;
  if (m > 0) return `${m} min ${s} sec`;
  return `${s} sec`;
}

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const month = d.toLocaleString("en-US", { month: "short" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${month} ${d.getDate().toString().padStart(2, "0")} ${time}`;
}

export function percent(d: Download): number | null {
  if (d.kind === "hls") {
    return d.hlsTotal > 0 ? (d.hlsDone / d.hlsTotal) * 100 : null;
  }
  if (!d.size) return d.status === "completed" ? 100 : null;
  return Math.min(100, (d.downloaded / d.size) * 100);
}

/** The text IDM shows in the Status column. */
export function statusText(d: Download): string {
  switch (d.status) {
    case "completed":
      return "Complete";
    case "failed":
      return "Error";
    case "queued":
      return "Queued";
    default: {
      const p = percent(d);
      if (p == null) return d.status === "downloading" ? formatBytes(d.downloaded) || "Connecting..." : "";
      return `${p.toFixed(2)}%`;
    }
  }
}
