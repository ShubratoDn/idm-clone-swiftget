import { useRef, useState } from "react";
import type { Download } from "../api";
import { FileIcon } from "../icons";
import { formatBytes, formatDate, formatEta, formatSpeed, statusText } from "../format";
import { loadPref, savePref } from "../useStore";

type ColumnId = "name" | "size" | "status" | "eta" | "speed" | "lastTry" | "description";

const COLUMNS: { id: ColumnId; label: string; width: number; num?: boolean }[] = [
  { id: "name", label: "File Name", width: 300 },
  { id: "size", label: "Size", width: 85, num: true },
  { id: "status", label: "Status", width: 85 },
  { id: "eta", label: "Time left", width: 90 },
  { id: "speed", label: "Transfer rate", width: 95 },
  { id: "lastTry", label: "Last Try Date", width: 120 },
  { id: "description", label: "Description", width: 200 },
];

function sortValue(d: Download, col: ColumnId): string | number {
  switch (col) {
    case "name":
      return d.fileName.toLowerCase();
    case "size":
      return d.size ?? -1;
    case "status":
      return d.status === "completed" ? 101 : d.size ? d.downloaded / d.size : 0;
    case "eta":
      return d.eta ?? Infinity;
    case "speed":
      return d.speed ?? 0;
    case "lastTry":
      return d.lastTryAt ?? d.addedAt;
    case "description":
      return d.description.toLowerCase();
  }
}

function cellText(d: Download, col: ColumnId): string {
  switch (col) {
    case "name":
      return d.fileName;
    case "size":
      return formatBytes(d.size);
    case "status":
      return statusText(d);
    case "eta":
      return d.status === "downloading" ? formatEta(d.eta) : "";
    case "speed":
      return d.status === "downloading" ? formatSpeed(d.speed) : "";
    case "lastTry":
      return formatDate(d.completedAt ?? d.lastTryAt ?? d.addedAt);
    case "description":
      return d.status === "failed" ? d.error ?? "" : d.description;
  }
}

interface Props {
  downloads: Download[];
  selection: Set<number>;
  onSelection: (s: Set<number>) => void;
  onOpen: (d: Download) => void;
  onContextMenu: (x: number, y: number) => void;
  onKey: (e: React.KeyboardEvent) => void;
}

export default function DownloadList({ downloads, selection, onSelection, onOpen, onContextMenu, onKey }: Props) {
  const [widths, setWidths] = useState<Record<string, number>>(() => loadPref("columns", Object.fromEntries(COLUMNS.map((c) => [c.id, c.width]))));
  const [sort, setSort] = useState<{ col: ColumnId; asc: boolean }>(() => loadPref("sort", { col: "lastTry" as ColumnId, asc: false }));
  const anchor = useRef<number | null>(null);

  const rows = [...downloads].sort((a, b) => {
    const va = sortValue(a, sort.col);
    const vb = sortValue(b, sort.col);
    const r = va < vb ? -1 : va > vb ? 1 : b.id - a.id;
    return sort.asc ? r : -r;
  });

  const clickRow = (e: React.MouseEvent, d: Download) => {
    if (e.button === 2 && selection.has(d.id)) return;
    if (e.shiftKey && anchor.current != null) {
      const ids = rows.map((r) => r.id);
      const [a, b] = [ids.indexOf(anchor.current), ids.indexOf(d.id)].sort((x, y) => x - y);
      onSelection(new Set(ids.slice(a, b + 1)));
      return;
    }
    if (e.ctrlKey) {
      const s = new Set(selection);
      if (s.has(d.id)) s.delete(d.id);
      else s.add(d.id);
      onSelection(s);
    } else {
      onSelection(new Set([d.id]));
    }
    anchor.current = d.id;
  };

  const keyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const ids = rows.map((r) => r.id);
      const cur = anchor.current != null ? ids.indexOf(anchor.current) : -1;
      const next = Math.max(0, Math.min(ids.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)));
      if (ids[next] != null) {
        anchor.current = ids[next];
        onSelection(new Set([ids[next]]));
      }
      return;
    }
    if (e.key === "a" && e.ctrlKey) {
      e.preventDefault();
      onSelection(new Set(rows.map((r) => r.id)));
      return;
    }
    onKey(e);
  };

  const startResize = (e: React.MouseEvent, col: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[col];
    const move = (ev: MouseEvent) => setWidths((w) => ({ ...w, [col]: Math.max(40, startW + ev.clientX - startX) }));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setWidths((w) => {
        savePref("columns", w);
        return w;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const clickHeader = (col: ColumnId) => {
    const next = { col, asc: sort.col === col ? !sort.asc : true };
    setSort(next);
    savePref("sort", next);
  };

  const totalWidth = COLUMNS.reduce((s, c) => s + (widths[c.id] ?? c.width), 0);

  return (
    <div className="list-scroll" tabIndex={0} onKeyDown={keyDown} onMouseDown={(e) => e.target === e.currentTarget && onSelection(new Set())}>
      <table className="list" style={{ minWidth: totalWidth }}>
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.id} style={{ width: widths[c.id] ?? c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.id} onClick={() => clickHeader(c.id)} style={{ position: "sticky" }}>
                {c.label}
                {sort.col === c.id && <span className="sort">{sort.asc ? "▲" : "▼"}</span>}
                <span className="resizer" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => startResize(e, c.id)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr
              key={d.id}
              className={`row${selection.has(d.id) ? " selected" : ""}`}
              onMouseDown={(e) => clickRow(e, d)}
              onDoubleClick={() => onOpen(d)}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu(e.clientX, e.clientY);
              }}
            >
              {COLUMNS.map((c) => (
                <td key={c.id} className={`${c.num ? "num" : ""}${c.id === "status" && d.status === "failed" ? " status-error" : ""}`} title={c.id === "name" ? d.url : c.id === "description" ? cellText(d, c.id) : undefined}>
                  {c.id === "name" ? (
                    <div className="name-cell">
                      <FileIcon category={d.category} status={d.status} />
                      <span>{d.fileName}</span>
                    </div>
                  ) : (
                    cellText(d, c.id)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="empty-list">No downloads here. Click "Add URL" or download something in your browser.</div>}
    </div>
  );
}
