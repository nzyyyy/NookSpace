import { motion } from "motion/react";
import { FilePlus2, FolderOpen, Plus } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useLibrary, type View } from "@/stores/library";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function copyFor(view: View): { title: string; subtitle: string } {
  switch (view.kind) {
    case "favorites":
      return { title: "还没有收藏任何内容。", subtitle: "点亮任意条目的星标，它就会出现在这里" };
    case "recent":
      return { title: "最近使用过的东西会出现在这里。", subtitle: "打开或预览条目时自动记录" };
    case "uncollected":
      return { title: "所有内容都已归入集合。", subtitle: "未归入任何集合的条目会出现在这里" };
    case "collection":
      return { title: "这个集合还是空的。", subtitle: "往里面放点笔记和文件吧" };
    case "tag":
      return { title: "这个标签下还没有内容。", subtitle: "给条目打上这个标签就会出现在这里" };
    default:
      return {
        title: "一个安静的地方，存放你的一切。",
        subtitle: "笔记 · 文件 · 链接 —— 全部保存在本机",
      };
  }
}

export function EmptyState({ view }: { view: View }) {
  const { createNote, importPaths } = useLibrary();
  const { title, subtitle } = copyFor(view);

  const importFiles = async () => {
    const picked = await openDialog({
      multiple: true,
      directory: false,
      title: "导入文件",
    });
    if (picked && picked.length > 0) {
      const result = await importPaths(picked);
      if (result) {
        toast.success(
          `已导入 ${result.imported.length} 个文件${result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ""}`,
        );
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex min-h-full flex-col items-center justify-center gap-8 px-10 py-16"
    >
      <div className="text-center">
        <p className="font-display text-[26px] font-medium tracking-tight text-foreground/90 italic">
          {title}
        </p>
        <p className="mt-2 font-mono text-[12px] tracking-wide text-muted-foreground">
          {subtitle}
        </p>
      </div>

      <div className="flex gap-3">
        <Button
          onClick={() => {
            void createNote().then((item) => item && toast.success("已新建笔记"));
          }}
        >
          <Plus className="size-4" /> 新建笔记
        </Button>
        <Button variant="outline" onClick={() => void importFiles()}>
          <FolderOpen className="size-4" /> 导入文件
        </Button>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-2.5">
        <FilePlus2 className="size-4 text-muted-foreground" />
        <span className="text-[12.5px] text-muted-foreground">
          也可以直接把文件拖进来 —— 它们会被复制进资料库，原件不受影响
        </span>
      </div>
    </motion.div>
  );
}
