import {
  Suspense,
  lazy,
  memo,
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import Panzoom, { type PanzoomObject } from "@panzoom/panzoom";
import { observeElementOffset, useVirtualizer } from "@tanstack/react-virtual";
import { useReadingZoom } from "./ReadingZoom";
import { createZoomMath } from "./reading-zoom";
import { mermaidWheelScale } from "./mermaid-zoom";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MarkdownBlock, MarkdownWorkerMessage } from "./markdown-render";
import { searchMarkdownBlocks, type MarkdownSearchMatch } from "./markdown-search";

const TextEditor = lazy(() => import("./TextEditor"));
let mermaidPromise: ReturnType<typeof importMermaid> | undefined;
let mermaidDiagramId = 0;

async function importMermaid() {
  const { default: mermaid } = await import("mermaid");
  return mermaid;
}

function loadMermaid() {
  mermaidPromise ??= importMermaid();
  return mermaidPromise;
}

function useDarkTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function canOpen(url: string) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

type HighlightMatch = Pick<MarkdownSearchMatch, "from" | "to"> & { active: boolean };
const NO_MATCHES: HighlightMatch[] = [];

function RenderedHtmlBlock({ block, matches }: { block: MarkdownBlock; matches: HighlightMatch[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.innerHTML = block.html;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; from: number; to: number }[] = [];
    let offset = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      nodes.push({ node: text, from: offset, to: offset + text.data.length });
      offset += text.data.length;
    }
    for (let matchIndex = matches.length - 1; matchIndex >= 0; matchIndex -= 1) {
      const match = matches[matchIndex];
      for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
        const entry = nodes[nodeIndex];
        if (entry.to <= match.from || entry.from >= match.to) continue;
        const from = Math.max(match.from, entry.from) - entry.from;
        const to = Math.min(match.to, entry.to) - entry.from;
        if (to <= from) continue;
        const range = document.createRange();
        range.setStart(entry.node, from);
        range.setEnd(entry.node, to);
        const mark = document.createElement("mark");
        mark.className = match.active
          ? "markdown-search-match markdown-search-match-selected"
          : "markdown-search-match";
        if (match.active) mark.dataset.searchActive = "";
        range.surroundContents(mark);
      }
    }
    return () => {
      root.innerHTML = block.html;
    };
  }, [block.html, matches]);

  return (
    <div
      ref={ref}
      className="markdown-block"
      data-markdown-block={block.kind}
      dangerouslySetInnerHTML={{ __html: block.html }}
    />
  );
}

