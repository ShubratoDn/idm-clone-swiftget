import { useCallback, useEffect, useMemo, useState } from "react";
import { api, events, subscribe, type Download } from "../api";
import Menu, { type MenuEntry } from "../components/Menu";
import { formatSpeed } from "../format";
import { loadPref, savePref, useStore } from "../useStore";
import CategoryTree from "./CategoryTree";
import DownloadList from "./DownloadList";
import { filterTitle, matchesFilter } from "./filters";
import MenuBar, { type MenuDef } from "./MenuBar";
import OptionsDialog from "./OptionsDialog";
import SchedulerDialog from "./SchedulerDialog";
import { AboutDialog, AddUrlDialog, DeleteDialog, SpeedLimiterDialog } from "./SmallDialogs";
import Toolbar, { type Tool } from "./Toolbar";

type DialogKind = "addUrl" | "delete" | "deleteCompleted" | "options" | "scheduler" | "speed" | "about" | null;

export default function MainWindow() {
  const { downloads, settings, schedule } = useStore();
  const [filter, setFilter] = useState(() => loadPref("filter", "all"));
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const [showTree, setShowTree] = useState(() => loadPref("showTree", true));
  const [showStatus, setShowStatus] = useState(() => loadPref("showStatus", true));

  const all = useMemo(() => [...downloads.values()], [downloads]);
  const visible = useMemo(() => all.filter((d) => matchesFilter(d, filter)), [all, filter]);
  const selected = useMemo(() => all.filter((d) => selection.has(d.id)), [all, selection]);
  const selIds = selected.map((d) => d.id);

  const canResume = selected.some((d) => d.status === "paused" || d.status === "failed");
  const canStop = selected.some((d) => d.status === "downloading" || d.status === "queued");
  const anyActive = all.some((d) => d.status === "downloading" || d.status === "queued");
  const anyCompleted = all.some((d) => d.status === "completed");
  const single = selected.length === 1 ? selected[0] : null;

  useEffect(() => subscribe([events.onMenuAddUrl(() => setDialog("addUrl"))]), []);

  // Drop selections of removed downloads.
  useEffect(() => {
    setSelection((s) => {
      const next = new Set([...s].filter((id) => downloads.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [downloads]);

  const changeFilter = (k: string) => {
    setFilter(k);
    savePref("filter", k);
  };

  const openDownload = useCallback((d: Download) => {
    if (d.status === "completed") api.openFile(d.id).catch(() => api.openFolder(d.id));
    else api.openProgress(d.id);
  }, []);

  const resume = () => api.start(selIds);
  const stop = () => api.pause(selIds);
  const pauseAll = () => api.pause(all.filter((d) => d.status === "downloading" || d.status === "queued").map((d) => d.id));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Delete" && selected.length) setDialog("delete");
    else if (e.key === "Enter" && single) openDownload(single);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog) return;
      if (e.ctrlKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        setDialog("addUrl");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  const toggleTree = (v: boolean) => {
    setShowTree(v);
    savePref("showTree", v);
  };
  const toggleStatus = (v: boolean) => {
    setShowStatus(v);
    savePref("showStatus", v);
  };

  const speedOn = (settings?.speedLimitKbps ?? 0) > 0;

  const fileItems: MenuEntry[] = [
    { label: "Open", bold: true, disabled: single?.status !== "completed", onClick: () => single && api.openFile(single.id) },
    { label: "Open folder", disabled: !single, onClick: () => single && api.openFolder(single.id) },
    "sep",
    { label: "Resume download", disabled: !canResume, onClick: resume },
    { label: "Stop download", disabled: !canStop, onClick: stop },
    { label: "Redownload", disabled: !single || single.status === "downloading", onClick: () => single && api.redownload(single.id) },
    "sep",
    { label: "Copy download address", disabled: !single, onClick: () => single && navigator.clipboard.writeText(single.url) },
    { label: "Remove", disabled: !selected.length, onClick: () => setDialog("delete"), shortcut: "Del" },
    "sep",
    { label: "Properties", disabled: !single, onClick: () => single && api.openProgress(single.id) },
  ];

  const menus: MenuDef[] = [
    {
      title: "Tasks",
      items: [
        { label: "Add new download", shortcut: "Ctrl+N", onClick: () => setDialog("addUrl") },
        "sep",
        { label: "Start queue", disabled: !all.some((d) => d.status === "paused" || d.status === "failed"), onClick: () => api.startQueue() },
        { label: "Stop queue", disabled: !anyActive, onClick: () => api.stopQueue() },
        "sep",
        { label: "Exit", onClick: () => api.quit() },
      ],
    },
    { title: "File", items: fileItems },
    {
      title: "Downloads",
      items: [
        { label: "Pause All", disabled: !anyActive, onClick: pauseAll },
        { label: "Stop All", disabled: !anyActive, onClick: () => api.stopQueue() },
        "sep",
        { label: "Delete All Completed", disabled: !anyCompleted, onClick: () => setDialog("deleteCompleted") },
        "sep",
        { label: "Scheduler", onClick: () => setDialog("scheduler") },
        { label: "Speed Limiter...", checked: speedOn, onClick: () => setDialog("speed") },
        { label: speedOn ? "Turn off speed limiter" : "Turn on speed limiter", onClick: () => (speedOn ? api.setSpeedLimit(0) : setDialog("speed")) },
        "sep",
        { label: "Options", onClick: () => setDialog("options") },
      ],
    },
    {
      title: "View",
      items: [
        { label: "Categories", checked: showTree, onClick: () => toggleTree(!showTree) },
        { label: "Status bar", checked: showStatus, onClick: () => toggleStatus(!showStatus) },
      ],
    },
    { title: "Help", items: [{ label: "About SwiftGet", onClick: () => setDialog("about") }] },
  ];

  const tools: Tool[] = [
    { id: "addUrl", label: "Add URL", onClick: () => setDialog("addUrl") },
    { id: "resume", label: "Resume", disabled: !canResume, onClick: resume },
    { id: "stop", label: "Stop", disabled: !canStop, onClick: stop },
    { id: "stopAll", label: "Stop All", disabled: !anyActive, onClick: pauseAll },
    { id: "delete", label: "Delete", disabled: !selected.length, onClick: () => setDialog("delete") },
    { id: "deleteCompleted", label: "Delete Co...", title: "Delete Completed", disabled: !anyCompleted, onClick: () => setDialog("deleteCompleted") },
    { id: "divider" },
    { id: "options", label: "Options", onClick: () => setDialog("options") },
    { id: "scheduler", label: "Scheduler", onClick: () => setDialog("scheduler") },
    { id: "startQueue", label: "Start Qu...", title: "Start Queue", onClick: () => api.startQueue() },
    { id: "stopQueue", label: "Stop Qu...", title: "Stop Queue", disabled: !anyActive, onClick: () => api.stopQueue() },
    { id: "divider" },
    { id: "speed", label: "Speed Li...", title: "Speed Limiter", onClick: () => setDialog("speed") },
  ];

  const active = all.filter((d) => d.status === "downloading");
  const totalSpeed = active.reduce((s, d) => s + (d.speed ?? 0), 0);
  const completedIds = all.filter((d) => d.status === "completed").map((d) => d.id);

  return (
    <div className="main">
      <MenuBar menus={menus} />
      <Toolbar tools={tools} />
      <div className="body">
        {showTree && <CategoryTree downloads={all} selected={filter} onSelect={changeFilter} onClose={() => toggleTree(false)} />}
        <div className="list-wrap">
          <DownloadList
            downloads={visible}
            selection={selection}
            onSelection={setSelection}
            onOpen={openDownload}
            onContextMenu={(x, y) => setCtx({ x, y })}
            onKey={onKey}
          />
        </div>
      </div>
      {showStatus && (
        <div className="statusbar">
          <span className="cell grow">{filterTitle(filter)}: {visible.length} item(s){selected.length > 1 ? `, ${selected.length} selected` : ""}</span>
          <span className="cell">Downloading: {active.length}</span>
          <span className="cell">{active.length ? formatSpeed(totalSpeed) : "Idle"}</span>
          <span className="cell click" onClick={() => setDialog("speed")} title="Speed Limiter">
            Speed limiter: {speedOn ? `${settings!.speedLimitKbps} KB/s` : "Off"}
          </span>
        </div>
      )}

      {ctx && selected.length > 0 && <Menu x={ctx.x} y={ctx.y} items={fileItems} onClose={() => setCtx(null)} />}

      {dialog === "addUrl" && <AddUrlDialog onClose={() => setDialog(null)} />}
      {dialog === "delete" && (
        <DeleteDialog
          count={selected.length}
          onClose={() => setDialog(null)}
          onConfirm={(files) => {
            api.remove(selIds, files);
            setDialog(null);
          }}
        />
      )}
      {dialog === "deleteCompleted" && (
        <DeleteDialog
          count={completedIds.length}
          onClose={() => setDialog(null)}
          onConfirm={(files) => {
            api.remove(completedIds, files);
            setDialog(null);
          }}
        />
      )}
      {dialog === "options" && settings && <OptionsDialog settings={settings} onClose={() => setDialog(null)} />}
      {dialog === "scheduler" && schedule && <SchedulerDialog schedule={schedule} downloads={all} onClose={() => setDialog(null)} />}
      {dialog === "speed" && settings && <SpeedLimiterDialog settings={settings} onClose={() => setDialog(null)} />}
      {dialog === "about" && <AboutDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
