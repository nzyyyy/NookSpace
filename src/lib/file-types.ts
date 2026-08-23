const MEDIA_EXTENSIONS = new Set([
  "3gp", "aac", "aif", "aiff", "avi", "caf", "flac", "flv", "m4a", "m4v", "mkv",
  "mov", "mp3", "mp4", "mpeg", "mpg", "oga", "ogg", "ogv", "opus", "wav", "webm",
  "wma", "wmv",
]);

export function isMediaFile(mime: string, name: string): boolean {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return mime.startsWith("audio/") || mime.startsWith("video/") || MEDIA_EXTENSIONS.has(extension);
}
