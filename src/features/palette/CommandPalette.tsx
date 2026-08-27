import { useEffect, useRef, useState } from "react";
import {
  Clock,
  FileText,
  Folder,
  Inbox,
  Link2,
  LayoutGrid,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Star,
  Upload,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ipc, type ItemSummary } from "@/core/ipc";
import { useLibrary } from "@/stores/library";
import { useUi } from "@/stores/ui";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { collectionPath } from "@/lib/collections";
import { canonicalFormat, displayStem, fileExtension } from "@/lib/file-types";
import { tagDotClass } from "@/lib/tag-colors";
import { cn } from "@/lib/utils";

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, listLayout, setListLayout, listCollapsed, toggleListCollapsed } = useUi();
  const lib = useLibrary();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ItemSummary[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Reset state each time the palette opens.
  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setResults([]);
    }
  }, [paletteOpen]);

  // Global search while typing (debounced).
  useEffect(() => {
    if (!paletteOpen) return;
    let active = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      void ipc
        .listItems({ view: "all", query: query.trim(), sort: "updated", limit: 20 })
        .then((result) => active && setResults(result.entries.map((entry) => entry.item)))
        .catch(() => active && setResults([]));
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer.current);
    };
  }, [query, paletteOpen]);

  const close = () => setPaletteOpen(false);

  const newNote = () => {
    void lib.createNote().then((item) => {
      if (item) toast.success("已新建笔记");
    });
    close();
  };

  const importFiles = async () => {
    const picked = await openDialog({
      multiple: true,
      directory: false,
      title: "导入文件",
    });
    if (picked && picked.length > 0) {
      const result = await lib.importPaths(picked);
      if (result) {
        toast.success(`已导入 ${result.imported.length} 个文件${result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ""}`);
      }
    }
    close();
  };

  const go = (view: Parameters<typeof lib.setView>[0]) => {
    lib.setView(view);
    close();
  };

  const openItem = (id: string) => {
    void lib.openItem(id);
    close();
  };

  return (
    <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogContent className="top-[12%] gap-0 overflow-hidden p-0 sm:max-w-xl">
        <Command shouldFilter={false} className="rounded-lg">
          <CommandInput
            placeholder="搜索条目，或输入命令…"
            value={query}
            onValueChange={setQuery}
            autoFocus
            className="h-11 text-[14px]"
          />
          <CommandList>
            <CommandEmpty>没有匹配的结果</CommandEmpty>

            {results.length > 0 && (
              <CommandGroup heading="条目">
                {results.map((item) => (
                  <CommandItem key={item.id} value={item.title} onSelect={() => openItem(item.id)}>
                    {item.effectiveLocked && !lib.lockSession.unlocked ? (
                      <Lock className="size-3.5 text-muted-foreground" />
                    ) : item.itemType === "link" ? (
                      <Link2 className="size-3.5 text-muted-foreground" />
                    ) : canonicalFormat(fileExtension(item.storedPath || item.title)) === "md" ? (
                      <FileText className="size-3.5 text-muted-foreground" />
                    ) : (
                      <Folder className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{displayStem(item.title, item.storedPath) || "无标题"}</span>
                    <span className="font-mono text-[10.5px] text-muted-foreground">
                      {item.itemType === "link" ? "链接" : fileExtension(item.storedPath || item.title).toUpperCase() || "文件"}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandGroup heading="操作">
              <CommandItem onSelect={newNote}>
                <Plus className="size-3.5" /> 新建笔记
                <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">⌘N</kbd>
              </CommandItem>
              <CommandItem onSelect={() => void importFiles()}>
                <Upload className="size-3.5" /> 导入文件…
                <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">⇧⌘N</kbd>
              </CommandItem>
              <CommandItem onSelect={() => {
                setListLayout(listLayout === "list" ? "grid" : "list");
                close();
              }}>
                <LayoutGrid className="size-3.5" /> 切换为{listLayout === "list" ? "网格" : "列表"}视图
              </CommandItem>
              <CommandItem onSelect={() => {
                toggleListCollapsed();
                close();
              }}>
                {listCollapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
                {listCollapsed ? "显示列表" : "隐藏列表"}
                <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">⌘\</kbd>
              </CommandItem>
              {lib.lockSession.unlocked ? (
                <CommandItem onSelect={() => {
                  void lib.lockNow();
                  close();
                }}>
                  <Lock className="size-3.5" /> 立即锁定
                </CommandItem>
              ) : null}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="跳转">
              <CommandItem onSelect={() => go({ kind: "all" })}>
                <Search className="size-3.5" /> 全部
              </CommandItem>
              <CommandItem onSelect={() => go({ kind: "favorites" })}>
                <Star className="size-3.5" /> 收藏
              </CommandItem>
              <CommandItem onSelect={() => go({ kind: "recent" })}>
                <Clock className="size-3.5" /> 最近
              </CommandItem>
              <CommandItem onSelect={() => go({ kind: "uncollected" })}>
                <Inbox className="size-3.5" /> 未分类
              </CommandItem>
              {lib.collections.map((c) => (
                <CommandItem key={c.id} onSelect={() => go({ kind: "collection", id: c.id })}>
                  {c.effectiveLocked ? <Lock className="size-3.5" /> : <Folder className="size-3.5" />} {collectionPath(lib.collections, c.id).map((item) => item.name).join(" / ")}
                </CommandItem>
              ))}
              {lib.tags.map((t) => (
                <CommandItem key={t.id} onSelect={() => go({ kind: "tag", id: t.id })}>
                  <span className={cn("size-2.5 rounded-full", tagDotClass(t.color))} /> {t.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
