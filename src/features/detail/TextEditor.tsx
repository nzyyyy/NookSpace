import { useEffect, useRef } from "react";
import { minimalSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { searchKeymap } from "@codemirror/search";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import type { TextSnapshot } from "@/lib/text-file-draft";

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
});

const modeExtensions = (readOnly: boolean, ariaLabel: string) => [
  EditorState.readOnly.of(readOnly),
  EditorView.editable.of(!readOnly),
  EditorView.contentAttributes.of({ "aria-label": ariaLabel, tabindex: "0" }),
];

export default function TextEditor({
  initialContent,
  readOnly,
  ariaLabel,
  onDocumentChange,
  onEscape,
}: {
  initialContent: string;
  readOnly: boolean;
  ariaLabel: string;
  onDocumentChange: (snapshot: TextSnapshot) => void;
  onEscape: () => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const modeRef = useRef(new Compartment());
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
        lineNumbers(),
        keymap.of(searchKeymap),
        keymap.of([{
          key: "Escape",
          run: () => {
            onEscapeRef.current();
            return true;
          },
        }]),
        modeRef.current.of(modeExtensions(readOnly, ariaLabel)),
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
      effects: modeRef.current.reconfigure(modeExtensions(readOnly, ariaLabel)),
    });
    if (!readOnly) view.focus();
  }, [ariaLabel, readOnly]);

  return <div ref={parentRef} className="-ml-6 min-h-0 min-w-0 flex-1 overflow-hidden" />;
}
