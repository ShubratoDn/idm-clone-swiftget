import { useState } from "react";
import type { Download } from "../api";
import { FolderIcon } from "../icons";
import { CATEGORY_NAMES, matchesFilter } from "./filters";
import { loadPref, savePref } from "../useStore";

interface Props {
  downloads: Download[];
  selected: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}

const GROUPS: { key: string; label: string; badge?: "down" | "check" }[] = [
  { key: "all", label: "All Downloads" },
  { key: "unfinished", label: "Unfinished", badge: "down" },
  { key: "finished", label: "Finished", badge: "check" },
];

export default function CategoryTree({ downloads, selected, onSelect, onClose }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => loadPref("tree", { all: true, unfinished: false, finished: false, queues: true }));

  const toggle = (k: string) => {
    const next = { ...expanded, [k]: !expanded[k] };
    setExpanded(next);
    savePref("tree", next);
  };

  const count = (key: string) => downloads.filter((d) => matchesFilter(d, key)).length;

  const Row = ({ k, label, depth, icon, twisty }: { k: string; label: string; depth: number; icon: React.ReactNode; twisty?: string }) => (
    <div className={`tree-row${selected === k ? " selected" : ""}`} style={{ paddingLeft: 4 + depth * 16 }} onMouseDown={() => onSelect(k)}>
      <span
        className="twisty"
        onMouseDown={(e) => {
          if (!twisty) return;
          e.stopPropagation();
          toggle(twisty);
        }}
      >
        {twisty ? (expanded[twisty] ? "▼" : "▶") : ""}
      </span>
      {icon}
      <span className="label">{label}</span>
    </div>
  );

  return (
    <div className="categories">
      <div className="panel-head">
        <span>Categories</span>
        <span className="x" onClick={onClose} title="Hide categories">
          ✕
        </span>
      </div>
      <div className="tree">
        {GROUPS.map((g) => (
          <div key={g.key}>
            <Row k={g.key} label={g.key === "all" ? g.label : `${g.label} (${count(g.key)})`} depth={0} twisty={g.key} icon={<FolderIcon open={expanded[g.key]} badge={g.badge} />} />
            {expanded[g.key] &&
              CATEGORY_NAMES.map((c) => <Row key={c} k={`${g.key}:${c}`} label={c} depth={1} icon={<FolderIcon />} />)}
          </div>
        ))}
        <Row k="queues" label="Queues" depth={0} twisty="queues" icon={<FolderIcon open={expanded.queues} />} />
        {expanded.queues && <Row k="queue" label="Main download queue" depth={1} icon={<FolderIcon badge="queue" />} />}
      </div>
    </div>
  );
}
