import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  File as FileIcon,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Link2,
  Lock,
  MoreHorizontal,
  Paperclip,
  PanelLeftOpen,
  Search,
  Star,
  Tags,
  X,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  convertFileSrc,
  ipc,
  type Item,
  type ItemSummary,
  type TextFileEncoding,
  type TextFileLineEnding,
} from "@/core/ipc";
import { formatFullDate, formatSize, FORMAT_LABEL } from "@/lib/format";
import {
  canonicalFormat,
  displayStem,
  fileExtension,
  isHtmlFile,
  isLargeTextFile,
  isSwitchableText,
  SWITCHABLE_FORMATS,
  type SwitchableFormat,
} from "@/lib/file-types";
import { useLibrary } from "@/stores/library";
import { useUi } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { CollectionPicker } from "@/features/list/CollectionPicker";
import { useItemActions } from "@/features/list/item-actions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTitlebarDrag } from "@/hooks/useTitlebarDrag";
import { toast } from "sonner";
import { createSerialNoteSaver } from "@/lib/note-draft";
import { tagDotClass } from "@/lib/tag-colors";
import {
  classifyTextFileDraft,
  createSerialTextFileDraftWriter,
  createTextSnapshotScheduler,
  deleteTextFileDraft,
  deleteTextFileDraftIfContentMatches,
  readTextFileDraft,
  type TextFileDraft,
} from "@/lib/text-file-draft";

