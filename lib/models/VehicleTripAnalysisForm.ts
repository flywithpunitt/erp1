import mongoose, { Schema, Document, Model } from "mongoose";

export interface IVehicleTripAnalysisForm extends Document {
  excelFileId: mongoose.Types.ObjectId;
  vehicleNumber: string;
  tripSheet?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const vehicleTripAnalysisFormSchema = new Schema<IVehicleTripAnalysisForm>(
  {
    excelFileId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "ExcelFile",
      index: true,
    },
    vehicleNumber: {
      type: String,
      required: true,
      trim: true,
    },
    tripSheet: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

vehicleTripAnalysisFormSchema.index({ excelFileId: 1, vehicleNumber: 1 }, { unique: true });

const VehicleTripAnalysisForm: Model<IVehicleTripAnalysisForm> =
  mongoose.models.VehicleTripAnalysisForm ||
  mongoose.model<IVehicleTripAnalysisForm>("VehicleTripAnalysisForm", vehicleTripAnalysisFormSchema);

export default VehicleTripAnalysisForm;
