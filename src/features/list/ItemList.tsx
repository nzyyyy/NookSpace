import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownAZ,
  ArrowUpDown,
  Calendar,
  BookmarkPlus,
  Clapperboard,
  File as FileIcon,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  List,
  ListPlus,
  LayoutGrid,
  Music,
  Lock,
  LockOpen,
  PanelLeftClose,
  Plus,
  Star,
  Tags,
  Trash2,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { convertFileSrc, ipc, type Collection, type ItemSummary, type SavedView } from "@/core/ipc";
import { formatRelativeDate, formatSize } from "@/lib/format";
import { collectionPath } from "@/lib/collections";
import { tagBadgeClass, tagDotClass } from "@/lib/tag-colors";
import { canonicalFormat, displayStem, fileExtension, isMediaFile } from "@/lib/file-types";
import { useLibrary, type SortKey, type View } from "@/stores/library";
import { useUi, type ListLayout } from "@/stores/ui";
import { useTitlebarDrag } from "@/hooks/useTitlebarDrag";
import { EmptyState } from "@/features/empty/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CollectionPicker } from "@/features/list/CollectionPicker";
import { useItemActions } from "@/features/list/item-actions";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

function viewTitle(
  view: View,
  collections: Collection[],
  tags: { id: string; name: string }[],
  savedViews: SavedView[],
): string {
  switch (view.kind) {
    case "all":
      return "全部";
    case "favorites":
      return "收藏";
    case "privacy":
      return "保险箱";
    case "recent":
      return "最近";
    case "uncollected":
      return "未分类";
    case "trash":
      return "回收站";
    case "collection":
      return collectionPath(collections, view.id).map((collection) => collection.name).join(" / ") || "集合";
    case "tag":
      return `# ${tags.find((t) => t.id === view.id)?.name ?? "标签"}`;
    case "saved":
      return savedViews.find((item) => item.id === view.id)?.name ?? "保存搜索";
  }
}

function TypeIcon({ item, className }: { item: ItemSummary; className?: string }) {
  const unlocked = useLibrary((state) => state.lockSession.unlocked);
  if ((item.collectionLocked || item.isPrivate) && !unlocked) return <Lock className={className} />;
  if (item.itemType === "link") return <Link2 className={className} />;
  if (canonicalFormat(fileExtension(item.storedPath || item.title)) === "md") {
    return <FileText className={className} />;
  }
  if (item.mime.startsWith("image/")) return <ImageIcon className={className} />;
  if (item.mime.startsWith("video/")) return <Clapperboard className={className} />;
  if (item.mime.startsWith("audio/")) return <Music className={className} />;
  return <FileIcon className={className} />;
}

function extOf(item: ItemSummary): string {
  return fileExtension(item.storedPath || item.title).toUpperCase();
}

function metaLine(item: ItemSummary, concealed = false): string {
  if (concealed) return "已锁定";
  const rel = formatRelativeDate(item.updatedAt);
  if (item.itemType === "file") {
    const ext = extOf(item);
    const size = item.size > 0 ? ` · ${formatSize(item.size)}` : "";
    return `${ext || "文件"}${size} · ${rel}`;
  }
  try {
    return `链接 · ${new URL(item.url).hostname} · ${rel}`;
  } catch {
    return `链接 · ${rel}`;
  }
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return text;
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
  return text.split(pattern).map((part, index) =>
    terms.some((term) => part.toLowerCase() === term.toLowerCase()) ? (
      <mark key={index} className="rounded-sm bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-700/50">{part}</mark>
    ) : part,
  );
}

