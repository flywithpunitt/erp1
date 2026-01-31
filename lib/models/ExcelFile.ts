import mongoose, { Schema, Document, Model } from "mongoose";

export interface IExcelFile extends Document {
  ownerId: mongoose.Types.ObjectId;
  name: string;
  headers: string[];
  rows: Record<string, any>[];
  createdAt: Date;
  updatedAt: Date;
}

const ExcelFileSchema = new Schema<IExcelFile>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "User",
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    headers: {
      type: [String],
      required: true,
      default: [],
    },
    rows: {
      type: [Schema.Types.Mixed],
      required: true,
      default: [],
    } as any,
  },
  {
    timestamps: true,
  }
);

const ExcelFile: Model<IExcelFile> =
  mongoose.models.ExcelFile || mongoose.model<IExcelFile>("ExcelFile", ExcelFileSchema);

export default ExcelFile;

