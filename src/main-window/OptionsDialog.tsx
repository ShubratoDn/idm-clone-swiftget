import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type Settings } from "../api";
import Dialog from "../components/Dialog";
import { CATEGORY_NAMES } from "./filters";

const TABS = ["General", "File types", "Save to", "Downloads", "Connection"] as const;
type Tab = (typeof TABS)[number];

const DEFAULT_EXTENSIONS =
  "3GP 7Z AAC ACE AIF APK ARJ ASF AVI BIN BZ2 EXE GZ GZIP IMG ISO LZH M4A M4V MKV MOV MP3 MP4 MPA MPE MPEG MPG MSI MSU OGG OGV PDF PLJ PPS PPT QT R0* R1* RA RAR RM RMVB SEA SIT SITX TAR TIF TIFF WAV WEBM WMA WMV Z ZIP";

export default function OptionsDialog({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("General");
  const [s, setS] = useState<Settings>(settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((cur) => ({ ...cur, [k]: v }));

  const browse = async () => {
    const dir = await open({ directory: true, defaultPath: s.downloadDir, title: "Select default download folder" });
    if (typeof dir === "string") set("downloadDir", dir);
  };

  const save = async () => {
    await api.saveSettings(s);
    onClose();
  };

  const check = (k: keyof Settings, label: string) => (
    <div style={{ marginBottom: 7 }}>
      <label>
        <input type="checkbox" checked={Boolean(s[k])} onChange={(e) => set(k, e.target.checked as never)} /> {label}
      </label>
    </div>
  );

  return (
    <Dialog
      title="Configuration"
      width={600}
      onClose={onClose}
      buttons={
        <>
          <button className="btn default" onClick={save}>
            OK
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="tabs">
        {TABS.map((t) => (
          <div key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t}
          </div>
        ))}
      </div>
      <div className="tab-page" style={{ height: 330, overflow: "auto" }}>
        {tab === "General" && (
          <>
            {check("launchAtStartup", "Launch SwiftGet on Windows startup")}
            {check("minimizeToTray", "Keep running in the notification area when the main window is closed")}
            {check("clipboardMonitor", "Use clipboard for adding URLs")}
            {check("showProgressWindow", "Show download progress dialog when a download starts")}
            {check("showCompleteDialog", 'Show "Download complete" dialog')}
            {check("notifyOnComplete", "Show a notification when a download completes")}
            <fieldset style={{ marginTop: 12 }}>
              <legend>Browser integration</legend>
              <div style={{ marginBottom: 7 }}>
                Install the SwiftGet extension from the <b>extension</b> folder in Chrome or Edge (Extensions → Developer mode → Load unpacked).
              </div>
              {check("browserAutoStart", "Start browser downloads immediately without showing the Download File Info dialog")}
              <div className="form-row" style={{ marginBottom: 0 }}>
                <span className="lbl" style={{ width: 150 }}>
                  Local integration port
                </span>
                <input type="number" min={1024} max={65535} value={s.browserPort} onChange={(e) => set("browserPort", Number(e.target.value))} style={{ width: 80 }} />
                <span className="hint">Takes effect after restart</span>
              </div>
            </fieldset>
          </>
        )}

        {tab === "File types" && (
          <>
            <div style={{ marginBottom: 6 }}>Automatically start downloading the following file types:</div>
            <textarea rows={8} style={{ width: "100%" }} value={s.captureExtensions} onChange={(e) => set("captureExtensions", e.target.value.toUpperCase())} spellCheck={false} />
            <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="hint">Separate extensions with spaces. A trailing * matches any ending (R0* matches R01, R02...).</span>
              <button className="btn" onClick={() => set("captureExtensions", DEFAULT_EXTENSIONS)}>
                Default
              </button>
            </div>
          </>
        )}

        {tab === "Save to" && (
          <>
            <div className="form-row">
              <span className="lbl">Default folder</span>
              <input className="grow" type="text" value={s.downloadDir} onChange={(e) => set("downloadDir", e.target.value)} />
              <button className="btn small" onClick={browse}>
                ...
              </button>
            </div>
            {check("useCategoryFolders", "Save files into a subfolder named after their category")}
            <fieldset>
              <legend>Category folders</legend>
              {CATEGORY_NAMES.map((c) => (
                <div key={c} className="form-row" style={{ marginBottom: 4 }}>
                  <span className="lbl">{c}</span>
                  <span className="hint">{s.useCategoryFolders ? `${s.downloadDir}\\${c}` : s.downloadDir}</span>
                </div>
              ))}
              <div className="form-row" style={{ marginBottom: 0 }}>
                <span className="lbl">General</span>
                <span className="hint">{s.downloadDir}</span>
              </div>
            </fieldset>
          </>
        )}

        {tab === "Downloads" && (
          <>
            <div className="form-row">
              <span className="lbl" style={{ width: 240 }}>
                Max. connections per download
              </span>
              <select value={s.connections} onChange={(e) => set("connections", Number(e.target.value))} style={{ width: 80 }}>
                {[1, 2, 4, 8, 16, 24, 32].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <span className="lbl" style={{ width: 240 }}>
                Max. simultaneous downloads
              </span>
              <select value={s.maxConcurrent} onChange={(e) => set("maxConcurrent", Number(e.target.value))} style={{ width: 80 }}>
                {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <span className="lbl" style={{ width: 240 }}>
                Number of retries per connection
              </span>
              <input type="number" min={0} max={100} value={s.maxRetries} onChange={(e) => set("maxRetries", Number(e.target.value))} style={{ width: 80 }} />
            </div>
            <div className="hint" style={{ marginTop: 10 }}>
              More connections help most when a server limits the speed of each connection. When one connection finishes its part early, it takes over half of the slowest remaining part, so all connections stay busy until the end.
            </div>
          </>
        )}

        {tab === "Connection" && (
          <>
            <div className="form-row">
              <span className="lbl" style={{ width: 190 }}>
                Speed limit (0 = unlimited)
              </span>
              <input type="number" min={0} value={s.speedLimitKbps} onChange={(e) => set("speedLimitKbps", Math.max(0, Number(e.target.value)))} style={{ width: 90 }} />
              <span>KBytes/sec</span>
            </div>
            <div style={{ marginBottom: 4 }}>User-Agent sent to servers:</div>
            <textarea rows={3} style={{ width: "100%" }} value={s.userAgent} onChange={(e) => set("userAgent", e.target.value)} spellCheck={false} />
            <div className="hint" style={{ marginTop: 4 }}>
              Downloads captured from the browser use the browser's own User-Agent, cookies and referrer.
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
