import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { api, type Download } from "../api";
import { formatBytes, formatEta, formatSpeed, percent } from "../format";
import { useStore } from "../useStore";

type Tab = "status" | "speed" | "complete";

function statusLine(d: Download): string {
  switch (d.status) {
    case "downloading":
      return (d.activeConnections ?? 0) > 0 ? "Receiving data..." : "Connecting...";
    case "queued":
      return "Waiting in queue";
    case "paused":
      return "Paused";
    case "failed":
      return `Error: ${d.error ?? "unknown error"}`;
    case "completed":
      return "Complete";
  }
}

function SegmentMap({ d }: { d: Download }) {
  if (d.kind === "hls") {
    const pct = d.hlsTotal ? (d.hlsDone / d.hlsTotal) * 100 : 0;
    return (
      <div className="segment-map">
        <div className="seg" style={{ left: 0, width: `${pct}%` }} />
      </div>
    );
  }
  const size = d.size ?? 0;
  return (
    <div className="segment-map">
      {size > 0 &&
        d.segments.map((s, i) => (
          <div key={`s${i}`}>
            <div className={`seg${s.active ? "" : " inactive"}`} style={{ left: `${(s.start / size) * 100}%`, width: `${((s.pos - s.start) / size) * 100}%` }} />
            <div className="start" style={{ left: `${(s.start / size) * 100}%` }} />
          </div>
        ))}
    </div>
  );
}

