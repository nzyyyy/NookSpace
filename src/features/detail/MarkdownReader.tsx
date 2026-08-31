import {
  Suspense,
  lazy,
  startTransition,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MarkdownBlock, MarkdownWorkerMessage } from "./markdown-render";

const TextEditor = lazy(() => import("./TextEditor"));

function canOpen(url: string) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

function RenderedBlock({ block }: { block: MarkdownBlock }) {
  return (
    <div
      className="markdown-block"
      data-markdown-block={block.kind}
      dangerouslySetInnerHTML={{ __html: block.html }}
    />
  );
}

export default function MarkdownReader({
  content,
  ariaLabel,
  large,
}: {
  content: string;
  ariaLabel: string;
  large: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<MarkdownBlock[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    blocksRef.current = [];
    setCount(0);
    setLoading(true);
    setError("");
    const worker = new Worker(new URL("./markdown-render.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<MarkdownWorkerMessage>) => {
      if (!alive) return;
      const message = event.data;
      if (message.type === "batch") {
        blocksRef.current.push(...message.blocks);
        startTransition(() => setCount(blocksRef.current.length));
      } else if (message.type === "done") {
        setCount(blocksRef.current.length);
        setLoading(false);
      } else {
        setError(message.message);
        setLoading(false);
      }
    };
    worker.onerror = (event) => {
      if (!alive) return;
      setError(event.message || "Markdown 渲染失败");
      setLoading(false);
    };
    worker.postMessage({ content });
    return () => {
      alive = false;
      worker.terminate();
    };
  }, [content]);

  const virtualizer = useVirtualizer({
    count: large ? count : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => blocksRef.current[index]?.estimatedHeight ?? 48,
    getItemKey: (index) => blocksRef.current[index]?.key ?? index,
    overscan: 4,
    gap: 16,
  });

  const openMarkdownLink = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[data-markdown-link='external']")
      : null;
    if (!target) return;
    event.preventDefault();
    const href = target.getAttribute("href") ?? "";
    if (canOpen(href)) void openUrl(href);
  };

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px]" role="alert">
          Markdown 渲染失败，已显示源码：{error}
        </p>
        <Suspense fallback={<p className="py-12 text-center font-mono text-[11px] text-muted-foreground">正在载入源码…</p>}>
          <TextEditor
            initialContent={content}
            format="md"
            readOnly
            ariaLabel={ariaLabel}
            onDocumentChange={() => undefined}
            onEscape={() => undefined}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="markdown-reader min-h-[360px] min-w-0 flex-1 overflow-auto pr-2"
      role="document"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-busy={loading}
      onClick={openMarkdownLink}
    >
      {loading && count === 0 ? (
        <p className="py-12 text-center font-mono text-[11px] text-muted-foreground">正在渲染 Markdown…</p>
      ) : count === 0 ? (
        <p className="py-12 text-center font-mono text-[11px] text-muted-foreground">空文档</p>
      ) : large ? (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const block = blocksRef.current[item.index];
            if (!block) return null;
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <RenderedBlock block={block} />
              </div>
            );
          })}
        </div>
      ) : (
        Array.from({ length: count }, (_, index) => (
          <RenderedBlock key={blocksRef.current[index].key} block={blocksRef.current[index]} />
        ))
      )}
    </div>
  );
}