function MermaidBlock({ block, dark }: { block: MarkdownBlock; dark: boolean }) {
  const [id] = useState(() => `markdown-mermaid-${mermaidDiagramId += 1}`);
  const [svg, setSvg] = useState("");
  // Keep SVG nodes alive during zoom updates so an active gesture retains its target.
  const svgMarkup = useMemo(() => ({ __html: svg }), [svg]);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(100);
  const zoomRef = useRef(zoom);
  const panzoomRef = useRef<PanzoomObject>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setSvg("");
    setFailed(false);
    void loadMermaid()
      .then((mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: dark ? "dark" : "neutral",
        });
        return mermaid.render(id, block.mermaidSource ?? "");
      })
      .then((result) => {
        if (alive) setSvg(result.svg);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [block.mermaidSource, dark, id]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas || !svg) return;
    const panzoom = Panzoom(canvas, {
      canvas: true,
      minScale: 0.5,
      maxScale: 2,
      startScale: zoomRef.current / 100,
      pinchAndPan: true,
    });
    panzoomRef.current = panzoom;
    let gestureActive = false;
    let gestureUsesWheel = false;
    let wheelAt = -Infinity;
    let gestureScale = 1;
    let gestureEndedAt = -Infinity;
    const math = createZoomMath();
    const syncZoom = (event: Event) => {
      const scale = (event as CustomEvent<{ scale: number }>).detail.scale;
      const previous = Math.round(zoomRef.current);
      zoomRef.current = scale * 100;
      const percentage = Math.round(zoomRef.current);
      if (percentage !== previous) setZoom(percentage);
    };
    const navigateWithTrackpad = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.ctrlKey) {
        if (math.wheelAllowed(gestureActive && !gestureUsesWheel, gestureEndedAt, performance.now())) {
          wheelAt = performance.now();
          const scale = panzoom.getScale();
          const next = mermaidWheelScale(scale, event.deltaY, event.deltaMode, viewport.clientHeight);
          if (next !== scale) panzoom.zoomToPoint(next, event, { animate: false });
        }
      } else {
        const { x, y } = panzoom.getPan();
        const scale = panzoom.getScale();
        const documentScale = Number(viewport.closest<HTMLElement>("[data-reading-scale]")?.dataset.readingScale) || 1;
        panzoom.pan(x - event.deltaX / scale / documentScale, y - event.deltaY / scale / documentScale);
      }
    };
    const gesture = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.type === "gesturestart") {
        gestureActive = true;
        gestureUsesWheel = performance.now() - wheelAt <= 100;
        gestureScale = panzoom.getScale();
      } else if (event.type === "gestureend") {
        gestureActive = false;
        gestureEndedAt = performance.now();
      } else if (gestureActive && !gestureUsesWheel) {
        const point = event as Event & { scale: number; clientX: number; clientY: number };
        if (Number.isFinite(point.scale)) panzoom.zoomToPoint(gestureScale * point.scale, point, { animate: false });
      }
    };
    canvas.addEventListener("panzoomchange", syncZoom);
    viewport.addEventListener("wheel", navigateWithTrackpad, { passive: false });
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) viewport.addEventListener(type, gesture, { passive: false });
    return () => {
      canvas.removeEventListener("panzoomchange", syncZoom);
      viewport.removeEventListener("wheel", navigateWithTrackpad);
      for (const type of ["gesturestart", "gesturechange", "gestureend"]) viewport.removeEventListener(type, gesture);
      panzoom.destroy();
      panzoomRef.current = null;
    };
  }, [svg]);

  return (
    <div className="markdown-block" data-markdown-block={block.kind}>
      {svg ? (
        <div className="markdown-mermaid">
          <label className="markdown-mermaid-zoom">
            <span>缩放</span>
            <input
              type="range"
              min="50"
              max="200"
              step="1"
              value={zoom}
              onChange={(event) => {
                zoomRef.current = Number(event.target.value);
                setZoom(zoomRef.current);
                panzoomRef.current?.zoom(zoomRef.current / 100, { animate: false });
              }}
            />
            <output>{Math.round(zoom)}%</output>
          </label>
          <div ref={viewportRef} className="markdown-mermaid-viewport" role="img" aria-label="Mermaid 图表">
            <div
              ref={canvasRef}
              className="markdown-mermaid-canvas"
              dangerouslySetInnerHTML={svgMarkup}
            />
          </div>
        </div>
      ) : (
        <>
          {failed && <p className="markdown-block-warning" role="alert">Mermaid 图表无法渲染，已显示源码。</p>}
          <div dangerouslySetInnerHTML={{ __html: block.html }} />
        </>
      )}
    </div>
  );
}

const RenderedBlock = memo(function RenderedBlock({ block, matches, dark }: { block: MarkdownBlock; matches: HighlightMatch[]; dark: boolean }) {
  return block.mermaidSource === undefined
    ? <RenderedHtmlBlock block={block} matches={matches} />
    : <MermaidBlock block={block} dark={dark} />;
});

