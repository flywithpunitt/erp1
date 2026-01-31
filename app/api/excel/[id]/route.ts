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

    // Admin can view any file, Manager can only view their own
    const query: any = { _id: id };
    if (user.role !== "ADMIN") {
      query.ownerId = new mongoose.Types.ObjectId(user.id);
    }

    const file = await ExcelFile.findOne(query);

    if (!file) {
      return NextResponse.json({ message: "File not found" }, { status: 404 });
    }

    return NextResponse.json({
      file: {
        id: file._id.toString(),
        name: file.name,
        headers: file.headers,
        rows: file.rows,
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
    const { name, headers, rows } = body;

    await connectDB();

    // Admin can edit any file, Manager can only edit their own
    const query: any = { _id: id };
    if (user.role !== "ADMIN") {
      query.ownerId = new mongoose.Types.ObjectId(user.id);
    }

    const file = await ExcelFile.findOne(query);

    if (!file) {
      return NextResponse.json({ message: "File not found" }, { status: 404 });
    }

    if (name !== undefined) {
      file.name = String(name).trim();
    }

    if (headers !== undefined) {
      if (!Array.isArray(headers)) {
        return NextResponse.json({ message: "Headers must be an array" }, { status: 400 });
      }
      file.headers = headers.filter((h: any) => typeof h === "string" && h.trim()).map((h: string) => h.trim());
    }

    if (rows !== undefined) {
      if (!Array.isArray(rows)) {
        return NextResponse.json({ message: "Rows must be an array" }, { status: 400 });
      }
      file.rows = rows;
    }

    await file.save();

    return NextResponse.json({
      message: "File updated successfully",
      file: {
        id: file._id.toString(),
        name: file.name,
        headers: file.headers,
        rows: file.rows,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
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

