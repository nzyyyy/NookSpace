// Formatting helpers for the catalog-card meta lines.

const sqliteTs = (s: string): number => {
  // SQLite "YYYY-MM-DD HH:MM:SS" (UTC) → epoch ms
  if (!s) return 0;
  return Date.parse(s.replace(" ", "T") + "Z") || 0;
};

export function formatRelativeDate(ts: string, now = Date.now()): string {
  const t = sqliteTs(ts);
  if (!t) return "—";
  const diff = now - t;
  const day = 86_400_000;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < day && new Date(t).getDate() === new Date(now).getDate()) {
    return `今天 ${new Date(t).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (diff < 2 * day) return "昨天";
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(t).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function formatFullDate(ts: string): string {
  const t = sqliteTs(ts);
  if (!t) return "—";
  return new Date(t).toLocaleString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export const TYPE_LABEL: Record<string, string> = {
  note: "笔记",
  file: "文件",
  link: "链接",
};
