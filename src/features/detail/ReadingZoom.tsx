import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { createZoomMath, createReadingZoomSession, installReadingZoom } from "./reading-zoom";

const ZoomContext = createContext<ReturnType<typeof createReadingZoomSession> | null>(null);

export function ReadingZoomProvider({ children }: { children: ReactNode }) {
  const [session] = useState(createReadingZoomSession);
  return <ZoomContext.Provider value={session}>{children}</ZoomContext.Provider>;
}

export function useReadingZoomSession() { return useContext(ZoomContext); }

export function ReadingZoomButton() {
  const session = useContext(ZoomContext)!;
  const scale = useSyncExternalStore(session.subscribe, session.getSnapshot);
  if (scale === null) return null;
  return (
    <Button variant="ghost" size="xs" className="font-mono tabular-nums" title="恢复原始大小" aria-label={`当前缩放 ${Math.round(scale * 100)}%，恢复原始大小`} onClick={session.reset}>
      {Math.round(scale * 100)}%
    </Button>
  );
}

export function useReadingZoom(
  viewportRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  spaceRef: RefObject<HTMLDivElement | null>,
  enabled = true,
) {
  const session = useContext(ZoomContext);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const space = spaceRef.current;
    if (!session || !enabled || !viewport || !content || !space) return;
    const zoom = installReadingZoom(viewport, content, space, createZoomMath(), session.changed, {
      initialScale: session.getInitialScale(),
    });
    const unregister = session.register(zoom);
    return () => { unregister(); zoom.destroy(); };
  }, [session, enabled, viewportRef, contentRef, spaceRef]);
}

export function ReadingZoomViewport({ children, className = "" }: { children: ReactNode; className?: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const space = useRef<HTMLDivElement>(null);
  useReadingZoom(viewport, content, space);
  return (
    <div className={`relative min-h-0 min-w-0 flex-1 ${className}`}>
      <div ref={viewport} className="absolute inset-0 overflow-auto" tabIndex={0} role="document">
        <div ref={space}><div ref={content}>{children}</div></div>
      </div>
    </div>
  );
}
