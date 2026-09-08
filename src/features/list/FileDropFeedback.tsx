import { useEffect, useState, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, FolderInput, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { useLibrary } from "@/stores/library";

type Feedback = { phase: "hover" | "importing" | "success"; label: string } | null;

export function FileDropFeedback({ paneRef }: { paneRef: RefObject<HTMLDivElement | null> }) {
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision = 0;
    let current: Feedback = null;
    const show = (next: Feedback) => {
      if (current?.phase === next?.phase && current?.label === next?.label) return;
      current = next;
      setFeedback(next);
    };
    const reset = () => {
      revision++;
      clearTimeout(timer);
      show(null);
    };
    const unsubscribe = useLibrary.subscribe((state, previous) => {
      if (state.view !== previous.view) reset();
    });

    // Keep the existing window-wide import; only the list gets visual feedback.
    void getCurrentWindow().onDragDropEvent(async ({ payload }) => {
      if (disposed) return;
      if (payload.type === "leave") {
        if (current?.phase === "hover") reset();
        return;
      }

      const request = ++revision;
      clearTimeout(timer);
      const rect = paneRef.current?.getBoundingClientRect();
      const toolbar = paneRef.current?.querySelector("[data-pane-toolbar]")?.getBoundingClientRect();
      // wry 0.55.1 emits logical points on macOS, despite Tauri's PhysicalPosition type.
      const scale = navigator.platform.startsWith("Mac") ? 1 : window.devicePixelRatio;
      const x = payload.position.x / scale;
      const y = payload.position.y / scale;
      const overList = rect && rect.width > 0 && rect.height > 0
        && x >= rect.left && x < rect.right
        && y >= (toolbar?.bottom ?? rect.top) && y < rect.bottom;
      const { view, collections } = useLibrary.getState();
      const collection = view.kind === "collection" ? collections.find((item) => item.id === view.id) : null;
      const label = collection ? `松开加入『${collection.name}』` : "松开导入文件库";

      if (payload.type !== "drop") {
        show(overList ? { phase: "hover", label } : null);
        return;
      }
      show(overList && payload.paths.length > 0 ? { phase: "importing", label: "正在导入" } : null);
      if (payload.paths.length === 0) return;
      const resultPromise = useLibrary.getState().importPaths(payload.paths).catch(() => null);
      if (useLibrary.getState().importConfirmation) show(null);
      const result = await resultPromise;
      if (disposed) return;
      if (!result) {
        show(null);
        return;
      }
      const count = result?.imported.length ?? 0;
      // A previous import must not replace feedback for a newer drag or view.
      if (request !== revision) return;
      show(overList && count > 0 ? { phase: "success", label: `已导入 ${count} 个文件` } : null);
      if (current) timer = setTimeout(() => show(null), 600);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    }).catch(() => {
      if (!disposed) toast.error("无法启用文件拖入，请重新打开窗口");
    });

    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      unlisten?.();
    };
  }, [paneRef]);

  const Icon = feedback?.phase === "success" ? Check : feedback?.phase === "importing" ? LoaderCircle : FolderInput;
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 top-14 z-20" role="status" aria-live="polite" aria-atomic="true">
      {feedback && (
        <div className="file-drop-feedback flex h-full items-center justify-center rounded-lg border border-primary/40 bg-primary/5 p-4" data-phase={feedback.phase}>
          <div className="flex max-w-full flex-col items-center gap-3 rounded-xl border border-border/60 bg-background/95 px-5 py-4 text-center shadow-sm">
            <span key={feedback.phase} className="file-drop-icon flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
              <Icon className={`size-6${feedback.phase === "importing" ? " motion-safe:animate-spin" : ""}`} />
            </span>
            <span className="break-all text-[13px] font-medium">{feedback.label}</span>
          </div>
        </div>
      )}
    </div>
  );
}
