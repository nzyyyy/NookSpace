import type {
  TextFileDocument,
  TextFileEncoding,
  TextFileLineEnding,
} from "@/core/ipc";

export interface TextFileDraft {
  itemId: string;
  content: string;
  baseVersion: string;
  encoding: TextFileEncoding;
  lineEnding: TextFileLineEnding;
}

export type TextSnapshot = () => string;

export type TextFileDraftDecision = "none" | "discard" | "recover" | "conflict";

const DATABASE = "nookspace-drafts";
const STORE = "text-file-drafts";
let databasePromise: Promise<IDBDatabase> | null = null;

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
});

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
});

const database = () => {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "itemId" });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
  });
  return databasePromise;
};

const isDraft = (value: unknown): value is TextFileDraft => {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<TextFileDraft>;
  return typeof draft.itemId === "string"
    && typeof draft.content === "string"
    && typeof draft.baseVersion === "string"
    && (draft.encoding === "utf8" || draft.encoding === "utf8Bom")
    && (draft.lineEnding === "lf" || draft.lineEnding === "crlf" || draft.lineEnding === "cr");
};

export function classifyTextFileDraft(
  document: Pick<TextFileDocument, "content" | "version">,
  draft: TextFileDraft | null,
): TextFileDraftDecision {
  if (!draft) return "none";
  if (draft.content === document.content) return "discard";
  return draft.baseVersion === document.version ? "recover" : "conflict";
}

export async function readTextFileDraft(itemId: string): Promise<TextFileDraft | null> {
  const db = await database();
  const value = await requestResult(db.transaction(STORE).objectStore(STORE).get(itemId));
  return isDraft(value) ? value : null;
}

export async function writeTextFileDraft(draft: TextFileDraft): Promise<void> {
  const db = await database();
  const transaction = db.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).put(draft);
  await transactionDone(transaction);
}

export async function deleteTextFileDraft(itemId: string): Promise<void> {
  const db = await database();
  const transaction = db.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).delete(itemId);
  await transactionDone(transaction);
}

export async function deleteTextFileDraftIfContentMatches(
  itemId: string,
  content: string,
): Promise<void> {
  const db = await database();
  const transaction = db.transaction(STORE, "readwrite");
  const store = transaction.objectStore(STORE);
  const request = store.get(itemId);
  request.onsuccess = () => {
    if (isDraft(request.result) && request.result.content === content) {
      store.delete(itemId);
    }
  };
  await transactionDone(transaction);
}

export function createSerialTextFileDraftWriter(
  write: (draft: TextFileDraft) => Promise<void> = writeTextFileDraft,
  onFailed?: (error: unknown) => void,
) {
  let latest: TextFileDraft | null = null;
  let active: Promise<void> | null = null;

  const pump = async () => {
    while (latest) {
      const draft = latest;
      latest = null;
      await write(draft);
    }
  };

  const start = () => {
    if (!active) {
      active = pump()
        .catch((error) => onFailed?.(error))
        .finally(() => {
          active = null;
          if (latest) void start();
        });
    }
    return active;
  };

  return {
    schedule(draft: TextFileDraft) {
      latest = draft;
      void start();
    },
    flush() {
      return start();
    },
  };
}

export function createTextSnapshotScheduler(
  commit: (content: string) => void,
  delay = 400,
) {
  let latest: TextSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const snapshot = latest;
    latest = null;
    if (snapshot) commit(snapshot());
  };

  return {
    schedule(snapshot: TextSnapshot) {
      latest = snapshot;
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      latest = null;
    },
    pending() {
      return latest !== null;
    },
  };
}
