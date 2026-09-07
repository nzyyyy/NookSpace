import { create } from "zustand";
import {
  type Collection,
  type ImportResult,
  type IndexResult,
  ipc,
  type Item,
  type ItemDetail,
  type ItemSummary,
  type LibraryInfo,
  type LockSession,
  type SavedView,
  type SearchIndexStatus,
  type Tag,
  type TagColor,
} from "@/core/ipc";
import { collectionSubtreeIds } from "@/lib/collections";
import { isLargeTextFile, isSwitchableText } from "@/lib/file-types";
import { toast } from "sonner";
import { getUnlockMinutes } from "@/lib/unlock-duration";

export type View =
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "privacy" }
  | { kind: "recent" }
  | { kind: "uncollected" }
  | { kind: "trash" }
  | { kind: "collection"; id: string }
  | { kind: "tag"; id: string }
  | { kind: "saved"; id: string };

export type SortKey = "updated" | "created" | "title" | "type";
export type NoteMode = "read" | "edit";

const EMPTY_DETAIL: ItemDetail = {
  item: {
    id: "",
    itemType: "file",
    title: "",
    content: "",
    url: "",
    storedPath: "",
    size: 0,
    mime: "",
    createdAt: "",
    updatedAt: "",
    lastOpenedAt: "",
    isFavorite: false,
    deletedAt: null,
    isLocked: false,
    isPrivate: false,
    collectionLocked: false,
    effectiveLocked: false,
    tags: [],
    collections: [],
  },
  attachments: [],
};

const summaryOf = (item: Item): ItemSummary => ({
  id: item.id,
  itemType: item.itemType,
  title: item.title,
  contentPreview: item.content.slice(0, 240),
  url: item.url,
  storedPath: item.storedPath,
  size: item.size,
  mime: item.mime,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  lastOpenedAt: item.lastOpenedAt,
  isFavorite: item.isFavorite,
  deletedAt: item.deletedAt,
  isLocked: item.isLocked,
  isPrivate: item.isPrivate,
  collectionLocked: item.collectionLocked,
  effectiveLocked: item.effectiveLocked,
  tags: item.tags,
  collections: item.collections,
});

interface LibraryState {
  ready: boolean;
  loading: boolean;
  info: LibraryInfo | null;
  items: ItemSummary[];
  collections: Collection[];
  tags: Tag[];
  savedViews: SavedView[];
  searchIndex: SearchIndexStatus | null;
  snippets: Record<string, { text: string; terms: string[] }>;
  listTruncated: boolean;
  view: View;
  query: string;
  sort: SortKey;
  selectedId: string | null;
  multiIds: string[];
  multiAnchor: string | null;
  detail: ItemDetail | null;
  detailLoading: boolean;
  noteMode: NoteMode;
  lockSession: LockSession;

  operationBusy: boolean;
  destructiveConfirmation: { count: number; emptyTrash: boolean; resolve: (confirmed: boolean) => void } | null;
  batchTagFailures: { id: string; title: string; reason: string }[];
  batchTagDetailsOpen: boolean;
  updateBatchTags: (ids: string[], tagId: string, mode: "add" | "remove") => Promise<boolean>;
  init: () => Promise<void>;
  refresh: (strict?: boolean) => Promise<void>;
  refreshMeta: () => Promise<void>;
  setView: (view: View, options?: { preserveQuery?: boolean }) => void;
  setQuery: (q: string) => void;
  setSort: (s: SortKey) => void;
  select: (id: string | null) => Promise<void>;
  toggleMulti: (id: string, additive: boolean, range: boolean) => Promise<void>;
  clearMulti: () => void;
  openItem: (id: string) => Promise<void>;
  setNoteMode: (mode: NoteMode) => void;
  syncLockSession: () => Promise<void>;
  unlockProtectedContent: () => Promise<boolean>;
  lockNow: () => Promise<void>;
  setItemsLocked: (ids: string[], locked: boolean) => Promise<boolean>;
  setItemsPrivate: (ids: string[], privateItem: boolean) => Promise<boolean>;
  setCollectionLocked: (id: string, locked: boolean) => Promise<boolean>;

