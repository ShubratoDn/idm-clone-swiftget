import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuEntry =
  | "sep"
  | {
      label: string;
      onClick?: () => void;
      disabled?: boolean;
      checked?: boolean;
      bold?: boolean;
      shortcut?: string;
    };

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

/** A popup menu at screen position (x, y), kept inside the window. */
export default function Menu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(0, Math.min(x, window.innerWidth - r.width - 2)),
      y: Math.max(0, Math.min(y, window.innerHeight - r.height - 2)),
    });
  }, [x, y]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="dropdown" style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="sep" />
        ) : (
          <div
            key={i}
            className={`item${it.disabled ? " disabled" : ""}${it.bold ? " bold" : ""}`}
            onClick={() => {
              if (it.disabled) return;
              onClose();
              it.onClick?.();
            }}
          >
            {it.checked && <span className="check">✓</span>}
            {it.label}
            {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
          </div>
        ),
      )}
    </div>
  );
}
