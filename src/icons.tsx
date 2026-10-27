import type { JSX } from "react";

// Original icon set in a glossy, classic-Windows toolbar style.
// Gradients live in <IconDefs/>, rendered once per window and referenced by id.

export function IconDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <linearGradient id="g-blue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7cc4ff" />
          <stop offset="1" stopColor="#1565c0" />
        </linearGradient>
        <linearGradient id="g-green" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8be37a" />
          <stop offset="1" stopColor="#23891d" />
        </linearGradient>
        <linearGradient id="g-red" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff8a80" />
          <stop offset="1" stopColor="#c62828" />
        </linearGradient>
        <linearGradient id="g-orange" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd27a" />
          <stop offset="1" stopColor="#e07b00" />
        </linearGradient>
        <linearGradient id="g-gray" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eef1f5" />
          <stop offset="1" stopColor="#9aa3ad" />
        </linearGradient>
        <linearGradient id="g-folder" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#e6a817" />
        </linearGradient>
        <linearGradient id="g-paper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dfe5ec" />
        </linearGradient>
        <linearGradient id="g-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const S = 34;

function Globe({ x = 0, y = 0, r = 12 }: { x?: number; y?: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx={0} cy={0} r={r} fill="url(#g-blue)" stroke="#0d47a1" strokeWidth="1" />
      <ellipse cx={0} cy={0} rx={r * 0.45} ry={r} fill="none" stroke="#e3f2fd" strokeWidth="1" opacity="0.8" />
      <line x1={-r} y1={0} x2={r} y2={0} stroke="#e3f2fd" strokeWidth="1" opacity="0.8" />
      <path d={`M${-r * 0.85} ${-r * 0.5} H${r * 0.85} M${-r * 0.85} ${r * 0.5} H${r * 0.85}`} stroke="#e3f2fd" strokeWidth="0.8" opacity="0.6" />
      <ellipse cx={0} cy={-r * 0.45} rx={r * 0.75} ry={r * 0.45} fill="url(#g-shine)" />
    </g>
  );
}

function DownArrow({ fill = "url(#g-green)", stroke = "#1b5e20" }: { fill?: string; stroke?: string }) {
  return <path d="M12 4 h10 v11 h6 L17 28 L6 15 h6 z" fill={fill} stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" />;
}

function StopSquare({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g>
      <rect x={x} y={y} width={s} height={s} rx={s * 0.18} fill="url(#g-red)" stroke="#8e0000" strokeWidth="1.2" />
      <rect x={x + 2} y={y + 2} width={s - 4} height={s * 0.4} rx={s * 0.12} fill="url(#g-shine)" />
    </g>
  );
}

