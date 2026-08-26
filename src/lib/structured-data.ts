import { parseAllDocuments } from "yaml";

export type StructuredValue =
  | null
  | boolean
  | number
  | string
  | StructuredValue[]
  | { [key: string]: StructuredValue };

export type StructuredParseResult =
  | { ok: true; documents: StructuredValue[] }
  | { ok: false; reason: "invalid" | "tooLarge"; message: string };

const MAX_NODES = 10_000;
const TOO_LARGE = Symbol("structured data too large");
const CIRCULAR_ALIAS = Symbol("circular yaml alias");

function normalize(
  value: unknown,
  count: { value: number },
  ancestors = new Set<object>(),
): StructuredValue {
  count.value += 1;
  if (count.value > MAX_NODES) throw TOO_LARGE;

  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (typeof value === "object") {
    if (ancestors.has(value)) throw CIRCULAR_ALIAS;
    ancestors.add(value);
    try {
      if (Array.isArray(value)) return value.map((item) => normalize(item, count, ancestors));
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, normalize(item, count, ancestors)]),
      );
    } finally {
      ancestors.delete(value);
    }
  }
  return String(value);
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n", 1)[0];
}

export function parseStructuredDocuments(
  format: "json" | "yaml",
  content: string,
): StructuredParseResult {
  try {
    const values = format === "json"
      ? [JSON.parse(content)]
      : parseAllDocuments(content, { logLevel: "error" }).map((document) => {
          if (document.errors[0]) throw document.errors[0];
          return document.toJSON();
        });
    const count = { value: 0 };
    return { ok: true, documents: values.map((value) => normalize(value, count)) };
  } catch (error) {
    if (error === TOO_LARGE) {
      return { ok: false, reason: "tooLarge", message: "结构超过 10,000 个节点" };
    }
    if (error === CIRCULAR_ALIAS) {
      return { ok: false, reason: "invalid", message: "循环别名无法展示" };
    }
    return { ok: false, reason: "invalid", message: errorMessage(error) };
  }
}
