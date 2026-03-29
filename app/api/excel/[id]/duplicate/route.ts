import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import ExcelFile from "@/lib/models/ExcelFile";
import { getAuthUser, requireManager } from "@/lib/auth";
import mongoose from "mongoose";

export async function POST(
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

    // Use collection.findOne so all MongoDB fields (including celldata) are
    // returned regardless of the Mongoose model's cached schema.
    const originalFile = await ExcelFile.collection.findOne({
      _id: new mongoose.Types.ObjectId(id),
      ownerId: new mongoose.Types.ObjectId(user.id),
    }) as any;

    if (!originalFile) {
      return NextResponse.json({ message: "File not found" }, { status: 404 });
    }

    // Insert via collection.insertOne so celldata is written even if the
    // compiled Mongoose model predates the celldata field in the schema.
    const now = new Date();
    const docToInsert: Record<string, any> = {
      ownerId: new mongoose.Types.ObjectId(user.id),
      name: `${originalFile.name} (Copy)`,
      headers: [...(originalFile.headers ?? [])],
      rows: JSON.parse(JSON.stringify(originalFile.rows ?? [])),
      createdAt: now,
      updatedAt: now,
    };

    // Copy celldata (stores all styles — bg colours, text colours, bold, etc.)
    if (Array.isArray(originalFile.celldata) && originalFile.celldata.length > 0) {
      docToInsert.celldata = JSON.parse(JSON.stringify(originalFile.celldata));
    }

    const insertResult = await ExcelFile.collection.insertOne(docToInsert);

    return NextResponse.json({
      message: "File duplicated successfully",
      file: {
        id: insertResult.insertedId.toString(),
        name: docToInsert.name,
        headers: docToInsert.headers,
        rowCount: (docToInsert.rows as any[]).length,
        createdAt: docToInsert.createdAt,
        updatedAt: docToInsert.updatedAt,
      },
    });
  } catch (error) {
    console.error("Duplicate file error:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Manager access required") {
      return NextResponse.json({ message: "Manager access required" }, { status: 403 });
    }
    return NextResponse.json({ message: "Failed to duplicate file" }, { status: 500 });
  }
}

