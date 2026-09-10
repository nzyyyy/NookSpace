import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { mermaidWheelScale } from "../src/features/detail/mermaid-zoom.ts";

test("Mermaid wheel zoom follows gesture magnitude continuously and respects limits", () => {
  const zoom = (scale, delta, mode = 0) => mermaidWheelScale(scale, delta, mode, 400);
  const small = zoom(1, -0.1);
  assert.ok(small > 1 && small < 1.002);
  assert.ok(zoom(1, -0.2) > small);
  assert.ok(Math.abs(zoom(small, 0.1) - 1) < 1e-12);
  assert.ok(Math.abs(zoom(small, -0.1) - zoom(1, -0.2)) < 1e-12);
  assert.equal(zoom(1.2345, 0), 1.2345);
  assert.equal(zoom(1, -1, 1), zoom(1, -16));
  assert.equal(zoom(1, 0.01, 2), zoom(1, 4));
  assert.equal(zoom(1, -10000), 2);
  assert.equal(zoom(1, 10000), 0.5);
  assert.equal(zoom(2, -1), 2);
  assert.equal(zoom(0.5, 1), 0.5);
  assert.equal(zoom(1, NaN), 1);
  assert.equal(zoom(1, Infinity), 1);
});

test("zoom renders retain the SVG markup identity until diagram content changes", () => {
  const file = ts.createSourceFile("MarkdownReader.tsx", readFileSync(new URL("../src/features/detail/MarkdownReader.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name.text === "MermaidBlock");
  const source = ts.transpileModule(component.getText(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const hooks = [];
  const setters = [];
  let cursor = 0;
  const render = runInNewContext(`${source}; MermaidBlock`, {
    mermaidDiagramId: 0,
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      setters[index] = (value) => { hooks[index] = value; };
      return [hooks[index], setters[index]];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!hooks[index] || deps.some((dep, i) => !Object.is(dep, hooks[index].deps[i]))) hooks[index] = { value: factory(), deps };
      return hooks[index].value;
    },
    useRef(value) { const index = cursor++; return hooks[index] ??= { current: value }; },
    useEffect() {},
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
  });
  const draw = () => { cursor = 0; return render({ block: { kind: "fence" }, dark: false }); };
  const find = (node, predicate) => node && typeof node === "object"
    ? predicate(node) ? node : node.children?.map((child) => find(child, predicate)).find(Boolean)
    : undefined;
  draw();
  setters[1]("<svg><text>Diagram</text></svg>");
  let tree = draw();
  const canvas = (tree) => find(tree, (node) => node.props?.className === "markdown-mermaid-canvas");
  const markup = canvas(tree).props.dangerouslySetInnerHTML;
  for (const value of [102, 110, 125, 150, 100]) {
    find(tree, (node) => node.type === "input").props.onChange({ target: { value: String(value) } });
    tree = draw();
    assert.strictEqual(canvas(tree).props.dangerouslySetInnerHTML, markup, "React must not rewrite innerHTML during a zoom gesture");
  }
  setters[1]("<svg><text>Updated diagram</text></svg>");
  const updated = canvas(draw()).props.dangerouslySetInnerHTML;
  assert.notStrictEqual(updated, markup);
  assert.match(updated.__html, /Updated diagram/);
});
