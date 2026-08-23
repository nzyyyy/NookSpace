import { useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Folder,
  FolderPlus,
  Inbox,
  Laptop,
  Moon,
  Plus,
  Search,
  Settings,
  Star,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import type { Collection } from "@/core/ipc";
import { cn } from "@/lib/utils";
import { buildCollectionTree, collectionPath, collectionSubtreeIds, flattenCollectionTree, type CollectionTreeNode } from "@/lib/collections";
import { TAG_COLORS, tagDotClass } from "@/lib/tag-colors";
import { useLibrary } from "@/stores/library";
import { useTheme, type ThemePreference } from "@/stores/theme";
import { useUi } from "@/stores/ui";
import { useTitlebarDrag } from "@/hooks/useTitlebarDrag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const SMART_VIEWS: { kind: "favorites" | "recent" | "uncollected"; label: string; icon: typeof Star }[] = [
  { kind: "favorites", label: "收藏", icon: Star },
  { kind: "recent", label: "最近", icon: Clock },
  { kind: "uncollected", label: "未分类", icon: Inbox },
];

function SectionLabel({ children, onAdd }: { children: React.ReactNode; onAdd?: () => void }) {
  return (
    <div className="flex h-7 items-center justify-between px-3 pt-2">
      <span className="text-[11px] font-medium tracking-wider text-muted-foreground/80 uppercase">
        {children}
      </span>
      {onAdd && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="-mr-1 text-muted-foreground hover:text-foreground"
          onClick={onAdd}
          aria-label="新建"
        >
          <Plus className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

function SidebarRow({
  active,
  onClick,
  icon,
  label,
  children,
  onContext,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: React.ReactNode;
  children?: React.ReactNode;
  onContext?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onContextMenu={onContext}
      className={cn(
        "group flex h-7 w-full cursor-default items-center gap-2 rounded-md px-2 text-[13px] select-none outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "bg-accent text-foreground font-medium"
          : "text-foreground/80 hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {icon && <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </div>
  );
}

function CollectionRows({
  nodes,
  depth = 0,
  activeId,
  collapsed,
  onToggle,
  onCreateChild,
  onRename,
  onMove,
  onDelete,
  onDrop,
}: {
  nodes: CollectionTreeNode<Collection>[];
  depth?: number;
  activeId: string | null;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onCreateChild: (id: string) => void;
  onRename: (collection: Collection) => void;
  onMove: (collection: Collection) => void;
  onDelete: (collection: Collection) => void;
  onDrop: (draggedId: string, target: Collection, zone: "before" | "inside" | "after", siblings: Collection[]) => void;
}) {
  return nodes.map((node, index) => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.id);
    return (
      <div key={node.id}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              draggable
              onDragStart={(event) => event.dataTransfer.setData("text/x-nookspace-collection", node.id)}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("text/x-nookspace-collection")) event.preventDefault();
              }}
              onDrop={(event) => {
                const draggedId = event.dataTransfer.getData("text/x-nookspace-collection");
                if (!draggedId) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = (event.clientY - rect.top) / rect.height;
                onDrop(draggedId, node, ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside", nodes);
              }}
              className="flex items-center"
              style={{ paddingLeft: depth * 12 }}
            >
              <button
                type="button"
                className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
                onClick={() => hasChildren && onToggle(node.id)}
                aria-label={hasChildren ? (isCollapsed ? "展开集合" : "折叠集合") : undefined}
                aria-expanded={hasChildren ? !isCollapsed : undefined}
              >
                {hasChildren ? (isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />) : null}
              </button>
              <div className="min-w-0 flex-1">
                <SidebarRow
                  active={activeId === node.id}
                  onClick={() => useLibrary.getState().setView({ kind: "collection", id: node.id })}
                  icon={<Folder />}
                  label={node.name}
                />
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-44">
            <ContextMenuItem onSelect={() => onCreateChild(node.id)}>新建子集合</ContextMenuItem>
            <ContextMenuItem disabled={index === 0} onSelect={() => {
              const before = nodes[index - 1];
              if (before) void useLibrary.getState().moveCollection(node.id, node.parentId, before.id);
            }}>上移</ContextMenuItem>
            <ContextMenuItem disabled={index === nodes.length - 1} onSelect={() => {
              const before = nodes[index + 2]?.id ?? null;
              void useLibrary.getState().moveCollection(node.id, node.parentId, before);
            }}>下移</ContextMenuItem>
            <ContextMenuItem onSelect={() => onMove(node)}>移动到…</ContextMenuItem>
            <ContextMenuItem onSelect={() => onRename(node)}>重命名</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => onDelete(node)}>删除集合</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {hasChildren && !isCollapsed ? (
          <CollectionRows
            nodes={node.children}
            depth={depth + 1}
            activeId={activeId}
            collapsed={collapsed}
            onToggle={onToggle}
            onCreateChild={onCreateChild}
            onRename={onRename}
            onMove={onMove}
            onDelete={onDelete}
            onDrop={onDrop}
          />
        ) : null}
      </div>
    );
  });
}

