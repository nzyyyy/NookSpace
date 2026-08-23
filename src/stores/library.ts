import { create } from "zustand";
import {
  type Collection,
  type ImportResult,
  ipc,
  type Item,
  type ItemDetail,
  type LibraryInfo,
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
  | { kind: "tag"; id: string };

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

interface LibraryState {
  ready: boolean;
  loading: boolean;
  info: LibraryInfo | null;
  items: Item[];
  collections: Collection[];
  tags: Tag[];
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

export const useLibrary = create<LibraryState>((set, get) => {
  const currentCollectionId = (view: View): string | null =>
    view.kind === "collection" ? view.id : null;

  const filters = () => {
    const { view, query, sort } = get();
    const base = {
      view: view.kind === "collection" || view.kind === "tag" ? "all" : view.kind,
      sort,
      query: query || null,
    };
    return {
      ...base,
      collectionId: view.kind === "collection" ? view.id : null,
      tagId: view.kind === "tag" ? view.id : null,
    };
  };

  return {
    ready: false,
    loading: false,
    info: null,
    items: [],
    collections: [],
    tags: [],
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
      const [info, items, collections, tags] = await Promise.all([
        ipc.getLibraryInfo().catch(() => null),
        ipc.listItems(filters()).catch(() => []),
        ipc.listCollections().catch(() => []),
        ipc.listTags().catch(() => []),
      ]);
      set({ info, items, collections, tags, ready: true, loading: false });
    },

    refresh: async () => {
      const items = await ipc.listItems(filters()).catch(() => get().items);
      const { selectedId, detail } = get();
      let next = detail;
      if (selectedId && detail) {
        next = await ipc.getItem(selectedId).catch(() => null) ?? detail;
      }
      set({ items, detail: next, loading: false });
    },

    refreshMeta: async () => {
      const [collections, tags] = await Promise.all([
        ipc.listCollections().catch(() => get().collections),
        ipc.listTags().catch(() => get().tags),
      ]);
      set({ collections, tags });
    },

    setView: (view) => {
      set({ view, multiIds: [], multiAnchor: null, selectedId: null, detail: null, noteMode: "read" });
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
      const v = get().view;
      if (v.kind === "collection" && subtree.has(v.id)) {
        set({ view: { kind: "all" }, selectedId: null, detail: null });
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
      await ipc.deleteTag(id).catch(() => undefined);
      const v = get().view;
      if (v.kind === "tag" && v.id === id) {
        set({ view: { kind: "all" }, selectedId: null, detail: null });
      }
      await get().refreshMeta();
      await get().refresh();
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
      const items = get().items.map((i) => (i.id === item.id ? item : i));
      set({ items });
    },
  };
});