  createNote: () => Promise<Item | null>;
  renameFile: (id: string, stem: string, format?: string | null) => Promise<Item | null>;
  createLink: (url: string, title: string) => Promise<Item | null>;
  createCollection: (name: string, parentId?: string | null) => Promise<Collection | null>;
  renameCollection: (id: string, name: string) => Promise<void>;
  moveCollection: (id: string, parentId: string | null, beforeId: string | null) => Promise<boolean>;
  deleteCollectionTree: (id: string) => Promise<number>;
  addToCollection: (ids: string[], collectionId: string) => Promise<boolean>;
  removeFromCollection: (ids: string[], collectionId: string) => Promise<boolean>;
  createTag: (name: string) => Promise<Tag | null>;
  renameTag: (id: string, name: string) => Promise<void>;
  setTagColor: (id: string, color: TagColor | null) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
  createSavedView: (name: string) => Promise<SavedView | null>;
  renameSavedView: (id: string, name: string) => Promise<void>;
  deleteSavedView: (id: string) => Promise<void>;
  retryPdfIndex: () => Promise<IndexResult | null>;
  setItemTags: (itemId: string, tagIds: string[]) => Promise<boolean>;
  toggleFavorite: (id: string) => Promise<void>;
  deleteItems: (ids: string[]) => Promise<boolean>;
  restoreItems: (ids: string[]) => Promise<boolean>;
  purgeItems: (ids: string[]) => Promise<boolean>;
  emptyTrash: () => Promise<boolean>;
  importPaths: (paths: string[]) => Promise<ImportResult | null>;
  addAttachments: (parentId: string, childIds: string[]) => Promise<ItemDetail | null>;
  removeAttachment: (parentId: string, childId: string) => Promise<ItemDetail | null>;
  applyDetail: (detail: ItemDetail) => void;
  upsertItem: (item: Item) => void;
}

let queryTimer: ReturnType<typeof setTimeout> | undefined;
let refreshRequest = 0;
let detailRequest = 0;
let lockTimer: ReturnType<typeof setTimeout> | undefined;
let visibilityListenerInstalled = false;

const flushEdits = async () => {
  const waits: Promise<void>[] = [];
  window.dispatchEvent(new CustomEvent("nookspace:flush-edits", { detail: waits }));
  await Promise.all(waits);
};

