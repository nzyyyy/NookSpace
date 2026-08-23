import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { clampPaneWidth } from "@/lib/pane-width";
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

const LIST_MIN_WIDTH = 320;
const DETAIL_MIN_WIDTH = 360;

export default function App() {
  useShortcuts();
  const { init } = useLibrary();

  const backStack = useRef<NavEntry[]>([]);
  const fwdStack = useRef<NavEntry[]>([]);
  const listPane = useRef<HTMLDivElement>(null);
  const detailPane = useRef<HTMLDivElement>(null);
  const resize = useRef<{
    startX: number;
    startWidth: number;
    availableWidth: number;
    minimumWidth: number;
  } | undefined>(undefined);
  const [listWidth, setListWidth] = useState<number>();

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
        if (event.payload.type === "drop" && event.payload.paths.length > 0) {
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

  const listMinimumWidth = () => {
    const toolbar = listPane.current?.querySelector<HTMLElement>("[data-pane-toolbar]");
    const spacer = toolbar?.querySelector<HTMLElement>("[data-pane-spacer]");
    return Math.max(LIST_MIN_WIDTH, (toolbar?.scrollWidth ?? 0) - (spacer?.offsetWidth ?? 0));
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !listPane.current || !detailPane.current) return;
    const startWidth = listPane.current.getBoundingClientRect().width;
    resize.current = {
      startX: event.clientX,
      startWidth,
      availableWidth: startWidth + detailPane.current.getBoundingClientRect().width,
      minimumWidth: listMinimumWidth(),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const resizePanes = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resize.current) return;
    setListWidth(clampPaneWidth(
      resize.current.startWidth + event.clientX - resize.current.startX,
      resize.current.availableWidth,
      resize.current.minimumWidth,
      DETAIL_MIN_WIDTH,
    ));
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!direction || !listPane.current || !detailPane.current) return;
    const currentWidth = listPane.current.getBoundingClientRect().width;
    setListWidth(clampPaneWidth(
      currentWidth + direction * 24,
      currentWidth + detailPane.current.getBoundingClientRect().width,
      listMinimumWidth(),
      DETAIL_MIN_WIDTH,
    ));
    event.preventDefault();
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <Sidebar />
        <div ref={listPane} className="flex min-w-[320px] flex-1" style={listWidth === undefined ? undefined : { flex: `0 1 ${listWidth}px` }}>
          <ItemList />
        </div>
        <div
          role="separator"
          aria-label="调整中间栏和右侧栏宽度"
          aria-orientation="vertical"
          tabIndex={0}
          className="group relative z-10 -mx-1 w-2 shrink-0 touch-none cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border after:content-[''] hover:after:bg-primary focus-visible:after:bg-primary active:after:bg-primary"
          onPointerDown={startResize}
          onPointerMove={resizePanes}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
          onLostPointerCapture={() => { resize.current = undefined; }}
          onKeyDown={resizeWithKeyboard}
        />
        <div ref={detailPane} className="flex min-w-[360px] flex-1">
          <DetailPane />
        </div>
      </div>
      <CommandPalette />
      <QuickLook />
      <SettingsDialog />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}