function CreateInput({
  placeholder,
  onConfirm,
  onCancel,
}: {
  placeholder: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="flex items-center gap-1 px-2 pb-1">
      <Input
        autoFocus
        value={name}
        placeholder={placeholder}
        className="h-6 text-[13px]"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) onConfirm(name.trim());
          if (e.key === "Escape") onCancel();
        }}
      />
      <Button variant="ghost" size="icon-xs" onClick={() => name.trim() && onConfirm(name.trim())}>
        <Check className="size-3.5" />
      </Button>
      <Button variant="ghost" size="icon-xs" onClick={onCancel}>
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function RenameDialog({
  open,
  title,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-medium">{title}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              onSubmit(name.trim());
              onClose();
            }
          }}
        />
        <DialogFooter>
          <Button
            size="sm"
            onClick={() => {
              if (name.trim()) {
                onSubmit(name.trim());
                onClose();
              }
            }}
          >
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type RenameTarget =
  | { kind: "collection"; id: string; name: string }
  | { kind: "tag"; id: string; name: string }
  | { kind: "saved"; id: string; name: string }
  | null;

export function Sidebar() {
  const {
    collections,
    tags,
    savedViews,
    view,
    setView,
    createCollection,
    moveCollection,
    deleteCollectionTree,
    renameCollection,
    createTag,
    deleteTag,
    renameTag,
    setTagColor,
    renameSavedView,
    deleteSavedView,
  } = useLibrary();
  const { preference, setPreference } = useTheme();
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const [creating, setCreating] = useState<{ kind: "collection"; parentId: string | null } | { kind: "tag" } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [moveTarget, setMoveTarget] = useState<Collection | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Collection | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const headerRef = useRef<HTMLDivElement | null>(null);
  useTitlebarDrag(headerRef);

  const themeCycle: ThemePreference[] = ["system", "light", "dark"];
  const ThemeIcon = preference === "light" ? Sun : preference === "dark" ? Moon : Laptop;
  const collectionTree = buildCollectionTree(collections);
  const flatCollections = flattenCollectionTree(collectionTree);
  const activeCollectionId = view.kind === "collection" ? view.id : null;
  const moveExcluded = moveTarget ? collectionSubtreeIds(collections, moveTarget.id) : new Set<string>();

  const dropCollection = async (
    draggedId: string,
    target: Collection,
    zone: "before" | "inside" | "after",
    siblings: Collection[],
  ) => {
    if (draggedId === target.id) return;
    let parentId = target.parentId;
    let beforeId: string | null = target.id;
    if (zone === "inside") {
      parentId = target.id;
      beforeId = null;
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
    } else if (zone === "after") {
      const index = siblings.findIndex((item) => item.id === target.id);
      beforeId = siblings[index + 1]?.id ?? null;
    }
    if (!(await moveCollection(draggedId, parentId, beforeId))) toast.error("无法移动集合");
  };

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-background">
      {/* Header: traffic-light zone + wordmark, whole area is window drag zone */}
      <div ref={headerRef} className="shrink-0">
        <div className="h-[26px]" />
        <div className="flex h-9 items-center pl-2.5 pr-4">
          <span className="font-display text-[19px] font-semibold tracking-tight text-foreground">
            NookSpace
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {/* Smart views */}
        <div className="flex flex-col gap-px">
          {SMART_VIEWS.map(({ kind, label, icon: Icon }) => (
            <SidebarRow
              key={kind}
              active={view.kind === kind}
              onClick={() => setView({ kind })}
              icon={<Icon />}
              label={label}
            />
          ))}
        </div>

        {savedViews.length > 0 && (
          <>
            <SectionLabel>已保存</SectionLabel>
            <div className="flex flex-col gap-px">
              {savedViews.map((saved) => (
                <ContextMenu key={saved.id}>
                  <ContextMenuTrigger asChild>
                    <div>
                      <SidebarRow
                        active={view.kind === "saved" && view.id === saved.id}
                        onClick={() => setView({ kind: "saved", id: saved.id })}
                        icon={<Search />}
                        label={saved.name}
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="min-w-40">
                    <ContextMenuItem onSelect={() => setRenameTarget({ kind: "saved", id: saved.id, name: saved.name })}>
                      重命名
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onSelect={() => void deleteSavedView(saved.id)}>
                      删除保存搜索
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          </>
        )}

        {/* Collections */}
        <SectionLabel onAdd={() => setCreating({ kind: "collection", parentId: null })}>集合</SectionLabel>
        <div className="flex flex-col gap-px">
          <CollectionRows
            nodes={collectionTree}
            activeId={activeCollectionId}
            collapsed={collapsed}
            onToggle={(id) => setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })}
            onCreateChild={(parentId) => {
              setCreating({ kind: "collection", parentId });
              setCollapsed((current) => {
                const next = new Set(current);
                next.delete(parentId);
                return next;
              });
            }}
            onRename={(collection) => setRenameTarget({ kind: "collection", id: collection.id, name: collection.name })}
            onMove={setMoveTarget}
            onDelete={setDeleteTarget}
            onDrop={(draggedId, target, zone, siblings) => void dropCollection(draggedId, target, zone, siblings)}
          />
          {creating?.kind === "collection" && (
            <CreateInput
              placeholder={creating.parentId ? "子集合名称" : "集合名称"}
              onConfirm={(name) => {
                void createCollection(name, creating.parentId);
                setCreating(null);
              }}
              onCancel={() => setCreating(null)}
            />
          )}
          {collections.length === 0 && creating?.kind !== "collection" && (
            <div className="px-2 py-1 text-[12px] text-muted-foreground">
              <FolderPlus className="mr-1 inline size-3" />
              还没有集合
            </div>
          )}
        </div>

        {/* Tags */}
        <SectionLabel onAdd={() => setCreating({ kind: "tag" })}>标签</SectionLabel>
        <div className="flex flex-col gap-px">
          {tags.map((t) => (
            <ContextMenu key={t.id}>
              <ContextMenuTrigger asChild>
                <div>
                  <SidebarRow
                    active={view.kind === "tag" && view.id === t.id}
                    onClick={() => setView({ kind: "tag", id: t.id })}
                    icon={t.color ? <span className={cn("size-2.5 rounded-full", tagDotClass(t.color))} /> : undefined}
                    label={t.name}
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-40">
                <ContextMenuItem onSelect={() => setRenameTarget({ kind: "tag", id: t.id, name: t.name })}>
                  重命名
                </ContextMenuItem>
                <ContextMenuSub>
                  <ContextMenuSubTrigger>颜色</ContextMenuSubTrigger>
                  <ContextMenuSubContent className="min-w-32">
                    {TAG_COLORS.map((color) => (
                      <ContextMenuItem key={color.value} onSelect={() => void setTagColor(t.id, color.value)}>
                        <span className={cn("size-2.5 rounded-full", color.dot)} /> {color.label}
                      </ContextMenuItem>
                    ))}
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => void setTagColor(t.id, null)}>清除颜色</ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onSelect={() => void deleteTag(t.id)}>
                  删除标签
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
          {creating?.kind === "tag" && (
            <CreateInput
              placeholder="标签名称"
              onConfirm={(name) => {
                void createTag(name);
                setCreating(null);
              }}
              onCancel={() => setCreating(null)}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border p-2">
        <SidebarRow
          active={view.kind === "trash"}
          onClick={() => setView({ kind: "trash" })}
          icon={<Trash2 />}
          label="回收站"
        />
        <SidebarRow
          active={false}
          onClick={() => {
            const next = themeCycle[(themeCycle.indexOf(preference) + 1) % themeCycle.length];
            setPreference(next);
          }}
          icon={<ThemeIcon />}
          label={`外观：${preference === "light" ? "浅色" : preference === "dark" ? "深色" : "跟随系统"}`}
        />
        <SidebarRow active={false} onClick={() => setSettingsOpen(true)} icon={<Settings />} label="设置" />
      </div>

      <RenameDialog
        open={renameTarget !== null}
        title={renameTarget?.kind === "collection" ? "重命名集合" : renameTarget?.kind === "tag" ? "重命名标签" : "重命名保存搜索"}
        initial={renameTarget?.name ?? ""}
        onClose={() => setRenameTarget(null)}
        onSubmit={(name) => {
          if (!renameTarget) return;
          if (renameTarget.kind === "collection") void renameCollection(renameTarget.id, name);
          else if (renameTarget.kind === "tag") void renameTag(renameTarget.id, name);
          else void renameSavedView(renameTarget.id, name);
        }}
      />

      <Dialog open={moveTarget !== null} onOpenChange={(open) => !open && setMoveTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-[15px] font-medium">移动「{moveTarget?.name}」</DialogTitle></DialogHeader>
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            <Button variant="ghost" className="justify-start" disabled={moveTarget?.parentId === null} onClick={() => {
              if (moveTarget) void moveCollection(moveTarget.id, null, null);
              setMoveTarget(null);
            }}>顶层</Button>
            {moveTarget ? flatCollections
              .filter(({ collection }) => !moveExcluded.has(collection.id))
              .map(({ collection }) => (
                <Button key={collection.id} variant="ghost" className="justify-start" disabled={moveTarget.parentId === collection.id} onClick={() => {
                  void moveCollection(moveTarget.id, collection.id, null);
                  setMoveTarget(null);
                }}>
                  {collectionPath(collections, collection.id).map((item) => item.name).join(" / ")}
                </Button>
              )) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-[15px] font-medium">删除集合子树？</DialogTitle></DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            将删除「{deleteTarget?.name}」及其下的所有集合，共 {deleteTarget ? collectionSubtreeIds(collections, deleteTarget.id).size : 0} 个。条目本身不会被删除。
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={() => {
              if (deleteTarget) void deleteCollectionTree(deleteTarget.id);
              setDeleteTarget(null);
            }}>删除集合</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
