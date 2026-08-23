import type { TagColor } from "@/core/ipc";

export const TAG_COLORS: Array<{ value: TagColor; label: string; dot: string }> = [
  { value: "red", label: "红", dot: "bg-red-500" },
  { value: "orange", label: "橙", dot: "bg-orange-500" },
  { value: "amber", label: "黄", dot: "bg-amber-500" },
  { value: "green", label: "绿", dot: "bg-emerald-500" },
  { value: "blue", label: "蓝", dot: "bg-blue-500" },
  { value: "purple", label: "紫", dot: "bg-purple-500" },
  { value: "pink", label: "粉", dot: "bg-pink-500" },
];

const BADGE: Record<TagColor, string> = {
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
  orange: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  purple: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  pink: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
};

export const tagBadgeClass = (color: TagColor | null) => color ? BADGE[color] : "bg-muted text-muted-foreground";
export const tagDotClass = (color: TagColor | null) => TAG_COLORS.find((item) => item.value === color)?.dot ?? "bg-muted-foreground/50";
