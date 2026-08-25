export function prettyJson(content: string): { ok: true; text: string } | { ok: false; text: string } {
  try {
    return { ok: true, text: JSON.stringify(JSON.parse(content), null, 2) };
  } catch {
    return { ok: false, text: content };
  }
}

export function parseCsv(content: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = content.replace(/^\uFEFF/, "");
  if (!input.trim()) return [];

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (quoted) return null;
  row.push(field);
  rows.push(row);
  return rows;
}
