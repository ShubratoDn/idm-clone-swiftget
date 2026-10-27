import { useEffect, type ReactNode } from "react";
import { AppLogo } from "../icons";

interface Props {
  title: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
  buttons?: ReactNode;
}

/** An in-window modal drawn like a Windows dialog box. */
export default function Dialog({ title, width = 420, onClose, children, buttons }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.stopPropagation()}>
      <div className="dialog" style={{ width }} role="dialog" aria-label={title}>
        <div className="title">
          <AppLogo />
          <span className="text">{title}</span>
          <span className="close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="content">{children}</div>
        {buttons && <div className="buttons">{buttons}</div>}
      </div>
    </div>
  );
}
