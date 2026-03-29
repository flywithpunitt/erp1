import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import connectDB from "@/lib/db";
import ExcelFile from "@/lib/models/ExcelFile";
import { getAuthUser, requireAdminOrManager } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    requireAdminOrManager(user);

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ message: "Invalid file ID" }, { status: 400 });
    }

    await connectDB();

    const objectId = new mongoose.Types.ObjectId(id);
    const filter: Record<string, any> = { _id: objectId };
    if (user.role !== "ADMIN") {
      filter.ownerId = new mongoose.Types.ObjectId(user.id);
    }
    const file = await ExcelFile.collection.findOne(filter) as any;

    if (!file) {
      return NextResponse.json({ message: "File not found" }, { status: 404 });
    }

    // Helper: Luckysheet "#d9d9d9" → ExcelJS ARGB "FFD9D9D9"
    const toArgb = (hex: string): string =>
      "FF" + hex.replace("#", "").toUpperCase().padStart(6, "0");

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sheet1");

    if (Array.isArray(file.celldata) && file.celldata.length > 0) {
      // ── Rebuild styled worksheet from saved Luckysheet celldata ──────────
      console.log("[DOWNLOAD] using celldata:", file.celldata.length, "cells");

      for (const entry of file.celldata) {
        const cv = entry.v;
        if (cv === null || cv === undefined) continue;

        // ExcelJS uses 1-based row/col
        const cell = worksheet.getCell(entry.r + 1, entry.c + 1);

        const rawVal = typeof cv === "object" ? (cv.v ?? "") : cv;
        cell.value = rawVal !== null && rawVal !== undefined ? rawVal : "";

        if (typeof cv === "object" && cv !== null) {
          // Background fill
          if (cv.bg) {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: toArgb(cv.bg) },
            } as ExcelJS.Fill;
          }

          // Font styles
          const fontProps: Partial<ExcelJS.Font> = {};
          if (cv.fc)   fontProps.color     = { argb: toArgb(cv.fc) };
          if (cv.bl)   fontProps.bold      = true;
          if (cv.it)   fontProps.italic    = true;
          if (cv.un)   fontProps.underline = "single";
          if (cv.fs)   fontProps.size      = cv.fs;
          if (cv.ff)   fontProps.name      = cv.ff;
          if (Object.keys(fontProps).length > 0) cell.font = fontProps;
        }
      }
    } else {
      // ── Fallback: plain values from headers + rows (no styling) ──────────
      console.log("[DOWNLOAD] no celldata — falling back to headers+rows");

      const headers: string[] = file.headers ?? [];
      worksheet.addRow(headers);

      (file.rows ?? []).forEach((row: any) => {
        worksheet.addRow(headers.map((h: string) => row[h] ?? ""));
      });
    }

    const rawBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(rawBuffer);
    const fileName = `${file.name}.xlsx`.replace(/[^a-z0-9._-]/gi, "_");

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("Download file error:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Admin or Manager access required") {
      return NextResponse.json({ message: "Admin or Manager access required" }, { status: 403 });
    }
    return NextResponse.json({ message: "Failed to download file" }, { status: 500 });
  }
}
