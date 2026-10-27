import { ToolIcons } from "../icons";

export interface Tool {
  id: keyof typeof ToolIcons | "divider";
  label?: string;
  title?: string;
  disabled?: boolean;
  onClick?: () => void;
}

export default function Toolbar({ tools }: { tools: Tool[] }) {
  return (
    <div className="toolbar">
      {tools.map((t, i) => {
        if (t.id === "divider") return <div key={i} className="divider" />;
        const Icon = ToolIcons[t.id];
        return (
          <div
            key={t.id}
            className={`tool${t.disabled ? " disabled" : ""}`}
            title={t.title ?? t.label}
            onClick={() => !t.disabled && t.onClick?.()}
          >
            <Icon />
            <span>{t.label}</span>
          </div>
        );
      })}
    </div>
  );
}
