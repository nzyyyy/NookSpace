import { useEffect, useRef } from "react";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import {
  HighlightStyle,
  StreamLanguage,
  codeFolding,
  foldGutter,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  closeSearchPanel,
  openSearchPanel,
  searchKeymap,
  searchPanelOpen,
} from "@codemirror/search";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { minimalSetup } from "codemirror";
import type { SwitchableFormat } from "@/lib/file-types";
import type { TextSnapshot } from "@/lib/text-file-draft";
import { foldPlaceholderLabel } from "./fold-placeholder";

const csvLanguage = StreamLanguage.define({
  name: "csv",
  token(stream) {
    if (stream.eat(",")) return "punctuation";
    if (stream.peek() === '"') {
      stream.next();
      while (!stream.eol()) {
        if (stream.next() === '"') {
          if (stream.peek() === '"') stream.next();
          else break;
        }
      }
      return "string";
    }
    if (stream.match(/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/)) return "number";
    if (stream.eatWhile(/[^,\r\n"]/)) return "atom";
    stream.next();
    return null;
  },
});

function languageExtensions(format: SwitchableFormat | null): Extension {
  if (format === "md") return markdown({ completeHTMLTags: false });
  if (format === "json") return json();
  if (format === "yaml") return yaml();
  if (format === "csv") return csvLanguage.extension;
  return [];
}

const highlightStyle = HighlightStyle.define([
  { tag: t.propertyName, color: "var(--primary)", fontWeight: "500" },
  { tag: t.string, color: "var(--cm-string)" },
  { tag: t.number, color: "var(--cm-number)" },
  { tag: t.bool, color: "var(--cm-bool)" },
  { tag: t.null, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: t.keyword, color: "var(--cm-bool)" },
  { tag: t.atom, color: "var(--foreground)" },
  { tag: t.punctuation, color: "var(--muted-foreground)" },
  { tag: t.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: t.heading1, fontSize: "1.45em", fontWeight: "600", color: "var(--foreground)" },
  { tag: t.heading2, fontSize: "1.28em", fontWeight: "600", color: "var(--foreground)" },
  { tag: t.heading3, fontSize: "1.14em", fontWeight: "600", color: "var(--foreground)" },
  { tag: t.heading, fontWeight: "600", color: "var(--foreground)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--primary)", textDecoration: "underline" },
  { tag: t.url, color: "var(--primary)" },
  { tag: t.monospace, fontFamily: "var(--font-mono)", fontSize: "0.92em" },
  { tag: t.quote, color: "var(--muted-foreground)" },
  { tag: t.processingInstruction, color: "var(--muted-foreground)" },
  { tag: t.meta, color: "var(--muted-foreground)" },
]);

function openSearchKeepingPagePosition(view: EditorView) {
  const viewport = view.dom.closest<HTMLElement>("[data-slot=scroll-area-viewport]");
  const position = viewport ? { top: viewport.scrollTop, left: viewport.scrollLeft } : null;
  const opened = openSearchPanel(view);
  if (viewport && position) {
    const restore = () => {
      viewport.scrollTop = position.top;
      viewport.scrollLeft = position.left;
    };
    restore();
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
  }
  requestAnimationFrame(() => {
    const root = view.dom.closest("[data-document-search-scope]") ?? view.dom;
    const controls = [
      ["button[name=prev]", "上一个匹配"],
      ["button[name=next]", "下一个匹配"],
      ["button[name=select]", "选择全部匹配"],
      ["label:nth-of-type(1)", "区分大小写"],
      ["label:nth-of-type(2)", "使用正则表达式"],
      ["label:nth-of-type(3)", "全词匹配"],
      ["button[name=replace]", "替换当前匹配"],
      ["button[name=replaceAll]", "替换全部匹配"],
      ["button[name=close]", "关闭查找"],
    ] as const;
    for (const [selector, label] of controls) {
      const control = root.querySelector<HTMLElement>(`.cm-search ${selector}`);
      if (control?.matches("button.cm-button")) control.textContent = "";
      if (control?.tagName === "LABEL") {
        for (const node of [...control.childNodes]) {
          if (node.nodeType === Node.TEXT_NODE) node.remove();
        }
        control.querySelector("input")?.setAttribute("aria-label", label);
      }
      control?.setAttribute("title", label);
      control?.setAttribute("aria-label", label);
    }
  });
  return opened;
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "360px",
    position: "relative",
    backgroundColor: "transparent",
    color: "var(--foreground)",
    fontSize: "13px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono)",
    lineHeight: "24px",
  },
  ".cm-content": { padding: "4px 0", caretColor: "var(--primary)" },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "var(--muted-foreground)",
    border: "none",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklab, var(--muted) 55%, transparent)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--muted)",
    border: "none",
    color: "var(--muted-foreground)",
    borderRadius: "4px",
    padding: "0 4px",
  },
  ".cm-foldGutter .cm-gutterElement": {
    padding: "0 2px",
    color: "var(--muted-foreground)",
  },
  ".cm-panels": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  ".cm-panels-bottom": {
    position: "fixed",
    inset: "56px 24px auto auto",
    zIndex: "20",
    width: "max-content",
    maxWidth: "calc(100% - 16px)",
    border: "none",
    backgroundColor: "transparent",
  },
  ".cm-panel.cm-search": {
    display: "flex",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: "2px",
    padding: "6px",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    backgroundColor: "var(--background)",
    boxShadow: "0 8px 24px color-mix(in oklab, var(--foreground) 12%, transparent)",
    fontSize: "12px",
    overflowX: "auto",
    scrollbarWidth: "none",
  },
  ".cm-search br": { display: "none" },
  ".cm-search .cm-textfield": {
    flex: "1 1 84px",
    width: "84px",
    minWidth: "48px",
    maxWidth: "128px",
    height: "24px",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    backgroundColor: "var(--input)",
    color: "var(--foreground)",
    padding: "0 6px",
    outline: "none",
  },
  ".cm-search .cm-textfield:focus": { borderColor: "var(--ring)" },
  ".cm-search .cm-button": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: "24px",
    width: "24px",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    backgroundImage: "none",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    padding: "0",
    fontSize: "0",
  },
  ".cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    width: "24px",
    height: "24px",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    fontSize: "0",
    color: "var(--muted-foreground)",
    cursor: "pointer",
  },
  ".cm-search label input": { position: "absolute", inset: "0", opacity: "0" },
  ".cm-search label:has(input:checked)": {
    backgroundColor: "var(--muted)",
    color: "var(--foreground)",
  },
  ".cm-search .cm-button::before, .cm-search label::after": {
    fontSize: "15px",
    lineHeight: "1",
  },
  ".cm-search .cm-button[name=next]::before": { content: "'↓'" },
  ".cm-search .cm-button[name=prev]::before": { content: "'↑'" },
  ".cm-search .cm-button[name=select]::before": { content: "'▤'" },
  ".cm-search .cm-button[name=replace]::before": { content: "'↪'" },
  ".cm-search .cm-button[name=replaceAll]::before": { content: "'↪+'", fontSize: "13px" },
  ".cm-search label:nth-of-type(1)::after": { content: "'Aa'", fontSize: "11px" },
  ".cm-search label:nth-of-type(2)::after": { content: "'.*'", fontSize: "12px" },
  ".cm-search label:nth-of-type(3)::after": { content: "'ab'", fontSize: "11px", textDecoration: "underline" },
  ".cm-search .cm-textfield[name=search]": { order: "1" },
  ".cm-search .cm-button[name=prev]": { order: "2" },
  ".cm-search .cm-button[name=next]": { order: "3" },
  ".cm-search .cm-button[name=select]": { order: "4" },
  ".cm-search label:nth-of-type(1)": { order: "5" },
  ".cm-search label:nth-of-type(2)": { order: "6" },
  ".cm-search label:nth-of-type(3)": { order: "7" },
  ".cm-search .cm-textfield[name=replace]": { order: "8" },
  ".cm-search .cm-button[name=replace]": { order: "9" },
  ".cm-search .cm-button[name=replaceAll]": { order: "10", width: "30px" },
  ".cm-panel.cm-search [name=close]": {
    order: "11",
    position: "static",
    top: "auto",
    right: "auto",
    flex: "0 0 24px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    padding: "0",
    margin: "0",
    color: "var(--muted-foreground)",
  },
  ".cm-searchMatch": { backgroundColor: "#fde047", color: "#1c1917" },
  ".cm-searchMatch-selected": {
    backgroundColor: "#facc15",
    color: "#1c1917",
    outline: "2px solid #a16207",
    outlineOffset: "-1px",
  },
});

