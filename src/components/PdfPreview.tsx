import { useEffect, useRef, useState } from "react";
import { ExternalLink, Eye, FileText } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { ipc } from "@/core/ipc";
import { Button } from "@/components/ui/button";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

function PdfFallback({ itemId, title }: { itemId: string; title: string }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
      <FileText className="size-10 text-muted-foreground/40" />
      <div>
        <p className="text-[13px] font-medium">无法在此处预览 PDF</p>
        <p className="mt-1 max-w-sm truncate text-[11.5px] text-muted-foreground">{title}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void ipc.quicklook(itemId)}>
          <Eye className="size-3.5" /> 系统快速查看
        </Button>
        <Button variant="outline" size="sm" onClick={() => void ipc.openWithDefault(itemId)}>
          <ExternalLink className="size-3.5" /> 默认应用打开
        </Button>
      </div>
    </div>
  );
}

export default function PdfPreview({
  src,
  itemId,
  title,
}: {
  src: string;
  itemId: string;
  title: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewport = container.closest<HTMLElement>("[data-slot='scroll-area-viewport']") ?? container.parentElement;
    const updateWidth = () => {
      const visibleWidth = viewport
        ? Math.min(container.clientWidth, viewport.getBoundingClientRect().right - container.getBoundingClientRect().left)
        : container.clientWidth;
      setPageWidth(Math.min(Math.max(visibleWidth - 48, 0), 960));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    if (viewport) observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setNumPages(0), [src]);

  const fallback = <PdfFallback itemId={itemId} title={title} />;

  return (
    <div
      ref={containerRef}
      className="flex min-h-full w-full flex-col bg-muted/35 p-4"
      aria-label={`PDF 预览：${title}`}
    >
      <Document
        key={src}
        file={src}
        className="flex w-full flex-col items-center gap-4"
        loading={<p className="py-12 font-mono text-[11px] text-muted-foreground" aria-live="polite">正在载入 PDF…</p>}
        noData={fallback}
        error={fallback}
        onLoadSuccess={({ numPages: count }) => setNumPages(count)}
        onLoadError={() => setNumPages(0)}
        onPassword={(callback) => callback(null)}
      >
        {/* ponytail: render all pages; add viewport virtualization if large PDFs become measurably slow. */}
        {pageWidth > 0 && Array.from({ length: numPages }, (_, index) => (
          <Page
            key={index + 1}
            pageNumber={index + 1}
            width={pageWidth}
            canvasBackground="#ffffff"
            renderAnnotationLayer={false}
            className="max-w-full self-start bg-white shadow-[0_1px_8px_rgba(52,45,36,0.14)] dark:shadow-[0_1px_12px_rgba(0,0,0,0.35)]"
            loading={<p className="py-12 font-mono text-[11px] text-muted-foreground">正在载入第 {index + 1} 页…</p>}
            error={<p className="py-12 text-[12px] text-destructive">第 {index + 1} 页载入失败</p>}
          />
        ))}
      </Document>
    </div>
  );
}
