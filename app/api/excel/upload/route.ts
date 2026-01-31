import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import ExcelFile from "@/lib/models/ExcelFile";
import { getAuthUser, requireManager } from "@/lib/auth";

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
    const buffer = Buffer.from(bytes);

    // Read Excel file directly from buffer (works in serverless environments)
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

    if (jsonData.length === 0) {
      return NextResponse.json({ message: "Excel file is empty" }, { status: 400 });
    }

    const headers = (jsonData[0] as any[]).map((h) => String(h || "").trim()).filter((h) => h);
    const rows = (jsonData.slice(1) as any[][]).map((row: any[]) => {
      const rowObj: Record<string, any> = {};
      headers.forEach((header, index) => {
        rowObj[header] = row[index] !== undefined ? String(row[index]) : "";
      });
      return rowObj;
    });

    await connectDB();

    const excelFile = await ExcelFile.create({
      ownerId: new mongoose.Types.ObjectId(user.id),
      name: file.name.replace(/\.(xlsx|xls)$/i, ""),
      headers,
      rows,
    });

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

