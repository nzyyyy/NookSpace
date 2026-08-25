import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Download,
  ExternalLink,
  File as FileIcon,
  FolderPlus,
  Image as ImageIcon,
  Link2,
  MoreHorizontal,
  Paperclip,
  PanelLeftOpen,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  convertFileSrc,
  ipc,
  type Item,
  type TextFileEncoding,
  type TextFileLineEnding,
} from "@/core/ipc";
import { formatFullDate, formatSize, TYPE_LABEL } from "@/lib/format";
import { isMediaFile } from "@/lib/file-types";
import { useLibrary } from "@/stores/library";
import { useUi } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTitlebarDrag } from "@/hooks/useTitlebarDrag";
import { toast } from "sonner";
import {
  createSerialNoteSaver,
  readNoteDraft,
  settleNoteDraft,
  writeNoteDraft,
  type NoteDraft,
} from "@/lib/note-draft";
import { tagBadgeClass, tagDotClass } from "@/lib/tag-colors";
import {
  classifyTextFileDraft,
  createSerialTextFileDraftWriter,
  deleteTextFileDraft,
  deleteTextFileDraftIfContentMatches,
  readTextFileDraft,
  type TextFileDraft,
} from "@/lib/text-file-draft";

const MarkdownPreview = lazy(() => import("./MarkdownPreview"));
const PdfPreview = lazy(() => import("@/components/PdfPreview"));

function EmptyDetail() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
      <p className="font-display text-[22px] text-muted-foreground/70 italic">
        从左边选择一个条目
      </p>
      <p className="font-mono text-[11px] tracking-wide text-muted-foreground/60">
        ↑ / ↓ 浏览 · Enter 打开 · Cmd+K 全局搜索
      </p>
    </div>
  );
}

