import { useMemo } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { buildCollectionTree, flattenCollectionTree } from "@/lib/collections";
import { useLibrary } from "@/stores/library";
import { cn } from "@/lib/utils";

export function CollectionPicker({ itemIds }: { itemIds: string[] }) {
  const collections = useLibrary((state) => state.collections);
  const items = useLibrary((state) => state.items);
  const detail = useLibrary((state) => state.detail);
  const addToCollection = useLibrary((state) => state.addToCollection);
  const removeFromCollection = useLibrary((state) => state.removeFromCollection);

  const rows = useMemo(
    () => flattenCollectionTree(buildCollectionTree(collections)),
    [collections],
  );

  const assigned = (collectionId: string) =>
    itemIds.length > 0
    && itemIds.every((id) => {
      const ids = detail?.item.id === id
        ? detail.item.collections
        : items.find((item) => item.id === id)?.collections;
      return ids?.includes(collectionId) ?? false;
    });

  const toggle = async (collectionId: string) => {
    const ok = assigned(collectionId)
      ? await removeFromCollection(itemIds, collectionId)
      : await addToCollection(itemIds, collectionId);
    if (!ok) toast.error("无法更新集合");
  };

  if (rows.length === 0) {
    return <p className="px-1.5 py-2 text-[12.5px] text-muted-foreground">还没有集合，请在侧栏新建</p>;
  }

  return (
    <div className="flex max-h-48 flex-col gap-px overflow-y-auto">
      {rows.map(({ collection, depth }) => {
        const on = assigned(collection.id);
        return (
          <button
            key={collection.id}
            type="button"
            className="flex h-6 items-center gap-1 rounded py-0 pr-1.5 text-left text-[12.5px] whitespace-nowrap hover:bg-accent"
            style={{ paddingLeft: 6 + depth * 12 }}
            aria-pressed={on}
            onClick={() => void toggle(collection.id)}
          >
            <Check className={cn("size-3 shrink-0", on ? "opacity-100" : "opacity-0")} />
            <span className="min-w-0 truncate">{collection.name}</span>
          </button>
        );
      })}
    </div>
  );
}
