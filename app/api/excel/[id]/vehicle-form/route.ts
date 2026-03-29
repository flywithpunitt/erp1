import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import ExcelFile from "@/lib/models/ExcelFile";
import VehicleTripAnalysisForm from "@/lib/models/VehicleTripAnalysisForm";
import { getAuthUser, requireAdminOrManager } from "@/lib/auth";
import {
  migrateLegacyFormToTripSheet,
  normalizeTripSheet,
  normalizeVehicleKey,
} from "@/lib/vehicleTripSheet";

/** Exact match first, then match by normalized vehicle key (fixes legacy spacing / unicode). */
async function findFormDocForVehicle(
  fileId: mongoose.Types.ObjectId,
  vehicleRaw: string
): Promise<{ doc: Record<string, unknown> | null; vehicleKey: string }> {
  const vehicleKey = normalizeVehicleKey(vehicleRaw);
  if (!vehicleKey) {
    return { doc: null, vehicleKey: "" };
  }

  let doc = (await VehicleTripAnalysisForm.collection.findOne({
    excelFileId: fileId,
    vehicleNumber: vehicleKey,
  })) as Record<string, unknown> | null;

  if (doc) {
    return { doc, vehicleKey };
  }

  const candidates = await VehicleTripAnalysisForm.collection
    .find({ excelFileId: fileId })
    .toArray();

  const match = candidates.find(
    (d) => normalizeVehicleKey(String((d as { vehicleNumber?: string }).vehicleNumber ?? "")) === vehicleKey
  );

  return {
    doc: (match as Record<string, unknown>) ?? null,
    vehicleKey,
  };
}

function excelAccessFilter(user: { id: string; role: string }, fileId: mongoose.Types.ObjectId) {
  const filter: Record<string, unknown> = { _id: fileId };
  if (user.role !== "ADMIN") {
    filter.ownerId = new mongoose.Types.ObjectId(user.id);
  }
  return filter;
}

function formPayloadFromDoc(doc: {
  _id: unknown;
  vehicleNumber: string;
  tripSheet?: unknown;
  updatedAt?: Date;
  driverName?: string;
  remarks?: string;
  maintenanceNotes?: string;
  actionItems?: string;
}) {
  return {
    id: String(doc._id),
    vehicleNumber: doc.vehicleNumber,
    tripSheet: migrateLegacyFormToTripSheet({
      vehicleNumber: doc.vehicleNumber,
      tripSheet: doc.tripSheet,
      driverName: doc.driverName,
      remarks: doc.remarks,
      maintenanceNotes: doc.maintenanceNotes,
      actionItems: doc.actionItems,
    }),
    updatedAt: doc.updatedAt,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    requireAdminOrManager(user);

    const { id } = await params;
    const vehicleRaw = request.nextUrl.searchParams.get("vehicle") ?? "";

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ message: "Invalid file ID" }, { status: 400 });
    }
    if (!normalizeVehicleKey(vehicleRaw)) {
      return NextResponse.json({ message: "Missing vehicle query" }, { status: 400 });
    }

    await connectDB();

    const fileId = new mongoose.Types.ObjectId(id);
    const file = await ExcelFile.findOne(excelAccessFilter(user, fileId)).select("_id");
    if (!file) {
      return NextResponse.json({ message: "File not found" }, { status: 404 });
    }

    const { doc } = await findFormDocForVehicle(fileId, vehicleRaw);

    if (!doc) {
      return NextResponse.json({ form: null });
    }

    return NextResponse.json({
      form: formPayloadFromDoc({
        _id: doc._id,
        vehicleNumber: doc.vehicleNumber as string,
        tripSheet: doc.tripSheet,
        updatedAt: doc.updatedAt as Date | undefined,
        ...(doc as {
          driverName?: string;
          remarks?: string;
          maintenanceNotes?: string;
          actionItems?: string;
        }),
      }),
    });
  } catch (error) {
    console.error("Vehicle form GET error:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Admin or Manager access required") {
      return NextResponse.json({ message: "Admin or Manager access required" }, { status: 403 });
    }
    return NextResponse.json({ message: "Failed to load form" }, { status: 500 });
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
    const vehicleRaw = typeof body.vehicleNumber === "string" ? body.vehicleNumber : "";
    const vehicleKey = normalizeVehicleKey(vehicleRaw);
    if (!vehicleKey) {
      return NextResponse.json({ message: "vehicleNumber is required" }, { status: 400 });
    }

    const tripSheet = body.tripSheet;
    if (tripSheet === null || tripSheet === undefined || typeof tripSheet !== "object") {
      return NextResponse.json({ message: "tripSheet object is required" }, { status: 400 });
    }

    const normalized = normalizeTripSheet(tripSheet);

    await connectDB();

    const fileId = new mongoose.Types.ObjectId(id);
    const file = await ExcelFile.findOne(excelAccessFilter(user, fileId)).select("_id");
    if (!file) {
      return NextResponse.json({ message: "File not found" }, { status: 404 });
    }

    const { doc: existing } = await findFormDocForVehicle(fileId, vehicleRaw);

    const filter = existing
      ? { _id: existing._id as mongoose.Types.ObjectId }
      : { excelFileId: fileId, vehicleNumber: vehicleKey };

    const now = new Date();
    const updated = await VehicleTripAnalysisForm.collection.findOneAndUpdate(
      filter,
      {
        $set: {
          tripSheet: normalized,
          vehicleNumber: vehicleKey,
          excelFileId: fileId,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: !existing, returnDocument: "after" }
    );

    if (!updated) {
      return NextResponse.json({ message: "Failed to save" }, { status: 500 });
    }

    return NextResponse.json({
      message: "Saved",
      form: formPayloadFromDoc({
        _id: updated._id,
        vehicleNumber: updated.vehicleNumber as string,
        tripSheet: updated.tripSheet,
        updatedAt: updated.updatedAt as Date | undefined,
      }),
    });
  } catch (error) {
    console.error("Vehicle form PUT error:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Admin or Manager access required") {
      return NextResponse.json({ message: "Admin or Manager access required" }, { status: 403 });
    }
    return NextResponse.json({ message: "Failed to save form" }, { status: 500 });
  }
}