function TagsEditor({ item }: { item: Item }) {
  const { tags, setItemTags, createTag } = useLibrary();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const addTag = (tagId: string) => {
    if (item.tags.some((t) => t.id === tagId)) return;
    void setItemTags(item.id, [...item.tags.map((t) => t.id), tagId]);
  };
  const removeTag = (tagId: string) => {
    void setItemTags(item.id, item.tags.filter((t) => t.id !== tagId).map((t) => t.id));
  };

  const filtered = tags.filter(
    (t) => !item.tags.some((x) => x.id === t.id) && t.name.toLowerCase().includes(input.toLowerCase()),
  );

  const commit = async () => {
    const name = input.trim();
    if (!name) return;
    const match = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (match) {
      addTag(match.id);
    } else {
      const created = await createTag(name);
      if (created) addTag(created.id);
      else toast.error("标签创建失败（可能已存在）");
    }
    setInput("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {item.tags.map((t) => (
        <span
          key={t.id}
          className={cn("group flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px]", tagBadgeClass(t.color))}
        >
          {t.name}
          <button
            className="text-muted-foreground opacity-60 hover:text-foreground group-hover:opacity-100"
            onClick={() => removeTag(t.id)}
            aria-label={`移除标签 ${t.name}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="xs" className="text-muted-foreground">
            + 标签
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 p-1.5">
          <Input
            autoFocus
            value={input}
            placeholder="输入并回车，或选择已有标签"
            className="mb-1 h-7 text-[12.5px]"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit();
            }}
          />
          <div className="flex max-h-48 flex-col gap-px overflow-y-auto">
            {filtered.map((t) => (
              <button
                key={t.id}
                className="flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12.5px] hover:bg-accent"
                onClick={() => {
                  addTag(t.id);
                  setInput("");
                }}
              >
                <span className={cn("size-2 rounded-full", tagDotClass(t.color))} />
                {t.name}
              </button>
            ))}
            {input.trim() && !tags.some((t) => t.name.toLowerCase() === input.toLowerCase()) && (
              <button
                className="flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12.5px] text-primary hover:bg-accent"
                onClick={() => void commit()}
              >
                创建「{input.trim()}」
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Attachments({ item }: { item: Item }) {
  const { detail, items, addAttachments, removeAttachment } = useLibrary();
  const attachments = detail?.attachments ?? [];
  const [open, setOpen] = useState(false);

  const attachable = items.filter(
    (i) => i.itemType === "file" && !attachments.some((a) => a.id === i.id),
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 text-[11px] font-medium tracking-wider text-muted-foreground/80 uppercase">
        <Paperclip className="size-3" /> 附件
        {attachments.length > 0 && <span className="font-mono">{attachments.length}</span>}
      </div>
      {attachments.map((a) => (
        <div
          key={a.id}
          className="group flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[12.5px] hover:bg-accent/50"
        >
          {a.mime.startsWith("image/") ? (
            <ImageIcon className="size-3.5 text-muted-foreground" />
          ) : (
            <FileIcon className="size-3.5 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate">{a.title}</span>
          <span className="font-mono text-[10.5px] text-muted-foreground">{formatSize(a.size)}</span>
          <button
            className="text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
            onClick={() => void removeAttachment(item.id, a.id)}
            aria-label="移除附件"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="xs" className="justify-start text-muted-foreground">
            <FolderPlus className="size-3.5" /> 添加附件
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1.5">
          {attachable.length === 0 ? (
            <p className="px-1.5 py-1 text-[12px] text-muted-foreground">
              先导入一些文件，再挂到笔记上
            </p>
          ) : (
            <div className="flex max-h-56 flex-col gap-px overflow-y-auto">
              {attachable.map((f) => (
                <button
                  key={f.id}
                  className="flex items-center gap-2 rounded px-1.5 py-1 text-left text-[12.5px] hover:bg-accent"
                  onClick={() => {
                    void addAttachments(item.id, [f.id]);
                    setOpen(false);
                  }}
                >
                  {f.mime.startsWith("image/") ? (
                    <ImageIcon className="size-3.5 text-muted-foreground" />
                  ) : (
                    <FileIcon className="size-3.5 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{f.title}</span>
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    {formatSize(f.size)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

type TextFileSaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

function useAutosizeTextarea(value: string, active: boolean) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea || !active) return;

    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      resize();
    });

    resize();
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [active, value]);

  return ref;
}

function TextFileEditor({
  item,
  headerActions,
}: {
  item: Item;
  headerActions: HTMLDivElement | null;
}) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<TextFileSaveState>("idle");
  const textareaRef = useAutosizeTextarea(content, mode === "edit" && !item.deletedAt);
  const version = useRef("");
  const encoding = useRef<TextFileEncoding>("utf8");
  const lineEnding = useRef<TextFileLineEnding>("lf");
  const latestDraft = useRef<TextFileDraft | null>(null);
  const conflictVersion = useRef<string | null>(null);
  const saveError = useRef("");
  const mounted = useRef(true);
  const draftWarningShown = useRef(false);
  const draftWriter = useRef<ReturnType<typeof createSerialTextFileDraftWriter> | null>(null);
  const saver = useRef<ReturnType<typeof createSerialNoteSaver> | null>(null);
  const isMarkdown = item.mime === "text/markdown" || /\.(md|markdown)$/i.test(item.title);

  const warnDraftFailure = () => {
    if (draftWarningShown.current) return;
    draftWarningShown.current = true;
    toast.error("无法保存文件恢复草稿，自动保存仍会继续");
  };

  if (!draftWriter.current) {
    draftWriter.current = createSerialTextFileDraftWriter(undefined, warnDraftFailure);
  }

  if (!saver.current) {
    saver.current = createSerialNoteSaver({
      save: async (draft) => {
        if (mounted.current) setSaveState("saving");
        saveError.current = "";
        try {
          const result = await ipc.writeTextFile(
            item.id,
            draft.content,
            version.current,
            encoding.current,
            lineEnding.current,
          );
          if (result.status === "conflict") {
            conflictVersion.current = result.version;
            return null;
          }
          version.current = result.version;
          const library = useLibrary.getState();
          if (library.detail?.item.id === item.id) {
            library.applyDetail({ ...library.detail, item: result.item });
          }
          return result.version;
        } catch (error) {
          saveError.current = String(error);
          return null;
        }
      },
      onSaved: (saved, updatedVersion) => {
        conflictVersion.current = null;
        const current = latestDraft.current;
        if (current?.content === saved.content) {
          latestDraft.current = null;
          void draftWriter.current
            ?.flush()
            .then(() => deleteTextFileDraftIfContentMatches(item.id, saved.content))
            .catch(warnDraftFailure);
        } else if (current) {
          const rebased = { ...current, baseVersion: updatedVersion };
          latestDraft.current = rebased;
          draftWriter.current?.schedule(rebased);
        }
        if (mounted.current) setSaveState(latestDraft.current ? "dirty" : "saved");
      },
      onFailed: () => {
        if (!mounted.current) return;
        setSaveState(conflictVersion.current ? "conflict" : "error");
      },
    });
  }

  const scheduleSave = (draft: TextFileDraft) => {
    saver.current?.schedule({
      id: draft.itemId,
      title: item.title,
      content: draft.content,
      baseUpdatedAt: draft.baseVersion,
    });
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const document = await ipc.readTextFile(item.id);
        const storedDraft = await readTextFileDraft(item.id).catch(() => {
          warnDraftFailure();
          return null;
        });
        if (!alive) return;
        version.current = document.version;
        encoding.current = document.encoding;
        lineEnding.current = document.lineEnding;
        const decision = classifyTextFileDraft(document, storedDraft);
        if (decision === "recover" && storedDraft) {
          latestDraft.current = storedDraft;
          encoding.current = storedDraft.encoding;
          lineEnding.current = storedDraft.lineEnding;
          setContent(storedDraft.content);
          setMode(item.deletedAt ? "read" : "edit");
          setSaveState("dirty");
          toast.info("已恢复未保存的文件内容");
          if (!item.deletedAt) scheduleSave(storedDraft);
        } else if (decision === "conflict" && storedDraft) {
          latestDraft.current = storedDraft;
          conflictVersion.current = document.version;
          encoding.current = storedDraft.encoding;
          lineEnding.current = storedDraft.lineEnding;
          setContent(storedDraft.content);
          setMode(item.deletedAt ? "read" : "edit");
          setSaveState("conflict");
        } else {
          latestDraft.current = null;
          conflictVersion.current = null;
          setContent(document.content);
          setMode("read");
          setSaveState("idle");
          if (decision === "discard") void deleteTextFileDraft(item.id).catch(warnDraftFailure);
        }
      } catch (error) {
        if (alive) setLoadError(String(error));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [item.id]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void saver.current?.flush();
      void draftWriter.current?.flush();
    };
  }, []);

  useEffect(() => {
    const flush = (event: Event) => {
      const saving = saver.current?.flush() ?? Promise.resolve();
      const drafting = draftWriter.current?.flush() ?? Promise.resolve();
      (event as CustomEvent<Promise<void>[]>).detail.push(
        Promise.all([saving, drafting]).then(() => undefined),
      );
    };
    window.addEventListener("nookspace:flush-edits", flush);
    return () => window.removeEventListener("nookspace:flush-edits", flush);
  }, []);

  const updateContent = (nextContent: string) => {
    const draft: TextFileDraft = {
      itemId: item.id,
      content: nextContent,
      baseVersion: version.current,
      encoding: encoding.current,
      lineEnding: lineEnding.current,
    };
    setContent(nextContent);
    latestDraft.current = draft;
    draftWriter.current?.schedule(draft);
    setSaveState(conflictVersion.current ? "conflict" : "dirty");
    if (!conflictVersion.current) scheduleSave(draft);
  };

  const changeMode = (nextMode: "read" | "edit") => {
    setMode(nextMode);
    if (nextMode === "read") void saver.current?.flush();
  };

  const retrySave = () => {
    if (!latestDraft.current || conflictVersion.current) return;
    scheduleSave(latestDraft.current);
    void saver.current?.flush();
  };

  const reload = async () => {
    setLoading(true);
    try {
      const document = await ipc.readTextFile(item.id);
      version.current = document.version;
      encoding.current = document.encoding;
      lineEnding.current = document.lineEnding;
      latestDraft.current = null;
      conflictVersion.current = null;
      setContent(document.content);
      setMode("read");
      setSaveState("idle");
      await deleteTextFileDraft(item.id);
    } catch (error) {
      toast.error(`重新载入失败：${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const overwrite = () => {
    const draft = latestDraft.current;
    const currentVersion = conflictVersion.current;
    if (!draft || !currentVersion || item.deletedAt) return;
    version.current = currentVersion;
    conflictVersion.current = null;
    const rebased = { ...draft, baseVersion: currentVersion };
    latestDraft.current = rebased;
    draftWriter.current?.schedule(rebased);
    setSaveState("dirty");
    scheduleSave(rebased);
    void saver.current?.flush();
  };

  if (loading) {
    return <p className="py-12 text-center font-mono text-[11px] text-muted-foreground">正在载入文本…</p>;
  }
  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
        <FileIcon className="size-12 text-muted-foreground/40" />
        <p className="max-w-md text-[12px] text-muted-foreground">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => void ipc.openWithDefault(item.id)}>
          <ExternalLink className="size-3.5" /> 用默认应用打开
        </Button>
      </div>
    );
  }

  return (
    <>
      {headerActions && createPortal(
        <>
          <div className="flex items-center rounded-md bg-muted p-0.5" aria-label="文本文件模式">
            <Button variant={mode === "read" ? "default" : "ghost"} size="xs" aria-pressed={mode === "read"} onClick={() => changeMode("read")}>
              阅读
            </Button>
            <Button variant={mode === "edit" ? "default" : "ghost"} size="xs" aria-pressed={mode === "edit"} onClick={() => changeMode("edit")} disabled={Boolean(item.deletedAt)}>
              编辑
            </Button>
          </div>
          {saveState !== "idle" && saveState !== "conflict" && (
            <button
              type="button"
              disabled={saveState !== "error"}
              title={saveError.current || undefined}
              onClick={retrySave}
              className={cn(
                "font-mono text-[10.5px]",
                saveState === "error" ? "text-destructive" : "text-muted-foreground/60",
              )}
            >
              {saveState === "saving"
                ? "保存中…"
                : saveState === "saved"
                  ? "已保存"
                  : saveState === "error"
                    ? "保存失败，点击重试"
                    : "未保存"}
            </button>
          )}
        </>,
        headerActions,
      )}

      <div className="flex min-h-[360px] min-w-0 flex-1 flex-col gap-3">
        {saveState === "conflict" && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2" role="alert">
            <p className="min-w-0 flex-1 text-[12px] text-foreground/80">
              文件已被其他应用修改，自动保存已暂停；当前草稿仍被保留。
            </p>
            <Button variant="outline" size="xs" onClick={() => void reload()}>重新载入</Button>
            <Button variant="destructive" size="xs" onClick={overwrite} disabled={Boolean(item.deletedAt)}>覆盖保存</Button>
          </div>
        )}

        {mode === "edit" && !item.deletedAt ? (
          <Textarea
            ref={textareaRef}
            autoFocus
            value={content}
            onChange={(event) => updateContent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") changeMode("read");
            }}
            className="min-h-[360px] -mx-1 grow shrink-0 basis-auto resize-none overflow-hidden rounded-none border-none p-1 font-mono text-[13px] leading-6 shadow-none focus-visible:border-transparent focus-visible:bg-muted/20 focus-visible:ring-0"
            aria-label={`编辑 ${item.title}`}
          />
        ) : isMarkdown ? (
          <Suspense fallback={<p className="text-[13px] text-muted-foreground">正在排版…</p>}>
            <MarkdownPreview content={content} />
          </Suspense>
        ) : (
          <pre className="w-full min-w-0 max-w-full whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-[13px] leading-6 text-foreground/90">{content}</pre>
        )}
      </div>
    </>
  );
}

