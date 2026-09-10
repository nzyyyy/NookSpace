import { useEffect, useRef, useState } from "react";
import { ExternalLink, Eye, FileText } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
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

function PdfReadingPage({ pdf, pageNumber, width }: { pdf: PDFDocumentProxy; pageNumber: number; width: number }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const overlay = overlayRef.current;
    const viewport = wrapper?.closest<HTMLElement>("[data-reading-scale]");
    if (!wrapper || !overlay || !viewport) return;
    let visible = false;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let task: RenderTask | undefined;
    let revision = 0;
    let renderedScale = 1;
    const cancel = () => { revision += 1; clearTimeout(timer); task?.cancel(); task = undefined; };
    const refine = async () => {
      const currentRevision = revision;
      const scale = Number(viewport.dataset.readingScale) || 1;
      if (!visible || scale === renderedScale) return;
      if (scale === 1) { overlay.replaceChildren(); renderedScale = 1; return; }
      try {
        const page = await pdf.getPage(pageNumber);
        if (disposed || currentRevision !== revision) return;
        const unit = page.getViewport({ scale: 1 });
        const height = width * unit.height / unit.width;
        // ponytail: cap each visible-page buffer at 16 MP; use tiled rendering if higher zoom needs sharper output.
        const density = Math.min(window.devicePixelRatio * scale, Math.sqrt(16_000_000 / (width * height)));
        const canvas = document.createElement("canvas");
        const target = page.getViewport({ scale: width / unit.width * density });
        canvas.width = Math.ceil(target.width);
        canvas.height = Math.ceil(target.height);
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        task = page.render({ canvas, viewport: target });
        await task.promise;
        if (disposed || currentRevision !== revision) return;
        overlay.replaceChildren(canvas);
        renderedScale = scale;
      } catch {
        // Cancellation or refinement failure leaves the original PDF page visible.
      }
    };
    const schedule = () => {
      cancel();
      if (visible) timer = setTimeout(() => { void refine(); }, 180);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible) { overlay.replaceChildren(); renderedScale = 1; }
      schedule();
    }, { root: viewport });
    observer.observe(wrapper);
    viewport.addEventListener("readingzoomchange", schedule);
    return () => {
      disposed = true;
      cancel();
      observer.disconnect();
      viewport.removeEventListener("readingzoomchange", schedule);
      overlay.replaceChildren();
    };
  }, [pdf, pageNumber, width]);
  return (
    <div ref={wrapperRef} className="self-start">
      <Page
        pageNumber={pageNumber}
        width={width}
        canvasBackground="#ffffff"
        renderAnnotationLayer={false}
        className="bg-white shadow-sm"
        loading={<p className="py-12 font-mono text-[11px] text-muted-foreground">正在载入第 {pageNumber} 页…</p>}
        error={<p className="py-12 text-[12px] text-destructive">第 {pageNumber} 页载入失败</p>}
      >
        <div ref={overlayRef} className="pointer-events-none absolute inset-0 z-[1]" aria-hidden="true" />
      </Page>
    </div>
  );
}

export default function PdfPreview({
  src,
  itemId,
  title,
  readingZoom = false,
}: {
  src: string;
  itemId: string;
  title: string;
  readingZoom?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewport = container.closest<HTMLElement>("[data-reading-scale], [data-slot='scroll-area-viewport']") ?? container.parentElement;
    const updateWidth = () => {
      const visibleWidth = readingZoom && viewport ? viewport.clientWidth : viewport
        ? Math.min(container.clientWidth, viewport.getBoundingClientRect().right - container.getBoundingClientRect().left)
        : container.clientWidth;
      setPageWidth(Math.min(Math.max(visibleWidth - 48, 0), 960));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    if (viewport) observer.observe(viewport);
    return () => observer.disconnect();
  }, [readingZoom]);

  useEffect(() => { setNumPages(0); setPdf(null); }, [src]);

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
        onLoadSuccess={(document) => { setNumPages(document.numPages); setPdf(document); }}
        onLoadError={() => setNumPages(0)}
        onPassword={(callback) => callback(null)}
      >
        {/* ponytail: render all pages; add viewport virtualization if large PDFs become measurably slow. */}
        {pageWidth > 0 && Array.from({ length: numPages }, (_, index) => (
          readingZoom && pdf ? <PdfReadingPage key={index + 1} pdf={pdf} pageNumber={index + 1} width={pageWidth} /> :
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
