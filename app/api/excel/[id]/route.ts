import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import ExcelFile from "@/lib/models/ExcelFile";
import { getAuthUser, requireAdminOrManager, requireManager } from "@/lib/auth";

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

    // Use collection.findOne so ALL MongoDB fields are returned regardless
    // of the Mongoose model's cached schema (celldata may postdate it).
    const objectIdForGet = new mongoose.Types.ObjectId(id);
    const getFilter: Record<string, any> = { _id: objectIdForGet };
    if (user.role !== "ADMIN") {
      getFilter.ownerId = new mongoose.Types.ObjectId(user.id);
    }
    const file = await ExcelFile.collection.findOne(getFilter) as any;
    console.log("[API-GET] celldata in DB:", Array.isArray(file?.celldata) ? file.celldata.length + " cells" : "none");

    if (!file) {
      return NextResponse.json({ message: "File not found" }, { status: 404 });
    }

    return NextResponse.json({
      file: {
        id: file._id.toString(),
        name: file.name,
        headers: file.headers,
        rows: file.rows,
        celldata: Array.isArray(file.celldata) && file.celldata.length > 0 ? file.celldata : null,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      },
    });
  } catch (error) {
    console.error("Get file error:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Manager access required") {
      return NextResponse.json({ message: "Manager access required" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "Admin or Manager access required") {
      return NextResponse.json({ message: "Admin or Manager access required" }, { status: 403 });
    }
    return NextResponse.json({ message: "Failed to get file" }, { status: 500 });
  }
}

export async function PUT(
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

    const body = await request.json();
    const { name, headers, rows, celldata } = body;

    await connectDB();

    // Build the $set payload
    const setFields: Record<string, any> = {};

    if (name !== undefined) {
      setFields.name = String(name).trim();
    }

    if (headers !== undefined) {
      if (!Array.isArray(headers)) {
        return NextResponse.json({ message: "Headers must be an array" }, { status: 400 });
      }
      setFields.headers = headers.filter((h: any) => typeof h === "string").map((h: string) => h.trim());
    }

    if (rows !== undefined) {
      if (!Array.isArray(rows)) {
        return NextResponse.json({ message: "Rows must be an array" }, { status: 400 });
      }
      setFields.rows = rows;
    }

    if (Array.isArray(celldata) && celldata.length > 0) {
      setFields.celldata = celldata;
    }

    console.log("[API-PUT] setFields keys:", Object.keys(setFields), "celldata cells:", Array.isArray(celldata) ? celldata.length : "none");

    if (Object.keys(setFields).length === 0) {
      return NextResponse.json({ message: "Nothing to update" }, { status: 400 });
    }

    const objectId = new mongoose.Types.ObjectId(id);

    // Use collection.updateOne — the most direct MongoDB write, completely
    // bypassing Mongoose schema validation and strict-mode caching so that
    // celldata is always written regardless of model state.
    const ownerFilter: Record<string, any> = { _id: objectId };
    if (user.role !== "ADMIN") {
      ownerFilter.ownerId = new mongoose.Types.ObjectId(user.id);
    }
    const writeResult = await ExcelFile.collection.updateOne(ownerFilter, { $set: setFields });
    console.log("[API-PUT] writeResult:", JSON.stringify(writeResult));

    if (writeResult.matchedCount === 0) {
      return NextResponse.json({ message: "File not found" }, { status: 404 });
    }

    // Fetch the updated document for the response
    const updated = await ExcelFile.collection.findOne(ownerFilter) as any;

    return NextResponse.json({
      message: "File updated successfully",
      file: {
        id: updated._id.toString(),
        name: updated.name,
        headers: updated.headers,
        rows: updated.rows,
        celldata: Array.isArray(updated.celldata) && updated.celldata.length > 0 ? updated.celldata : null,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update file error:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Manager access required") {
      return NextResponse.json({ message: "Manager access required" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "Admin or Manager access required") {
      return NextResponse.json({ message: "Admin or Manager access required" }, { status: 403 });
    }
    return NextResponse.json({ message: "Failed to update file" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    requireManager(user);

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ message: "Invalid file ID" }, { status: 400 });
    }

    await connectDB();

    const file = await ExcelFile.findOneAndDelete({
      _id: id,
      ownerId: new mongoose.Types.ObjectId(user.id),
    });

    if (!file) {
      return NextResponse.json({ message: "File not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "File deleted successfully" });
  } catch (error) {
    console.error("Delete file error:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Manager access required") {
      return NextResponse.json({ message: "Manager access required" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "Admin or Manager access required") {
      return NextResponse.json({ message: "Admin or Manager access required" }, { status: 403 });
    }
    return NextResponse.json({ message: "Failed to delete file" }, { status: 500 });
  }
}

