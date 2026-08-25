const MEDIA_EXTENSIONS = new Set([
  "3gp", "aac", "aif", "aiff", "avi", "caf", "flac", "flv", "m4a", "m4v", "mkv",
  "mov", "mp3", "mp4", "mpeg", "mpg", "oga", "ogg", "ogv", "opus", "wav", "webm",
  "wma", "wmv",
]);

export const SWITCHABLE_FORMATS = ["md", "txt", "json", "yaml", "csv"] as const;
export type SwitchableFormat = (typeof SWITCHABLE_FORMATS)[number];

export function isMediaFile(mime: string, name: string): boolean {
  const extension = fileExtension(name);
  return mime.startsWith("audio/") || mime.startsWith("video/") || MEDIA_EXTENSIONS.has(extension);
}

export function fileExtension(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const index = base.lastIndexOf(".");
  return index > 0 ? base.slice(index + 1).toLowerCase() : "";
}

export function canonicalFormat(ext: string): SwitchableFormat | null {
  const value = ext.toLowerCase();
  if (value === "md" || value === "markdown") return "md";
  if (value === "txt") return "txt";
  if (value === "json") return "json";
  if (value === "yaml" || value === "yml") return "yaml";
  if (value === "csv") return "csv";
  return null;
}

export function isSwitchableText(name: string): boolean {
  return canonicalFormat(fileExtension(name)) !== null;
}

export function displayStem(title: string, storedPath = ""): string {
  const ext = fileExtension(storedPath || title);
  if (ext && title.toLowerCase().endsWith(`.${ext}`)) {
    return title.slice(0, title.length - ext.length - 1);
  }
  return title;
}