export default function MarkdownReader({
  content,
  ariaLabel,
  large,
  searchOpen,
  onSearchOpenChange,
}: {
  content: string;
  ariaLabel: string;
  large: boolean;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const spaceRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dark = useDarkTheme();
  const blocksRef = useRef<MarkdownBlock[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  useReadingZoom(scrollRef, contentRef, spaceRef, !error);

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
    observeElementRect: (instance, callback) => {
      const element = instance.scrollElement;
      if (!element) return;
      const update = () => {
        const scale = Number(element.dataset.readingScale) || 1;
        callback({ width: element.clientWidth / scale, height: element.clientHeight / scale });
      };
      const observer = new ResizeObserver(update);
      observer.observe(element);
      element.addEventListener("readingzoomchange", update);
      update();
      return () => { observer.disconnect(); element.removeEventListener("readingzoomchange", update); };
    },
    observeElementOffset: (instance, callback) => {
      const element = instance.scrollElement;
      if (!element) return;
      const update = () => callback(element.scrollTop / (Number(element.dataset.readingScale) || 1), false);
      const cleanup = observeElementOffset(instance, (offset, scrolling) => callback(offset / (Number(element.dataset.readingScale) || 1), scrolling));
      element.addEventListener("readingzoomchange", update);
      return () => { cleanup?.(); element.removeEventListener("readingzoomchange", update); };
    },
    measureElement: (element, entry) => entry?.borderBoxSize?.[0]?.blockSize ?? (element as HTMLElement).offsetHeight,
    scrollToFn: (offset, { adjustments = 0, behavior }, instance) => {
      const element = instance.scrollElement;
      element?.scrollTo({ top: (offset + adjustments) * (Number(element.dataset.readingScale) || 1), behavior });
    },
  });

  const searchResult = useMemo(() => searchMarkdownBlocks(blocksRef.current, {
    search,
    caseSensitive,
    regexp,
    wholeWord,
  }), [caseSensitive, count, regexp, search, wholeWord]);
  const selectedIndex = searchResult.matches.length === 0
    ? -1
    : Math.min(activeIndex, searchResult.matches.length - 1);
  const matchesByBlock = useMemo(() => {
    const grouped = new Map<number, HighlightMatch[]>();
    if (!searchOpen) return grouped;
    searchResult.matches.forEach((match, index) => {
      const matches = grouped.get(match.blockIndex) ?? [];
      matches.push({ from: match.from, to: match.to, active: index === selectedIndex });
      grouped.set(match.blockIndex, matches);
    });
    return grouped;
  }, [searchOpen, searchResult.matches, selectedIndex]);

  useEffect(() => {
    if (!searchOpen || selectedIndex < 0) return;
    const match = searchResult.matches[selectedIndex];
    if (large) virtualizer.scrollToIndex(match.blockIndex, { align: "center" });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollRef.current
          ?.querySelector<HTMLElement>("[data-search-active]")
          ?.scrollIntoView({ block: "center", inline: "nearest" });
      });
    });
  }, [large, searchResult.matches, selectedIndex, virtualizer]);

  useEffect(() => {
    if (!searchOpen) return;
    const scroll = scrollRef.current;
    const position = scroll ? { top: scroll.scrollTop, left: scroll.scrollLeft } : null;
    searchInputRef.current?.focus({ preventScroll: true });
    searchInputRef.current?.select();
    if (!scroll || !position) return;
    const restore = () => {
      scroll.scrollTop = position.top;
      scroll.scrollLeft = position.left;
    };
    restore();
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
  }, [searchOpen]);

  const moveMatch = (direction: 1 | -1) => {
    const length = searchResult.matches.length;
    if (length === 0) return;
    setActiveIndex((current) => (Math.min(current, length - 1) + direction + length) % length);
  };

  const closeSearch = () => {
    onSearchOpenChange(false);
    requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true }));
  };

  const openMarkdownLink = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[data-markdown-link]")
      : null;
    if (!target) return;
    event.preventDefault();
    const href = target.getAttribute("href") ?? "";
    if (target.dataset.markdownLink === "external") {
      if (canOpen(href)) void openUrl(href);
      return;
    }
    let anchor = href.slice(1);
    try {
      anchor = decodeURIComponent(anchor);
    } catch {
      return;
    }
    const blockIndex = blocksRef.current.findIndex((block) => block.anchorIds?.includes(anchor));
    if (blockIndex < 0) return;
    if (large) virtualizer.scrollToIndex(blockIndex, { align: "start" });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const heading = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[id]") ?? [])
          .find((element) => element.id === anchor);
        heading?.scrollIntoView({ block: "start", inline: "nearest" });
      });
    });
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
            searchOpen={searchOpen}
            onSearchOpenChange={onSearchOpenChange}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {searchOpen && (
        <div
          className="fixed top-14 right-6 z-20 flex max-w-[calc(100%-16px)] items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-background p-1.5 text-xs shadow-[0_8px_24px_color-mix(in_oklab,var(--foreground)_12%,transparent)]"
          role="search"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeSearch();
            } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
              event.preventDefault();
              searchInputRef.current?.select();
            } else if (event.key === "Enter" && event.target === searchInputRef.current) {
              event.preventDefault();
              moveMatch(event.shiftKey ? -1 : 1);
            }
          }}
        >
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActiveIndex(0);
            }}
            className="h-6 w-24 min-w-12 rounded-md border border-border bg-input px-1.5 text-xs text-foreground outline-none focus:border-ring aria-invalid:border-destructive"
            aria-label="查找"
            aria-invalid={regexp && search.length > 0 && !searchResult.valid}
            title={regexp && search.length > 0 && !searchResult.valid ? "无效的正则表达式" : undefined}
            spellCheck={false}
          />
          <Button variant="outline" size="icon-xs" title="上一个匹配" aria-label="上一个匹配" onClick={() => moveMatch(-1)}>
            <ArrowUp />
          </Button>
          <Button variant="outline" size="icon-xs" title="下一个匹配" aria-label="下一个匹配" onClick={() => moveMatch(1)}>
            <ArrowDown />
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            className={caseSensitive ? "bg-muted" : ""}
            title="区分大小写"
            aria-label="区分大小写"
            aria-pressed={caseSensitive}
            onClick={() => {
              setCaseSensitive((value) => !value);
              setActiveIndex(0);
            }}
          >
            <span className="text-[11px]">Aa</span>
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            className={regexp ? "bg-muted" : ""}
            title="使用正则表达式"
            aria-label="使用正则表达式"
            aria-pressed={regexp}
            onClick={() => {
              setRegexp((value) => !value);
              setActiveIndex(0);
            }}
          >
            <span className="text-xs">.*</span>
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            className={wholeWord ? "bg-muted" : ""}
            title="全词匹配"
            aria-label="全词匹配"
            aria-pressed={wholeWord}
            onClick={() => {
              setWholeWord((value) => !value);
              setActiveIndex(0);
            }}
          >
            <span className="text-[11px] underline">ab</span>
          </Button>
          <Button variant="ghost" size="icon-xs" title="关闭查找" aria-label="关闭查找" onClick={closeSearch}>
            <X />
          </Button>
        </div>
      )}
      <div
        ref={scrollRef}
        className="absolute inset-0 min-w-0 overflow-auto"
        role="document"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-busy={loading}
        onClick={openMarkdownLink}
      >
        <div ref={spaceRef}>
        <div ref={contentRef} className="markdown-reader flow-root pr-2">
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
                  <RenderedBlock block={block} matches={matchesByBlock.get(item.index) ?? NO_MATCHES} dark={dark} />
                </div>
              );
            })}
          </div>
        ) : (
          Array.from({ length: count }, (_, index) => (
            <RenderedBlock
              key={blocksRef.current[index].key}
              block={blocksRef.current[index]}
              matches={matchesByBlock.get(index) ?? NO_MATCHES}
              dark={dark}
            />
          ))
        )}
        </div>
        </div>
      </div>
    </div>
  );
}