const PdfPreview = lazy(() => import("@/components/PdfPreview"));
const TextEditor = lazy(() => import("./TextEditor"));
const CsvTable = lazy(() => import("./CsvTable"));
const MarkdownReader = lazy(() => import("./MarkdownReader"));

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
  const operationBusy = useLibrary((state) => state.operationBusy);
  const tags = useLibrary((state) => state.tags);
  const setItemTags = useLibrary((state) => state.setItemTags);

  const assigned = (tagId: string) => item.tags.some((tag) => tag.id === tagId);
  const toggle = (tagId: string) => {
    if (assigned(tagId)) {
      void setItemTags(item.id, item.tags.filter((tag) => tag.id !== tagId).map((tag) => tag.id));
      return;
    }
    void setItemTags(item.id, [...item.tags.map((tag) => tag.id), tagId]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Tags className="size-3.5" />
          标签
          {item.tags.length > 0 && <span className="font-mono text-[11px]">{item.tags.length}</span>}
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-max min-w-32 max-w-48 p-1">
        {tags.length === 0 ? (
          <p className="px-1.5 py-2 text-[12.5px] text-muted-foreground">还没有标签，请在侧栏新建</p>
        ) : (
          <div className="flex max-h-48 flex-col gap-px overflow-y-auto">
            {tags.map((tag) => {
              const on = assigned(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className="flex h-6 items-center gap-1 rounded px-1.5 text-left text-[12.5px] whitespace-nowrap hover:bg-accent"
                  disabled={operationBusy}
                  aria-pressed={on}
                  onClick={() => toggle(tag.id)}
                >
                  <Check className={cn("size-3 shrink-0", on ? "opacity-100" : "opacity-0")} />
                  <span className={cn("size-2 shrink-0 rounded-full", tagDotClass(tag.color))} />
                  <span className="min-w-0 truncate">{tag.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CollectionsEditor({ item }: { item: Item }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Folder className="size-3.5" />
          集合
          {item.collections.length > 0 && (
            <span className="font-mono text-[11px]">{item.collections.length}</span>
          )}
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-max min-w-36 max-w-48 p-1">
        <CollectionPicker itemIds={[item.id]} />
      </PopoverContent>
    </Popover>
  );
}

function Attachments({ item }: { item: Item }) {
  const attachments = useLibrary((state) => state.detail?.attachments) ?? [];
  const addAttachments = useLibrary((state) => state.addAttachments);
  const removeAttachment = useLibrary((state) => state.removeAttachment);
  const unlocked = useLibrary((state) => state.lockSession.unlocked);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ItemSummary[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setQuery("");
    setResults([]);
    setSearching(false);
  }, [item.id]);

  useEffect(() => {
    const text = query.trim();
    if (!open || !text) {
      setResults([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      const search = (view: "all" | "privacy") => ipc.listItems({
        view,
        query: `type:file ${text}`,
        sort: "updated",
        limit: 20,
      });
      const requests = [search("all")];
      if (item.isPrivate) requests.push(search("privacy"));
      void Promise.all(requests)
        .then((responses) => {
          if (!active) return;
          const items = responses.flatMap((response) => response.entries.map((entry) => entry.item));
          setResults([...new Map(items.map((candidate) => [candidate.id, candidate])).values()]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        })
        .catch(() => {
          if (active) setResults([]);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [item.isPrivate, open, query]);

  const attachable = results.filter(
    (candidate) => candidate.itemType === "file"
      && candidate.id !== item.id
      && !(candidate.effectiveLocked && !unlocked)
      && !attachments.some((attachment) => attachment.id === candidate.id),
  ).slice(0, 20);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1 text-[11px] font-medium tracking-wider text-muted-foreground/80 uppercase">
          <Paperclip className="size-3" /> 附件
          {attachments.length > 0 && <span className="font-mono">{attachments.length}</span>}
        </span>
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              setQuery("");
              setResults([]);
              setSearching(false);
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs" className="text-muted-foreground">
              <FolderPlus className="size-3.5" /> 添加附件
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索库内文件…"
                aria-label="搜索附件"
                autoFocus
                className="h-8 pl-7 text-[12.5px]"
              />
            </div>
            {!query.trim() ? (
              <p className="px-1.5 py-1 text-[12px] text-muted-foreground">
                输入文件名或内容搜索附件
              </p>
            ) : searching ? (
              <p className="px-1.5 py-1 text-[12px] text-muted-foreground">搜索中…</p>
            ) : attachable.length === 0 ? (
              <p className="px-1.5 py-1 text-[12px] text-muted-foreground">没有可挂载的匹配文件</p>
            ) : (
              <div className="flex max-h-56 flex-col gap-px overflow-y-auto">
                {attachable.map((f) => (
                  <button
                    key={f.id}
                    className="flex h-6 items-center gap-1.5 rounded px-1.5 text-left text-[12.5px] whitespace-nowrap hover:bg-accent"
                    onClick={() => {
                      void addAttachments(item.id, [f.id]);
                      setOpen(false);
                    }}
                  >
                    {f.mime.startsWith("image/") ? (
                      <ImageIcon className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileIcon className="size-3 shrink-0 text-muted-foreground" />
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
      {attachments.map((a) => {
        const concealed = a.effectiveLocked && !unlocked;
        return (
        <div
          key={a.id}
          className="group flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[12.5px] hover:bg-accent/50"
        >
          {concealed ? (
            <Lock className="size-3.5 text-muted-foreground" />
          ) : a.mime.startsWith("image/") ? (
            <ImageIcon className="size-3.5 text-muted-foreground" />
          ) : (
            <FileIcon className="size-3.5 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate">{a.title}</span>
          <span className="font-mono text-[10.5px] text-muted-foreground">{concealed ? "已锁定" : formatSize(a.size)}</span>
          <button
            className="text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
            onClick={() => void removeAttachment(item.id, a.id)}
            aria-label="移除附件"
          >
            <X className="size-3.5" />
          </button>
        </div>
        );
      })}
    </div>
  );
}

type TextFileSaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

function FileIdentity({ item }: { item: Item }) {
  const switchable = isSwitchableText(item.storedPath || item.title);
  const noteMode = useLibrary((state) => state.noteMode);
  const currentFormat = canonicalFormat(fileExtension(item.storedPath || item.title));
  const ext = fileExtension(item.storedPath || item.title);
  const [stem, setStem] = useState(displayStem(item.title, item.storedPath));
  const [pendingFormat, setPendingFormat] = useState<SwitchableFormat | null>(null);
  const committed = displayStem(item.title, item.storedPath);
  const trashed = Boolean(item.deletedAt);
  const linkState = useLibrary((state) => state.linkedSources[item.id]);
  const linked = linkState !== undefined;
  const unavailable = linkState === "missing" || linkState === "error";
  const showTitleInput = !trashed && !unavailable && (!switchable || noteMode === "edit");

  useEffect(() => {
    setStem(displayStem(item.title, item.storedPath));
  }, [item.id, item.title, item.storedPath]);

  useEffect(() => setPendingFormat(null), [item.id]);

  const commit = async (nextStem = stem, format: string | null = null) => {
    const trimmed = nextStem.trim() || "无标题";
    if (trimmed === committed && (format == null || format === currentFormat)) return;
    const renamed = await useLibrary.getState().renameFile(item.id, trimmed, format);
    if (!renamed) toast.error("重命名失败");
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {showTitleInput ? (
        <Input
          value={stem}
          onChange={(event) => setStem(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          placeholder="无标题"
          className="h-auto min-w-0 flex-1 rounded-md border-none px-1 -ml-1 text-[20px] font-semibold tracking-tight shadow-none md:text-[20px] focus-visible:ring-1 focus-visible:ring-ring/40"
          aria-label="文件名"
        />
      ) : (
        <h2 className="min-w-0 flex-1 text-[20px] font-semibold tracking-tight">
          {committed || "无标题"}
        </h2>
      )}
      {linked && <Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-label="已链接源文件" />}
      {switchable && !linked ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              disabled={trashed}
              aria-label="文件格式"
              className="shrink-0 font-mono text-[11px] text-muted-foreground"
            >
              {FORMAT_LABEL[currentFormat ?? "md"]}
              <ChevronDown className="size-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-32">
            <DropdownMenuRadioGroup
              value={currentFormat ?? "md"}
              onValueChange={(value) => {
                const format = canonicalFormat(value);
                if (format && format !== currentFormat) setPendingFormat(format);
              }}
            >
              {SWITCHABLE_FORMATS.map((format) => (
                <DropdownMenuRadioItem key={format} value={format}>
                  {FORMAT_LABEL[format]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="font-mono text-[11px] text-muted-foreground">{ext.toUpperCase() || "FILE"}</span>
      )}
      <Dialog open={pendingFormat !== null} onOpenChange={(open) => !open && setPendingFormat(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-medium">切换文件格式？</DialogTitle>
            <DialogDescription>
              将从 {FORMAT_LABEL[currentFormat ?? ""] ?? ext.toUpperCase()} 切换为 {pendingFormat ? FORMAT_LABEL[pendingFormat] : ""}。
              此操作只会修改扩展名，不会转换文件内容，可能影响其他应用打开。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingFormat(null)}>取消</Button>
            <Button onClick={() => {
              const format = pendingFormat;
              setPendingFormat(null);
              if (format) void commit(stem, format);
            }}>确认切换</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LinkedSourceBanner({ item }: { item: Item }) {
  const state = useLibrary((library) => library.linkedSources[item.id]);
  const relinkSource = useLibrary((library) => library.relinkSource);
  const detachSource = useLibrary((library) => library.detachSource);
  const [conflictingPath, setConflictingPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (state !== "missing" && state !== "error") return null;

  const pickSource = async () => {
    const picked = await openDialog({ multiple: false, directory: false, title: "重新选择源文件" });
    if (!picked) return;
    setBusy(true);
    const result = await relinkSource(item.id, picked);
    setBusy(false);
    if (result?.status === "needsChoice") setConflictingPath(picked);
    else if (result?.status === "linked") toast.success("已恢复源文件链接");
  };

  const resolveConflict = async (strategy: "useSource" | "keepLibrary") => {
    const path = conflictingPath;
    if (!path) return;
    setBusy(true);
    const result = await relinkSource(item.id, path, strategy);
    setBusy(false);
    if (result?.status === "linked") {
      setConflictingPath(null);
      toast.success("已恢复源文件链接");
    }
  };

  return <>
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-md border border-amber-500/35 bg-amber-500/8 px-3 py-2.5 text-[12px]" role="alert">
      <AlertTriangle className="size-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{state === "missing" ? "源文件已失联" : "源文件同步失败"}</p>
        <p className="text-muted-foreground">安全副本仍可阅读、预览和导出；处理前不可编辑。</p>
      </div>
      <Button variant="outline" size="xs" disabled={busy} onClick={() => void pickSource()}>重新选择</Button>
      <Button variant="ghost" size="xs" disabled={busy} onClick={() => void detachSource(item.id)}>转为内部管理</Button>
    </div>
    <Dialog open={conflictingPath !== null} onOpenChange={(open) => { if (!open && !busy) setConflictingPath(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>两份文件内容不同</DialogTitle>
          <DialogDescription>请选择保留哪一份。另一份会被覆盖，此操作不会自动合并内容。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setConflictingPath(null)}>取消</Button>
          <Button variant="outline" disabled={busy} onClick={() => void resolveConflict("keepLibrary")}>用安全副本覆盖源文件</Button>
          <Button disabled={busy} onClick={() => void resolveConflict("useSource")}>采用源文件</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function TextFileEditor({
  item,
  headerActions,
}: {
  item: Item;
  headerActions: HTMLDivElement | null;
}) {
  const [content, setContent] = useState("");
  const linkState = useLibrary((state) => state.linkedSources[item.id]);
  const sourceUnavailable = linkState === "missing" || linkState === "error";
  const noteMode = useLibrary((state) => state.noteMode);
  const setNoteMode = useLibrary((state) => state.setNoteMode);
  const mode = item.deletedAt || sourceUnavailable ? "read" : noteMode;
  const format = canonicalFormat(fileExtension(item.storedPath || item.title));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<TextFileSaveState>("idle");
  const [searchOpen, setSearchOpen] = useState(false);
  const version = useRef("");
  const encoding = useRef<TextFileEncoding>("utf8");
  const lineEnding = useRef<TextFileLineEnding>("lf");
  const latestDraft = useRef<TextFileDraft | null>(null);
  const conflictVersion = useRef<string | null>(null);
  const saveError = useRef("");
  const mounted = useRef(true);
  const searchScopeRef = useRef<HTMLDivElement>(null);
  const previousMode = useRef(mode);
  const draftWarningShown = useRef(false);
  const draftWriter = useRef<ReturnType<typeof createSerialTextFileDraftWriter> | null>(null);
  const saver = useRef<ReturnType<typeof createSerialNoteSaver> | null>(null);
  const snapshotter = useRef<ReturnType<typeof createTextSnapshotScheduler> | null>(null);
  const updateContentRef = useRef<(content: string) => void>(() => undefined);

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
      delay: 0,
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
        if (mounted.current) {
          setSaveState(latestDraft.current || snapshotter.current?.pending() ? "dirty" : "saved");
        }
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
    setSearchOpen(false);
    snapshotter.current?.cancel();
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
          if (!item.deletedAt && !isLargeTextFile(item.size, storedDraft.content.length)) {
            setNoteMode("edit");
          }
          setSaveState("dirty");
          toast.info("已恢复未保存的文件内容");
          if (!item.deletedAt) scheduleSave(storedDraft);
        } else if (decision === "conflict" && storedDraft) {
          latestDraft.current = storedDraft;
          conflictVersion.current = document.version;
          encoding.current = storedDraft.encoding;
          lineEnding.current = storedDraft.lineEnding;
          setContent(storedDraft.content);
          if (!item.deletedAt && !isLargeTextFile(item.size, storedDraft.content.length)) {
            setNoteMode("edit");
          }
          setSaveState("conflict");
        } else {
          latestDraft.current = null;
          conflictVersion.current = null;
          setContent(document.content);
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
    const openSearch = () => setSearchOpen(true);
    window.addEventListener("nookspace:find-in-document", openSearch);
    return () => window.removeEventListener("nookspace:find-in-document", openSearch);
  }, []);

  useEffect(() => {
    if (previousMode.current === mode) return;
    previousMode.current = mode;
    setSearchOpen(false);
    if (mode === "read") {
      requestAnimationFrame(() => searchScopeRef.current?.focus({ preventScroll: true }));
    }
  }, [mode]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      snapshotter.current?.flush();
      void saver.current?.flush();
      void draftWriter.current?.flush();
    };
  }, []);

  useEffect(() => {
    const flush = (event: Event) => {
      snapshotter.current?.flush();
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
    latestDraft.current = draft;
    draftWriter.current?.schedule(draft);
    if (mounted.current) {
      setContent(nextContent);
      setSaveState(conflictVersion.current ? "conflict" : "dirty");
    }
    if (!conflictVersion.current) scheduleSave(draft);
  };
  updateContentRef.current = updateContent;

  if (!snapshotter.current) {
    snapshotter.current = createTextSnapshotScheduler((nextContent) => {
      updateContentRef.current(nextContent);
    });
  }

  const stageSnapshot = (snapshot: () => string) => {
    snapshotter.current?.schedule(snapshot);
    setSaveState(conflictVersion.current ? "conflict" : "dirty");
  };

  const changeMode = (nextMode: "read" | "edit") => {
    setNoteMode(nextMode);
    if (nextMode === "read") {
      snapshotter.current?.flush();
      void saver.current?.flush();
    }
  };

  const retrySave = () => {
    snapshotter.current?.flush();
    if (!latestDraft.current || conflictVersion.current) return;
    scheduleSave(latestDraft.current);
    void saver.current?.flush();
  };

  const reload = async () => {
    snapshotter.current?.cancel();
    setLoading(true);
    try {
      const document = await ipc.readTextFile(item.id);
      version.current = document.version;
      encoding.current = document.encoding;
      lineEnding.current = document.lineEnding;
      latestDraft.current = null;
      conflictVersion.current = null;
      setContent(document.content);
      setNoteMode("read");
      setSaveState("idle");
      await deleteTextFileDraft(item.id);
    } catch (error) {
      toast.error(`重新载入失败：${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const synced = (event: Event) => {
      const ids = (event as CustomEvent<string[]>).detail;
      if (!ids.includes(item.id)) return;
      if (latestDraft.current || snapshotter.current?.pending()) {
        snapshotter.current?.flush();
        void saver.current?.flush();
      } else {
        void reload();
      }
    };
    window.addEventListener("nookspace:linked-source-updated", synced);
    return () => window.removeEventListener("nookspace:linked-source-updated", synced);
  }, [item.id]);

  const overwrite = () => {
    snapshotter.current?.flush();
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
        <Button variant="outline" size="sm" disabled={sourceUnavailable} onClick={() => void ipc.openWithDefault(item.id)}>
          <ExternalLink className="size-3.5" /> 用默认应用打开
        </Button>
      </div>
    );
  }

  return (
    <>
      {headerActions && createPortal(
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setSearchOpen(true)}
                aria-label="在文档内查找"
                aria-keyshortcuts="Meta+F Control+F"
              >
                <Search className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              在文档内查找 <kbd data-slot="kbd">⌘F</kbd>
            </TooltipContent>
          </Tooltip>
          <div className="flex items-center rounded-md bg-muted p-0.5" aria-label="文本文件模式">
            <Button variant={mode === "read" ? "default" : "ghost"} size="xs" aria-pressed={mode === "read"} onClick={() => changeMode("read")}>
              阅读
            </Button>
            <Button variant={mode === "edit" ? "default" : "ghost"} size="xs" aria-pressed={mode === "edit"} onClick={() => changeMode("edit")} disabled={Boolean(item.deletedAt) || sourceUnavailable}>
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

      <div
        ref={searchScopeRef}
        data-document-search-scope
        tabIndex={-1}
        className="relative flex min-h-[360px] min-w-0 flex-1 flex-col gap-3 outline-none"
        onPointerDownCapture={(event) => {
          const target = event.target;
          if (target instanceof Element
            && !target.closest("button, input, textarea, select, a, [contenteditable='true']")) {
            event.currentTarget.focus({ preventScroll: true });
          }
        }}
      >
        {saveState === "conflict" && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2" role="alert">
            <p className="min-w-0 flex-1 text-[12px] text-foreground/80">
              文件已被其他应用修改，自动保存已暂停；当前草稿仍被保留。
            </p>
            <Button variant="outline" size="xs" onClick={() => void reload()}>重新载入</Button>
            <Button variant="destructive" size="xs" onClick={overwrite} disabled={Boolean(item.deletedAt)}>覆盖保存</Button>
          </div>
        )}

        <Suspense fallback={<p className="py-12 text-center font-mono text-[11px] text-muted-foreground">正在载入文本视图…</p>}>
          {mode === "read" && format === "csv" ? (
            <CsvTable content={content} />
          ) : mode === "read" && format === "md" ? (
            <MarkdownReader
              content={content}
              ariaLabel={`阅读 ${item.title}`}
              large={isLargeTextFile(item.size, content.length)}
              searchOpen={searchOpen}
              onSearchOpenChange={setSearchOpen}
            />
          ) : (
            <TextEditor
              initialContent={content}
              format={format}
              readOnly={mode === "read" || Boolean(item.deletedAt)}
              ariaLabel={`${mode === "read" ? "阅读" : "编辑"} ${item.title}`}
              onDocumentChange={stageSnapshot}
              onEscape={() => {
                if (mode === "edit") changeMode("read");
              }}
              searchOpen={searchOpen}
              onSearchOpenChange={setSearchOpen}
            />
          )}
          {mode === "read" && searchOpen && format === "csv" && (
            <div className="absolute inset-0 z-10 flex min-h-0 bg-background">
              <TextEditor
                initialContent={content}
                format={format}
                readOnly
                ariaLabel={`查找 ${item.title}`}
                onDocumentChange={() => undefined}
                onEscape={() => undefined}
                searchOpen
                onSearchOpenChange={setSearchOpen}
              />
            </div>
          )}
        </Suspense>
      </div>
    </>
  );
}

function HtmlFileReader({ item }: { item: Item }) {
  const linkState = useLibrary((state) => state.linkedSources[item.id]);
  const sourceUnavailable = linkState === "missing" || linkState === "error";
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    void ipc.readTextFile(item.id)
      .then((document) => {
        if (alive) setContent(document.content);
      })
      .catch((error) => {
        if (alive) setLoadError(String(error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [item.id]);

  if (loading) {
    return <p className="py-12 text-center font-mono text-[11px] text-muted-foreground">正在载入 HTML…</p>;
  }
  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
        <FileIcon className="size-12 text-muted-foreground/40" />
        <p className="max-w-md text-[12px] text-muted-foreground">{loadError}</p>
        <Button variant="outline" size="sm" disabled={sourceUnavailable} onClick={() => void ipc.openWithDefault(item.id)}>
          <ExternalLink className="size-3.5" /> 用默认应用打开
        </Button>
      </div>
    );
  }

  return (
    <iframe
      title={`阅读 ${item.title}`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={content}
      className="min-h-0 w-full flex-1 border-0 bg-white"
    />
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
  const html = isHtmlFile(item.mime, item.storedPath || item.title);
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

  if (html) {
    return <HtmlFileReader key={item.id} item={item} />;
  }
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

function DetailItemMenu({ item }: { item: Item }) {
  const actions = useItemActions(item);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="更多操作">
          <MoreHorizontal className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {actions.map((action) => action.kind === "separator" ? (
          <DropdownMenuSeparator key={action.key} />
        ) : (
          <DropdownMenuItem
            key={action.key}
            disabled={action.disabled}
            variant={action.destructive ? "destructive" : "default"}
            onSelect={() => void action.run?.()}
          >
            {action.icon}{action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DetailPane() {
  const item = useLibrary((state) => state.detail?.item);
  const selectedId = useLibrary((state) => state.selectedId);
  const selectedLocked = useLibrary((state) => state.items.find((candidate) => candidate.id === state.selectedId)?.effectiveLocked ?? false);
  const detailLoading = useLibrary((state) => state.detailLoading);
  const toggleFavorite = useLibrary((state) => state.toggleFavorite);
  const listCollapsed = useUi((state) => state.listCollapsed);
  const toggleListCollapsed = useUi((state) => state.toggleListCollapsed);
  const headerRef = useRef<HTMLDivElement | null>(null);
  useTitlebarDrag(headerRef);
  const [fileHeaderActions, setFileHeaderActions] = useState<HTMLDivElement | null>(null);

  const isTrashed = item ? item.deletedAt !== null : false;
  const html = item?.itemType === "file" && isHtmlFile(item.mime, item.storedPath || item.title);

  return (
    <section
      data-document-search-scope={item?.itemType === "file"
        && isSwitchableText(item.storedPath || item.title)
        ? ""
        : undefined}
      className="flex min-w-0 flex-1 flex-col bg-background"
    >
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
          详情
        </h1>
        {item && (
          <>
            {!item.isPrivate && <CollectionsEditor item={item} />}
            <TagsEditor item={item} />
          </>
        )}
        <div className="flex-1" />
        {item?.itemType === "file" && (
          <div ref={setFileHeaderActions} className="flex items-center gap-2" />
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
        {item && <DetailItemMenu item={item} />}
      </div>

      {item && <LinkedSourceBanner item={item} />}

      {!item ? (
        detailLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="font-mono text-[12px] text-muted-foreground">加载中…</p>
          </div>
        ) : selectedId && selectedLocked ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-muted">
              <Lock className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-[13px] font-medium">此内容已锁定</p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">使用 Touch ID 或系统密码解锁</p>
            </div>
            <Button size="sm" onClick={() => void useLibrary.getState().unlockProtectedContent()}>
              解锁
            </Button>
          </div>
        ) : (
          <EmptyDetail />
        )
      ) : html ? (
        <div className="flex min-h-0 flex-1">
          <HtmlFileReader key={item.id} item={item} />
        </div>
      ) : (
      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea
          type="scroll"
          className="min-h-0 flex-1 [&_[data-slot=scroll-area-scrollbar]]:w-1.5 [&_[data-slot=scroll-area-scrollbar]]:py-3 [&_[data-slot=scroll-area-thumb]]:bg-muted-foreground/45 [&_[data-slot=scroll-area-viewport]>div]:!block"
        >
          <div
            className={cn(
              "flex min-h-full w-full min-w-0 max-w-full flex-col px-6 pt-5",
              item.itemType === "file"
                && isSwitchableText(item.storedPath || item.title)
                && !isTrashed
                ? "pb-0"
                : "pb-5",
            )}
          >
          {item.itemType === "file" ? (
            <>
              <FileIdentity item={item} />
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                <span>{FORMAT_LABEL[canonicalFormat(fileExtension(item.storedPath || item.title)) ?? ""] ?? (fileExtension(item.storedPath || item.title).toUpperCase() || item.mime)}</span>
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
        {item.itemType === "file" && isSwitchableText(item.storedPath || item.title) && !isTrashed && (
          <footer
            className="max-h-[35%] shrink-0 overflow-y-auto border-t border-border px-6 py-3"
            aria-label="附件"
          >
            <Attachments item={item} />
          </footer>
        )}
      </div>
      )}
    </section>
  );
}
