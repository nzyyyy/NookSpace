import { useRef } from "react";
import { useLibrary } from "@/stores/library";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ItemOperationDialogs() {
  const confirmation = useLibrary((state) => state.destructiveConfirmation);
  const failures = useLibrary((state) => state.batchTagFailures);
  const detailsOpen = useLibrary((state) => state.batchTagDetailsOpen);
  const cancel = useRef<HTMLButtonElement>(null);
  const answer = (confirmed: boolean) => {
    confirmation?.resolve(confirmed);
    useLibrary.setState({ destructiveConfirmation: null });
  };

  return <>
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
