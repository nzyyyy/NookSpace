export interface NoteDraft {
  id: string;
  title: string;
  content: string;
  baseUpdatedAt: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const key = (id: string) => `nookspace.note-draft.v1.${id}`;

export function writeNoteDraft(storage: StorageLike, draft: NoteDraft) {
  storage.setItem(key(draft.id), JSON.stringify(draft));
}

export function readNoteDraft(storage: StorageLike, item: NoteDraft): NoteDraft | null {
  try {
    const value = JSON.parse(storage.getItem(key(item.id)) ?? "null");
    if (
      value?.id === item.id &&
      value.baseUpdatedAt === item.baseUpdatedAt &&
      typeof value.title === "string" &&
      typeof value.content === "string" &&
      (value.title !== item.title || value.content !== item.content)
    ) {
      return value;
    }
  } catch {
    // Ignore corrupt local recovery data.
  }
  return null;
}

export function settleNoteDraft(storage: StorageLike, saved: NoteDraft, updatedAt: string) {
  try {
    const current = JSON.parse(storage.getItem(key(saved.id)) ?? "null");
    if (current?.title === saved.title && current?.content === saved.content) {
      storage.removeItem(key(saved.id));
    } else if (current?.id === saved.id) {
      writeNoteDraft(storage, { ...current, baseUpdatedAt: updatedAt });
    }
  } catch {
    storage.removeItem(key(saved.id));
  }
}

export function createSerialNoteSaver({
  delay = 400,
  save,
  onSaved,
  onFailed,
}: {
  delay?: number;
  save: (draft: NoteDraft) => Promise<string | null>;
  onSaved?: (draft: NoteDraft, updatedAt: string) => void;
  onFailed?: (draft: NoteDraft) => void;
}) {
  let latest: NoteDraft | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | null = null;

  const pump = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    if (active) return active.then(() => (latest ? pump() : undefined));
    if (!latest) return Promise.resolve();
    const draft = latest;
    latest = null;
    active = save(draft)
      .then((updatedAt) => {
        if (updatedAt) onSaved?.(draft, updatedAt);
        else onFailed?.(draft);
      })
      .catch(() => onFailed?.(draft))
      .finally(() => {
        active = null;
        if (latest) void pump();
      });
    return active;
  };

  return {
    schedule(draft: NoteDraft) {
      latest = draft;
      clearTimeout(timer);
      timer = setTimeout(() => void pump(), delay);
    },
    flush() {
      clearTimeout(timer);
      return pump();
    },
  };
}