export const useLibrary = create<LibraryState>((set, get) => {
  const currentCollectionId = (view: View): string | null =>
    view.kind === "collection" ? view.id : null;

  const filters = () => {
    const { view, query, sort, savedViews } = get();
    const saved = view.kind === "saved" ? savedViews.find((item) => item.id === view.id) : null;
    const effectiveView = saved?.view ?? view.kind;
    const base = {
      view: effectiveView === "collection" || effectiveView === "tag" || effectiveView === "saved"
        ? "all"
        : effectiveView,
      sort,
      query: query || null,
    };
    return {
      ...base,
      collectionId: saved?.collectionId ?? (view.kind === "collection" ? view.id : null),
      tagId: saved?.tagId ?? (view.kind === "tag" ? view.id : null),
    };
  };

  const applyLockSession = (lockSession: LockSession) => {
    clearTimeout(lockTimer);
    const expired = get().lockSession.unlocked && !lockSession.unlocked;
    if (expired) detailRequest++;
    set(expired
      ? {
          lockSession,
          detail: null,
          detailLoading: false,
          noteMode: "read",
          snippets: {},
        }
      : { lockSession });
    if (lockSession.unlocked && lockSession.remainingMs > 0) {
      lockTimer = setTimeout(() => void get().syncLockSession(), lockSession.remainingMs + 50);
    }
  };

  const itemRequiresUnlock = (id: string) => {
    const item = get().items.find((candidate) => candidate.id === id);
    return Boolean(item?.effectiveLocked && !get().lockSession.unlocked);
  };

  const canApplyDetail = (request: number, id: string) =>
    request === detailRequest && get().selectedId === id && !itemRequiresUnlock(id);

  const refreshAfterOperation = async (message = "操作已成功，但列表刷新失败") => {
    try {
      await get().refresh(true);
    } catch (error) {
      toast.warning(`${message}：${String(error)}`, {
        action: { label: "重试刷新", onClick: () => { void refreshAfterOperation(message); } },
      });
    }
  };

  const runTrashOperation = async (kind: "delete" | "restore" | "purge" | "empty", requestedIds: string[] = []) => {
    if (get().operationBusy) return false;
    const ids = [...new Set(requestedIds)];
    if (kind !== "empty" && !ids.length) return false;
    const label = { delete: "删除", restore: "恢复", purge: "永久删除", empty: "清空回收站" }[kind];
    set({ operationBusy: true });
    try {
      const count = kind === "empty" ? await ipc.trashCount() : ids.length;
      if (!count) { toast.info("回收站是空的"); return false; }
      if (kind === "purge" || kind === "empty") {
        const confirmed = await new Promise<boolean>((resolve) => set({
          destructiveConfirmation: { count, emptyTrash: kind === "empty", resolve },
        }));
        set({ destructiveConfirmation: null });
        if (!confirmed) return false;
      }
      if (kind === "delete") await flushEdits();
      let affected = ids;
      if (kind === "delete") affected = await ipc.deleteItems(ids);
      else if (kind === "restore") await ipc.restoreItems(ids);
      else if (kind === "purge") await ipc.purgeItems(ids);
      else await ipc.emptyTrash(count);

      const { selectedId, detail, multiIds } = get();
      const clearsDetail = kind !== "restore" && (kind === "empty"
        ? Boolean(detail?.item.deletedAt)
        : selectedId !== null && affected.includes(selectedId));
      set({
        ...(clearsDetail ? { selectedId: null, detail: null, detailLoading: false } : {}),
        multiIds: kind === "empty" ? multiIds.filter((id) => !get().items.find((item) => item.id === id)?.deletedAt)
          : multiIds.filter((id) => !affected.includes(id)),
      });
      await refreshAfterOperation();
      if (kind === "delete" && affected.length) {
        const deletedIds = [...affected];
        toast.success(`已移至回收站 ${affected.length} 项`, {
          duration: 10000,
          action: { label: "撤销", onClick: () => {
            if (get().operationBusy) {
              toast.info("请等待当前操作完成，可在回收站恢复文件");
              return;
            }
            void get().restoreItems(deletedIds);
          } },
        });
      } else if (kind === "delete") toast.info("文件已被删除或不存在，未删除任何文件");
      else toast.success(kind === "empty" ? `已清空回收站 ${count} 项` : `已${label} ${count} 项`);
      return true;
    } catch (error) {
      toast.error(`${label}失败：${String(error)}`);
      return false;
    } finally {
      set({ operationBusy: false, destructiveConfirmation: null });
    }
  };

  return {
    operationBusy: false,
    destructiveConfirmation: null,
    batchTagFailures: [],
    batchTagDetailsOpen: false,
    ready: false,
    loading: false,
    info: null,
    items: [],
    collections: [],
    tags: [],
    savedViews: [],
    searchIndex: null,
    snippets: {},
    listTruncated: false,
    view: { kind: "all" },
    query: "",
    sort: "updated",
    selectedId: null,
    multiIds: [],
    multiAnchor: null,
    detail: null,
    detailLoading: false,
    noteMode: "read",
    lockSession: { unlocked: false, remainingMs: 0 },

    init: async () => {
      const [info, result, collections, tags, savedViews, searchIndex, lockSession] = await Promise.all([
        ipc.getLibraryInfo().catch(() => null),
        ipc.listItems(filters()).catch(() => ({ entries: [], truncated: false })),
        ipc.listCollections().catch(() => []),
        ipc.listTags().catch(() => []),
        ipc.listSavedViews().catch(() => []),
        ipc.getSearchIndexStatus().catch(() => null),
        ipc.getLockSession().catch(() => ({ unlocked: false, remainingMs: 0 })),
      ]);
      set({
        info,
        items: result.entries.map((entry) => entry.item),
        collections,
        tags,
        savedViews,
        searchIndex,
        snippets: Object.fromEntries(result.entries.filter((entry) => entry.snippet).map((entry) => [entry.item.id, { text: entry.snippet!, terms: entry.highlightTerms }])),
        listTruncated: result.truncated,
        ready: true,
        loading: false,
      });
      applyLockSession(lockSession);
      if (!visibilityListenerInstalled) {
        visibilityListenerInstalled = true;
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void useLibrary.getState().syncLockSession();
        });
      }
      void ipc.indexPendingPdfs(false).then(async (indexed) => {
        const status = await ipc.getSearchIndexStatus().catch(() => null);
        set({ searchIndex: status });
        if (indexed.indexed > 0 && get().query) await get().refresh();
      }).catch(() => undefined);
    },

    refresh: async (strict = false) => {
      const request = ++refreshRequest;
      const result = await ipc.listItems(filters()).catch((error) => {
        if (strict) throw error;
        return null;
      });
      if (request !== refreshRequest) return;
      if (!result) {
        set({ loading: false });
        return;
      }
      const { selectedId, detail } = get();
      let next = detail;
      let detailCurrent = false;
      if (selectedId && !itemRequiresUnlock(selectedId)) {
        const detailRequestId = ++detailRequest;
        next = await ipc.getItem(selectedId).catch((error) => {
          if (strict) throw error;
          return null;
        }) ?? (detail?.item.id === selectedId ? detail : null);
        detailCurrent = canApplyDetail(detailRequestId, selectedId);
      }
      if (request !== refreshRequest) return;
      set({
        items: result.entries.map((entry) => entry.item),
        snippets: Object.fromEntries(result.entries.filter((entry) => entry.snippet).map((entry) => [entry.item.id, { text: entry.snippet!, terms: entry.highlightTerms }])),
        listTruncated: result.truncated,
        ...(detailCurrent ? { detail: next, detailLoading: false } : {}),
        loading: false,
      });
    },

    refreshMeta: async () => {
      const [collections, tags, savedViews] = await Promise.all([
        ipc.listCollections().catch(() => get().collections),
        ipc.listTags().catch(() => get().tags),
        ipc.listSavedViews().catch(() => get().savedViews),
      ]);
      set({ collections, tags, savedViews });
    },

    setView: (view, options) => {
      clearTimeout(queryTimer);
      queryTimer = undefined;
      detailRequest++;
      const saved = view.kind === "saved" ? get().savedViews.find((item) => item.id === view.id) : null;
      set({
        view,
        query: saved?.query ?? (options?.preserveQuery ? get().query : ""),
        sort: saved?.sort ?? get().sort,
        multiIds: [],
        multiAnchor: null,
        selectedId: null,
        detail: null,
        detailLoading: false,
        noteMode: "read",
      });
      void get().refresh();
    },

    setQuery: (q) => {
      set({ query: q });
      clearTimeout(queryTimer);
      queryTimer = setTimeout(() => void get().refresh(), 180);
    },

    setSort: (s) => {
      set({ sort: s });
      void get().refresh();
    },

    select: async (id) => {
      const request = ++detailRequest;
      if (id === null) {
        set({ selectedId: null, detail: null, detailLoading: false, noteMode: "read" });
        return;
      }
      if (itemRequiresUnlock(id)) {
        set({ selectedId: id, multiIds: [], multiAnchor: null, detail: null, detailLoading: false, noteMode: "read" });
        return;
      }
      set({
        selectedId: id,
        multiIds: [],
        multiAnchor: null,
        detail: get().detail?.item.id === id ? get().detail : null,
        detailLoading: true,
        noteMode: "read",
      });
      const detail = await ipc.getItem(id).catch(() => null);
      if (!canApplyDetail(request, id)) return;
      set({ detail: detail ?? EMPTY_DETAIL, detailLoading: false });
    },

    toggleMulti: async (id, additive, range) => {
      const request = ++detailRequest;
      const { multiIds, multiAnchor, items } = get();
      if (additive) {
        const next = multiIds.includes(id)
          ? multiIds.filter((x) => x !== id)
          : [...multiIds, id];
        set({ multiIds: next, multiAnchor: multiIds.length ? multiAnchor : id });
        if (next.length === 0) set({ selectedId: null, detail: null, detailLoading: false });
        else if (next.length === 1) {
          set({
            selectedId: next[0],
            detail: get().detail?.item.id === next[0] ? get().detail : null,
            detailLoading: true,
            noteMode: "read",
          });
          if (itemRequiresUnlock(next[0])) {
            set({ detail: null, detailLoading: false });
            return;
          }
          const detail = await ipc.getItem(next[0]).catch(() => null);
          if (!canApplyDetail(request, next[0])) return;
          set({ detail: detail ?? EMPTY_DETAIL, detailLoading: false });
        } else set({ detailLoading: false });
        return;
      }
      if (range && multiAnchor) {
        const idxA = items.findIndex((i) => i.id === multiAnchor);
        const idxB = items.findIndex((i) => i.id === id);
        if (idxA >= 0 && idxB >= 0) {
          const [lo, hi] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
          const ids = items.slice(lo, hi + 1).map((i) => i.id);
          set({ multiIds: ids, detailLoading: false });
          return;
        }
      }
      set({
        selectedId: id,
        multiIds: [],
        multiAnchor: id,
        detail: get().detail?.item.id === id ? get().detail : null,
        detailLoading: true,
        noteMode: "read",
      });
      if (itemRequiresUnlock(id)) {
        set({ detail: null, detailLoading: false });
        return;
      }
      const detail = await ipc.getItem(id).catch(() => null);
      if (!canApplyDetail(request, id)) return;
      set({ detail: detail ?? EMPTY_DETAIL, detailLoading: false });
    },

    clearMulti: () => set({ multiIds: [], multiAnchor: null }),

    openItem: async (id) => {
      const request = ++detailRequest;
      if (itemRequiresUnlock(id)) {
        set({ selectedId: id, detail: null, detailLoading: false, noteMode: "read" });
        return;
      }
      set({
        selectedId: id,
        detail: get().detail?.item.id === id ? get().detail : null,
        detailLoading: true,
      });
      void ipc.touchItem(id);
      const detail = await ipc.getItem(id).catch(() => null);
      if (!canApplyDetail(request, id)) return;
      set({
        detail: detail ?? EMPTY_DETAIL,
        detailLoading: false,
        noteMode: isSwitchableText(detail?.item.storedPath || detail?.item.title || "")
          && !isLargeTextFile(detail?.item.size ?? 0)
          ? "edit"
          : "read",
      });
    },

    setNoteMode: (noteMode) => set({ noteMode }),

    syncLockSession: async () => {
      const session = await ipc.getLockSession().catch(() => ({ unlocked: false, remainingMs: 0 }));
      const wasUnlocked = get().lockSession.unlocked;
      if (wasUnlocked && !session.unlocked) await flushEdits();
      applyLockSession(session);
      if (wasUnlocked !== session.unlocked) {
        await Promise.all([get().refresh(), get().refreshMeta()]);
      }
    },

    unlockProtectedContent: async () => {
      const session = await ipc.unlockProtectedContent(getUnlockMinutes()).catch((error) => {
        toast.error(`解锁失败：${String(error)}`);
        return null;
      });
      if (!session) return false;
      applyLockSession(session);
      if (session.unlocked) {
        await Promise.all([get().refresh(), get().refreshMeta()]);
      }
      return session.unlocked;
    },

    lockNow: async () => {
      await flushEdits();
      await ipc.lockNow().catch(() => undefined);
      applyLockSession({ unlocked: false, remainingMs: 0 });
      await Promise.all([get().refresh(), get().refreshMeta()]);
    },

    setItemsLocked: async (ids, locked) => {
      if (!locked && !get().lockSession.unlocked && !(await get().unlockProtectedContent())) {
        return false;
      }
      if (locked) await flushEdits();
      const changed = await ipc.setItemsLocked(ids, locked).then(() => true).catch(() => false);
      if (!changed) return false;
      if (locked) applyLockSession({ unlocked: false, remainingMs: 0 });
      await Promise.all([get().refresh(), get().refreshMeta()]);
      return true;
    },

    setItemsPrivate: async (ids, privateItem) => {
      if (!privateItem && !get().lockSession.unlocked && !(await get().unlockProtectedContent())) {
        return false;
      }
      await flushEdits();
      const changed = await ipc.setItemsPrivate(ids, privateItem).then(() => true).catch(() => false);
      if (!changed) return false;
      const selectedId = get().selectedId;
      if (selectedId && ids.includes(selectedId)) {
        set({ selectedId: null, detail: null, detailLoading: false, multiIds: [], multiAnchor: null, noteMode: "read" });
      }
      await get().refresh();
      return true;
    },

    setCollectionLocked: async (id, locked) => {
      if (!locked && !get().lockSession.unlocked && !(await get().unlockProtectedContent())) {
        return false;
      }
      if (locked) await flushEdits();
      const changed = await ipc.setCollectionLocked(id, locked).then(() => true).catch(() => false);
      if (!changed) return false;
      if (locked) applyLockSession({ unlocked: false, remainingMs: 0 });
      await Promise.all([get().refresh(), get().refreshMeta()]);
      return true;
    },

    createNote: async () => {
      const { view } = get();
      const collectionIds = currentCollectionId(view) ? [currentCollectionId(view)!] : [];
      const item = await ipc.createNote("无标题", "", collectionIds).catch(() => null);
      if (item) {
        await get().refresh();
        set({ selectedId: item.id, detail: null, multiIds: [] });
        await get().select(item.id);
        set({ noteMode: "edit" });
      }
      return item;
    },

    renameFile: async (id, stem, format = null) => {
      const item = await ipc.renameFile(id, stem, format).catch(() => null);
      if (!item) return null;
      get().upsertItem(item);
      const detail = get().detail;
      if (detail?.item.id === id) set({ detail: { ...detail, item } });
      return item;
    },

    createLink: async (url, title) => {
      const { view } = get();
      const collectionIds = currentCollectionId(view) ? [currentCollectionId(view)!] : [];
      const item = await ipc.createLink(url, title, collectionIds).catch(() => null);
      if (item) {
        await get().refresh();
        set({ selectedId: item.id, detail: null, multiIds: [] });
        await get().select(item.id);
      }
      return item;
    },

    createCollection: async (name, parentId = null) => {
      const c = await ipc.createCollection(name, parentId).catch(() => null);
      if (c) await get().refreshMeta();
      return c;
    },

    renameCollection: async (id, name) => {
      await ipc.renameCollection(id, name).catch(() => undefined);
      await get().refreshMeta();
    },

    moveCollection: async (id, parentId, beforeId) => {
      const moved = await ipc.moveCollection(id, parentId, beforeId).then(() => true).catch(() => false);
      if (moved) await Promise.all([get().refresh(), get().refreshMeta()]);
      return moved;
    },

    deleteCollectionTree: async (id) => {
      const subtree = collectionSubtreeIds(get().collections, id);
      const count = await ipc.deleteCollectionTree(id).catch(() => 0);
      if (!count) return 0;
      const { savedViews, view } = get();
      const saved = view.kind === "saved" ? savedViews.find((item) => item.id === view.id) : null;
      if (
        (view.kind === "collection" && subtree.has(view.id))
        || (saved?.collectionId && subtree.has(saved.collectionId))
      ) {
        set({ view: { kind: "all" }, query: "", selectedId: null, detail: null, detailLoading: false });
      }
      await get().refreshMeta();
      await get().refresh();
      return count;
    },

    addToCollection: async (ids, collectionId) => {
      const ok = await ipc.addItemsToCollection(ids, collectionId).then(() => true).catch(() => false);
      if (ok) await get().refresh();
      return ok;
    },

    removeFromCollection: async (ids, collectionId) => {
      const ok = await ipc.removeItemsFromCollection(ids, collectionId).then(() => true).catch(() => false);
      if (ok) await get().refresh();
      return ok;
    },

    createTag: async (name) => {
      const t = await ipc.createTag(name).catch(() => null);
      if (t) await get().refreshMeta();
      return t;
    },

    renameTag: async (id, name) => {
      await ipc.renameTag(id, name).catch(() => undefined);
      await get().refreshMeta();
    },

    setTagColor: async (id, color) => {
      const tag = await ipc.setTagColor(id, color).catch(() => null);
      if (!tag) return;
      set({ tags: get().tags.map((item) => (item.id === id ? tag : item)) });
      await get().refresh();
    },

    deleteTag: async (id) => {
      const deleted = await ipc.deleteTag(id).then(() => true).catch(() => false);
      if (!deleted) return;
      const { savedViews, view } = get();
      const saved = view.kind === "saved" ? savedViews.find((item) => item.id === view.id) : null;
      if ((view.kind === "tag" && view.id === id) || saved?.tagId === id) {
        set({ view: { kind: "all" }, query: "", selectedId: null, detail: null, detailLoading: false });
      }
      await get().refreshMeta();
      await get().refresh();
    },

    createSavedView: async (name) => {
      const { view, query, sort, savedViews } = get();
      const active = view.kind === "saved" ? savedViews.find((item) => item.id === view.id) : null;
      const baseView = active?.view ?? (view.kind === "saved" || view.kind === "trash" || view.kind === "privacy" ? "all" : view.kind);
      const saved = await ipc.createSavedView({
        name,
        query,
        sort,
        view: baseView,
        collectionId: active?.collectionId ?? (view.kind === "collection" ? view.id : null),
        tagId: active?.tagId ?? (view.kind === "tag" ? view.id : null),
      }).catch(() => null);
      if (saved) set({ savedViews: [...get().savedViews, saved] });
      return saved;
    },

    renameSavedView: async (id, name) => {
      const renamed = await ipc.renameSavedView(id, name).then(() => true).catch(() => false);
      if (renamed) set({ savedViews: get().savedViews.map((item) => item.id === id ? { ...item, name } : item) });
    },

    deleteSavedView: async (id) => {
      const deleted = await ipc.deleteSavedView(id).then(() => true).catch(() => false);
      if (!deleted) return;
      const currentView = get().view;
      const active = currentView.kind === "saved" && currentView.id === id;
      set({
        savedViews: get().savedViews.filter((item) => item.id !== id),
        ...(active ? { view: { kind: "all" } as View, query: "", selectedId: null, detail: null, detailLoading: false } : {}),
      });
      if (active) await get().refresh();
    },

    retryPdfIndex: async () => {
      const result = await ipc.indexPendingPdfs(true).catch(() => null);
      const status = await ipc.getSearchIndexStatus().catch(() => null);
      set({ searchIndex: status });
      if (result?.indexed && get().query) await get().refresh();
      return result;
    },

    setItemTags: async (itemId, tagIds) => {
      if (get().operationBusy) return false;
      set({ operationBusy: true });
      try {
        const item = await ipc.setItemTags(itemId, tagIds);
        get().upsertItem(item);
        const { detail } = get();
        if (detail?.item.id === itemId) set({ detail: { ...detail, item } });
        toast.success("标签已更新");
        await refreshAfterOperation();
        return true;
      } catch (error) {
        toast.error(`更新标签失败：${String(error)}`);
        return false;
      } finally {
        set({ operationBusy: false });
      }
    },

    updateBatchTags: async (requestedIds, tagId, mode) => {
      if (get().operationBusy) return false;
      const ids = [...new Set(requestedIds)];
      if (!ids.length) return false;
      const failures: LibraryState["batchTagFailures"] = [];
      let changed = 0;
      let unchanged = 0;
      set({ operationBusy: true, batchTagFailures: [], batchTagDetailsOpen: false });
      try {
        for (const id of ids) {
          const title = get().items.find((item) => item.id === id)?.title ?? "所选文件";
          try {
            const { item } = await ipc.getItem(id);
            const tags = item.tags.map((tag) => tag.id);
            if (tags.includes(tagId) === (mode === "add")) { unchanged++; continue; }
            const updated = await ipc.setItemTags(id, mode === "add" ? [...tags, tagId] : tags.filter((tag) => tag !== tagId));
            get().upsertItem(updated);
            const { detail } = get();
            if (detail?.item.id === id) set({ detail: { ...detail, item: updated } });
            changed++;
          } catch (error) {
            failures.push({ id, title, reason: String(error) });
          }
        }
        if (failures.length) {
          set({ batchTagFailures: failures, multiIds: failures.map(({ id }) => id), multiAnchor: failures[0].id });
          toast.error(`标签更新：成功 ${changed} 项，无需更改 ${unchanged} 项，失败 ${failures.length} 项`, {
            action: { label: "查看明细", onClick: () => set({ batchTagDetailsOpen: true }) },
          });
        } else toast.success(`标签更新：成功 ${changed} 项，无需更改 ${unchanged} 项`);
        await refreshAfterOperation(failures.length ? "标签操作结果已记录，但列表刷新失败" : undefined);
        return failures.length === 0;
      } finally {
        set({ operationBusy: false });
      }
    },

    toggleFavorite: async (id) => {
      const target = get().items.find((i) => i.id === id);
      if (!target) return;
      const item = await ipc
        .setFavorite(id, !target.isFavorite)
        .catch(() => null);
      if (item) {
        get().upsertItem(item);
        const { detail } = get();
        if (detail && detail.item.id === id) set({ detail: { ...detail, item } });
      }
    },

    deleteItems: (ids) => runTrashOperation("delete", ids),
    restoreItems: (ids) => runTrashOperation("restore", ids),
    purgeItems: (ids) => runTrashOperation("purge", ids),
    emptyTrash: () => runTrashOperation("empty"),

    importPaths: async (paths) => {
      const { view } = get();
      const result = await ipc
        .importFiles(paths, currentCollectionId(view))
        .catch(() => null);
      await get().refresh();
      return result;
    },

    addAttachments: async (parentId, childIds) => {
      const d = await ipc.addAttachments(parentId, childIds).catch(() => null);
      if (d && get().selectedId === parentId && (get().lockSession.unlocked || !d.item.effectiveLocked)) {
        set({ detail: d });
      }
      return d;
    },

    removeAttachment: async (parentId, childId) => {
      const d = await ipc.removeAttachment(parentId, childId).catch(() => null);
      if (d && get().selectedId === parentId && (get().lockSession.unlocked || !d.item.effectiveLocked)) {
        set({ detail: d });
      }
      return d;
    },

    applyDetail: (detail) => {
      set({ detail });
      get().upsertItem(detail.item);
    },

    upsertItem: (item) => {
      const summary = summaryOf(item);
      const items = get().items.map((i) => (i.id === item.id ? summary : i));
      set({ items });
    },
  };
});
