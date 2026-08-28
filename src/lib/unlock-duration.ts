export const DEFAULT_UNLOCK_MINUTES = 10;
export const MIN_UNLOCK_MINUTES = 1;
export const MAX_UNLOCK_MINUTES = 120;

const KEY = "nookspace.unlock-minutes.v1";

export function isValidUnlockMinutes(value: number): boolean {
  return Number.isInteger(value)
    && value >= MIN_UNLOCK_MINUTES
    && value <= MAX_UNLOCK_MINUTES;
}

export function parseUnlockMinutes(value: string | null): number {
  if (value === null || value.trim() === "") return DEFAULT_UNLOCK_MINUTES;
  const minutes = Number(value);
  return isValidUnlockMinutes(minutes) ? minutes : DEFAULT_UNLOCK_MINUTES;
}

export function getUnlockMinutes(): number {
  return parseUnlockMinutes(localStorage.getItem(KEY));
}

export function setUnlockMinutes(minutes: number): boolean {
  if (!isValidUnlockMinutes(minutes)) return false;
  localStorage.setItem(KEY, String(minutes));
  return true;
}
