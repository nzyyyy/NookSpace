import { createZoomMath, installReadingZoom } from "./reading-zoom.ts";

// Serialized into srcDoc after bundling; it has no access to the host application.
export function initializeHtmlZoom(install: typeof installReadingZoom, math: typeof createZoomMath) {
  const start = () => {
    const html = document.documentElement;
    const body = document.body;
    if (!body) return;
    html.style.height = "100%";
    html.style.overflow = "hidden";
    body.style.height = "100%";
    body.style.overflow = "hidden";
    if (getComputedStyle(body).position === "static") body.style.position = "relative";
    const viewport = document.createElement("div");
    viewport.style.position = "absolute";
    viewport.style.inset = "0";
    const space = document.createElement("div");
    space.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    while (body.firstChild) content.append(body.firstChild);
    viewport.append(space, content);
    body.append(viewport);
    const zoom = install(viewport, content, space, math(), (scale) => {
      parent.postMessage({ type: "nookspace-reading-scale", scale }, "*");
    });
    const receive = (event: MessageEvent) => {
      if (event.source === parent && event.data?.type === "nookspace-reading-reset") zoom.reset();
    };
    window.addEventListener("message", receive);
    window.addEventListener("pagehide", () => {
      window.removeEventListener("message", receive);
      zoom.destroy();
    }, { once: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

export function withHtmlReadingZoom(content: string) {
  const script = `(${initializeHtmlZoom.toString()})(${installReadingZoom.toString()}, ${createZoomMath.toString()});`;
  // Parse as HTML instead of interpolating into an existing script or quoted attribute.
  const document = new DOMParser().parseFromString(content, "text/html");
  const element = document.createElement("script");
  element.textContent = script;
  document.head.prepend(element);
  return `<!DOCTYPE html>\n${document.documentElement.outerHTML}`;
}

export function htmlReadingScale(event: Pick<MessageEvent, "source" | "data">, source: Window | null): number | null {
  if (!source || event.source !== source || event.data?.type !== "nookspace-reading-scale") return null;
  const scale: unknown = event.data.scale;
  return typeof scale === "number" && Number.isFinite(scale) && scale >= 1 && scale <= 4 ? scale : null;
}
