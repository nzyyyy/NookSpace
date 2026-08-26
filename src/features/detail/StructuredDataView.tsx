import { useMemo, useState } from "react";
import {
  parseStructuredDocuments,
  type StructuredValue,
} from "@/lib/structured-data";

function Key({ name, index }: { name: string; index: boolean }) {
  return (
    <span className={index ? "text-muted-foreground/65" : "font-medium text-primary"}>
      {index ? `[${name}]` : name}
    </span>
  );
}

function Primitive({ value }: { value: Exclude<StructuredValue, StructuredValue[] | object> }) {
  if (value === null) return <span className="italic text-muted-foreground">null</span>;
  if (typeof value === "string") {
    return (
      <span className="whitespace-pre-wrap break-words text-emerald-700 dark:text-emerald-300">
        {JSON.stringify(value)}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="text-blue-700 dark:text-blue-300">{String(value)}</span>;
  }
  return <span className="text-amber-700 dark:text-amber-300">{String(value)}</span>;
}

function TreeNode({
  value,
  name,
  index = false,
  depth = 0,
}: {
  value: StructuredValue;
  name?: string;
  index?: boolean;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const collection = value !== null && typeof value === "object";
  if (!collection) {
    return (
      <div className="min-w-0 px-2 py-px">
        {name !== undefined && (
          <><Key name={name} index={index} /><span className="text-muted-foreground/60">: </span></>
        )}
        <Primitive value={value} />
      </div>
    );
  }

  const array = Array.isArray(value);
  const entries = Object.entries(value);
  const brackets = array ? ["[", "]"] : ["{", "}"];
  if (entries.length === 0) {
    return (
      <div className="px-2 py-px">
        {name !== undefined && (
          <><Key name={name} index={index} /><span className="text-muted-foreground/60">: </span></>
        )}
        <span className="text-muted-foreground">{brackets.join("")}</span>
      </div>
    );
  }

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group/tree min-w-0"
    >
      <summary className="cursor-pointer rounded-sm px-2 py-px outline-none marker:text-primary/60 hover:bg-muted/55 focus-visible:ring-1 focus-visible:ring-ring">
        {name !== undefined && (
          <><Key name={name} index={index} /><span className="text-muted-foreground/60">: </span></>
        )}
        <span className="text-muted-foreground">{brackets[0]}</span>
        <span className="mx-1.5 text-[10.5px] text-muted-foreground/70">
          {entries.length} {array ? "项" : "个字段"}
        </span>
        <span className="text-muted-foreground">{brackets[1]}</span>
      </summary>
      {open && (
        <div className="ml-[11px] border-l border-primary/20 pl-2">
          {entries.map(([key, item]) => (
            <TreeNode
              key={key}
              value={item}
              name={key}
              index={array}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </details>
  );
}

export default function StructuredDataView({
  format,
  content,
}: {
  format: "json" | "yaml";
  content: string;
}) {
  const result = useMemo(() => parseStructuredDocuments(format, content), [format, content]);

  if (!result.ok) {
    const message = result.reason === "tooLarge"
      ? `${result.message}，已显示原文`
      : `${format.toUpperCase()} 无法解析，显示原文：${result.message}`;
    return (
      <>
        <p className="mb-2 text-[12px] text-muted-foreground" role="status">{message}</p>
        <pre className="w-full min-w-0 max-w-full whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-[13px] leading-6 text-foreground/90">
          {content}
        </pre>
      </>
    );
  }

  if (result.documents.length === 0) {
    return <p className="font-mono text-[12px] text-muted-foreground">空文档</p>;
  }

  return (
    <div className="min-w-0 rounded-lg border border-border/80 bg-card/55 py-2 font-mono text-[12.5px] leading-6 text-foreground/90">
      {result.documents.map((document, index) => (
        <section
          key={index}
          className={index > 0 ? "mt-2 border-t border-border pt-2" : undefined}
        >
          {result.documents.length > 1 && (
            <h3 className="mb-1 px-2 text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              文档 {index + 1}
            </h3>
          )}
          <TreeNode value={document} />
        </section>
      ))}
    </div>
  );
}
