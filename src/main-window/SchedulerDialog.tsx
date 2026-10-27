import { useState } from "react";
import { api, type Download, type PostAction, type Schedule } from "../api";
import Dialog from "../components/Dialog";
import { FileIcon, FolderIcon } from "../icons";
import { formatBytes, statusText } from "../format";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ACTIONS: { value: PostAction; label: string }[] = [
  { value: "none", label: "Do nothing" },
  { value: "exit", label: "Exit SwiftGet" },
  { value: "sleep", label: "Put computer to sleep" },
  { value: "shutdown", label: "Turn off computer" },
];

export default function SchedulerDialog({ schedule, downloads, onClose }: { schedule: Schedule; downloads: Download[]; onClose: () => void }) {
  const [tab, setTab] = useState<"schedule" | "files">("schedule");
  const [s, setS] = useState<Schedule>(schedule);
  const set = <K extends keyof Schedule>(k: K, v: Schedule[K]) => setS((cur) => ({ ...cur, [k]: v }));
  const daily = s.days.length === 0;
  const inQueue = downloads.filter((d) => d.status !== "completed");

  const toggleDay = (i: number) => set("days", s.days.includes(i) ? s.days.filter((d) => d !== i) : [...s.days, i].sort());

  const apply = () => api.saveSchedule(s);

  return (
    <Dialog
      title="Scheduler"
      width={640}
      onClose={onClose}
      buttons={
        <>
          <button className="btn" onClick={() => api.startQueue()}>
            Start now
          </button>
          <button className="btn" onClick={() => api.stopQueue()}>
            Stop
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={apply}>
            Apply
          </button>
          <button
            className="btn default"
            onClick={async () => {
              await apply();
              onClose();
            }}
          >
            OK
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ width: 160, background: "#fff", border: "1px solid #c8c8c8", height: 330 }}>
          <div className="panel-head">Queues</div>
          <div className="tree-row selected" style={{ paddingLeft: 6 }}>
            <FolderIcon badge="queue" />
            <span className="label">Main download queue</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="tabs">
            <div className={`tab${tab === "schedule" ? " active" : ""}`} onClick={() => setTab("schedule")}>
              Schedule
            </div>
            <div className={`tab${tab === "files" ? " active" : ""}`} onClick={() => setTab("files")}>
              Files in the queue ({inQueue.length})
            </div>
          </div>
          <div className="tab-page" style={{ height: 307, overflow: "auto" }}>
            {tab === "schedule" ? (
              <>
                <div className="form-row">
                  <label style={{ width: 150 }}>
                    <input type="checkbox" checked={s.startEnabled} onChange={(e) => set("startEnabled", e.target.checked)} /> Start download at
                  </label>
                  <input type="time" value={s.startTime} disabled={!s.startEnabled} onChange={(e) => set("startTime", e.target.value)} />
                </div>
                <div style={{ marginLeft: 22, marginBottom: 10 }}>
                  <label style={{ marginRight: 14 }}>
                    <input type="radio" checked={daily} disabled={!s.startEnabled && !s.stopEnabled} onChange={() => set("days", [])} /> Daily
                  </label>
                  <label>
                    <input type="radio" checked={!daily} disabled={!s.startEnabled && !s.stopEnabled} onChange={() => set("days", [1, 2, 3, 4, 5])} /> On these days:
                  </label>
                  <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {DAYS.map((d, i) => (
                      <label key={d}>
                        <input type="checkbox" disabled={daily} checked={s.days.includes(i)} onChange={() => toggleDay(i)} /> {d}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-row">
                  <label style={{ width: 150 }}>
                    <input type="checkbox" checked={s.stopEnabled} onChange={(e) => set("stopEnabled", e.target.checked)} /> Stop download at
                  </label>
                  <input type="time" value={s.stopTime} disabled={!s.stopEnabled} onChange={(e) => set("stopTime", e.target.value)} />
                </div>
                <fieldset style={{ marginTop: 10 }}>
                  <legend>When all downloads in the queue are finished</legend>
                  {ACTIONS.map((a) => (
                    <div key={a.value} style={{ marginBottom: 4 }}>
                      <label>
                        <input type="radio" name="post" checked={s.onComplete === a.value} onChange={() => set("onComplete", a.value)} /> {a.label}
                      </label>
                    </div>
                  ))}
                  {s.onComplete === "shutdown" && <div className="hint">Windows shows a 60-second warning first; run "shutdown /a" to cancel it.</div>}
                </fieldset>
              </>
            ) : (
              <table className="list" style={{ tableLayout: "auto" }}>
                <thead>
                  <tr>
                    <th>File Name</th>
                    <th>Size</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {inQueue.map((d) => (
                    <tr key={d.id} className="row">
                      <td>
                        <div className="name-cell">
                          <FileIcon category={d.category} status={d.status} />
                          <span>{d.fileName}</span>
                        </div>
                      </td>
                      <td>{formatBytes(d.size)}</td>
                      <td>{statusText(d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
