import { convertFileSrc, invoke } from "@tauri-apps/api/core";

// ---- types (mirror src-tauri/src/library/models.rs) ----

export type ItemType = "note" | "file" | "link";

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  emoji: string | null;
}

export interface Collection {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  createdAt: string;
}

export interface Item {
  id: string;
  itemType: ItemType;
  title: string;
  content: string;
  url: string;
  storedPath: string;
  size: number;
  mime: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  isFavorite: boolean;
  deletedAt: string | null;
  tags: Tag[];
  collections: string[];
}

export interface ItemDetail {
  item: Item;
  attachments: Item[];
}

export type ViewKind = "all" | "favorites" | "recent" | "uncollected" | "trash";

export interface ListFilters {
  view: ViewKind;
  collectionId?: string | null;
  tagId?: string | null;
  query?: string | null;
  sort?: "updated" | "created" | "title" | "type";
  limit?: number;
}

export interface ImportOutcome {
  item: Item;
  fileName: string;
  size: number;
}

export interface ImportSkip {
  path: string;
  reason: string;
}

export interface ImportResult {
  imported: ImportOutcome[];
  skipped: ImportSkip[];
}

export interface LibraryInfo {
  root: string;
  dbPath: string;
  itemCount: number;
  fileCount: number;
  noteCount: number;
  linkCount: number;
}

// ---- typed invoke wrappers (the single seam to Rust) ----

export const ipc = {
  getLibraryInfo: () => invoke<LibraryInfo>("get_library_info"),

  listItems: (filters: ListFilters) =>
    invoke<Item[]>("list_items", { filters }),

  getItem: (id: string) => invoke<ItemDetail>("get_item", { id }),

  createNote: (title: string, content: string, collectionIds: string[]) =>
    invoke<Item>("create_note", { title, content, collectionIds }),

  updateNote: (id: string, title: string, content: string) =>
    invoke<Item>("update_note", { id, title, content }),

  createLink: (url: string, title: string, collectionIds: string[]) =>
    invoke<Item>("create_link", { url, title, collectionIds }),

  deleteItems: (ids: string[]) => invoke<void>("delete_items", { ids }),

  restoreItems: (ids: string[]) => invoke<void>("restore_items", { ids }),

  emptyTrash: () => invoke<void>("empty_trash"),

  purgeItems: (ids: string[]) => invoke<void>("purge_items", { ids }),

  setFavorite: (id: string, favorite: boolean) =>
    invoke<Item>("set_favorite", { id, favorite }),

  touchItem: (id: string) => invoke<void>("touch_item", { id }),

  listCollections: () => invoke<Collection[]>("list_collections"),

  createCollection: (name: string, parentId?: string | null) =>
    invoke<Collection>("create_collection", { name, parentId }),

  renameCollection: (id: string, name: string) =>
    invoke<void>("rename_collection", { id, name }),

  deleteCollection: (id: string) => invoke<void>("delete_collection", { id }),

  addItemsToCollection: (itemIds: string[], collectionId: string) =>
    invoke<void>("add_items_to_collection", { itemIds, collectionId }),

  removeItemsFromCollection: (itemIds: string[], collectionId: string) =>
    invoke<void>("remove_items_from_collection", { itemIds, collectionId }),

  listTags: () => invoke<Tag[]>("list_tags"),

  createTag: (name: string) => invoke<Tag>("create_tag", { name }),

  renameTag: (id: string, name: string) =>
    invoke<void>("rename_tag", { id, name }),

  deleteTag: (id: string) => invoke<void>("delete_tag", { id }),

  setItemTags: (itemId: string, tagIds: string[]) =>
    invoke<Item>("set_item_tags", { itemId, tagIds }),

  addAttachments: (parentId: string, childIds: string[]) =>
    invoke<ItemDetail>("add_attachments", { parentId, childIds }),

  removeAttachment: (parentId: string, childId: string) =>
    invoke<ItemDetail>("remove_attachment", { parentId, childId }),

  importFiles: (paths: string[], collectionId?: string | null) =>
    invoke<ImportResult>("import_files", { paths, collectionId }),

  openWithDefault: (id: string) =>
    invoke<void>("open_with_default", { id }),

  quicklook: (id: string) => invoke<void>("quicklook", { id }),

  generateThumbnail: (id: string) =>
    invoke<string | null>("generate_thumbnail", { id }),

  fileAbsPath: (id: string) =>
    invoke<string | null>("file_abs_path", { id }),
};

export { convertFileSrc };
