export function clampPaneWidth(
  desiredWidth: number,
  availableWidth: number,
  minimumWidth: number,
  siblingMinimumWidth: number,
) {
  const maximumWidth = Math.max(minimumWidth, availableWidth - siblingMinimumWidth);
  return Math.min(Math.max(desiredWidth, minimumWidth), maximumWidth);
}
