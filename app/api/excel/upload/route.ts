import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import ExcelFile from "@/lib/models/ExcelFile";
import { getAuthUser, requireManager } from "@/lib/auth";

function normalizeHeaderName(value: unknown): string {
  const str = String(value ?? "");
  const normalized = str
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  try {
    return normalized.normalize("NFKC");
  } catch {
    return normalized;
  }
}

function isDateFormattedCell(cell: XLSX.CellObject | undefined): boolean {
  if (!cell) return false;
  if (cell.t === "d") return true;
  if (typeof cell.z === "string") {
    const format = cell.z.toLowerCase();
    if (/[dmyhs]/.test(format)) return true;
  }
  return false;
}

function normalizeCellValue(
  raw: unknown,
  cell: XLSX.CellObject | undefined,
  fmtDate: (d: Date) => string
): string | number {
  if (raw === null || raw === undefined || raw === "") return "";

  if (raw instanceof Date) {
    return fmtDate(raw);
  }

  if (typeof raw === "number") {
    if (isDateFormattedCell(cell)) {
      const date = XLSX.SSF.parse_date_code(raw);
      if (date) {
        return fmtDate(new Date(date.y, date.m - 1, date.d, date.H || 0, date.M || 0, date.S || 0));
      }
    }
    return raw;
  }

  if (typeof raw === "string") {
    return raw;
  }

  if (typeof raw === "boolean") {
    return raw ? "TRUE" : "FALSE";
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if ("w" in obj && obj.w !== undefined && obj.w !== null && obj.w !== "") {
      return String(obj.w);
    }
    if ("v" in obj && obj.v !== undefined && obj.v !== null && obj.v !== "") {
      return normalizeCellValue(obj.v, cell, fmtDate);
    }
    if (typeof obj.text === "string") return obj.text;
    if (Array.isArray(obj.richText)) {
      return obj.richText
        .map((part) => (typeof part === "object" && part && "text" in part ? String((part as { text?: unknown }).text ?? "") : ""))
        .join("");
    }
    if ("result" in obj) {
      return normalizeCellValue(obj.result, cell, fmtDate);
    }
    try {
      return JSON.stringify(obj);
    } catch {
      return String(raw);
    }
  }

  return String(raw);
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireManager(user);

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ message: "No file provided" }, { status: 400 });
    }

    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      return NextResponse.json({ message: "Only .xlsx and .xls files are allowed" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(bytes));

    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const fmtDate = (d: Date) =>
      `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

    // ── 1. Read values via SheetJS (fast, handles date serials) ───────────────
    const xlsxWb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = xlsxWb.SheetNames[0];
    const xlsxWs = xlsxWb.Sheets[sheetName];

    const jsonData = XLSX.utils.sheet_to_json(xlsxWs, { header: 1, defval: "", raw: true });
    if (jsonData.length === 0) {
      return NextResponse.json({ message: "Excel file is empty" }, { status: 400 });
    }

    const rawHeaders = (jsonData[0] as any[]).map((h) => normalizeHeaderName(h));
    const seenHeaders = new Map<string, number>();
    const headerMeta = rawHeaders.map((base, index) => {
      if (!base) {
        return { sourceIndex: index, normalized: "" };
      }
      const count = seenHeaders.get(base) ?? 0;
      seenHeaders.set(base, count + 1);
      const normalized = count === 0 ? base : `${base} (${count + 1})`;
      return { sourceIndex: index, normalized };
    });
    const headers = headerMeta
      .map((h) => h.normalized)
      .filter((h) => h);

      const rows = (jsonData.slice(1) as any[][]).map((row: any[], rowIndex: number) => {
        const rowObj: Record<string, any> = {};
      
        headerMeta.forEach(({ sourceIndex, normalized }) => {
          if (!normalized) return;
      
          const cellAddress = XLSX.utils.encode_cell({ r: rowIndex + 1, c: sourceIndex });
          const sheetCell = xlsxWs[cellAddress] as XLSX.CellObject | undefined;
      
          // 🔥 ADD THIS BLOCK HERE
          if (rowIndex < 40) {
            console.log("---- CELL DEBUG ----");
            console.log("Row:", rowIndex + 1, "Col:", normalized);
            console.log("Raw row value:", row[sourceIndex], typeof row[sourceIndex]);
            console.log("SheetCell:", sheetCell);
            console.log("SheetCell.v:", sheetCell?.v);
            console.log("SheetCell.w:", sheetCell?.w);
            console.log("--------------------");
          }
      
          const actualValue = sheetCell?.w ?? sheetCell?.v ?? row[sourceIndex];
      
          const finalValue = normalizeCellValue(actualValue, sheetCell, fmtDate);
      
          // 🔥 OPTIONAL EXTRA LOG
          if (rowIndex < 40) {
            console.log("FINAL VALUE:", finalValue, typeof finalValue);
            console.log("====================");
          }
      
          rowObj[normalized] = finalValue;
        });
      
        return rowObj;
      });

    // ── 2. Read styles via ExcelJS (full fill/font colour support) ────────────
    const ejsWb = new ExcelJS.Workbook();
    await ejsWb.xlsx.load(bytes);
    const ejsWs = ejsWb.worksheets[0];

    // Helper: ExcelJS ARGB "FFD9D9D9" → Luckysheet "#d9d9d9"
    const argbToHex = (argb: string | undefined): string | null => {
      if (!argb || argb.length < 6) return null;
      const rgb = argb.length === 8 ? argb.slice(2) : argb; // strip alpha byte
      return "#" + rgb.toLowerCase();
    };

    const celldata: any[] = [];

    ejsWs?.eachRow({ includeEmpty: false }, (row, rowIdx) => {
      (row as any).eachCell({ includeEmpty: false }, (cell: ExcelJS.Cell, colIdx: number) => {
        const r = rowIdx - 1; // 0-based
        const c = colIdx - 1;
        const lv: Record<string, any> = {};

        // Value
        const raw = cell.value;
        if (raw instanceof Date) {
          lv.v = fmtDate(raw); lv.m = lv.v;
        } else if (raw !== null && raw !== undefined && raw !== "") {
          lv.v = String(raw); lv.m = String(raw);
        } else {
          lv.v = null; lv.m = "";
        }

        // Background fill colour
        const fill = cell.fill as any;
        if (fill?.type === "pattern" && fill?.fgColor) {
          const bg = argbToHex(fill.fgColor.argb ?? fill.fgColor.rgb);
          if (bg && bg !== "#ffffff" && bg !== "#00000000" && bg !== "#000000") lv.bg = bg;
        }

        // Font
        const font = cell.font as any;
        if (font) {
          const fc = argbToHex(font.color?.argb ?? font.color?.rgb);
          if (fc && fc !== "#000000" && fc !== "#ff000000") lv.fc = fc;
          if (font.bold)      lv.bl = 1;
          if (font.italic)    lv.it = 1;
          if (font.underline) lv.un = 1;
          if (font.size)      lv.fs = font.size;
        }

        const hasStyle = lv.bg || lv.fc || lv.bl || lv.it || lv.un || lv.fs;
        const hasValue = lv.v !== null && lv.v !== "";
        if (hasValue || hasStyle) celldata.push({ r, c, v: lv });
      });
    });

    await connectDB();

    const now = new Date();
    const insertResult = await ExcelFile.collection.insertOne({
      ownerId: new mongoose.Types.ObjectId(user.id),
      name: file.name.replace(/\.(xlsx|xls)$/i, ""),
      headers,
      rows,
      ...(celldata.length > 0 ? { celldata } : {}),
      createdAt: now,
      updatedAt: now,
    });

    const excelFile = {
      _id: insertResult.insertedId,
      name: file.name.replace(/\.(xlsx|xls)$/i, ""),
      headers, rows, createdAt: now, updatedAt: now,
    };

    return NextResponse.json({
      message: "File uploaded successfully",
      file: {
        id: excelFile._id.toString(),
        name: excelFile.name,
        headers: excelFile.headers,
        rowCount: excelFile.rows.length,
        createdAt: excelFile.createdAt,
        updatedAt: excelFile.updatedAt,
      },
    });
  } catch (error) {
    console.error("Upload error:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Manager access required") {
      return NextResponse.json({ message: "Manager access required" }, { status: 403 });
    }
    return NextResponse.json(
      { message: "Failed to upload file", error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

