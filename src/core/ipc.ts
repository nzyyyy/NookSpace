import { convertFileSrc, invoke } from "@tauri-apps/api/core";

// ---- types (mirror src-tauri/src/library/models.rs) ----

export type ItemType = "note" | "file" | "link";
export type TagColor = "red" | "orange" | "amber" | "green" | "blue" | "purple" | "pink";

export interface Tag {
  id: string;
  name: string;
  color: TagColor | null;
  emoji: string | null;
}

export interface Collection {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  createdAt: string;
  isLocked: boolean;
  effectiveLocked: boolean;
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
  isLocked: boolean;
  effectiveLocked: boolean;
  tags: Tag[];
  collections: string[];
}

export interface ItemSummary {
  id: string;
  itemType: ItemType;
  title: string;
  contentPreview: string;
  url: string;
  storedPath: string;
  size: number;
  mime: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  isFavorite: boolean;
  deletedAt: string | null;
  isLocked: boolean;
  effectiveLocked: boolean;
  tags: Tag[];
  collections: string[];
}

export interface ListEntry {
  item: ItemSummary;
  snippet: string | null;
  highlightTerms: string[];
}

export interface ListResult {
  entries: ListEntry[];
  truncated: boolean;
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

export interface LockSession {
  unlocked: boolean;
  remainingMs: number;
}

export interface SavedView {
  id: string;
  name: string;
  query: string;
  sort: "updated" | "created" | "title" | "type";
  view: "all" | "favorites" | "recent" | "uncollected" | "collection" | "tag";
  collectionId: string | null;
  tagId: string | null;
  createdAt: string;
}

export interface SearchIndexStatus {
  pending: number;
  failed: number;
}

export interface IndexResult {
  indexed: number;
  failed: number;
}

export type TextFileEncoding = "utf8" | "utf8Bom";
export type TextFileLineEnding = "lf" | "crlf" | "cr";

export interface TextFileDocument {
  content: string;
  version: string;
  encoding: TextFileEncoding;
  lineEnding: TextFileLineEnding;
}

export type TextFileWriteResult =
  | { status: "saved"; item: Item; version: string }
  | { status: "conflict"; version: string };

// ---- typed invoke wrappers (the single seam to Rust) ----

export const ipc = {
  getLockSession: () => invoke<LockSession>("get_lock_session"),

  unlockProtectedContent: () =>
    invoke<LockSession>("unlock_protected_content"),

  lockNow: () => invoke<void>("lock_now"),

  setItemsLocked: (ids: string[], locked: boolean) =>
    invoke<void>("set_items_locked", { ids, locked }),

  setCollectionLocked: (id: string, locked: boolean) =>
    invoke<void>("set_collection_locked", { id, locked }),

  getLibraryInfo: () => invoke<LibraryInfo>("get_library_info"),

  listItems: (filters: ListFilters) =>
    invoke<ListResult>("list_items", { filters }),

  listSavedViews: () => invoke<SavedView[]>("list_saved_views"),

  createSavedView: (input: {
    name: string;
    query: string;
    sort: SavedView["sort"];
    view: SavedView["view"];
    collectionId: string | null;
    tagId: string | null;
  }) => invoke<SavedView>("create_saved_view", input),

  renameSavedView: (id: string, name: string) =>
    invoke<void>("rename_saved_view", { id, name }),

  deleteSavedView: (id: string) => invoke<void>("delete_saved_view", { id }),

  getSearchIndexStatus: () =>
    invoke<SearchIndexStatus>("get_search_index_status"),

  indexPendingPdfs: (retryFailed = false) =>
    invoke<IndexResult>("index_pending_pdfs", { retryFailed }),

  backupLibrary: (destinationParent: string) =>
    invoke<string>("backup_library", { destinationParent }),

  exportLibrary: (destinationParent: string) =>
    invoke<string>("export_library", { destinationParent }),

  moveLibrary: (destination: string) =>
    invoke<string>("move_library", { destination }),

  useExistingLibrary: (root: string) =>
    invoke<string>("use_existing_library", { root }),

  restartApp: () => invoke<void>("restart_app"),

  getItem: (id: string) => invoke<ItemDetail>("get_item", { id }),

  exportItem: (id: string, destination: string) =>
    invoke<string>("export_item", { id, destination }),

  createNote: (title: string, content: string, collectionIds: string[]) =>
    invoke<Item>("create_note", { title, content, collectionIds }),

  renameFile: (id: string, stem: string, format?: string | null) =>
    invoke<Item>("rename_file", { id, stem, format: format ?? null }),

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

  moveCollection: (id: string, parentId: string | null, beforeId: string | null) =>
    invoke<void>("move_collection", { id, parentId, beforeId }),

  deleteCollectionTree: (id: string) =>
    invoke<number>("delete_collection_tree", { id }),

  addItemsToCollection: (itemIds: string[], collectionId: string) =>
    invoke<void>("add_items_to_collection", { itemIds, collectionId }),

  removeItemsFromCollection: (itemIds: string[], collectionId: string) =>
    invoke<void>("remove_items_from_collection", { itemIds, collectionId }),

  listTags: () => invoke<Tag[]>("list_tags"),

  createTag: (name: string) => invoke<Tag>("create_tag", { name }),

  renameTag: (id: string, name: string) =>
    invoke<void>("rename_tag", { id, name }),

  setTagColor: (id: string, color: TagColor | null) =>
    invoke<Tag>("set_tag_color", { id, color }),

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

  readTextFile: (id: string) =>
    invoke<TextFileDocument>("read_text_file", { id }),

  writeTextFile: (
    id: string,
    content: string,
    expectedVersion: string,
    encoding: TextFileEncoding,
    lineEnding: TextFileLineEnding,
  ) => invoke<TextFileWriteResult>("write_text_file", {
    id,
    content,
    expectedVersion,
    encoding,
    lineEnding,
  }),

  fileAbsPath: (id: string) =>
    invoke<string | null>("file_abs_path", { id }),
};

export { convertFileSrc };
