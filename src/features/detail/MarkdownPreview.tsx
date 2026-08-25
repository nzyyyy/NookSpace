import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";

const MARKDOWN_PLUGINS = [remarkGfm];

export default function MarkdownPreview({ content }: { content: string }) {
  if (!content.trim()) {
    return <p className="text-[13px] text-muted-foreground">还没有内容</p>;
  }
  return (
    <article className="markdown-body w-full min-w-0 max-w-full">
      <ReactMarkdown
        remarkPlugins={MARKDOWN_PLUGINS}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                if (href && /^(https?:|mailto:)/.test(href)) void openUrl(href);
              }}
            >
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-[12px] text-muted-foreground">
              远程图片未加载{alt ? `：${alt}` : ""}
            </span>
          ),
          table: ({ children }) => (
            <div className="w-full max-w-full overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
