import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api, type Settings } from "../api";
import Dialog from "../components/Dialog";
import { AppLogo } from "../icons";

/** "Enter new address to download". OK opens the Download File Info window. */
export function AddUrlDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [useAuth, setUseAuth] = useState(false);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.clipboardUrl().then((u) => {
      if (u) setUrl((cur) => cur || u);
      setTimeout(() => input.current?.select(), 0);
    });
    input.current?.focus();
  }, []);

  const submit = async () => {
    let target = url.trim();
    try {
      const u = new URL(target);
      if (!/^https?:$/.test(u.protocol)) throw new Error();
      if (useAuth && login) {
        u.username = login;
        u.password = password;
        target = u.toString();
      }
    } catch {
      setError("Please enter a valid http:// or https:// address.");
      return;
    }
    await api.openAdd(target);
    onClose();
  };

  return (
    <Dialog
      title="Enter new address to download"
      width={470}
      onClose={onClose}
      buttons={
        <>
          <button className="btn default" onClick={submit}>
            OK
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="form-row">
        <span className="lbl" style={{ width: 52 }}>
          Address
        </span>
        <input
          ref={input}
          className="grow"
          type="text"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          spellCheck={false}
        />
      </div>
      {error && <div className="error-text" style={{ marginLeft: 60, marginBottom: 6 }}>{error}</div>}
      <fieldset>
        <legend>
          <label>
            <input type="checkbox" checked={useAuth} onChange={(e) => setUseAuth(e.target.checked)} /> Use authorization
          </label>
        </legend>
        <div className="form-row">
          <span className="lbl" style={{ width: 60 }}>
            Login
          </span>
          <input className="grow" type="text" disabled={!useAuth} value={login} onChange={(e) => setLogin(e.target.value)} />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <span className="lbl" style={{ width: 60 }}>
            Password
          </span>
          <input className="grow" type="password" disabled={!useAuth} value={password} onChange={(e) => setPassword(e.target.value)} style={{ height: 22, border: "1px solid #7a7a7a" }} />
        </div>
      </fieldset>
    </Dialog>
  );
}

export function DeleteDialog({ count, onConfirm, onClose }: { count: number; onConfirm: (deleteFiles: boolean) => void; onClose: () => void }) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  return (
    <Dialog
      title="Confirmation"
      width={400}
      onClose={onClose}
      buttons={
        <>
          <button className="btn default" autoFocus onClick={() => onConfirm(deleteFiles)}>
            OK
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <svg width="32" height="32" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="14" fill="url(#g-blue)" stroke="#0d47a1" />
          <text x="16" y="22" textAnchor="middle" fontSize="18" fontWeight="bold" fill="#fff">
            ?
          </text>
        </svg>
        <div>
          <p style={{ margin: "4px 0 14px" }}>
            Are you sure you want to delete {count === 1 ? "the selected download" : `${count} selected downloads`} from the list?
          </p>
          <label>
            <input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} /> Also delete downloaded files from disk
          </label>
        </div>
      </div>
    </Dialog>
  );
}

export function SpeedLimiterDialog({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const [on, setOn] = useState(settings.speedLimitKbps > 0);
  const [kbps, setKbps] = useState(settings.speedLimitKbps > 0 ? settings.speedLimitKbps : 512);
  const save = async () => {
    await api.setSpeedLimit(on ? Math.max(1, kbps) : 0);
    onClose();
  };
  return (
    <Dialog
      title="Speed Limiter"
      width={390}
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
      <label style={{ marginBottom: 10 }}>
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Turn on speed limiter
      </label>
      <div className="form-row">
        <span className="lbl" style={{ width: 170 }}>
          Maximum download speed
        </span>
        <input type="number" min={1} disabled={!on} value={kbps} onChange={(e) => setKbps(Number(e.target.value))} style={{ width: 90 }} />
        <span>KBytes/sec</span>
      </div>
      <div className="hint">The limit is shared by all running downloads.</div>
    </Dialog>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  return (
    <Dialog
      title="About SwiftGet"
      width={380}
      onClose={onClose}
      buttons={
        <button className="btn default" onClick={onClose}>
          OK
        </button>
      }
    >
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <AppLogo size={56} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>SwiftGet {version}</div>
          <div className="hint" style={{ marginTop: 4 }}>
            Multi-connection download manager with dynamic file segmentation, resume support, scheduler, speed limiter and browser integration.
          </div>
        </div>
      </div>
    </Dialog>
  );
}