function FilePreview({
  item,
  headerActions,
}: {
  item: Item;
  headerActions: HTMLDivElement | null;
}) {
  const [absPath, setAbsPath] = useState<string | null>(null);
  const usesAssetPreview = item.mime.startsWith("image/") || item.mime === "application/pdf";

  useEffect(() => {
    if (!usesAssetPreview) {
      setAbsPath(null);
      return;
    }
    let alive = true;
    setAbsPath(null);
    void ipc.fileAbsPath(item.id).then((p) => {
      if (alive) setAbsPath(p);
    });
    return () => {
      alive = false;
    };
  }, [item.id, usesAssetPreview]);

  if (!usesAssetPreview) {
    return <TextFileEditor key={item.id} item={item} headerActions={headerActions} />;
  }

  const src = absPath ? convertFileSrc(absPath) : null;

  if (!src) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <FileIcon className="size-12 text-muted-foreground/40" />
      </div>
    );
  }
  if (item.mime.startsWith("image/")) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/40">
        <img
          src={src}
          alt={item.title}
          className="max-h-full max-w-full rounded-md object-contain"
          draggable={false}
        />
      </div>
    );
  }
  if (item.mime === "application/pdf") {
    return (
      <div className="min-h-0 flex-1 rounded-md border border-border bg-muted/30">
        <Suspense fallback={<p className="py-12 text-center font-mono text-[11px] text-muted-foreground">正在载入 PDF…</p>}>
          <PdfPreview src={src} itemId={item.id} title={item.title} />
        </Suspense>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
      <FileIcon className="size-12 text-muted-foreground/40" />
      <span className="font-mono text-[11px]">此类型暂不支持内置预览</span>
    </div>
  );
}

