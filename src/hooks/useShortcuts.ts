import { useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useLibrary } from "@/stores/library";
import { useUi } from "@/stores/ui";
import { toast } from "sonner";
import { isMediaFile, isSwitchableText } from "@/lib/file-types";

/**
 * Global keyboard shortcuts (Q20 table). Field focus and the palette take
 * precedence; everything else operates on the list/selection.
 */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const inField =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Cmd+K — palette (works even inside fields)
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useUi.getState().togglePalette();
        return;
      }
      // Cmd+\ — toggle the item list so reading/editing can fill the window.
      if (mod && !e.shiftKey && e.code === "Backslash") {
        e.preventDefault();
        useUi.getState().toggleListCollapsed();
        return;
      }
      // Cmd+E — toggle the selected note between reading and editing.
      if (mod && e.key.toLowerCase() === "e") {
        const lib = useLibrary.getState();
        if (lib.detail?.item.itemType === "file"
          && isSwitchableText(lib.detail.item.storedPath || lib.detail.item.title)
          && !lib.detail.item.deletedAt) {
          e.preventDefault();
          lib.setNoteMode(lib.noteMode === "read" ? "edit" : "read");
        }
        return;
      }
      // Cmd+N — new note
      if (mod && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void useLibrary
          .getState()
          .createNote()
          .then((item) => item && toast.success("已新建笔记"));
        return;
      }
      // Cmd+Shift+N — import files
      if (mod && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void (async () => {
          const picked = await openDialog({
            multiple: true,
            directory: false,
            title: "导入文件",
          });
          if (picked && picked.length > 0) {
            const r = await useLibrary.getState().importPaths(picked);
            if (r) {
              toast.success(
                `已导入 ${r.imported.length} 个文件${r.skipped.length ? `，跳过 ${r.skipped.length} 个` : ""}`,
              );
            }
          }
        })();
        return;
      }
      // Cmd+F — focus list search (expand the list first if it is collapsed)
      if (mod && e.key.toLowerCase() === "f" && !inField) {
        e.preventDefault();
        if (useUi.getState().listCollapsed) useUi.getState().setListCollapsed(false);
        requestAnimationFrame(() => document.getElementById("list-search")?.focus());
        return;
      }
      // Cmd+1/2/3 — smart views
      if (mod && !e.shiftKey && ["1", "2", "3"].includes(e.key)) {
        const map = { "1": "favorites", "2": "recent", "3": "uncollected" } as const;
        e.preventDefault();
        useLibrary.getState().setView({ kind: map[e.key as "1" | "2" | "3"] });
        return;
      }
      // Cmd+, — settings
      if (mod && e.key === ",") {
        e.preventDefault();
        useUi.getState().setSettingsOpen(!useUi.getState().settingsOpen);
        return;
      }

      if (useUi.getState().paletteOpen) return;
      if (inField) return;

      const lib = useLibrary.getState();

      // Arrow navigation
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        (useUi.getState().listLayout === "grid" && (e.key === "ArrowLeft" || e.key === "ArrowRight"))
      ) {
        e.preventDefault();
        const items = lib.items;
        if (!items.length) return;
        const idx = items.findIndex((i) => i.id === lib.selectedId);
        const next =
          e.key === "ArrowDown" || e.key === "ArrowRight"
            ? (idx + 1 + items.length) % items.length
            : (idx - 1 + items.length) % items.length;
        void lib.select(items[next].id);
        return;
      }
      // Enter — open
      if (e.key === "Enter" && lib.selectedId) {
        void lib.openItem(lib.selectedId);
        return;
      }
      // Space — quick look
      if (e.key === " ") {
        e.preventDefault();
        if (useUi.getState().quickLookId) useUi.getState().setQuickLookId(null);
        else if (lib.selectedId) {
          const item = lib.items.find((candidate) => candidate.id === lib.selectedId);
          if (item && isMediaFile(item.mime, item.storedPath || item.title)) {
            toast.info("音视频文件请使用默认应用打开");
          } else {
            useUi.getState().setQuickLookId(lib.selectedId);
          }
        }
        return;
      }
      // Delete — soft delete (not in trash view)
      if (e.key === "Backspace" && lib.selectedId && lib.view.kind !== "trash") {
        void lib.deleteItems([lib.selectedId]);
        toast.info("已移至回收站");
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