function ItemRow({
  item,
  selected,
  multi,
  onActivate,
  snippet,
  terms,
}: {
  item: ItemSummary;
  selected: boolean;
  multi: boolean;
  onActivate: (e: React.MouseEvent) => void;
  snippet?: string;
  terms: string[];
}) {
  const unlocked = useLibrary((state) => state.lockSession.unlocked);
  const protectedLocked = item.effectiveLocked && !unlocked;
  const concealed = (item.collectionLocked || item.isPrivate) && !unlocked;
  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={onActivate}
      className={cn(
        "group flex cursor-default flex-col gap-0.5 rounded-md px-3 py-2 select-none group-data-[state=open]/item-menu:bg-accent",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        selected || multi
          ? "bg-accent text-foreground"
          : "text-foreground/90 hover:bg-accent/50",
      )}
    >
      <div className="flex items-center gap-2">
        <TypeIcon item={item} className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
          <Highlight text={displayStem(item.title, item.storedPath) || "无标题"} terms={terms} />
        </span>
        {protectedLocked && !concealed ? <Lock className="size-3 text-muted-foreground" /> : null}
        <button
          disabled={protectedLocked}
          tabIndex={-1}
          className={cn(
            "opacity-0 transition-opacity group-hover:opacity-100",
            item.isFavorite && "opacity-100",
          )}
          onClick={(e) => {
            e.stopPropagation();
            void useLibrary.getState().toggleFavorite(item.id);
          }}
          aria-label={item.isFavorite ? "取消收藏" : "收藏"}
        >
          <Star
            className={cn(
              "size-3.5",
              item.isFavorite ? "fill-primary text-primary" : "text-muted-foreground",
            )}
          />
        </button>
      </div>
      <div className="font-mono text-[11px] tracking-tight text-muted-foreground">
        {metaLine(item, concealed)}
      </div>
      {snippet && (
        <div className="line-clamp-2 text-[11.5px] leading-4 text-muted-foreground">
          <Highlight text={snippet} terms={terms} />
        </div>
      )}
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {item.tags.slice(0, 3).map((t) => (
            <span
              key={t.id}
              className={cn("rounded px-1 py-px text-[10.5px]", tagBadgeClass(t.color))}
            >
              {t.name}
            </span>
          ))}
          {item.tags.length > 3 && (
            <span className="text-[10.5px] text-muted-foreground">+{item.tags.length - 3}</span>
          )}
        </div>
      )}
    </div>
  );
}