export function DetailPane() {
  const { detail, detailLoading, noteMode, setNoteMode, toggleFavorite } = useLibrary();
  const { listCollapsed, toggleListCollapsed } = useUi();
  const headerRef = useRef<HTMLDivElement | null>(null);
  useTitlebarDrag(headerRef);
  const item = detail?.item;

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [fileHeaderActions, setFileHeaderActions] = useState<HTMLDivElement | null>(null);
  const noteTextareaRef = useAutosizeTextarea(
    content,
    noteMode === "edit" && item?.itemType === "note" && item.deletedAt === null,
  );
  const loadedId = useRef<string | null>(null);
  const baseUpdatedAt = useRef("");
  const latestDraft = useRef<NoteDraft | null>(null);
  const saver = useRef<ReturnType<typeof createSerialNoteSaver> | null>(null);

  if (!saver.current) {
    saver.current = createSerialNoteSaver({
      save: async (draft) => {
        if (loadedId.current === draft.id) setSaveState("saving");
        return (await useLibrary.getState().saveNote(draft.id, draft.title, draft.content))?.updatedAt ?? null;
      },
      onSaved: (draft, updatedAt) => {
        settleNoteDraft(localStorage, draft, updatedAt);
        if (loadedId.current !== draft.id) return;
        baseUpdatedAt.current = updatedAt;
        if (latestDraft.current?.title === draft.title && latestDraft.current.content === draft.content) {
          latestDraft.current = null;
        }
        setSaveState(latestDraft.current ? "dirty" : "saved");
      },
      onFailed: (draft) => {
        if (loadedId.current === draft.id) setSaveState("error");
      },
    });
  }

  useEffect(() => {
    if (!item || item.itemType !== "note" || item.id === loadedId.current) return;
    const databaseDraft: NoteDraft = {
      id: item.id,
      title: item.title,
      content: item.content,
      baseUpdatedAt: item.updatedAt,
    };
    const recovered = readNoteDraft(localStorage, databaseDraft);
    const draft = recovered ?? databaseDraft;
    loadedId.current = item.id;
    baseUpdatedAt.current = item.updatedAt;
    latestDraft.current = recovered;
    setTitle(draft.title);
    setContent(draft.content);
    setSaveState(recovered ? "dirty" : "idle");
    if (recovered) {
      toast.info("已恢复未保存的笔记内容");
      saver.current?.schedule(recovered);
    }
  }, [item]);

  useEffect(() => () => void saver.current?.flush(), [item?.id]);
  useEffect(() => {
    const flush = (event: Event) => {
      (event as CustomEvent<Promise<void>[]>).detail.push(saver.current?.flush() ?? Promise.resolve());
    };
    window.addEventListener("nookspace:flush-edits", flush);
    return () => window.removeEventListener("nookspace:flush-edits", flush);
  }, []);
  useEffect(() => {
    if (noteMode === "read") void saver.current?.flush();
  }, [noteMode]);

  const updateDraft = (nextTitle: string, nextContent: string) => {
    if (!item || item.itemType !== "note") return;
    const draft = {
      id: item.id,
      title: nextTitle,
      content: nextContent,
      baseUpdatedAt: baseUpdatedAt.current || item.updatedAt,
    };
    setTitle(nextTitle);
    setContent(nextContent);
    latestDraft.current = draft;
    writeNoteDraft(localStorage, draft);
    setSaveState("dirty");
    saver.current?.schedule(draft);
  };

  const changeNoteMode = (mode: "read" | "edit") => {
    setNoteMode(mode);
    if (mode === "read") void saver.current?.flush();
  };

  const retrySave = () => {
    if (!latestDraft.current) return;
    saver.current?.schedule(latestDraft.current);
    void saver.current?.flush();
  };

  const exportItem = async () => {
    if (!item || item.itemType === "link") return;
    try {
      const waits: Promise<void>[] = [];
      window.dispatchEvent(new CustomEvent("nookspace:flush-edits", { detail: waits }));
      await Promise.all(waits);

      const noteTitle = title
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
        .replace(/[. ]+$/g, "")
        .trim();
      const destination = await saveDialog({
        title: "导出文件",
        defaultPath: item.itemType === "note" ? `${noteTitle || "无标题"}.md` : item.title,
        filters: item.itemType === "note" ? [{ name: "Markdown", extensions: ["md"] }] : undefined,
      });
      if (!destination) return;

      const exported = await ipc.exportItem(item.id, destination);
      toast.success(`已导出：${exported}`);
    } catch (error) {
      toast.error(`导出失败：${String(error)}`);
    }
  };

  const isTrashed = item ? item.deletedAt !== null : false;

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      {/* Header — always present; the drag/zoom zone of this pane */}
      <div ref={headerRef} className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        {listCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => toggleListCollapsed()}
                aria-label="显示列表"
                aria-keyshortcuts="Meta+\\"
              >
                <PanelLeftOpen className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              显示列表 <kbd data-slot="kbd">⌘\</kbd>
            </TooltipContent>
          </Tooltip>
        )}
        <h1 className="text-[15px] font-medium tracking-tight">
          {item ? TYPE_LABEL[item.itemType] : "详情"}
        </h1>
        <div className="flex-1" />
        {item?.itemType === "file" && (
          <div ref={setFileHeaderActions} className="flex items-center gap-2" />
        )}
        {item?.itemType === "note" && (
          <div className="flex items-center rounded-md bg-muted p-0.5" aria-label="笔记模式">
            <Button variant={noteMode === "read" ? "default" : "ghost"} size="xs" aria-pressed={noteMode === "read"} onClick={() => changeNoteMode("read")}>
              阅读
            </Button>
            <Button variant={noteMode === "edit" ? "default" : "ghost"} size="xs" aria-pressed={noteMode === "edit"} onClick={() => changeNoteMode("edit")} disabled={isTrashed}>
              编辑
            </Button>
          </div>
        )}
        {item && saveState !== "idle" && item.itemType === "note" && (
          <button
            type="button"
            disabled={saveState !== "error"}
            onClick={retrySave}
            className={cn(
              "font-mono text-[10.5px]",
              saveState === "error" ? "text-destructive" : "text-muted-foreground/60",
            )}
          >
            {saveState === "saving"
              ? "保存中…"
              : saveState === "saved"
                ? "已保存"
                : saveState === "error"
                  ? "保存失败，点击重试"
                  : "未保存"}
          </button>
        )}
        {item && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void toggleFavorite(item.id)}
            aria-label={item.isFavorite ? "取消收藏" : "收藏"}
          >
            <Star
              className={cn(
                "size-4",
                item.isFavorite ? "fill-primary text-primary" : "text-muted-foreground",
              )}
            />
          </Button>
        )}
        {item && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="更多操作">
                <MoreHorizontal className="size-4 text-muted-foreground" />
              </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {item.itemType === "file" && (
              <>
                <DropdownMenuItem onSelect={() => void ipc.openWithDefault(item.id)}>
                  <ExternalLink className="size-3.5" /> 用默认应用打开
                </DropdownMenuItem>
                {!isMediaFile(item.mime, item.storedPath || item.title) && (
                  <DropdownMenuItem onSelect={() => void ipc.quicklook(item.id)}>
                    <ImageIcon className="size-3.5" /> 系统快速查看
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            {item.itemType === "link" && (
              <DropdownMenuItem onSelect={() => void openUrl(item.url)}>
                <ExternalLink className="size-3.5" /> 在浏览器中打开
              </DropdownMenuItem>
            )}
            {item.itemType !== "link" && (
              <>
                <DropdownMenuItem onSelect={() => void exportItem()}>
                  <Download className="size-3.5" /> 导出…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                void useLibrary.getState().deleteItems([item.id]);
                toast.info("已移至回收站");
              }}
            >
              <Trash2 className="size-3.5" /> 移到回收站
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </div>

      {/* Body */}
      {!item ? (
        detailLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="font-mono text-[12px] text-muted-foreground">加载中…</p>
          </div>
        ) : (
          <EmptyDetail />
        )
      ) : (
      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea
          type="scroll"
          className="min-h-0 flex-1 [&_[data-slot=scroll-area-scrollbar]]:w-1.5 [&_[data-slot=scroll-area-scrollbar]]:py-3 [&_[data-slot=scroll-area-thumb]]:bg-muted-foreground/45 [&_[data-slot=scroll-area-viewport]>div]:!block"
        >
          <div className="flex min-h-full w-full min-w-0 max-w-full flex-col px-6 py-5">
          {item.itemType === "note" ? (
            noteMode === "edit" && !isTrashed ? (
              <>
                <Input
                  value={title}
                  onChange={(e) => updateDraft(e.target.value, content)}
                  placeholder="无标题"
                  className="h-auto -mx-1 rounded-md border-none px-1 text-[20px] font-semibold tracking-tight shadow-none focus-visible:ring-1 focus-visible:ring-ring/40"
                />
                <Textarea
                  ref={noteTextareaRef}
                  autoFocus
                  value={content}
                  onChange={(e) => updateDraft(title, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") changeNoteMode("read");
                  }}
                  placeholder="写点什么…（支持 Markdown）"
                  className="mt-2 min-h-[320px] -mx-1 grow shrink-0 basis-auto resize-none overflow-hidden rounded-none border-none p-1 text-[14px] leading-relaxed shadow-none focus-visible:border-transparent focus-visible:bg-muted/20 focus-visible:ring-0"
                />
              </>
            ) : (
              <>
                <h2 className="text-[24px] font-semibold tracking-tight">{title || "无标题"}</h2>
                <div className="mt-4">
                  <Suspense fallback={<p className="text-[13px] text-muted-foreground">正在排版…</p>}>
                    <MarkdownPreview content={content} />
                  </Suspense>
                </div>
              </>
            )
          ) : item.itemType === "file" ? (
            <>
              <div className="flex items-center gap-2">
                <h2 className="min-w-0 flex-1 truncate text-[20px] font-semibold tracking-tight">
                  {item.title}
                </h2>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                <span>{item.mime.split("/")[1]?.toUpperCase() ?? item.mime}</span>
                <span>{formatSize(item.size)}</span>
                <span>创建于 {formatFullDate(item.createdAt)}</span>
                <span>修改于 {formatFullDate(item.updatedAt)}</span>
              </div>
              <div className="mt-4 flex min-h-0 min-w-0 flex-1 flex-col">
                <FilePreview item={item} headerActions={fileHeaderActions} />
              </div>
            </>
          ) : (
            <>
              <h2 className="text-[20px] font-semibold tracking-tight">{item.title}</h2>
              <a
                href={item.url}
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl(item.url);
                }}
                className="mt-1 flex items-center gap-1.5 text-[13px] text-primary hover:underline"
              >
                <Link2 className="size-3.5" />
                <span className="font-mono text-[12px]">{item.url}</span>
              </a>
              <div className="mt-4 font-mono text-[11px] text-muted-foreground">
                {formatFullDate(item.createdAt)}
              </div>
            </>
          )}

          </div>
        </ScrollArea>
        <footer
          className="max-h-[35%] shrink-0 overflow-y-auto border-t border-border px-6 py-3"
          aria-label="条目信息"
        >
          <div className="flex flex-col gap-3">
            <TagsEditor item={item} />
            {item.itemType === "note" && !isTrashed && <Attachments item={item} />}
          </div>
        </footer>
      </div>
      )}
    </section>
  );
}
