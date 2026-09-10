export function mermaidWheelScale(scale: number, deltaY: number, deltaMode: number, viewportHeight: number) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return scale;
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? viewportHeight : 1;
  return Math.max(0.5, Math.min(2, scale * Math.exp(-deltaY * unit * 0.01)));
}
