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
  type SavedView,
  type SearchIndexStatus,
  type Tag,
  type TagColor,
} from "@/core/ipc";
import { collectionSubtreeIds } from "@/lib/collections";

export type View =
  | { kind: "all" }
  | { kind: "favorites" }
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
    itemType: "note",
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

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  setView: (view: View) => void;
  setQuery: (q: string) => void;
  setSort: (s: SortKey) => void;
  select: (id: string | null) => Promise<void>;
  toggleMulti: (id: string, additive: boolean, range: boolean) => Promise<void>;
  clearMulti: () => void;
  openItem: (id: string) => Promise<void>;
  setNoteMode: (mode: NoteMode) => void;

  createNote: () => Promise<Item | null>;
  saveNote: (id: string, title: string, content: string) => Promise<Item | null>;
  createLink: (url: string, title: string) => Promise<Item | null>;
  createCollection: (name: string, parentId?: string | null) => Promise<Collection | null>;
  renameCollection: (id: string, name: string) => Promise<void>;
  moveCollection: (id: string, parentId: string | null, beforeId: string | null) => Promise<boolean>;
  deleteCollectionTree: (id: string) => Promise<number>;
  addToCollection: (ids: string[], collectionId: string) => Promise<void>;
  removeFromCollection: (ids: string[], collectionId: string) => Promise<void>;
  createTag: (name: string) => Promise<Tag | null>;
  renameTag: (id: string, name: string) => Promise<void>;
  setTagColor: (id: string, color: TagColor | null) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
  createSavedView: (name: string) => Promise<SavedView | null>;
  renameSavedView: (id: string, name: string) => Promise<void>;
  deleteSavedView: (id: string) => Promise<void>;
  retryPdfIndex: () => Promise<IndexResult | null>;
  setItemTags: (itemId: string, tagIds: string[]) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  deleteItems: (ids: string[]) => Promise<void>;
  restoreItems: (ids: string[]) => Promise<void>;
  purgeItems: (ids: string[]) => Promise<void>;
  emptyTrash: () => Promise<void>;
  importPaths: (paths: string[]) => Promise<ImportResult | null>;
  addAttachments: (parentId: string, childIds: string[]) => Promise<ItemDetail | null>;
  removeAttachment: (parentId: string, childId: string) => Promise<ItemDetail | null>;
  applyDetail: (detail: ItemDetail) => void;
  upsertItem: (item: Item) => void;
}