function ItemCard({
  item,
  selected,
  multi,
  onActivate,
  snippet,
  terms,
}: {
  item: ItemSummary;
  selected: boolean;
  multi: boolean;
  onActivate: (event: React.MouseEvent) => void;
  snippet?: string;
  terms: string[];
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const unlocked = useLibrary((state) => state.lockSession.unlocked);
  const protectedLocked = item.effectiveLocked && !unlocked;
  const concealed = (item.collectionLocked || item.isPrivate) && !unlocked;

  useEffect(() => {
    if (protectedLocked) {
      setThumbnail(null);
      return;
    }
    if (item.itemType !== "file" || isMediaFile(item.mime, item.storedPath || item.title) || !ref.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      void ipc.generateThumbnail(item.id).then((path) => setThumbnail(path ? convertFileSrc(path) : null)).catch(() => undefined);
    }, { rootMargin: "120px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [protectedLocked, item.id, item.itemType, item.mime, item.storedPath, item.title]);

  let secondary = "";
  if (snippet) secondary = snippet;
  else if (item.itemType === "file" && item.contentPreview.trim()) {
    secondary = item.contentPreview.replace(/\s+/g, " ").trim();
  } else if (item.itemType === "link") {
    try { secondary = new URL(item.url).hostname; } catch { secondary = metaLine(item, concealed); }
  } else secondary = metaLine(item, concealed);

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      onClick={onActivate}
      style={{ contentVisibility: "auto" }}
      className={cn(
        "group flex min-h-44 cursor-default flex-col overflow-hidden rounded-lg border bg-card select-none group-data-[state=open]/item-menu:bg-accent",
        selected || multi ? "border-primary/50 ring-2 ring-primary/20" : "border-border hover:border-foreground/20",
      )}
    >
      <div className="flex h-28 items-center justify-center overflow-hidden bg-muted/50">
        {protectedLocked ? (
          <Lock className="size-8 text-muted-foreground/50" />
        ) : thumbnail ? (
          <img src={thumbnail} alt="" className="size-full object-cover" draggable={false} />
        ) : item.itemType === "file" && item.contentPreview.trim() ? (
          <p className="line-clamp-4 px-4 text-[12px] leading-5 text-muted-foreground">{secondary}</p>
        ) : item.itemType === "link" ? (
          <Link2 className="size-8 text-muted-foreground/50" />
        ) : (
          <TypeIcon item={item} className="size-8 text-muted-foreground/50" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium"><Highlight text={displayStem(item.title, item.storedPath) || "无标题"} terms={terms} /></span>
          {protectedLocked ? <Lock className="size-3 text-muted-foreground" /> : null}
          {item.isFavorite ? <Star className="size-3 fill-primary text-primary" /> : null}
        </div>
        <span className="line-clamp-2 font-mono text-[10.5px] text-muted-foreground"><Highlight text={secondary} terms={terms} /></span>
        {item.tags.length > 0 ? (
          <div className="mt-auto flex gap-1 overflow-hidden pt-1">
            {item.tags.slice(0, 2).map((tag) => (
              <span key={tag.id} className={cn("truncate rounded px-1 py-px text-[10px]", tagBadgeClass(tag.color))}>{tag.name}</span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ItemContextMenu({ item, children }: { item: ItemSummary; children: React.ReactNode }) {
  const actions = useItemActions(item);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group/item-menu contents">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        {actions.map((action) => action.kind === "separator" ? (
          <ContextMenuSeparator key={action.key} />
        ) : (
          <ContextMenuItem
            key={action.key}
            disabled={action.disabled}
            variant={action.destructive ? "destructive" : "default"}
            onSelect={() => void action.run?.()}
          >
            {action.icon}{action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const SORTS: { key: SortKey; label: string; icon: typeof ArrowUpDown }[] = [
  { key: "updated", label: "按修改时间", icon: ArrowUpDown },
  { key: "created", label: "按创建时间", icon: Calendar },
  { key: "title", label: "按名称", icon: ArrowDownAZ },
  { key: "type", label: "按类型", icon: ListPlus },
];

function ListViewChrome({
  listLayout,
  setListLayout,
  sort,
  setSort,
}: {
  listLayout: ListLayout;
  setListLayout: (layout: ListLayout) => void;
  sort: SortKey;
  setSort: (sort: SortKey) => void;
}) {
  const current = SORTS.find((item) => item.key === sort) ?? SORTS[0];
  const SortIcon = current.icon;
  const [sortOpen, setSortOpen] = useState(false);
  return (
    <>
      <div className="flex rounded-md bg-muted p-0.5" aria-label="条目布局">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={listLayout === "list" ? "secondary" : "ghost"} size="icon-xs" onClick={() => setListLayout("list")} aria-label="列表视图">
              <List className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>列表视图</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={listLayout === "grid" ? "secondary" : "ghost"} size="icon-xs" onClick={() => setListLayout("grid")} aria-label="网格视图">
              <LayoutGrid className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>网格视图</TooltipContent>
        </Tooltip>
      </div>
      <DropdownMenu open={sortOpen} onOpenChange={setSortOpen}>
        <Tooltip open={sortOpen ? false : undefined}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={`排序：${current.label}`}>
                <SortIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>排序：{current.label}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          className="w-max min-w-44"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownMenuRadioGroup value={sort} onValueChange={(value) => setSort(value as SortKey)}>
            {SORTS.map((item) => (
              <DropdownMenuRadioItem key={item.key} value={item.key} className="whitespace-nowrap">
                <item.icon className="size-3.5" /> {item.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function CreateMenu() {
  const { createNote, importPaths } = useLibrary();
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" aria-label="新建">
              <Plus className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>新建</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="w-44"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuItem
          onSelect={() => {
            void createNote().then((item) => item && toast.success("已新建笔记"));
          }}
        >
          <FilePlus2 className="size-3.5" /> 新建笔记
          <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">⌘N</kbd>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void (async () => {
              const picked = await openDialog({
                multiple: true,
                directory: false,
                title: "导入文件",
              });
              if (picked && picked.length > 0) {
                const r = await importPaths(picked);
                if (r) {
                  toast.success(
                    `已导入 ${r.imported.length} 个文件${r.skipped.length ? `，跳过 ${r.skipped.length} 个` : ""}`,
                  );
                }
              }
            })();
          }}
        >
          <FolderOpen className="size-3.5" /> 导入文件…
          <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">⇧⌘N</kbd>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ItemList() {
  const { listLayout, setListLayout, toggleListCollapsed } = useUi();
  const {
    ready,
    items,
    collections,
    tags,
    savedViews,
    snippets,
    listTruncated,
    view,
    query,
    sort,
    selectedId,
    multiIds,
    setQuery,
    setSort,
    select,
    toggleMulti,
    openItem,
    clearMulti,
    deleteItems,
    restoreItems,
    purgeItems,
    emptyTrash,
    setItemTags,
    createSavedView,
    setItemsLocked,
    lockSession,
    unlockProtectedContent,
  } = useLibrary();

  const title = viewTitle(view, collections, tags, savedViews);
  const isTrash = view.kind === "trash";
  const isPrivacy = view.kind === "privacy";
  const collectionLocked = view.kind === "collection"
    && !lockSession.unlocked
    && collections.some((collection) => collection.id === view.id && collection.effectiveLocked);
  const privacyLocked = isPrivacy && !lockSession.unlocked;
  const viewLocked = collectionLocked || privacyLocked;
  const batch = multiIds;
  const lockableBatch = batch.filter((id) => !items.find((item) => item.id === id)?.collectionLocked);
  const lockableBatchLocked = lockableBatch.length > 0
    && lockableBatch.every((id) => items.find((item) => item.id === id)?.isLocked);
  const batchSet = useMemo(() => new Set(batch), [batch]);

  const handleActivate = (id: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) void toggleMulti(id, true, false);
    else if (e.shiftKey) void toggleMulti(id, false, true);
    else if (e.detail === 2) void openItem(id);
    else void select(id);
  };

  const batchDelete = () => {
    void deleteItems(batch);
    toast.info(`已删除 ${batch.length} 项（可在回收站恢复）`);
  };

  const tagPicker = useMemo(() => tags, [tags]);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  useTitlebarDrag(toolbarRef);

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      {/* Toolbar — also a window drag zone (buttons excluded) */}
      <div ref={toolbarRef} data-pane-toolbar className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => toggleListCollapsed()}
              aria-label="隐藏列表"
              aria-keyshortcuts="Meta+\\"
            >
              <PanelLeftClose className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            隐藏列表 <kbd data-slot="kbd">⌘\</kbd>
          </TooltipContent>
        </Tooltip>
        {batch.length > 0 ? (
          <>
            <span className="font-mono text-[12px] text-muted-foreground">
              已选 {batch.length} 项
            </span>
            <div className="ml-2 flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Tags className="size-3.5" /> 标签
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-max min-w-32 max-w-48">
                  <DropdownMenuLabel>添加标签</DropdownMenuLabel>
                  {tagPicker.map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      onSelect={() => {
                        for (const id of batch) {
                          const item = useLibrary.getState().items.find((i) => i.id === id);
                          if (item) {
                            const next = item.tags.some((x) => x.id === t.id)
                              ? item.tags.filter((x) => x.id !== t.id)
                              : [...item.tags, t];
                            void setItemTags(id, next.map((x) => x.id));
                          }
                        }
                        toast.success(`已更新 ${batch.length} 项的标签`);
                      }}
                    >
                      <span className={cn("size-2 rounded-full", tagDotClass(t.color))} />
                      {t.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {!isPrivacy && <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Folder className="size-3.5" /> 集合
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-max min-w-32 max-w-48 p-1">
                  <CollectionPicker itemIds={batch} />
                </PopoverContent>
              </Popover>}

              {!isTrash && !isPrivacy && lockableBatch.length > 0 && <Button
                variant="ghost"
                size="sm"
                onClick={() => void setItemsLocked(lockableBatch, !lockableBatchLocked)}
              >
                {lockableBatchLocked
                  ? <LockOpen className="size-3.5" />
                  : <Lock className="size-3.5" />}
                {lockableBatchLocked ? "取消锁定" : "锁定"}
              </Button>}

              {isTrash ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void restoreItems(batch);
                      toast.success("已恢复");
                    }}
                  >
                    恢复
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      void purgeItems(batch);
                      toast.success("已永久删除");
                    }}
                  >
                    删除
                  </Button>
                </>
              ) : (
                <Button variant="destructive" size="sm" onClick={batchDelete}>
                  <Trash2 className="size-3.5" /> 删除
                </Button>
              )}
            </div>
            <div data-pane-spacer className="flex-1" />
            <Button variant="ghost" size="sm" onClick={clearMulti}>
              取消
            </Button>
          </>
        ) : (
          <>
            <h1 className="min-w-0 truncate text-[15px] font-medium tracking-tight">{title}</h1>
            <span className="font-mono text-[11px] text-muted-foreground">{items.length}</span>
            <div data-pane-spacer className="flex-1" />
            {!isTrash && !viewLocked && !isPrivacy && (
              <CreateMenu />
            )}
            {isTrash && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => {
                  void emptyTrash();
                  toast.success("回收站已清空");
                }}
              >
                清空回收站
              </Button>
            )}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 px-3 pt-2">
        <Input
          id="list-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={privacyLocked ? "保险箱已锁定" : collectionLocked ? "集合已锁定" : "搜索标题、内容、文件名…"}
          disabled={viewLocked}
          className="h-7 min-w-0 flex-1 text-[13px]"
        />
        {!isTrash && !isPrivacy && query.trim() && (
          <Button variant="ghost" size="icon-sm" onClick={() => {
            setSaveName(query.trim());
            setSaveOpen(true);
          }} aria-label="保存当前搜索">
            <BookmarkPlus className="size-3.5" />
          </Button>
        )}
        <ListViewChrome
          listLayout={listLayout}
          setListLayout={setListLayout}
          sort={sort}
          setSort={setSort}
        />
      </div>
      {listTruncated && (
        <p className="px-4 pt-1 font-mono text-[10.5px] text-muted-foreground">仅显示前 500 条，请继续细化搜索</p>
      )}

      {/* Rows */}
      <ScrollArea className="flex-1">
        {!ready ? (
          <div className="flex flex-col gap-2 p-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-4/5" />
          </div>
        ) : viewLocked ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-4 px-10 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Lock className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-display text-[24px] font-medium tracking-tight text-foreground/90 italic">
                {privacyLocked ? "保险箱已锁定。" : "这个集合已锁定。"}
              </p>
              <p className="mt-2 font-mono text-[12px] tracking-wide text-muted-foreground">
                使用 Touch ID 或系统密码解锁
              </p>
            </div>
            <Button onClick={() => void unlockProtectedContent()}>
              <LockOpen className="size-4" /> {privacyLocked ? "解锁保险箱" : "解锁"}
            </Button>
          </div>
        ) : items.length === 0 && !isTrash && !query ? (
          <EmptyState view={view} />
        ) : (
          <div className={cn(listLayout === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 p-3" : "flex flex-col gap-px p-2")}>
            {items.map((item) => (
              <ItemContextMenu key={item.id} item={item}>
                {listLayout === "grid" ? <ItemCard
                item={item}
                selected={selectedId === item.id}
                multi={batchSet.has(item.id)}
                onActivate={handleActivate(item.id)}
                snippet={snippets[item.id]?.text}
                terms={snippets[item.id]?.terms ?? []}
              /> : <ItemRow
                item={item}
                selected={selectedId === item.id}
                multi={batchSet.has(item.id)}
                onActivate={handleActivate(item.id)}
                snippet={snippets[item.id]?.text}
                terms={snippets[item.id]?.terms ?? []}
              />}
              </ItemContextMenu>
            ))}
            {items.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="text-[13px] text-muted-foreground">
                  {isTrash && !query ? "回收站是空的" : "没有匹配的结果"}
                </p>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-[15px] font-medium">保存搜索</DialogTitle></DialogHeader>
          <Input autoFocus value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="搜索名称" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>取消</Button>
            <Button disabled={!saveName.trim()} onClick={() => {
              void createSavedView(saveName).then((saved) => {
                if (!saved) return toast.error("保存搜索失败");
                toast.success("搜索已保存");
                setSaveOpen(false);
              });
            }}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