export default function ProgressWindow({ id }: { id: number }) {
  const { downloads, settings, schedule } = useStore();
  const d = downloads.get(id);
  const [tab, setTab] = useState<Tab>("status");
  const [details, setDetails] = useState(true);
  const [limitOn, setLimitOn] = useState(false);
  const [limit, setLimit] = useState(512);

  const pct = d ? percent(d) : null;

  useEffect(() => {
    if (!d) return;
    const p = pct != null ? `${Math.floor(pct)}% ` : "";
    getCurrentWindow().setTitle(`${p}${d.fileName}`);
  }, [d?.fileName, pct != null ? Math.floor(pct) : null]);

  useEffect(() => {
    if (!settings) return;
    setLimitOn(settings.speedLimitKbps > 0);
    if (settings.speedLimitKbps > 0) setLimit(settings.speedLimitKbps);
  }, [settings?.speedLimitKbps]);

  const toggleDetails = () => {
    const next = !details;
    setDetails(next);
    getCurrentWindow().setSize(new LogicalSize(520, next ? 400 : 262));
  };

  if (!d) return <div className="window" />;

  const running = d.status === "downloading" || d.status === "queued";
  const close = () => getCurrentWindow().close();
  const segments = d.segments.filter((s) => s.end > s.start);

  return (
    <div className="window progress-window" style={{ padding: "8px 10px 0" }}>
      <div className="tabs">
        <div className={`tab${tab === "status" ? " active" : ""}`} onClick={() => setTab("status")}>
          Download status
        </div>
        <div className={`tab${tab === "speed" ? " active" : ""}`} onClick={() => setTab("speed")}>
          Speed Limiter
        </div>
        <div className={`tab${tab === "complete" ? " active" : ""}`} onClick={() => setTab("complete")}>
          Options on completion
        </div>
      </div>

      <div className="tab-page" style={{ flex: "none", height: 172 }}>
        {tab === "status" && (
          <>
            <div className="info-grid">
              <span className="k">URL</span>
              <span className="v url" title={d.url}>
                {d.url}
              </span>
              <span className="k">Status</span>
              <span className={`v${d.status === "failed" ? " error-text" : ""}`} title={d.error ?? undefined}>
                {statusLine(d)}
              </span>
              <span className="k">File size</span>
              <span className="v">{d.size != null ? formatBytes(d.size) : d.kind === "hls" ? `${d.hlsTotal || "?"} segments` : "Unknown"}</span>
              <span className="k">Downloaded</span>
              <span className="v">
                {formatBytes(d.downloaded) || "0 Bytes"}
                {pct != null && ` ( ${pct.toFixed(2)} % )`}
                {d.kind === "hls" && d.hlsTotal > 0 && ` - ${d.hlsDone}/${d.hlsTotal} segments`}
              </span>
              <span className="k">Transfer rate</span>
              <span className="v">{d.status === "downloading" ? formatSpeed(d.speed) || "0.00 KB/sec" : ""}</span>
              <span className="k">Time left</span>
              <span className="v">{d.status === "downloading" ? formatEta(d.eta) : ""}</span>
              <span className="k">Resume capability</span>
              <span className="v">{d.kind === "hls" ? "Yes" : d.size != null || d.status !== "queued" ? (d.resumable ? "Yes" : "No") : ""}</span>
            </div>
            <div className={`pbar${d.status === "paused" || d.status === "failed" ? " paused" : ""}${pct == null && d.status === "downloading" ? " indeterminate" : ""}`} style={{ marginTop: 9 }}>
              <div className="fill" style={{ width: `${pct ?? 0}%` }} />
            </div>
          </>
        )}

        {tab === "speed" && settings && (
          <>
            <label style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={limitOn} onChange={(e) => setLimitOn(e.target.checked)} /> Use speed limiter
            </label>
            <div className="form-row">
              <span className="lbl" style={{ width: 170 }}>
                Maximum download speed
              </span>
              <input type="number" min={1} disabled={!limitOn} value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ width: 90 }} />
              <span>KBytes/sec</span>
            </div>
            <div className="hint" style={{ marginBottom: 10 }}>
              The limit applies to all downloads together.
            </div>
            <button className="btn" onClick={() => api.setSpeedLimit(limitOn ? Math.max(1, limit) : 0)}>
              Apply
            </button>
          </>
        )}

        {tab === "complete" && settings && schedule && (
          <>
            <div style={{ marginBottom: 8 }}>
              <label>
                <input type="checkbox" checked={settings.showCompleteDialog} onChange={(e) => api.saveSettings({ ...settings, showCompleteDialog: e.target.checked })} /> Show download complete dialog
              </label>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label>
                <input
                  type="checkbox"
                  checked={schedule.onComplete === "exit"}
                  onChange={(e) => api.saveSchedule({ ...schedule, onComplete: e.target.checked ? "exit" : "none" })}
                />{" "}
                Exit SwiftGet when all downloads are finished
              </label>
            </div>
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={schedule.onComplete === "shutdown"}
                  onChange={(e) => api.saveSchedule({ ...schedule, onComplete: e.target.checked ? "shutdown" : "none" })}
                />{" "}
                Turn off computer when all downloads are finished
              </label>
            </div>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 7, padding: "9px 0" }}>
        <button className="btn" onClick={toggleDetails} style={{ minWidth: 100 }}>
          {details ? "<< Hide details" : "Show details >>"}
        </button>
        <span style={{ flex: 1 }} />
        {d.status === "completed" ? (
          <>
            <button className="btn default" onClick={() => api.openFile(id)}>
              Open
            </button>
            <button className="btn" onClick={() => api.openFolder(id)}>
              Open folder
            </button>
          </>
        ) : (
          <button className="btn default" onClick={() => (running ? api.pause([id]) : api.start([id]))}>
            {running ? "Pause" : d.status === "failed" ? "Retry" : "Resume"}
          </button>
        )}
        <button
          className="btn"
          onClick={() => {
            if (running) api.pause([id]);
            close();
          }}
        >
          {d.status === "completed" ? "Close" : "Cancel"}
        </button>
      </div>

      {details && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, paddingBottom: 10 }}>
          <div style={{ marginBottom: 4 }}>Start positions and download progress by connections</div>
          <SegmentMap d={d} />
          <div className="conn-table" style={{ marginTop: 6 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>N.</th>
                  <th style={{ width: 110 }}>Downloaded</th>
                  <th>Info</th>
                </tr>
              </thead>
              <tbody>
                {d.kind === "hls" ? (
                  <tr>
                    <td>1</td>
                    <td>{formatBytes(d.downloaded)}</td>
                    <td>{running ? `Fetching segments with up to ${d.connections} connections` : statusLine(d)}</td>
                  </tr>
                ) : (
                  segments.map((s, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{formatBytes(s.pos - s.start) || "0 Bytes"}</td>
                      <td>{s.pos >= s.end ? "Completed" : s.active && d.status === "downloading" ? "Receiving data..." : d.status === "downloading" ? "Waiting" : "Paused"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
