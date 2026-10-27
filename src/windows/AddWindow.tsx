import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save } from "@tauri-apps/plugin-dialog";
import { api, type AddRequest, type ProbeInfo } from "../api";
import { formatBytes } from "../format";
import { FileIcon } from "../icons";
import { CATEGORY_NAMES } from "../main-window/filters";
import { useStore } from "../useStore";

// The pending request can only be taken once; share the promise so a re-run effect sees it too.
const pending = new Map<string, Promise<AddRequest | null>>();
function takeOnce(token: string) {
  if (!pending.has(token)) pending.set(token, api.takePendingAdd(token));
  return pending.get(token)!;
}

function splitPath(p: string): [string, string] {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i < 0 ? ["", p] : [p.slice(0, i), p.slice(i + 1)];
}

export default function AddWindow({ token }: { token: string }) {
  const { settings } = useStore();
  const [req, setReq] = useState<AddRequest | null>(null);
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<ProbeInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("General");
  const [savePath, setSavePath] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const probedUrl = useRef("");
  const close = () => getCurrentWindow().close();

  const runProbe = async (r: AddRequest, target: string) => {
    if (!target || probedUrl.current === target) return;
    probedUrl.current = target;
    setProbing(true);
    setError("");
    try {
      const p = await api.probe({ ...r, url: target });
      setInfo(p);
      const name = r.fileName?.trim() || p.fileName;
      const [cat, dir] = r.fileName?.trim() ? await api.suggestFolder(name) : [p.category, p.saveDir];
      setCategory(cat);
      setSavePath(`${r.saveDir || dir}\\${name}`);
    } catch (e) {
      setInfo(null);
      setError(String(e));
      let fallback = "download";
      try {
        fallback = decodeURIComponent(splitPath(new URL(target).pathname)[1]) || fallback;
      } catch {
        /* not a URL; keep the generic name */
      }
      const [cat, dir] = await api.suggestFolder(fallback);
      setCategory(cat);
      setSavePath((cur) => cur || `${dir}\\${fallback}`);
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    takeOnce(token).then((r) => {
      if (!r) {
        close();
        return;
      }
      setReq(r);
      setUrl(r.url);
      setDescription(r.description ?? "");
      runProbe(r, r.url);
    });
  }, [token]);

  const changeCategory = (c: string) => {
    setCategory(c);
    if (!settings) return;
    const dir = settings.useCategoryFolders && c !== "General" ? `${settings.downloadDir}\\${c}` : settings.downloadDir;
    setSavePath(`${dir}\\${splitPath(savePath)[1]}`);
  };

  const browse = async () => {
    const p = await save({ defaultPath: savePath, title: "Save As" });
    if (p) setSavePath(p);
  };

  const submit = async (start: boolean) => {
    if (!req) return;
    const [saveDir, fileName] = splitPath(savePath.trim());
    if (!fileName) {
      setError("Please choose where to save the file.");
      return;
    }
    setBusy(true);
    try {
      await api.add({
        ...req,
        url: url.trim(),
        fileName,
        saveDir: saveDir || null,
        description,
        start,
        kind: req.kind ?? info?.kind ?? null,
        size: info?.size ?? null,
        resumable: info?.resumable ?? null,
      });
      close();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const [, fileName] = splitPath(savePath);

  return (
    <div className="window addwin" onKeyDown={(e) => e.key === "Escape" && close()}>
      <div style={{ display: "flex", padding: "14px 14px 0", gap: 12, flex: 1 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="form-row">
            <span className="lbl" style={{ width: 70 }}>
              URL
            </span>
            <input
              className="grow"
              type="text"
              value={url}
              spellCheck={false}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => req && runProbe(req, url.trim())}
            />
          </div>
          <div className="form-row">
            <span className="lbl" style={{ width: 70 }}>
              Category
            </span>
            <select value={category} onChange={(e) => changeCategory(e.target.value)} style={{ width: 160 }}>
              {["General", ...CATEGORY_NAMES].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <span className="lbl" style={{ width: 70 }}>
              Save As
            </span>
            <input className="grow" type="text" value={savePath} spellCheck={false} onChange={(e) => setSavePath(e.target.value)} />
            <button className="btn small" onClick={browse} title="Browse">
              ...
            </button>
          </div>
          <div className="form-row">
            <span className="lbl" style={{ width: 70 }}>
              Description
            </span>
            <input className="grow" type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div style={{ minHeight: 34, marginLeft: 78 }}>
            {probing && <span className="hint">Getting file information...</span>}
            {error && <span className="error-text">{error}. You can still start the download.</span>}
            {info && !probing && !error && (
              <span className="hint">
                {info.kind === "hls" ? "HLS video stream." : info.resumable ? "Resume supported - the file will be downloaded with multiple connections." : "This server does not support resume; one connection will be used."}
              </span>
            )}
          </div>
        </div>
        <div className="size-box">
          <div style={{ transform: "scale(2.4)", margin: "14px 0 18px" }}>
            <FileIcon category={category} />
          </div>
          <b>{info?.size != null ? formatBytes(info.size) : probing ? "" : info?.kind === "hls" ? "Stream" : "Unknown size"}</b>
          <span className="hint" style={{ wordBreak: "break-all" }}>
            {fileName}
          </span>
        </div>
      </div>
      <div className="window-buttons">
        <button className="btn" disabled={busy || !url} onClick={() => submit(false)} style={{ minWidth: 110 }}>
          Download Later
        </button>
        <button className="btn default" disabled={busy || !url} onClick={() => submit(true)} style={{ minWidth: 110 }} autoFocus>
          Start Download
        </button>
        <button className="btn" onClick={close}>
          Cancel
        </button>
      </div>
    </div>
  );
}
