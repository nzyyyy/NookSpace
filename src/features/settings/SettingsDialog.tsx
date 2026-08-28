import { useState } from "react";
import { Archive, Database, FolderInput, FolderOutput, Laptop, Moon, RefreshCw, Sun } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ipc } from "@/core/ipc";
import { useLibrary } from "@/stores/library";
import { useTheme } from "@/stores/theme";
import { useUi } from "@/stores/ui";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getUnlockMinutes,
  isValidUnlockMinutes,
  MAX_UNLOCK_MINUTES,
  MIN_UNLOCK_MINUTES,
  setUnlockMinutes,
} from "@/lib/unlock-duration";

const OPTIONS = [
  { value: "system", label: "跟随系统", icon: Laptop },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
] as const;

export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen } = useUi();
  const { preference, setPreference } = useTheme();
  const info = useLibrary((s) => s.info);
  const searchIndex = useLibrary((s) => s.searchIndex);
  const retryPdfIndex = useLibrary((s) => s.retryPdfIndex);
  const [busy, setBusy] = useState<string | null>(null);
  const [unlockMinutes, setUnlockMinutesInput] = useState(() => String(getUnlockMinutes()));

  const flushEdits = async () => {
    const waits: Promise<void>[] = [];
    window.dispatchEvent(new CustomEvent("nookspace:flush-edits", { detail: waits }));
    await Promise.all(waits);
  };

  const pickDirectory = (title: string) => openDialog({ directory: true, multiple: false, title });

  const run = async (label: string, action: (path: string) => Promise<string>, restart = false) => {
    const path = await pickDirectory(label);
    if (!path) return;
    setBusy(label);
    try {
      await flushEdits();
      const result = await action(path);
      toast.success(`${label}完成：${result}`);
      if (restart) await ipc.restartApp();
    } catch (error) {
      toast.error(`${label}失败：${String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-medium">设置</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-1">
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-muted-foreground">外观</span>
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setPreference(value)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] transition-colors",
                    preference === value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium text-muted-foreground">解锁时长</p>
              <p className="text-[11.5px] text-muted-foreground">下次解锁时生效</p>
            </div>
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <input
                type="number"
                min={MIN_UNLOCK_MINUTES}
                max={MAX_UNLOCK_MINUTES}
                step={1}
                value={unlockMinutes}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  const minutes = Number(value);
                  setUnlockMinutesInput(value);
                  if (value.trim() && isValidUnlockMinutes(minutes)) setUnlockMinutes(minutes);
                }}
                onBlur={() => setUnlockMinutesInput(String(getUnlockMinutes()))}
                className="h-8 w-20 rounded-md border border-input bg-transparent px-2 text-right text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="解锁时长（分钟）"
              />
              分钟
            </label>
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-muted-foreground">资料库</span>
            <p className="font-mono text-[11.5px] leading-relaxed break-all text-foreground/80">
              {info?.root ?? "…"}
            </p>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              所有笔记与文件都保存在本机这个目录里，不会上传到任何服务器。
              Time Machine 会默认备份它。
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void run("备份资料库", ipc.backupLibrary)}>
                <Archive className="size-3.5" /> 立即备份
              </Button>
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void run("完整导出", ipc.exportLibrary)}>
                <FolderOutput className="size-3.5" /> 完整导出
              </Button>
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => {
                if (window.confirm("移动完成后将重启应用，旧资料库会保留。继续吗？")) void run("移动资料库", ipc.moveLibrary, true);
              }}>
                <FolderInput className="size-3.5" /> 移动资料库
              </Button>
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => {
                if (window.confirm("将切换到所选资料库并重启应用，当前资料库不会被覆盖。继续吗？")) void run("使用已有资料库", ipc.useExistingLibrary, true);
              }}>
                <Database className="size-3.5" /> 使用已有备份
              </Button>
            </div>
            {busy && <p className="font-mono text-[11px] text-muted-foreground">{busy}中，请勿关闭应用…</p>}
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium text-muted-foreground">PDF 搜索索引</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                待处理 {searchIndex?.pending ?? 0} · 失败 {searchIndex?.failed ?? 0}
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => {
              setBusy("重建 PDF 索引");
              void retryPdfIndex().then((result) => {
                if (result) toast.success(`已索引 ${result.indexed} 个，失败 ${result.failed} 个`);
              }).finally(() => setBusy(null));
            }}>
              <RefreshCw className="size-3.5" /> 重试
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
