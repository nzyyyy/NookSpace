import { useEffect, useMemo, useRef, useState } from "react";
import { parseCsv } from "@/lib/text-views";

const ROW_HEIGHT = 34;
const OVERSCAN = 10;

export default function CsvTable({ content }: { content: string }) {
  const rows = useMemo(() => parseCsv(content), [content]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(360);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () => setViewport(scroller.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  if (rows === null) {
    return <p className="text-[12px] text-muted-foreground">CSV 无法解析，请切换到编辑查看原文</p>;
  }
  if (rows.length === 0) {
    return <p className="font-mono text-[12px] text-muted-foreground">空文档</p>;
  }

  const header = rows[0];
  const body = rows.slice(1);
  const columns = Math.max(header.length, 1);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visible = Math.ceil(viewport / ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(body.length, start + visible);
  const slice = body.slice(start, end);

  return (
    <div
      ref={scrollerRef}
      className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border border-border bg-card/40"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <table className="min-w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            {Array.from({ length: columns }, (_, index) => (
              <th
                key={index}
                scope="col"
                className="sticky top-0 z-10 min-w-28 max-w-[32rem] truncate border-r border-b border-border bg-muted/95 px-3 py-2 text-left font-medium last:border-r-0"
                title={header[index] ?? ""}
              >
                {header[index] ?? ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {start > 0 && (
            <tr aria-hidden="true">
              <td colSpan={columns} className="p-0" style={{ height: start * ROW_HEIGHT }} />
            </tr>
          )}
          {slice.map((row, rowIndex) => (
            <tr key={start + rowIndex} className="odd:bg-background even:bg-muted/20">
              {Array.from({ length: columns }, (_, index) => (
                <td
                  key={index}
                  className="h-[34px] max-w-[32rem] truncate border-r border-b border-border px-3 py-1.5 last:border-r-0"
                  title={row[index] ?? ""}
                >
                  {row[index] ?? ""}
                </td>
              ))}
            </tr>
          ))}
          {end < body.length && (
            <tr aria-hidden="true">
              <td colSpan={columns} className="p-0" style={{ height: (body.length - end) * ROW_HEIGHT }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