let queryTimer: ReturnType<typeof setTimeout> | undefined;
let refreshRequest = 0;

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

  return {
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

    init: async () => {
      const [info, result, collections, tags, savedViews, searchIndex] = await Promise.all([
        ipc.getLibraryInfo().catch(() => null),
        ipc.listItems(filters()).catch(() => ({ entries: [], truncated: false })),
        ipc.listCollections().catch(() => []),
        ipc.listTags().catch(() => []),
        ipc.listSavedViews().catch(() => []),
        ipc.getSearchIndexStatus().catch(() => null),
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
      void ipc.indexPendingPdfs(false).then(async (indexed) => {
        const status = await ipc.getSearchIndexStatus().catch(() => null);
        set({ searchIndex: status });
        if (indexed.indexed > 0 && get().query) await get().refresh();
      }).catch(() => undefined);
    },

    refresh: async () => {
      const request = ++refreshRequest;
      const result = await ipc.listItems(filters()).catch(() => null);
      if (request !== refreshRequest) return;
      if (!result) {
        set({ loading: false });
        return;
      }
      const { selectedId, detail } = get();
      let next = detail;
      if (selectedId && detail) {
        next = await ipc.getItem(selectedId).catch(() => null) ?? detail;
      }
      if (request !== refreshRequest) return;
      set({
        items: result.entries.map((entry) => entry.item),
        snippets: Object.fromEntries(result.entries.filter((entry) => entry.snippet).map((entry) => [entry.item.id, { text: entry.snippet!, terms: entry.highlightTerms }])),
        listTruncated: result.truncated,
        detail: next,
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

    setView: (view) => {
      const saved = view.kind === "saved" ? get().savedViews.find((item) => item.id === view.id) : null;
      set({
        view,
        query: saved?.query ?? get().query,
        sort: saved?.sort ?? get().sort,
        multiIds: [],
        multiAnchor: null,
        selectedId: null,
        detail: null,
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
      if (id === null) {
        set({ selectedId: null, detail: null, noteMode: "read" });
        return;
      }
      set({ selectedId: id, multiIds: [], multiAnchor: null, detailLoading: true, noteMode: "read" });
      const detail = await ipc.getItem(id).catch(() => null);
      set({ detail: detail ?? EMPTY_DETAIL, detailLoading: false });
    },

    toggleMulti: async (id, additive, range) => {
      const { multiIds, multiAnchor, items } = get();
      if (additive) {
        const next = multiIds.includes(id)
          ? multiIds.filter((x) => x !== id)
          : [...multiIds, id];
        set({ multiIds: next, multiAnchor: multiIds.length ? multiAnchor : id });
        if (next.length === 0) set({ selectedId: null, detail: null });
        else if (next.length === 1) {
          set({ selectedId: next[0], noteMode: "read" });
          const detail = await ipc.getItem(next[0]).catch(() => null);
          set({ detail: detail ?? EMPTY_DETAIL, detailLoading: false });
        }
        return;
      }
      if (range && multiAnchor) {
        const idxA = items.findIndex((i) => i.id === multiAnchor);
        const idxB = items.findIndex((i) => i.id === id);
        if (idxA >= 0 && idxB >= 0) {
          const [lo, hi] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
          const ids = items.slice(lo, hi + 1).map((i) => i.id);
          set({ multiIds: ids });
          return;
        }
      }
      set({ selectedId: id, multiIds: [], multiAnchor: id, noteMode: "read" });
      const detail = await ipc.getItem(id).catch(() => null);
      set({ detail: detail ?? EMPTY_DETAIL, detailLoading: false });
    },

    clearMulti: () => set({ multiIds: [], multiAnchor: null }),

    openItem: async (id) => {
      set({ selectedId: id, detailLoading: true });
      void ipc.touchItem(id);
      const detail = await ipc.getItem(id).catch(() => null);
      set({
        detail: detail ?? EMPTY_DETAIL,
        detailLoading: false,
        noteMode: detail?.item.itemType === "note" ? "edit" : "read",
      });
    },

    setNoteMode: (noteMode) => set({ noteMode }),

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

    saveNote: async (id, title, content) => {
      const item = await ipc.updateNote(id, title, content).catch(() => null);
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
      if (moved) await get().refreshMeta();
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
        set({ view: { kind: "all" }, query: "", selectedId: null, detail: null });
      }
      await get().refreshMeta();
      await get().refresh();
      return count;
    },

    addToCollection: async (ids, collectionId) => {
      await ipc.addItemsToCollection(ids, collectionId).catch(() => undefined);
      await get().refresh();
    },

    removeFromCollection: async (ids, collectionId) => {
      await ipc.removeItemsFromCollection(ids, collectionId).catch(() => undefined);
      await get().refresh();
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
        set({ view: { kind: "all" }, query: "", selectedId: null, detail: null });
      }
      await get().refreshMeta();
      await get().refresh();
    },

    createSavedView: async (name) => {
      const { view, query, sort, savedViews } = get();
      const active = view.kind === "saved" ? savedViews.find((item) => item.id === view.id) : null;
      const baseView = active?.view ?? (view.kind === "saved" || view.kind === "trash" ? "all" : view.kind);
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
        ...(active ? { view: { kind: "all" } as View, query: "", selectedId: null, detail: null } : {}),
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
      const item = await ipc.setItemTags(itemId, tagIds).catch(() => null);
      if (item) get().upsertItem(item);
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

    deleteItems: async (ids) => {
      await ipc.deleteItems(ids).catch(() => undefined);
      const { selectedId } = get();
      if (selectedId && ids.includes(selectedId)) {
        set({ selectedId: null, detail: null });
      }
      set({ multiIds: [] });
      await get().refresh();
    },

    restoreItems: async (ids) => {
      await ipc.restoreItems(ids).catch(() => undefined);
      set({ multiIds: [] });
      await get().refresh();
    },

    purgeItems: async (ids) => {
      await ipc.purgeItems(ids).catch(() => undefined);
      const { selectedId } = get();
      if (selectedId && ids.includes(selectedId)) {
        set({ selectedId: null, detail: null });
      }
      set({ multiIds: [] });
      await get().refresh();
    },

    emptyTrash: async () => {
      await ipc.emptyTrash().catch(() => undefined);
      set({ selectedId: null, detail: null });
      await get().refresh();
    },

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
      if (d) set({ detail: d });
      return d;
    },

    removeAttachment: async (parentId, childId) => {
      const d = await ipc.removeAttachment(parentId, childId).catch(() => null);
      if (d) set({ detail: d });
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
