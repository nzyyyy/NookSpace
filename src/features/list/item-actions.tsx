import type { ReactNode } from "react";
import { Download, ExternalLink, Image as ImageIcon, Lock, LockOpen, Shield, ShieldOff, Trash2, Undo2 } from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ipc, type Item, type ItemSummary } from "@/core/ipc";
import { displayStem, fileExtension, isMediaFile } from "@/lib/file-types";
import { useLibrary } from "@/stores/library";
import { toast } from "sonner";

export type ItemAction =
  | { kind: "separator"; key: string }
  | {
      kind: "item";
      key: string;
      label: string;
      icon?: ReactNode;
      disabled?: boolean;
      destructive?: boolean;
      run?: () => void | Promise<unknown>;
    };

async function exportItem(item: Item | ItemSummary) {
  try {
    const waits: Promise<void>[] = [];
    window.dispatchEvent(new CustomEvent("nookspace:flush-edits", { detail: waits }));
    await Promise.all(waits);

    const stem = displayStem(item.title, item.storedPath)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/[. ]+$/g, "")
      .trim();
    const ext = fileExtension(item.storedPath || item.title);
    const destination = await saveDialog({
      title: "导出文件",
      defaultPath: ext ? `${stem || "无标题"}.${ext}` : item.title,
    });
    if (!destination) return;

    const exported = await ipc.exportItem(item.id, destination);
    toast.success(`已导出：${exported}`);
  } catch (error) {
    toast.error(`导出失败：${String(error)}`);
  }
}

export function useItemActions(item: Item | ItemSummary): ItemAction[] {
  const unlocked = useLibrary((state) => state.lockSession.unlocked);
  const protectedLocked = item.effectiveLocked && !unlocked;
  const actions: ItemAction[] = [];
  const addSeparator = () => actions.push({ kind: "separator", key: `separator-${actions.length}` });
  const add = (action: Omit<Extract<ItemAction, { kind: "item" }>, "kind">) =>
    actions.push({ kind: "item", ...action });

  if (protectedLocked) {
    add({
      key: "unlock",
      label: "解锁",
      icon: <LockOpen className="size-3.5" />,
      run: () => useLibrary.getState().unlockProtectedContent(),
    });
    addSeparator();
  } else if (item.effectiveLocked) {
    add({
      key: "lock-now",
      label: "立即锁定",
      icon: <Lock className="size-3.5" />,
      run: () => useLibrary.getState().lockNow(),
    });
    addSeparator();
  }

  if (item.itemType === "file") {
    add({
      key: "open",
      label: "用默认应用打开",
      icon: <ExternalLink className="size-3.5" />,
      disabled: protectedLocked,
      run: () => ipc.openWithDefault(item.id),
    });
    if (!isMediaFile(item.mime, item.storedPath || item.title)) {
      add({
        key: "quicklook",
        label: "系统快速查看",
        icon: <ImageIcon className="size-3.5" />,
        disabled: protectedLocked,
        run: () => ipc.quicklook(item.id),
      });
    }
    addSeparator();
  } else if (item.itemType === "link") {
    add({
      key: "browser",
      label: "在浏览器中打开",
      icon: <ExternalLink className="size-3.5" />,
      disabled: protectedLocked,
      run: () => openUrl(item.url),
    });
    addSeparator();
  }

  if (item.itemType !== "link") {
    add({
      key: "export",
      label: "导出…",
      icon: <Download className="size-3.5" />,
      disabled: protectedLocked,
      run: () => exportItem(item),
    });
    addSeparator();
  }

  if (item.itemType === "file" && !item.deletedAt) {
    add({
      key: "privacy",
      label: item.isPrivate ? "移出保险箱" : "移入保险箱",
      icon: item.isPrivate ? <ShieldOff className="size-3.5" /> : <Shield className="size-3.5" />,
      disabled: protectedLocked,
      run: async () => {
        const changed = await useLibrary.getState().setItemsPrivate([item.id], !item.isPrivate);
        if (changed) toast.success(item.isPrivate ? "已移出保险箱" : "已移入保险箱");
        else toast.error(item.isPrivate ? "移出保险箱失败" : "移入保险箱失败");
      },
    });
  }
  if (!item.deletedAt && !item.isPrivate) {
    if (item.collectionLocked) {
      add({ key: "collection-lock", label: "由所属集合锁定", disabled: true });
    } else {
      add({
        key: "lock",
        label: item.isLocked ? "取消锁定" : "锁定",
        icon: item.isLocked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />,
        disabled: protectedLocked,
        run: () => useLibrary.getState().setItemsLocked([item.id], !item.isLocked),
      });
    }
  }
  addSeparator();
  if (item.deletedAt) {
    add({
      key: "restore",
      label: "放回原处",
      icon: <Undo2 className="size-3.5" />,
      run: () => {
        void useLibrary.getState().restoreItems([item.id]);
        toast.success("已恢复");
      },
    });
    add({
      key: "purge",
      label: "永久删除",
      icon: <Trash2 className="size-3.5" />,
      destructive: true,
      run: () => {
        void useLibrary.getState().purgeItems([item.id]);
        toast.success("已永久删除");
      },
    });
  } else {
    add({
      key: "delete",
      label: "移到回收站",
      icon: <Trash2 className="size-3.5" />,
      disabled: protectedLocked,
      destructive: true,
      run: () => {
        void useLibrary.getState().deleteItems([item.id]);
        toast.info("已移至回收站");
      },
    });
  }

  return actions;
}
