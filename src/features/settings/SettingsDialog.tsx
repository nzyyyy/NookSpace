import { Laptop, Moon, Sun } from "lucide-react";
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

const OPTIONS = [
  { value: "system", label: "跟随系统", icon: Laptop },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
] as const;

export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen } = useUi();
  const { preference, setPreference } = useTheme();
  const info = useLibrary((s) => s.info);

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

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-muted-foreground">资料库</span>
            <p className="font-mono text-[11.5px] leading-relaxed break-all text-foreground/80">
              {info?.root ?? "…"}
            </p>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              所有笔记与文件都保存在本机这个目录里，不会上传到任何服务器。
              Time Machine 会默认备份它。
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
