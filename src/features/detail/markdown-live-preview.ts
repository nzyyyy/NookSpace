import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

const HIDDEN = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "CodeInfo",
  "LinkMark",
  "QuoteMark",
]);

const hidden = Decoration.replace({});

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-list-mark";
    span.textContent = "• ";
    return span;
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() });

function hideUrl(node: SyntaxNode) {
  const parent = node.parent;
  if (!parent || (parent.name !== "Link" && parent.name !== "Image")) return false;
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.name !== "URL" && child.name !== "LinkMark") return true;
  }
  return false;
}

function decorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        if (name.startsWith("ATXHeading") || name.startsWith("SetextHeading")) {
          builder.add(node.from, node.from, Decoration.line({ class: "cm-md-heading" }));
        }
        if (HIDDEN.has(name) && node.from < node.to) {
          builder.add(node.from, node.to, hidden);
          return false;
        }
        if (name === "URL" && node.from < node.to && hideUrl(node.node)) {
          builder.add(node.from, node.to, hidden);
          return false;
        }
        if (name === "ListMark" && /^[-*+]\s*$/.test(view.state.doc.sliceString(node.from, node.to).trimStart())) {
          builder.add(node.from, node.to, bullet);
          return false;
        }
      },
    });
  }
  return builder.finish();
}

export function markdownLivePreview() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorations(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = decorations(update.view);
      }
    },
    { decorations: (value) => value.decorations },
  );
}
