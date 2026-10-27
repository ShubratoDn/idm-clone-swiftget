import { useState } from "react";
import Menu, { type MenuEntry } from "../components/Menu";

export interface MenuDef {
  title: string;
  items: MenuEntry[];
}

export default function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<{ index: number; x: number; y: number } | null>(null);

  const show = (index: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setOpen({ index, x: r.left, y: r.bottom });
  };

  return (
    <div className="menubar">
      {menus.map((m, i) => (
        <div
          key={m.title}
          className={`menu-title${open?.index === i ? " open" : ""}`}
          onMouseDown={(e) => {
            e.stopPropagation();
            if (open?.index === i) setOpen(null);
            else show(i, e.currentTarget);
          }}
          onMouseEnter={(e) => open && open.index !== i && show(i, e.currentTarget)}
        >
          {m.title}
        </div>
      ))}
      {open && <Menu x={open.x} y={open.y} items={menus[open.index].items} onClose={() => setOpen(null)} />}
    </div>
  );
}
