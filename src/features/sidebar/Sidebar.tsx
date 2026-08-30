import { useMemo, useRef, useState } from "react";
import { LayoutGroup, MotionConfig, motion } from "motion/react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Folder,
  FolderPlus,
  Inbox,
  Laptop,
  Lock,
  LockOpen,
  Moon,
  Plus,
  Search,
  Settings,
  Shield,
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

const SMART_VIEWS: { kind: "favorites" | "privacy" | "recent" | "uncollected"; label: string; icon: typeof Star }[] = [
  { kind: "favorites", label: "收藏", icon: Star },
  { kind: "privacy", label: "保险箱", icon: Shield },
  { kind: "recent", label: "最近", icon: Clock },
  { kind: "uncollected", label: "未分类", icon: Inbox },
];

type CollectionDropZone = "before" | "inside" | "after";

interface CollectionDropTarget {
  target: Collection;
  zone: CollectionDropZone;
  siblings: Collection[];
}

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
  leading,
  icon,
  label,
  children,
  onContext,
}: {
  active: boolean;
  onClick: () => void;
  leading?: React.ReactNode;
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
      {leading}
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
  renamingId,
  collapsed,
  draggedId,
  dropTarget,
  onToggle,
  onCreateChild,
  onRename,
  onRenameEnd,
  onMove,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
  onClickCapture,
}: {
  nodes: CollectionTreeNode<Collection>[];
  depth?: number;
  activeId: string | null;
  renamingId: string | null;
  collapsed: Set<string>;
  draggedId: string | null;
  dropTarget: CollectionDropTarget | null;
  onToggle: (id: string) => void;
  onCreateChild: (id: string) => void;
  onRename: (collection: Collection) => void;
  onRenameEnd: () => void;
  onMove: (collection: Collection) => void;
  onDelete: (collection: Collection) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, point: { x: number; y: number }) => void;
  onDragEnd: (id: string) => void;
  onClickCapture: (event: React.MouseEvent) => void;
}) {
  return nodes.map((node, index) => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.id);
    const isDragging = draggedId === node.id;
    const isRenaming = renamingId === node.id;
    const targetZone = dropTarget?.target.id === node.id ? dropTarget.zone : null;
    const unlocked = useLibrary.getState().lockSession.unlocked;
    const childRows = hasChildren && !isCollapsed ? (
      <CollectionRows
        nodes={node.children}
        depth={depth + 1}
        activeId={activeId}
        renamingId={renamingId}
        collapsed={collapsed}
        draggedId={draggedId}
        dropTarget={dropTarget}
        onToggle={onToggle}
        onCreateChild={onCreateChild}
        onRename={onRename}
        onRenameEnd={onRenameEnd}
        onMove={onMove}
        onDelete={onDelete}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onClickCapture={onClickCapture}
      />
    ) : null;
    return (
      <motion.div
        key={node.id}
        layout="position"
        layoutId={`collection-${node.id}`}
        transition={{ layout: { duration: 0.16, ease: [0.2, 0, 0, 1] } }}
      >
        {isRenaming ? (
          <div style={{ paddingLeft: depth * 12 }}>
            <CreateInput
              key={node.id}
              initial={node.name}
              placeholder="集合名称"
              onConfirm={(name) => {
                void useLibrary.getState().renameCollection(node.id, name);
                onRenameEnd();
              }}
              onCancel={onRenameEnd}
            />
          </div>
        ) : (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <motion.div
                data-collection-id={node.id}
                drag="y"
                dragMomentum={false}
                dragSnapToOrigin
                onDragStart={() => onDragStart(node.id)}
                onDrag={(_, info) => onDragMove(node.id, info.point)}
                onDragEnd={() => onDragEnd(node.id)}
                onClickCapture={onClickCapture}
                whileDrag={{ scale: 1.01 }}
                className={cn(
                  "group/collection-menu relative flex touch-none items-center cursor-grab select-none active:cursor-grabbing",
                  isDragging && "z-20 opacity-60 drop-shadow-sm",
                )}
                style={{ paddingLeft: depth * 12 }}
              >
                {targetZone && targetZone !== "inside" ? (
                  <span
                    className={cn(
                      "pointer-events-none absolute right-1 z-30 h-0.5 rounded-full bg-primary",
                      targetZone === "before" ? "-top-px" : "-bottom-px",
                    )}
                    style={{ left: depth * 12 + 4 }}
                  />
                ) : null}
                <div
                  className={cn(
                    "flex min-w-0 flex-1 items-center rounded-md transition-[background-color,box-shadow] duration-100 group-data-[state=open]/collection-menu:bg-accent",
                    targetZone === "inside" && "bg-accent ring-1 ring-inset ring-primary/35",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <SidebarRow
                      active={activeId === node.id}
                      onClick={() => useLibrary.getState().setView({ kind: "collection", id: node.id })}
                      leading={
                        hasChildren ? (
                          <button
                            type="button"
                            className="-ml-1 -mr-1 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggle(node.id);
                            }}
                            aria-label={isCollapsed ? "展开集合" : "折叠集合"}
                            aria-expanded={!isCollapsed}
                          >
                            {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                          </button>
                        ) : (
                          <span className="-ml-1 -mr-1 size-4 shrink-0" aria-hidden />
                        )
                      }
                      icon={node.effectiveLocked ? (unlocked ? <LockOpen /> : <Lock />) : <Folder />}
                      label={<span title={!node.isLocked && node.effectiveLocked ? "由上级集合锁定" : undefined}>{node.name}</span>}
                    />
                  </div>
                </div>
              </motion.div>
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
              {node.effectiveLocked ? (unlocked ? (
                <ContextMenuItem onSelect={() => void useLibrary.getState().lockNow()}>
                  <Lock className="size-3.5" /> 立即锁定
                </ContextMenuItem>
              ) : (
                <ContextMenuItem onSelect={() => void useLibrary.getState().unlockProtectedContent()}>
                  <LockOpen className="size-3.5" /> 解锁
                </ContextMenuItem>
              )) : null}
              <ContextMenuItem onSelect={() => void useLibrary.getState().setCollectionLocked(node.id, !node.isLocked)}>
                {node.isLocked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
                {node.isLocked ? "取消锁定" : "锁定"}
              </ContextMenuItem>
              {!node.isLocked && node.effectiveLocked ? (
                <ContextMenuItem disabled>由上级集合锁定</ContextMenuItem>
              ) : null}
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={() => onDelete(node)}>删除集合</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
        {childRows}
      </motion.div>
    );
  });
}

function CreateInput({
  placeholder,
  initial = "",
  onConfirm,
  onCancel,
}: {
  placeholder: string;
  initial?: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
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

type RenameTarget = { kind: "collection" | "tag" | "saved"; id: string } | null;

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
  const [draggedCollectionId, setDraggedCollectionId] = useState<string | null>(null);
  const [collectionDropTarget, setCollectionDropTarget] = useState<CollectionDropTarget | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const draggedCollectionIdRef = useRef<string | null>(null);
  const collectionDropTargetRef = useRef<CollectionDropTarget | null>(null);
  const dragExcludedRef = useRef<Set<string>>(new Set());
  const suppressCollectionClickRef = useRef(false);
  useTitlebarDrag(headerRef);

  const beginCreate = (next: { kind: "collection"; parentId: string | null } | { kind: "tag" }) => {
    setRenameTarget(null);
    setCreating(next);
  };
  const beginRename = (target: NonNullable<RenameTarget>) => {
    setCreating(null);
    setRenameTarget(target);
  };

  const themeCycle: ThemePreference[] = ["system", "light", "dark"];
  const ThemeIcon = preference === "light" ? Sun : preference === "dark" ? Moon : Laptop;
  const collectionTree = useMemo(() => buildCollectionTree(collections), [collections]);
  const flatCollections = useMemo(() => flattenCollectionTree(collectionTree), [collectionTree]);
  const collectionsById = useMemo(() => new Map(collections.map((collection) => [collection.id, collection])), [collections]);
  const collectionSiblings = useMemo(() => {
    const result = new Map<string, CollectionTreeNode<Collection>[]>();
    const visit = (nodes: CollectionTreeNode<Collection>[]) => {
      for (const node of nodes) {
        result.set(node.id, nodes);
        visit(node.children);
      }
    };
    visit(collectionTree);
    return result;
  }, [collectionTree]);
  const activeCollectionId = view.kind === "collection" ? view.id : null;
  const moveExcluded = moveTarget ? collectionSubtreeIds(collections, moveTarget.id) : new Set<string>();

  const dropCollection = async (
    draggedId: string,
    target: Collection,
    zone: CollectionDropZone,
    siblings: Collection[],
  ) => {
    if (draggedId === target.id) return;
    let parentId = target.parentId;
    let beforeId: string | null = target.id;
    if (zone === "inside") {
      parentId = target.id;
      beforeId = null;
    } else if (zone === "after") {
      const index = siblings.findIndex((item) => item.id === target.id);
      beforeId = siblings[index + 1]?.id ?? null;
    }
    if (!(await moveCollection(draggedId, parentId, beforeId))) {
      toast.error("无法移动集合");
    } else if (zone === "inside") {
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
    }
  };

  const updateCollectionDropTarget = (next: CollectionDropTarget | null) => {
    collectionDropTargetRef.current = next;
    setCollectionDropTarget((current) =>
      current?.target.id === next?.target.id && current?.zone === next?.zone ? current : next,
    );
  };

  const startCollectionDrag = (draggedId: string) => {
    suppressCollectionClickRef.current = true;
    draggedCollectionIdRef.current = draggedId;
    dragExcludedRef.current = collectionSubtreeIds(collections, draggedId);
    updateCollectionDropTarget(null);
    setDraggedCollectionId(draggedId);
  };

  const moveCollectionDrag = (draggedId: string, point: { x: number; y: number }) => {
    if (draggedCollectionIdRef.current !== draggedId) return;
    let targetElement: HTMLElement | null = null;
    for (const element of document.elementsFromPoint(point.x, point.y)) {
      const candidate = element.closest<HTMLElement>("[data-collection-id]");
      const candidateId = candidate?.dataset.collectionId;
      if (candidateId && !dragExcludedRef.current.has(candidateId)) {
        targetElement = candidate;
        break;
      }
    }

    const targetId = targetElement?.dataset.collectionId;
    const target = targetId ? collectionsById.get(targetId) : undefined;
    const siblings = targetId ? collectionSiblings.get(targetId) : undefined;
    if (!targetElement || !target || !siblings) {
      updateCollectionDropTarget(null);
      return;
    }

    const rect = targetElement.getBoundingClientRect();
    const ratio = (point.y - rect.top) / rect.height;
    const zone: CollectionDropZone = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
    updateCollectionDropTarget({ target, zone, siblings });
  };

  const endCollectionDrag = (draggedId: string) => {
    const dropTarget = collectionDropTargetRef.current;
    draggedCollectionIdRef.current = null;
    updateCollectionDropTarget(null);
    setDraggedCollectionId(null);
    requestAnimationFrame(() => {
      suppressCollectionClickRef.current = false;
    });
    if (dropTarget) {
      void dropCollection(draggedId, dropTarget.target, dropTarget.zone, dropTarget.siblings);
    }
  };

  const suppressCollectionClick = (event: React.MouseEvent) => {
    if (!suppressCollectionClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
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
              {savedViews.map((saved) =>
                renameTarget?.kind === "saved" && renameTarget.id === saved.id ? (
                  <CreateInput
                    key={saved.id}
                    initial={saved.name}
                    placeholder="名称"
                    onConfirm={(name) => {
                      void renameSavedView(saved.id, name);
                      setRenameTarget(null);
                    }}
                    onCancel={() => setRenameTarget(null)}
                  />
                ) : (
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
                      <ContextMenuItem onSelect={() => beginRename({ kind: "saved", id: saved.id })}>
                        重命名
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem variant="destructive" onSelect={() => void deleteSavedView(saved.id)}>
                        删除保存搜索
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ),
              )}
            </div>
          </>
        )}

        {/* Collections */}
        <SectionLabel onAdd={() => beginCreate({ kind: "collection", parentId: null })}>集合</SectionLabel>
        <div className="flex flex-col gap-px">
          <MotionConfig reducedMotion="user">
            <LayoutGroup id="collection-tree">
              <CollectionRows
                nodes={collectionTree}
                activeId={activeCollectionId}
                renamingId={renameTarget?.kind === "collection" ? renameTarget.id : null}
                collapsed={collapsed}
                draggedId={draggedCollectionId}
                dropTarget={collectionDropTarget}
                onToggle={(id) => setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })}
                onCreateChild={(parentId) => {
                  beginCreate({ kind: "collection", parentId });
                  setCollapsed((current) => {
                    const next = new Set(current);
                    next.delete(parentId);
                    return next;
                  });
                }}
                onRename={(collection) => beginRename({ kind: "collection", id: collection.id })}
                onRenameEnd={() => setRenameTarget(null)}
                onMove={setMoveTarget}
                onDelete={setDeleteTarget}
                onDragStart={startCollectionDrag}
                onDragMove={moveCollectionDrag}
                onDragEnd={endCollectionDrag}
                onClickCapture={suppressCollectionClick}
              />
            </LayoutGroup>
          </MotionConfig>
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
        <SectionLabel onAdd={() => beginCreate({ kind: "tag" })}>标签</SectionLabel>
        <div className="flex flex-col gap-px">
          {tags.map((t) =>
            renameTarget?.kind === "tag" && renameTarget.id === t.id ? (
              <CreateInput
                key={t.id}
                initial={t.name}
                placeholder="标签名称"
                onConfirm={(name) => {
                  void renameTag(t.id, name);
                  setRenameTarget(null);
                }}
                onCancel={() => setRenameTarget(null)}
              />
            ) : (
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
                  <ContextMenuItem onSelect={() => beginRename({ kind: "tag", id: t.id })}>
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
            ),
          )}
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
