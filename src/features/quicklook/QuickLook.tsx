import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { ExternalLink, Eye, File as FileIcon, Image as ImageIcon, X } from "lucide-react";
import { convertFileSrc, ipc, type ItemDetail } from "@/core/ipc";
import { formatFullDate, formatSize } from "@/lib/format";
import { isMediaFile } from "@/lib/file-types";
import { useUi } from "@/stores/ui";
import { useLibrary } from "@/stores/library";
import { Button } from "@/components/ui/button";

const PdfPreview = lazy(() => import("@/components/PdfPreview"));

export function QuickLook() {
  const { quickLookId, setQuickLookId } = useUi();
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [absPath, setAbsPath] = useState<string | null>(null);
  const unlocked = useLibrary((state) => state.lockSession.unlocked);
  const wasUnlocked = useRef(unlocked);

  useEffect(() => {
    if (wasUnlocked.current && !unlocked) {
      setDetail(null);
      setAbsPath(null);
      setQuickLookId(null);
    }
    wasUnlocked.current = unlocked;
  }, [setQuickLookId, unlocked]);

  useEffect(() => {
    if (!quickLookId) {
      setDetail(null);
      setAbsPath(null);
      return;
    }
    let alive = true;
    void ipc.getItem(quickLookId).then((d) => alive && setDetail(d));
    void ipc.fileAbsPath(quickLookId).then((p) => alive && setAbsPath(p));
    return () => {
      alive = false;
    };
  }, [quickLookId]);

  useEffect(() => {
    if (!quickLookId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQuickLookId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quickLookId, setQuickLookId]);

  if (!quickLookId || !detail) return null;
  const item = detail.item;
  if (isMediaFile(item.mime, item.storedPath || item.title)) return null;
  const src = absPath ? convertFileSrc(absPath) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-10 backdrop-blur-[2px]"
      onClick={() => setQuickLookId(null)}
      role="dialog"
      aria-label="快速查看"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{item.title}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => void ipc.quicklook(item.id)} aria-label="系统快速查看">
            <Eye className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => void ipc.openWithDefault(item.id)} aria-label="用默认应用打开">
            <ExternalLink className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setQuickLookId(null)} aria-label="关闭">
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/40">
          {src && item.mime.startsWith("image/") ? (
            <div className="flex min-h-full items-center justify-center p-4">
              <img src={src} alt={item.title} className="max-h-full max-w-full object-contain" draggable={false} />
            </div>
          ) : src && item.mime === "application/pdf" ? (
            <Suspense fallback={<p className="py-12 text-center font-mono text-[11px] text-muted-foreground">正在载入 PDF…</p>}>
              <PdfPreview src={src} itemId={item.id} title={item.title} />
            </Suspense>
          ) : (
            <div className="flex min-h-full flex-col items-center justify-center gap-2 p-8 text-center">
              {item.mime.startsWith("image/") ? (
                <ImageIcon className="size-12 text-muted-foreground/40" />
              ) : (
                <FileIcon className="size-12 text-muted-foreground/40" />
              )}
              <p className="text-[13px] text-foreground/80">{item.title}</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {item.mime} · {formatSize(item.size)} · {formatFullDate(item.createdAt)}
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
