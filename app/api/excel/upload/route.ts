import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import ExcelFile from "@/lib/models/ExcelFile";
import { getAuthUser, requireManager } from "@/lib/auth";
import {
  LUCKYSHEET_TEXT_CT,
  luckysheetValueToPlainString,
  sanitizeDisplayString,
} from "@/lib/luckysheetCelldataSerials";

function rcKey(r: number, c: number): string {
  return `${r},${c}`;
}

/**
 * ExcelJS `cell.text` is the rendered string per cell (e.g. `28-02-2026 13:00` — DD-MM-YYYY HH:mm, hyphens,
 * leading zeros). Used as the primary display map; no app-side reformatting.
 */
function buildExcelJsDisplayMap(ejsWs: ExcelJS.Worksheet | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!ejsWs) return map;
  ejsWs.eachRow({ includeEmpty: false }, (row, rowIdx) => {
    const r = rowIdx - 1;
    (row as any).eachCell({ includeEmpty: false }, (cell: ExcelJS.Cell, colIdx: number) => {
      const c = colIdx - 1;
      const t = typeof cell.text === "string" ? cell.text.trim() : "";
      if (t !== "") map.set(rcKey(r, c), sanitizeDisplayString(t));
    });
  });
  return map;
}

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

/**
 * Display priority: (1) ExcelJS `cell.text`, (2) SheetJS `w`, (3) `format_cell` SSF fallback.
 * Each step returns the string Excel would show for that cell — no forced locale pattern.
 */
function getCellDisplayAsInExcel(
  xlsxWs: XLSX.WorkSheet,
  r: number,
  c: number,
  wb: XLSX.WorkBook,
  excelJsDisplay?: string | null
): string {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = xlsxWs[addr] as XLSX.CellObject | undefined;
  if (!cell || cell.t === "z") return "";

  const ej = excelJsDisplay != null ? String(excelJsDisplay).trim() : "";
  if (ej !== "") {
    return sanitizeDisplayString(ej);
  }

  const trimmedW = cell.w != null ? String(cell.w).trim() : "";
  if (trimmedW !== "") {
    return sanitizeDisplayString(trimmedW);
  }

  const date1904 = !!wb.Workbook?.WBProps?.date1904;
  const fmtOpts = { date1904 };
  const cellForFmt = { ...cell } as XLSX.CellObject & { w?: string };
  if (cellForFmt.w === undefined || String(cellForFmt.w).trim() === "") {
    delete cellForFmt.w;
  }

  try {
    const formatted = XLSX.utils.format_cell(cellForFmt, undefined, fmtOpts);
    if (formatted != null && String(formatted).trim() !== "") {
      return sanitizeDisplayString(String(formatted).trim());
    }
  } catch {
    /* fall through */
  }

  const v = cell.v;
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return sanitizeDisplayString(v);
  if (typeof v === "object") return sanitizeDisplayString(luckysheetValueToPlainString(v));
  return sanitizeDisplayString(String(v));
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

    // ── 1. Read values via SheetJS — cellStyles helps populate z (number format) for SSF.format
    const xlsxWb = XLSX.read(buffer, { type: "buffer", cellDates: true, cellStyles: true });
    const sheetName = xlsxWb.SheetNames[0];
    const xlsxWs = xlsxWb.Sheets[sheetName];

    const jsonData = XLSX.utils.sheet_to_json(xlsxWs, { header: 1, defval: "", raw: true });
    if (jsonData.length === 0) {
      return NextResponse.json({ message: "Excel file is empty" }, { status: 400 });
    }

    const ejsWb = new ExcelJS.Workbook();
    await ejsWb.xlsx.load(bytes);
    const ejsWs = ejsWb.worksheets[0];
    const excelJsDisplayByRc = buildExcelJsDisplayMap(ejsWs);

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

          rowObj[normalized] = getCellDisplayAsInExcel(
            xlsxWs,
            rowIndex + 1,
            sourceIndex,
            xlsxWb,
            excelJsDisplayByRc.get(rcKey(rowIndex + 1, sourceIndex))
          );
        });
      
        return rowObj;
      });

    // ── 2. Styles from ExcelJS (workbook already loaded above) ────────────────
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

        const sheetR = rowIdx - 1;
        const sheetC = colIdx - 1;
        let displayStr = getCellDisplayAsInExcel(
          xlsxWs,
          sheetR,
          sheetC,
          xlsxWb,
          excelJsDisplayByRc.get(rcKey(sheetR, sheetC))
        );

        if (!displayStr) {
          const raw = cell.value;
          if (raw !== null && raw !== undefined && raw !== "") {
            if (typeof raw === "object" && !(raw instanceof Date)) {
              displayStr = sanitizeDisplayString(luckysheetValueToPlainString(raw));
            } else if (typeof raw === "number") {
              displayStr = sanitizeDisplayString(String(raw));
            }
          }
        }
        if (displayStr.length > 0) {
          lv.v = displayStr;
          lv.m = displayStr;
          lv.ct = LUCKYSHEET_TEXT_CT;
        } else {
          lv.v = null;
          lv.m = "";
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