const searchPhrases = EditorState.phrases.of({
  Find: "查找",
  Replace: "替换",
  next: "下一个",
  previous: "上一个",
  all: "全部",
  "match case": "区分大小写",
  regexp: "正则",
  "by word": "整词",
  replace: "替换",
  "replace all": "全部替换",
  close: "关闭",
});

const modeExtensions = (readOnly: boolean, ariaLabel: string): Extension => [
  EditorState.readOnly.of(readOnly),
  EditorView.editable.of(!readOnly),
  EditorView.contentAttributes.of({ "aria-label": ariaLabel, tabindex: "0" }),
];

export default function TextEditor({
  initialContent,
  format,
  readOnly,
  ariaLabel,
  onDocumentChange,
  onEscape,
  searchOpen = false,
  onSearchOpenChange = () => undefined,
}: {
  initialContent: string;
  format: SwitchableFormat | null;
  readOnly: boolean;
  ariaLabel: string;
  onDocumentChange: (snapshot: TextSnapshot) => void;
  onEscape: () => void;
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const modeRef = useRef(new Compartment());
  const languageRef = useRef(new Compartment());
  const onDocumentChangeRef = useRef(onDocumentChange);
  const onEscapeRef = useRef(onEscape);
  const searchOpenRef = useRef(searchOpen);
  const onSearchOpenChangeRef = useRef(onSearchOpenChange);
  onDocumentChangeRef.current = onDocumentChange;
  onEscapeRef.current = onEscape;
  searchOpenRef.current = searchOpen;
  onSearchOpenChangeRef.current = onSearchOpenChange;

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    const view = new EditorView({
      doc: initialContent,
      parent,
      extensions: [
        minimalSetup,
        foldGutter(),
        codeFolding({
          preparePlaceholder: foldPlaceholderLabel,
          placeholderDOM: (_view, onclick, prepared) => {
            const span = document.createElement("span");
            span.className = "cm-foldPlaceholder";
            span.textContent = typeof prepared === "string" ? prepared : "…";
            span.onclick = onclick;
            return span;
          },
        }),
        lineNumbers(),
        syntaxHighlighting(highlightStyle),
        searchPhrases,
        keymap.of([
          { key: "Mod-f", run: openSearchKeepingPagePosition, scope: "editor search-panel" },
          ...searchKeymap,
        ]),
        keymap.of([{
          key: "Escape",
          run: () => {
            onEscapeRef.current();
            return true;
          },
        }]),
        languageRef.current.of(languageExtensions(format)),
        modeRef.current.of(modeExtensions(readOnly, ariaLabel)),
        EditorView.updateListener.of((update) => {
          const panelOpen = searchPanelOpen(update.state);
          if (panelOpen !== searchOpenRef.current) {
            searchOpenRef.current = panelOpen;
            onSearchOpenChangeRef.current(panelOpen);
          }
          if (update.docChanged) {
            const document = update.state.doc;
            onDocumentChangeRef.current(() => document.toString());
          }
        }),
        editorTheme,
      ],
    });
    viewRef.current = view;
    if (!readOnly) view.focus();
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: modeRef.current.reconfigure(modeExtensions(readOnly, ariaLabel)),
    });
    if (!readOnly) view.focus();
  }, [ariaLabel, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageRef.current.reconfigure(languageExtensions(format)),
    });
  }, [format]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || searchPanelOpen(view.state) === searchOpen) return;
    if (searchOpen) openSearchKeepingPagePosition(view);
    else closeSearchPanel(view);
  }, [searchOpen]);

  return <div ref={parentRef} className="-ml-10 min-h-0 min-w-0 flex-1 overflow-hidden" />;
}