export const ToolIcons: Record<string, () => JSX.Element> = {
  addUrl: () => (
    <svg width={S} height={S} viewBox="0 0 34 34">
      <Globe x={15} y={16} r={12} />
      <circle cx="25" cy="25" r="7.5" fill="url(#g-green)" stroke="#1b5e20" strokeWidth="1.2" />
      <path d="M25 21 v8 M21 25 h8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  ),
  resume: () => (
    <svg width={S} height={S} viewBox="0 0 34 34">
      <rect x="4" y="27" width="26" height="4" rx="2" fill="url(#g-gray)" stroke="#6b7580" strokeWidth="0.8" />
      <DownArrow fill="url(#g-blue)" stroke="#0d47a1" />
    </svg>
  ),
  stop: () => (
    <svg width={S} height={S} viewBox="0 0 34 34">
      <StopSquare x={6} y={6} s={22} />
    </svg>
  ),
  stopAll: () => (
    <svg width={S} height={S} viewBox="0 0 34 34">
      <StopSquare x={3} y={3} s={17} />
      <StopSquare x={14} y={14} s={17} />
    </svg>
  ),
  delete: () => (
    <svg width={S} height={S} viewBox="0 0 34 34">
      <path d="M8 10 h18 l-2 20 h-14 z" fill="url(#g-gray)" stroke="#5f6b76" strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="6" y="6" width="22" height="4" rx="1.5" fill="url(#g-gray)" stroke="#5f6b76" strokeWidth="1.2" />
      <path d="M13 14 v12 M17 14 v12 M21 14 v12" stroke="#7d8892" strokeWidth="1.4" />
      <circle cx="24" cy="24" r="7" fill="url(#g-red)" stroke="#8e0000" strokeWidth="1.2" />
      <path d="M21.2 21.2 l5.6 5.6 M26.8 21.2 l-5.6 5.6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  deleteCompleted: () => (
    <svg width={S} height={S} viewBox="0 0 34 34">
      <path d="M8 10 h18 l-2 20 h-14 z" fill="url(#g-gray)" stroke="#5f6b76" strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="6" y="6" width="22" height="4" rx="1.5" fill="url(#g-gray)" stroke="#5f6b76" strokeWidth="1.2" />
      <circle cx="23" cy="24" r="7.5" fill="url(#g-green)" stroke="#1b5e20" strokeWidth="1.2" />
      <path d="M19.5 24 l2.5 2.6 l4.6 -5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  options: () => (
    <svg width={S} height={S} viewBox="0 0 34 34">
      <g transform="translate(17 17)">
        {Array.from({ length: 8 }).map((_, i) => (
          <rect key={i} x={-2.6} y={-15} width={5.2} height={7} rx={1.2} fill="url(#g-gray)" stroke="#56606a" strokeWidth="1" transform={`rotate(${i * 45})`} />
        ))}
        <circle r="10" fill="url(#g-gray)" stroke="#56606a" strokeWidth="1.2" />
        <circle r="4.2" fill="#fff" stroke="#56606a" strokeWidth="1.2" />
      </g>
    </svg>
  ),
  scheduler: () => (
    <svg width={S} height={S} viewBox="0 0 34 34">
      <circle cx="17" cy="18" r="13" fill="url(#g-orange)" stroke="#a45200" strokeWidth="1.2" />
      <circle cx="17" cy="18" r="10" fill="#fff" stroke="#c77800" strokeWidth="0.8" />
      <path d="M17 11 v7 l5 3" stroke="#333" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M6 7 l4 -3 M28 7 l-4 -3" stroke="#a45200" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  ),
  startQueue: () => (
    <svg width={S} height={S} viewBox="0 0 34 34">
      <rect x="3" y="5" width="18" height="24" rx="2" fill="url(#g-paper)" stroke="#6b7580" strokeWidth="1.1" />
      <path d="M7 11 h10 M7 16 h10 M7 21 h7" stroke="#7b8794" strokeWidth="1.6" />
      <circle cx="23" cy="22" r="9" fill="url(#g-green)" stroke="#1b5e20" strokeWidth="1.2" />
      <path d="M20.5 17.5 L28 22 L20.5 26.5 z" fill="#fff" />
    </svg>
  ),
  stopQueue: () => (
    <svg width={S} height={S} viewBox="0 0 34 34">
      <rect x="3" y="5" width="18" height="24" rx="2" fill="url(#g-paper)" stroke="#6b7580" strokeWidth="1.1" />
      <path d="M7 11 h10 M7 16 h10 M7 21 h7" stroke="#7b8794" strokeWidth="1.6" />
      <circle cx="23" cy="22" r="9" fill="url(#g-red)" stroke="#8e0000" strokeWidth="1.2" />
      <rect x="19.5" y="18.5" width="7" height="7" rx="1" fill="#fff" />
    </svg>
  ),
  speed: () => (
    <svg width={S} height={S} viewBox="0 0 34 34">
      <path d="M4 25 A13 13 0 0 1 30 25" fill="url(#g-paper)" stroke="#56606a" strokeWidth="1.4" />
      <path d="M7 25 A10 10 0 0 1 12 16" stroke="#43a047" strokeWidth="3" fill="none" />
      <path d="M12 16 A10 10 0 0 1 22 16" stroke="#fbc02d" strokeWidth="3" fill="none" />
      <path d="M22 16 A10 10 0 0 1 27 25" stroke="#e53935" strokeWidth="3" fill="none" />
      <path d="M17 25 L24 15" stroke="#333" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="17" cy="25" r="2.6" fill="#333" />
    </svg>
  ),
};

/** 16px file-type icons for the download list. */
export function FileIcon({ category, status }: { category: string; status?: string }) {
  const body = (() => {
    switch (category) {
      case "Compressed":
        return (
          <>
            <rect x="2" y="3" width="12" height="11" rx="1" fill="#c98b3c" stroke="#7a4f17" strokeWidth="0.8" />
            <rect x="2" y="3" width="12" height="3" fill="#e0a95a" stroke="#7a4f17" strokeWidth="0.8" />
            <path d="M8 6 v7" stroke="#ffe082" strokeWidth="1.6" strokeDasharray="1.2 1" />
          </>
        );
      case "Documents":
        return (
          <>
            <path d="M3 1.5 h7 l3 3 v10 h-10 z" fill="url(#g-paper)" stroke="#5b6b7c" strokeWidth="0.8" />
            <path d="M5 7 h6 M5 9 h6 M5 11 h4" stroke="#1e66c8" strokeWidth="1" />
          </>
        );
      case "Music":
        return (
          <>
            <circle cx="8" cy="8" r="6.5" fill="url(#g-orange)" stroke="#a45200" strokeWidth="0.8" />
            <path d="M7 11.5 v-7 l3.5 -1 v6" stroke="#fff" strokeWidth="1.2" fill="none" />
            <circle cx="6.2" cy="11.5" r="1.4" fill="#fff" />
            <circle cx="9.7" cy="9.6" r="1.4" fill="#fff" />
          </>
        );
      case "Programs":
        return (
          <>
            <rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="#fff" stroke="#4a5560" strokeWidth="0.8" />
            <rect x="1.5" y="2.5" width="13" height="3" fill="url(#g-blue)" stroke="#4a5560" strokeWidth="0.8" />
            <rect x="4" y="7.5" width="8" height="1.4" fill="#9aa5b1" />
            <rect x="4" y="10" width="5" height="1.4" fill="#9aa5b1" />
          </>
        );
      case "Video":
        return (
          <>
            <rect x="1.5" y="3" width="13" height="10" rx="1" fill="#37474f" stroke="#1c262b" strokeWidth="0.8" />
            <path d="M1.5 5 h13 M1.5 11 h13" stroke="#90a4ae" strokeWidth="0.8" strokeDasharray="1.4 1.2" />
            <path d="M6.5 6 L11 8 L6.5 10 z" fill="#ffca28" />
          </>
        );
      default:
        return (
          <>
            <path d="M3 1.5 h7 l3 3 v10 h-10 z" fill="url(#g-paper)" stroke="#5b6b7c" strokeWidth="0.8" />
            <path d="M10 1.5 v3 h3" fill="none" stroke="#5b6b7c" strokeWidth="0.8" />
          </>
        );
    }
  })();
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="file-icon">
      {body}
      {status === "downloading" && <path d="M10 9 h4 v3 h2 L12 16 L8 12 h2 z" fill="url(#g-green)" stroke="#1b5e20" strokeWidth="0.6" />}
      {status === "failed" && <circle cx="12.5" cy="12.5" r="3.2" fill="url(#g-red)" stroke="#8e0000" strokeWidth="0.6" />}
    </svg>
  );
}

export function FolderIcon({ open, badge }: { open?: boolean; badge?: "down" | "check" | "queue" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="tree-icon">
      {badge === "queue" ? (
        <>
          <rect x="2" y="1.5" width="11" height="13" rx="1" fill="url(#g-paper)" stroke="#5b6b7c" strokeWidth="0.8" />
          <path d="M4 5 h7 M4 8 h7 M4 11 h5" stroke="#1e66c8" strokeWidth="1" />
        </>
      ) : (
        <>
          <path d="M1 4 h5 l1.5 1.5 h7.5 v8.5 h-14 z" fill="url(#g-folder)" stroke="#a87400" strokeWidth="0.8" />
          {open && <path d="M2.5 7 h13 l-1.5 7 h-13 z" fill="#ffe9a8" stroke="#a87400" strokeWidth="0.8" />}
        </>
      )}
      {badge === "down" && <path d="M10 7 h3 v3 h2 L11.5 14 L8 10 h2 z" fill="url(#g-blue)" stroke="#0d47a1" strokeWidth="0.6" />}
      {badge === "check" && <path d="M8.5 10.5 l2 2 l4 -4.5" stroke="#23891d" strokeWidth="2" fill="none" strokeLinecap="round" />}
    </svg>
  );
}

export function AppLogo({ size = 16 }: { size?: number }) {
  return <img src="/app-icon.png" width={size} height={size} alt="" draggable={false} />;
}
