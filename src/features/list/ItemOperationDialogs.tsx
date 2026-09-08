import { useEffect, useRef, useState } from "react";
import { useLibrary } from "@/stores/library";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

export function ItemOperationDialogs() {
  const importConfirmation = useLibrary((state) => state.importConfirmation);
  const confirmation = useLibrary((state) => state.destructiveConfirmation);
  const failures = useLibrary((state) => state.batchTagFailures);
  const detailsOpen = useLibrary((state) => state.batchTagDetailsOpen);
  const cancel = useRef<HTMLButtonElement>(null);
  const importCancel = useRef<HTMLButtonElement>(null);
  const [linkSource, setLinkSource] = useState(false);
  useEffect(() => setLinkSource(false), [importConfirmation]);
  const answerImport = (answer: boolean | null) => {
    importConfirmation?.resolve(answer);
    useLibrary.setState({ importConfirmation: null });
  };
  const answer = (confirmed: boolean) => {
    confirmation?.resolve(confirmed);
    useLibrary.setState({ destructiveConfirmation: null });
  };

  return <>
    <Dialog open={importConfirmation !== null} onOpenChange={(open) => { if (!open) answerImport(null); }}>
      <DialogContent onOpenAutoFocus={(event) => { event.preventDefault(); importCancel.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle>确认导入 {importConfirmation?.paths.length ?? 0} 项</DialogTitle>
          <DialogDescription>确认以下文件或文件夹。文件夹中的内容会递归导入。</DialogDescription>
        </DialogHeader>
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-[12px]">
          {importConfirmation?.paths.map((path) => (
            <li key={path} className="truncate rounded px-2 py-1.5 font-mono text-muted-foreground" title={path}>
              {path.split(/[\\/]/).filter(Boolean).pop() ?? path}
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">链接源文件</p>
            <p className="text-[11.5px] text-muted-foreground">保留库内安全副本，并与原文件实时同步</p>
          </div>
          <Switch
            className="shrink-0"
            checked={linkSource}
            onCheckedChange={setLinkSource}
            aria-label="链接源文件"
          />
        </div>
        <DialogFooter>
          <Button ref={importCancel} variant="outline" onClick={() => answerImport(null)}>取消</Button>
          <Button onClick={() => answerImport(linkSource)}>确认导入</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={confirmation !== null} onOpenChange={(open) => { if (!open) answer(false); }}>
      <DialogContent onOpenAutoFocus={(event) => { event.preventDefault(); cancel.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle>{confirmation?.emptyTrash ? "清空回收站" : "永久删除文件"}</DialogTitle>
          <DialogDescription>
            将永久删除{confirmation?.emptyTrash ? "回收站中的全部" : "所选的"} {confirmation?.count} 项及其库内文件。此操作无法撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button ref={cancel} variant="outline" onClick={() => answer(false)}>取消</Button>
          <Button variant="destructive" onClick={() => answer(true)}>永久删除 {confirmation?.count} 项</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={detailsOpen} onOpenChange={(open) => useLibrary.setState({ batchTagDetailsOpen: open })}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>标签更新失败明细</DialogTitle>
          <DialogDescription>{failures.length} 项未能完成更新，请查看原因后重试。</DialogDescription>
        </DialogHeader>
        <ul className="max-h-80 space-y-3 overflow-y-auto text-sm">
          {failures.map((failure) => <li key={failure.id}>
            <p className="break-all font-medium">{failure.title}</p>
            <p className="break-words text-muted-foreground">{failure.reason}</p>
          </li>)}
        </ul>
        <DialogFooter><Button onClick={() => useLibrary.setState({ batchTagDetailsOpen: false })}>关闭</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
