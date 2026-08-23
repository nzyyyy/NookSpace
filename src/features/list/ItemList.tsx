import { useMemo, useRef } from "react";
import {
  ArrowDownAZ,
  ArrowUpDown,
  Calendar,
  Clapperboard,
  File as FileIcon,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  ListPlus,
  Music,
  Plus,
  Star,
  Tags,
  Trash2,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { type Item } from "@/core/ipc";
import { formatRelativeDate, formatSize } from "@/lib/format";
import { useLibrary, type SortKey, type View } from "@/stores/library";
import { useTitlebarDrag } from "@/hooks/useTitlebarDrag";
import { EmptyState } from "@/features/empty/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

function viewTitle(
  view: View,
  collections: { id: string; name: string }[],
  tags: { id: string; name: string }[],
): string {
  switch (view.kind) {
    case "all":
      return "全部";
    case "favorites":
      return "收藏";
    case "recent":
      return "最近";
    case "uncollected":
      return "未分类";
    case "trash":
      return "回收站";
    case "collection":
      return collections.find((c) => c.id === view.id)?.name ?? "集合";
    case "tag":
      return `# ${tags.find((t) => t.id === view.id)?.name ?? "标签"}`;
  }
}

function TypeIcon({ item, className }: { item: Item; className?: string }) {
  if (item.itemType === "note") return <FileText className={className} />;
  if (item.itemType === "link") return <Link2 className={className} />;
  if (item.mime.startsWith("image/")) return <ImageIcon className={className} />;
  if (item.mime.startsWith("video/")) return <Clapperboard className={className} />;
  if (item.mime.startsWith("audio/")) return <Music className={className} />;
  return <FileIcon className={className} />;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toUpperCase() : "";
}

function metaLine(item: Item): string {
  const rel = formatRelativeDate(item.updatedAt);
  if (item.itemType === "note") return `笔记 · ${rel}`;
  if (item.itemType === "file") {
    const ext = extOf(item.title);
    const size = item.size > 0 ? ` · ${formatSize(item.size)}` : "";
    return `${ext || "文件"}${size} · ${rel}`;
  }
  try {
    return `链接 · ${new URL(item.url).hostname} · ${rel}`;
  } catch {
    return `链接 · ${rel}`;
  }
}

function ItemRow({
  item,
  selected,
  multi,
  onActivate,
}: {
  item: Item;
  selected: boolean;
  multi: boolean;
  onActivate: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={onActivate}
      className={cn(
        "group flex cursor-default flex-col gap-0.5 rounded-md px-3 py-2 select-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        selected || multi
          ? "bg-accent text-foreground"
          : "text-foreground/90 hover:bg-accent/50",
      )}
    >
      <div className="flex items-center gap-2">
        <TypeIcon item={item} className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
          {item.title || "无标题"}
        </span>
        <button
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
        {metaLine(item)}
      </div>
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {item.tags.slice(0, 3).map((t) => (
            <span
              key={t.id}
              className="rounded bg-muted px-1 py-px text-[10.5px] text-muted-foreground"
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

const SORTS: { key: SortKey; label: string; icon: typeof ArrowUpDown }[] = [
  { key: "updated", label: "按修改时间", icon: ArrowUpDown },
  { key: "created", label: "按创建时间", icon: Calendar },
  { key: "title", label: "按名称", icon: ArrowDownAZ },
  { key: "type", label: "按类型", icon: ListPlus },
];

export function ItemList() {
  const {
    ready,
    items,
    collections,
    tags,
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
    addToCollection,
    removeFromCollection,
    deleteItems,
    restoreItems,
    purgeItems,
    emptyTrash,
    setItemTags,
    createNote,
    importPaths,
  } = useLibrary();

  const title = viewTitle(view, collections, tags);
  const isTrash = view.kind === "trash";
  const batch = multiIds;

  const targetCollection = view.kind === "collection" ? view.id : null;

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
  useTitlebarDrag(toolbarRef);

  return (
    <section className="flex min-w-0 flex-1 flex-col border-r border-border bg-background">
      {/* Toolbar — also a window drag zone (buttons excluded) */}
      <div ref={toolbarRef} className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
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
                <DropdownMenuContent className="max-h-72 w-52 overflow-y-auto">
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
                      {t.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Folder className="size-3.5" /> 集合
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-h-72 w-52 overflow-y-auto">
                  <DropdownMenuLabel>加入集合</DropdownMenuLabel>
                  {collections.map((c) => (
                    <DropdownMenuItem
                      key={c.id}
                      onSelect={() => {
                        void addToCollection(batch, c.id);
                        toast.success(`已加入「${c.name}」`);
                      }}
                    >
                      {c.name}
                    </DropdownMenuItem>
                  ))}
                  {targetCollection && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                          void removeFromCollection(batch, targetCollection);
                          toast.success("已移出当前集合");
                        }}
                      >
                        移出当前集合
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

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
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={clearMulti}>
              取消
            </Button>
          </>
        ) : (
          <>
            <h1 className="text-[15px] font-medium tracking-tight">{title}</h1>
            <span className="font-mono text-[11px] text-muted-foreground">{items.length}</span>
            <div className="flex-1" />
            {!isTrash && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm">
                    <Plus className="size-3.5" /> 新建
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
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
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  {SORTS.find((s) => s.key === sort)?.label}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {SORTS.map((s) => (
                  <DropdownMenuItem key={s.key} onSelect={() => setSort(s.key)}>
                    <s.icon className="size-3.5" /> {s.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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

      {/* Search */}
      {!isTrash && (
        <div className="shrink-0 px-3 pt-2">
          <Input
            id="list-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题、内容、文件名…"
            className="h-7 text-[13px]"
          />
        </div>
      )}

      {/* Rows */}
      <ScrollArea className="flex-1">
        {!ready ? (
          <div className="flex flex-col gap-2 p-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-4/5" />
          </div>
        ) : items.length === 0 && !isTrash && !query ? (
          <EmptyState view={view} />
        ) : (
          <div className="flex flex-col gap-px p-2">
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                multi={batch.includes(item.id)}
                onActivate={handleActivate(item.id)}
              />
            ))}
            {items.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="text-[13px] text-muted-foreground">
                  {isTrash ? "回收站是空的" : "没有匹配的结果"}
                </p>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </section>
  );
}
