import { useEffect, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const INTERACTIVE =
  "button, input, textarea, select, a, [role='button'], [contenteditable], [data-no-drag]";

/**
 * Make a container behave like a macOS titlebar:
 * - drag anywhere on it to move the window (interactive elements excluded)
 * - double-click to zoom (toggle maximize/restore)
 * Attach the returned ref to a top-level container of each pane header.
 */
export function useTitlebarDrag<T extends HTMLElement>(ref: RefObject<T | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const isInteractive = (e: MouseEvent) =>
      (e.target as HTMLElement).closest(INTERACTIVE) !== null;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || isInteractive(e)) return;
      void getCurrentWindow().startDragging();
    };
    const onDoubleClick = (e: MouseEvent) => {
      if (isInteractive(e)) return;
      void getCurrentWindow().toggleMaximize();
    };

    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("dblclick", onDoubleClick);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("dblclick", onDoubleClick);
    };
  }, [ref]);
}
