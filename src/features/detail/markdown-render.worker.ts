/// <reference lib="webworker" />

import {
  markdownBlockBatches,
  renderMarkdownBlocks,
  type MarkdownWorkerMessage,
} from "./markdown-render";

self.onmessage = (event: MessageEvent<{ content: string }>) => {
  try {
    const blocks = renderMarkdownBlocks(event.data.content);
    for (const batch of markdownBlockBatches(blocks)) {
      self.postMessage({ type: "batch", blocks: batch, total: blocks.length } satisfies MarkdownWorkerMessage);
    }
    self.postMessage({ type: "done", total: blocks.length } satisfies MarkdownWorkerMessage);
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) } satisfies MarkdownWorkerMessage);
  }
};

export {};
