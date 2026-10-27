import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../api";
import { formatBytes } from "../format";
import { FileIcon } from "../icons";
import { useStore } from "../useStore";

export default function CompleteWindow({ id }: { id: number }) {
  const { downloads, settings } = useStore();
  const d = downloads.get(id);
  const close = () => getCurrentWindow().close();

  if (!d) return <div className="window" />;
  const path = `${d.saveDir}\\${d.fileName}`;

  return (
    <div className="window complete-window">
      <div style={{ padding: "14px 16px 0", flex: 1 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ transform: "scale(2)", transformOrigin: "left center", width: 34 }}>
            <FileIcon category={d.category} />
          </div>
          <div className="big">Download complete</div>
        </div>
        <div className="info-grid" style={{ gridTemplateColumns: "120px 1fr", marginTop: 10 }}>
          <span className="k">Downloaded</span>
          <span className="v">{formatBytes(d.size ?? d.downloaded)}</span>
          <span className="k">Address</span>
          <span className="v url" title={d.url}>
            {d.url}
          </span>
          <span className="k">The file saved as</span>
          <span className="v" title={path}>
            {path}
          </span>
        </div>
        {settings && (
          <div style={{ marginTop: 16 }}>
            <label>
              <input type="checkbox" checked={!settings.showCompleteDialog} onChange={(e) => api.saveSettings({ ...settings, showCompleteDialog: !e.target.checked })} /> Don't show this dialog again
            </label>
          </div>
        )}
      </div>
      <div className="window-buttons">
        <button
          className="btn default"
          autoFocus
          onClick={() => {
            api.openFile(id);
            close();
          }}
        >
          Open
        </button>
        <button
          className="btn"
          onClick={() => {
            api.openFolder(id);
            close();
          }}
        >
          Open folder
        </button>
        <button className="btn" onClick={close}>
          Close
        </button>
      </div>
    </div>
  );
}
