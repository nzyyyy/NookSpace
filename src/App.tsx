import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLibrary, type View } from "@/stores/library";
import { initTheme } from "@/stores/theme";
import { useShortcuts } from "@/hooks/useShortcuts";
import { Sidebar } from "@/features/sidebar/Sidebar";
import { ItemList } from "@/features/list/ItemList";
import { DetailPane } from "@/features/detail/DetailPane";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { QuickLook } from "@/features/quicklook/QuickLook";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

interface NavEntry {
  view: View;
  id: string | null;
}

export default function App() {
  useShortcuts();
  const { init } = useLibrary();

  const backStack = useRef<NavEntry[]>([]);
  const fwdStack = useRef<NavEntry[]>([]);

  // Theme + library bootstrap
  useEffect(() => {
    initTheme();
    void init();
  }, [init]);

  // Record navigation history for Cmd+[ / Cmd+]
  useEffect(() => {
    return useLibrary.subscribe((s, prev) => {
      if (s.view !== prev.view) {
        backStack.current.push({ view: prev.view, id: prev.selectedId });
        fwdStack.current = [];
        if (backStack.current.length > 60) backStack.current.shift();
      }
    });
  }, []);

  // Cmd+[ / Cmd+] — back / forward
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "[") {
        e.preventDefault();
        const entry = backStack.current.pop();
        if (entry) {
          fwdStack.current.push({
            view: useLibrary.getState().view,
            id: useLibrary.getState().selectedId,
          });
          useLibrary.getState().setView(entry.view);
          if (entry.id) void useLibrary.getState().select(entry.id);
        }
      } else if (e.key === "]") {
        e.preventDefault();
        const entry = fwdStack.current.pop();
        if (entry) {
          backStack.current.push({
            view: useLibrary.getState().view,
            id: useLibrary.getState().selectedId,
          });
          useLibrary.getState().setView(entry.view);
          if (entry.id) void useLibrary.getState().select(entry.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Finder drag & drop — copy dropped files/folders into the Library
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent(async (event) => {
        if (disposed) return;
        if (event.payload.type === "drop") {
          const result = await useLibrary.getState().importPaths(event.payload.paths);
          if (result) {
            toast.success(
              `已导入 ${result.imported.length} 个文件${result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ""}`,
            );
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <Sidebar />
        <ItemList />
        <DetailPane />
      </div>
      <CommandPalette />
      <QuickLook />
      <SettingsDialog />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}
