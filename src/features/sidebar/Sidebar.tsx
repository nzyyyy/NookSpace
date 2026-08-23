import { useRef, useState } from "react";
import {
  Check,
  Clock,
  Folder,
  FolderPlus,
  Inbox,
  Laptop,
  Moon,
  Plus,
  Settings,
  Star,
  Sun,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
      {icon && <span className="text-muted-foreground [&_svg]:size-3.5">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </div>
  );
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
  | null;

export function Sidebar() {
  const {
    collections,
    tags,
    view,
    setView,
    createCollection,
    deleteCollection,
    renameCollection,
    createTag,
    deleteTag,
    renameTag,
  } = useLibrary();
  const { preference, setPreference } = useTheme();
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const [creating, setCreating] = useState<"collection" | "tag" | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  useTitlebarDrag(headerRef);

  const themeCycle: ThemePreference[] = ["system", "light", "dark"];
  const ThemeIcon = preference === "light" ? Sun : preference === "dark" ? Moon : Laptop;

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

        {/* Collections */}
        <SectionLabel onAdd={() => setCreating("collection")}>集合</SectionLabel>
        <div className="flex flex-col gap-px">
          {collections.map((c) => (
            <ContextMenu key={c.id}>
              <ContextMenuTrigger asChild>
                <div>
                  <SidebarRow
                    active={view.kind === "collection" && view.id === c.id}
                    onClick={() => setView({ kind: "collection", id: c.id })}
                    icon={<Folder />}
                    label={c.name}
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-40">
                <ContextMenuItem onSelect={() => setRenameTarget({ kind: "collection", id: c.id, name: c.name })}>
                  重命名
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() => void deleteCollection(c.id)}
                >
                  删除集合
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
          {creating === "collection" && (
            <CreateInput
              placeholder="集合名称"
              onConfirm={(name) => {
                void createCollection(name);
                setCreating(null);
              }}
              onCancel={() => setCreating(null)}
            />
          )}
          {collections.length === 0 && creating !== "collection" && (
            <div className="px-2 py-1 text-[12px] text-muted-foreground">
              <FolderPlus className="mr-1 inline size-3" />
              还没有集合
            </div>
          )}
        </div>

        {/* Tags */}
        <SectionLabel onAdd={() => setCreating("tag")}>标签</SectionLabel>
        <div className="flex flex-col gap-px">
          {tags.map((t) => (
            <ContextMenu key={t.id}>
              <ContextMenuTrigger asChild>
                <div>
                  <SidebarRow
                    active={view.kind === "tag" && view.id === t.id}
                    onClick={() => setView({ kind: "tag", id: t.id })}
                    icon={<TagIcon />}
                    label={t.name}
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-40">
                <ContextMenuItem onSelect={() => setRenameTarget({ kind: "tag", id: t.id, name: t.name })}>
                  重命名
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onSelect={() => void deleteTag(t.id)}>
                  删除标签
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
          {creating === "tag" && (
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
        title={renameTarget?.kind === "collection" ? "重命名集合" : "重命名标签"}
        initial={renameTarget?.name ?? ""}
        onClose={() => setRenameTarget(null)}
        onSubmit={(name) => {
          if (!renameTarget) return;
          if (renameTarget.kind === "collection") void renameCollection(renameTarget.id, name);
          else void renameTag(renameTarget.id, name);
        }}
      />
    </aside>
  );
}
