import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import ExcelFile from "@/lib/models/ExcelFile";
import { getAuthUser, requireManager } from "@/lib/auth";

// 8 column keys — A through H — reused across every section (mirrors Excel column letters)
const COLS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

function r(values: Partial<Record<"A"|"B"|"C"|"D"|"E"|"F"|"G"|"H", string>>): Record<string, string> {
  const row: Record<string, string> = {};
  for (const c of COLS) row[c] = values[c] ?? "";
  return row;
}

function buildVehicleRegRows(): Record<string, any>[] {
  return [
    // ── TRIP INFO ─────────────────────────────────────────────────────────────
    { ...r({ A: "Vehicle No.", B: "Route", C: "Start Date", D: "End Date", E: "Departure Time", F: "Notes" }), __bg: "#D9D9D9", __bold: true },
    r({ A: "", B: "", C: "", D: "", E: "", F: "" }),

    // blank separator
    r({}),

    // ── CASH ADVANCES ────────────────────────────────────────────────────────
    { ...r({ A: "CASH ADVANCES", B: "Date", C: "Description", D: "Amount (INR)" }), __bg: "#D9D9D9", __bold: true },
    r({ A: "", B: "", C: "Advance 1",    D: "" }),
    r({ A: "", B: "", C: "Advance 2",    D: "" }),
    r({ A: "", B: "", C: "Total Advance", D: "" }),

    // blank separator
    r({}),

    // ── DIESEL LOG ───────────────────────────────────────────────────────────
    { ...r({ A: "DIESEL LOG", B: "Date", C: "Location", D: "Litres", E: "Amount (INR)" }), __bg: "#D9D9D9", __bold: true },
    r({ A: "", B: "", C: "", D: "", E: "" }),
    r({ A: "", B: "", C: "", D: "", E: "" }),
    r({ A: "", B: "", C: "", D: "", E: "" }),
    r({ A: "", B: "", C: "", D: "", E: "" }),
    r({ A: "", B: "", C: "", D: "", E: "" }),
    r({ A: "", B: "", C: "", D: "", E: "" }),
    r({ A: "", B: "", C: "", D: "Total Diesel", E: "" }),

    // blank separator
    r({}),

    // ── KM & RUNNING ─────────────────────────────────────────────────────────
    { ...r({ A: "KM & RUNNING", B: "Total KM", C: "MT Empty KM", D: "Load KM", E: "MT Rate/km", F: "Load Rate/km", G: "MT Charges", H: "Load Charges" }), __bg: "#D9D9D9", __bold: true },
    r({ A: "", B: "", C: "", D: "", E: "", F: "", G: "", H: "" }),

    // blank separator
    r({}),

    // ── TRIP EXPENSES ────────────────────────────────────────────────────────
    { ...r({ A: "TRIP EXPENSES", B: "Chennai Fooding", C: "Kanta Slip", D: "RTO Challan", E: "Polythene", F: "Belt & Cargo Net", G: "Total Expenses" }), __bg: "#D9D9D9", __bold: true },
    r({ A: "", B: "", C: "", D: "", E: "", F: "", G: "" }),

    // blank separator
    r({}),

    // ── TRIP SUMMARY ─────────────────────────────────────────────────────────
    { ...r({ A: "TRIP SUMMARY", B: "Gross Earnings", C: "Diesel Cost", D: "MT Charges", E: "Load Charges", F: "Other Expenses", G: "Total Cost", H: "Driver Balance" }), __bg: "#D9D9D9", __bold: true },
    r({ A: "", B: "", C: "", D: "", E: "", F: "", G: "", H: "" }),
  ];
}

const TEMPLATES: Record<string, { name: string; headers: string[]; rows?: Record<string, any>[] }> = {
  vehicle: {
    name: "Vehicle Registration",
    headers: [...COLS],           // columns are just A B C D E F G H
    rows: buildVehicleRegRows(),
  },
  driver: {
    name: "Driver Log",
    headers: ["Driver ID", "Name", "License Number", "Phone", "Email", "Status"],
  },
  expense: {
    name: "Expense Tracker",
    headers: ["Date", "Category", "Description", "Amount", "Vehicle ID", "Payment Method"],
  },
  blank: {
    name: "Blank Spreadsheet",
    headers: ["Column 1", "Column 2", "Column 3"],
  },
};

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireManager(user);

    const body = await request.json();
    const { template, name, headers } = body;

    await connectDB();

    let fileHeaders: string[] = [];
    let fileRows: Record<string, any>[] = [];
    let fileName = name || "New Spreadsheet";

    if (template && TEMPLATES[template]) {
      fileHeaders = [...TEMPLATES[template].headers];
      fileRows   = TEMPLATES[template].rows ? [...TEMPLATES[template].rows!] : [];
      if (!name) fileName = TEMPLATES[template].name;
    } else if (headers && Array.isArray(headers)) {
      fileHeaders = headers
        .filter((h: any) => typeof h === "string" && h.trim())
        .map((h: string) => h.trim());
    } else {
      fileHeaders = ["Column 1", "Column 2", "Column 3"];
    }

    if (fileHeaders.length === 0) {
      return NextResponse.json({ message: "At least one header is required" }, { status: 400 });
    }

    const excelFile = await ExcelFile.create({
      ownerId: new mongoose.Types.ObjectId(user.id),
      name: fileName,
      headers: fileHeaders,
      rows: fileRows,
    });

    return NextResponse.json({
      message: "File created successfully",
      file: {
        id: excelFile._id.toString(),
        name: excelFile.name,
        headers: excelFile.headers,
        rowCount: fileRows.length,
        createdAt: excelFile.createdAt,
        updatedAt: excelFile.updatedAt,
      },
    });
  } catch (error) {
    console.error("Create file error:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Manager access required") {
      return NextResponse.json({ message: "Manager access required" }, { status: 403 });
    }
    return NextResponse.json({ message: "Failed to create file" }, { status: 500 });
  }
}
