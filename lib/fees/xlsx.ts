// Zero-dependency .xlsx workbook reader (ZIP + OOXML sharedStrings + sheets).
// Runs in both the browser (File.arrayBuffer()) and Node 20+ (tests) using the
// standard DecompressionStream("deflate-raw") API.

import { expandExcelNumericString } from "@/lib/fees/phone";

export type XlsxSheet = {
  name: string;
  rows: string[][];
};

const TEXT_DECODER = new TextDecoder("utf-8");

function decodeXmlEntities(str: string): string {
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const code = entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : "";
      }
    }
  });
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  void writer.write(copy).then(() => writer.close());
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Extract entries from a ZIP buffer keyed by normalized entry path. */
async function unzipEntries(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Locate End of Central Directory (signature 0x06054b50) scanning backwards.
  const minPos = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This file is not a valid Excel (.xlsx) workbook.");

  const cdEntries = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, Uint8Array>();

  let pos = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) break;
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);

    const name = TEXT_DECODER.decode(bytes.subarray(pos + 46, pos + 46 + nameLen)).replace(/^\/+/, "");
    pos += 46 + nameLen + extraLen + commentLen;

    // Only decompress XML / rels files we actually need.
    if (!/\.xml$|\.rels$/i.test(name)) continue;
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) continue;

    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const slice = bytes.subarray(dataStart, dataStart + compSize);

    if (method === 0) {
      entries.set(name, slice);
    } else if (method === 8) {
      entries.set(name, await inflateRaw(slice));
    }
  }
  return entries;
}

function readAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z0-9_:-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    attrs[m[1]] = decodeXmlEntities(m[2]);
  }
  return attrs;
}

/** Convert Excel column letters (A -> 0, Z -> 25, AA -> 26) to 0-based index. */
function colLettersToIndex(ref: string): number {
  const letters = ref.replace(/\d+$/, "").toUpperCase();
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1];
    // Concatenate all <t> elements inside <si> (handles both plain <t> and rich-text <r><t>).
    let text = "";
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(inner)) !== null) {
      text += decodeXmlEntities(tm[1]);
    }
    out.push(text);
  }
  return out;
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;

  while ((rm = rowRe.exec(xml)) !== null) {
    const rowBody = rm[1];
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    let nextCol = 0;

    while ((cm = cellRe.exec(rowBody)) !== null) {
      const attrs = readAttrs(cm[1]);
      const body = cm[2] ?? "";
      const col = attrs.r ? colLettersToIndex(attrs.r) : nextCol;
      nextCol = col + 1;

      const type = attrs.t ?? "";
      let value = "";

      if (type === "inlineStr") {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tm: RegExpExecArray | null;
        while ((tm = tRe.exec(body)) !== null) {
          value += decodeXmlEntities(tm[1]);
        }
      } else {
        const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
        const rawVal = vm ? decodeXmlEntities(vm[1]) : "";
        if (type === "s") {
          const idx = Number(rawVal);
          value = Number.isInteger(idx) && idx >= 0 && idx < sharedStrings.length ? sharedStrings[idx] : "";
        } else if (type === "b") {
          value = rawVal === "1" ? "TRUE" : "FALSE";
        } else if (type === "" || type === "n") {
          value = expandExcelNumericString(rawVal);
        } else {
          value = rawVal;
        }
      }

      while (cells.length < col) cells.push("");
      cells[col] = value;
    }

    if (cells.some((c) => c.trim() !== "")) {
      rows.push(cells);
    }
  }
  return rows;
}

/** Read every worksheet from an .xlsx ArrayBuffer as { name, rows }. */
export async function parseXlsx(buffer: ArrayBuffer): Promise<XlsxSheet[]> {
  const entries = await unzipEntries(buffer);
  const readText = (path: string) => {
    const data = entries.get(path);
    return data ? TEXT_DECODER.decode(data) : null;
  };

  const sharedXml = readText("xl/sharedStrings.xml");
  const sharedStrings = sharedXml ? parseSharedStrings(sharedXml) : [];

  const workbookXml = readText("xl/workbook.xml");
  const relsXml = readText("xl/_rels/workbook.xml.rels");

  const relMap = new Map<string, string>();
  if (relsXml) {
    const relRe = /<Relationship\b([^>]*?)\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = relRe.exec(relsXml)) !== null) {
      const attrs = readAttrs(m[1]);
      if (attrs.Id && attrs.Target) {
        const target = attrs.Target.replace(/^\/+/, "");
        relMap.set(attrs.Id, target.startsWith("xl/") ? target : `xl/${target}`);
      }
    }
  }

  const sheets: XlsxSheet[] = [];
  if (workbookXml) {
    const sheetRe = /<sheet\b([^>]*?)\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = sheetRe.exec(workbookXml)) !== null) {
      const attrs = readAttrs(m[1]);
      const rId = attrs["r:id"] ?? attrs.id;
      const target = rId ? relMap.get(rId) : null;
      const xml = target ? readText(target) : null;
      if (xml) {
        sheets.push({
          name: attrs.name || `Sheet ${sheets.length + 1}`,
          rows: parseWorksheetRows(xml, sharedStrings),
        });
      }
    }
  }

  // Fallback if workbook.xml wasn't standard: load xl/worksheets/sheet*.xml directly.
  if (sheets.length === 0) {
    const wsKeys = [...entries.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k)).sort();
    for (const k of wsKeys) {
      const xml = readText(k);
      if (xml) sheets.push({ name: k.split("/").pop() ?? "Sheet", rows: parseWorksheetRows(xml, sharedStrings) });
    }
  }

  if (sheets.length === 0) {
    throw new Error("No worksheets found in this Excel file.");
  }
  return sheets;
}
