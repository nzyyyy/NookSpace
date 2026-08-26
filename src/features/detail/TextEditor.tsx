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
import { searchKeymap } from "@codemirror/search";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { minimalSetup } from "codemirror";
import type { SwitchableFormat } from "@/lib/file-types";
import type { TextSnapshot } from "@/lib/text-file-draft";
import { foldPlaceholderLabel } from "./fold-placeholder";
import { markdownLivePreview } from "./markdown-live-preview";

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

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "360px",
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
  ".cm-md-heading": {
    fontFamily: "var(--font-sans)",
    lineHeight: "1.45",
  },
  ".cm-md-list-mark": { color: "var(--muted-foreground)" },
});

const modeExtensions = (readOnly: boolean, ariaLabel: string, livePreview: boolean): Extension => [
  EditorState.readOnly.of(readOnly),
  EditorView.editable.of(!readOnly),
  EditorView.contentAttributes.of({ "aria-label": ariaLabel, tabindex: "0" }),
  livePreview ? markdownLivePreview() : [],
];

export default function TextEditor({
  initialContent,
  format,
  readOnly,
  livePreview,
  ariaLabel,
  onDocumentChange,
  onEscape,
}: {
  initialContent: string;
  format: SwitchableFormat | null;
  readOnly: boolean;
  livePreview: boolean;
  ariaLabel: string;
  onDocumentChange: (snapshot: TextSnapshot) => void;
  onEscape: () => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const modeRef = useRef(new Compartment());
  const languageRef = useRef(new Compartment());
  const onDocumentChangeRef = useRef(onDocumentChange);
  const onEscapeRef = useRef(onEscape);
  onDocumentChangeRef.current = onDocumentChange;
  onEscapeRef.current = onEscape;

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
        keymap.of(searchKeymap),
        keymap.of([{
          key: "Escape",
          run: () => {
            onEscapeRef.current();
            return true;
          },
        }]),
        languageRef.current.of(languageExtensions(format)),
        modeRef.current.of(modeExtensions(readOnly, ariaLabel, livePreview)),
        EditorView.updateListener.of((update) => {
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
      effects: modeRef.current.reconfigure(modeExtensions(readOnly, ariaLabel, livePreview)),
    });
    if (!readOnly) view.focus();
  }, [ariaLabel, livePreview, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageRef.current.reconfigure(languageExtensions(format)),
    });
  }, [format]);

  return <div ref={parentRef} className="-ml-10 min-h-0 min-w-0 flex-1 overflow-hidden" />;
}
