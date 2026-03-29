/** Same key for save + load so dropdown / DB whitespace differences do not break lookup. */
export function normalizeVehicleKey(s: string): string {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  try {
    return t.normalize("NFKC");
  } catch {
    return t;
  }
}

export type DieselLogRow = {
  date: string;
  place: string;
  litres: string;
  amount: string;
};

export type CashAdvanceRow = {
  date: string;
  amount: string;
};

export type MiscExpenseRow = {
  remark: string;
  amount: string;
};

export type VehicleTripSheetPayload = {
  vehicleDetails: {
    vehicleNo: string;
    driverName: string;
    driverPhone: string;
    date: string;
    origin: string;
    destination1: string;
    destination2: string;
  };
  cashAdvances: CashAdvanceRow[];
  dieselLog: DieselLogRow[];
  miscExpenses: MiscExpenseRow[];
  tolls: {
    fromFbdToHwr: string;
    fromHwrToFbd: string;
  };
  kmRunning: {
    totalKm: string;
    mtKm: string;
    mtRatePerKm: string;
    loadKm: string;
    loadRatePerKm: string;
  };
  deductions: {
    anyDeduction: string;
  };
  tripSummary: {
    tripAmount: string;
    tteAmount: string;
  };
};

export function parseAmount(s: string | undefined): number {
  if (s == null) return 0;
  const n = parseFloat(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function formatInr(n: number): string {
  if (!Number.isFinite(n)) return "₹ 0";
  const rounded = Math.round(n * 100) / 100;
  return `₹ ${rounded.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function emptyTripSheet(): VehicleTripSheetPayload {
  return {
    vehicleDetails: {
      vehicleNo: "",
      driverName: "",
      driverPhone: "",
      date: "",
      origin: "",
      destination1: "",
      destination2: "",
    },
    cashAdvances: [{ date: "", amount: "" }],
    dieselLog: [{ date: "", place: "", litres: "", amount: "" }],
    miscExpenses: [{ remark: "", amount: "" }],
    tolls: { fromFbdToHwr: "", fromHwrToFbd: "" },
    kmRunning: {
      totalKm: "",
      mtKm: "",
      mtRatePerKm: "",
      loadKm: "",
      loadRatePerKm: "",
    },
    deductions: { anyDeduction: "" },
    tripSummary: { tripAmount: "", tteAmount: "" },
  };
}

export type TripSheetComputed = {
  totalAdvance: number;
  totalLitres: number;
  totalDieselAmount: number;
  totalMiscExpenses: number;
  totalToll: number;
  mtCharges: number;
  loadCharges: number;
  totalTripExpenditure: number;
  driverBalance: number;
};

export function computeTripSheetTotals(t: VehicleTripSheetPayload): TripSheetComputed {
  const totalAdvance = t.cashAdvances.reduce((sum, row) => sum + parseAmount(row.amount), 0);

  let totalLitres = 0;
  let totalDieselAmount = 0;
  for (const row of t.dieselLog) {
    totalLitres += parseAmount(row.litres);
    totalDieselAmount += parseAmount(row.amount);
  }

  const totalMiscExpenses = t.miscExpenses.reduce(
    (sum, row) => sum + parseAmount(row.amount),
    0
  );

  const totalToll =
    parseAmount(t.tolls.fromFbdToHwr) + parseAmount(t.tolls.fromHwrToFbd);

  const mtKm = parseAmount(t.kmRunning.mtKm);
  const loadKm = parseAmount(t.kmRunning.loadKm);
  const mtRate = parseAmount(t.kmRunning.mtRatePerKm);
  const loadRate = parseAmount(t.kmRunning.loadRatePerKm);
  const mtCharges = mtKm * mtRate;
  const loadCharges = loadKm * loadRate;

  const anyDeduction = parseAmount(t.deductions.anyDeduction);
  const totalTripExpenditure =
    totalAdvance +
    totalDieselAmount +
    totalMiscExpenses +
    totalToll +
    mtCharges +
    loadCharges +
    anyDeduction;

  const tripAmount = parseAmount(t.tripSummary.tripAmount);
  const driverBalance = tripAmount - totalTripExpenditure;

  return {
    totalAdvance,
    totalLitres,
    totalDieselAmount,
    totalMiscExpenses,
    totalToll,
    mtCharges,
    loadCharges,
    totalTripExpenditure,
    driverBalance,
  };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/** Coerce MongoDB / JSON values to form strings (Mixed fields may be numbers). */
function asStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Long text fields — never stringify Date objects into notes. */
function asTextStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function asDateInputStr(v: unknown): string {
  const s = asStr(v);
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return s.slice(0, 10);
}

/** Merge partial trip sheet from API into a full shape (safe for old documents). */
export function normalizeTripSheet(raw: unknown): VehicleTripSheetPayload {
  const base = emptyTripSheet();
  if (!isRecord(raw)) return base;

  const vd = isRecord(raw.vehicleDetails) ? raw.vehicleDetails : {};
  base.vehicleDetails = {
    vehicleNo: asStr(vd.vehicleNo),
    driverName: asTextStr(vd.driverName),
    driverPhone: asTextStr(vd.driverPhone),
    date: asDateInputStr(vd.date),
    origin: asTextStr(vd.origin),
    destination1: asTextStr(vd.destination1),
    destination2: asTextStr(vd.destination2),
  };

  if (Array.isArray(raw.cashAdvances) && raw.cashAdvances.length > 0) {
    base.cashAdvances = raw.cashAdvances.map((row) => {
      if (!isRecord(row)) return { date: "", amount: "" };
      return {
        date: asDateInputStr(row.date),
        amount: asStr(row.amount),
      };
    });
  }

  if (Array.isArray(raw.dieselLog) && raw.dieselLog.length > 0) {
    base.dieselLog = raw.dieselLog.map((row) => {
      if (!isRecord(row)) return { date: "", place: "", litres: "", amount: "" };
      return {
        date: asDateInputStr(row.date),
        place: asTextStr(row.place),
        litres: asStr(row.litres),
        amount: asStr(row.amount),
      };
    });
  }

  if (Array.isArray(raw.miscExpenses) && raw.miscExpenses.length > 0) {
    base.miscExpenses = raw.miscExpenses.map((row) => {
      if (!isRecord(row)) return { remark: "", amount: "" };
      return {
        remark: asTextStr(row.remark),
        amount: asStr(row.amount),
      };
    });
  }

  const tolls = isRecord(raw.tolls) ? raw.tolls : {};
  base.tolls = {
    fromFbdToHwr: asStr(tolls.fromFbdToHwr),
    fromHwrToFbd: asStr(tolls.fromHwrToFbd),
  };

  const km = isRecord(raw.kmRunning) ? raw.kmRunning : {};
  base.kmRunning = {
    totalKm: asStr(km.totalKm),
    mtKm: asStr(km.mtKm),
    mtRatePerKm: asStr(km.mtRatePerKm),
    loadKm: asStr(km.loadKm),
    loadRatePerKm: asStr(km.loadRatePerKm),
  };

  const d = isRecord(raw.deductions) ? raw.deductions : {};
  base.deductions = {
    anyDeduction: asStr(d.anyDeduction),
  };

  const ts = isRecord(raw.tripSummary) ? raw.tripSummary : {};
  base.tripSummary = {
    tripAmount: asStr(ts.tripAmount),
    tteAmount: asStr(ts.tteAmount),
  };

  return base;
}

/** Migrate legacy flat fields (pre–trip sheet) into normalized trip sheet. */
export function migrateLegacyFormToTripSheet(legacy: {
    vehicleNumber?: string;
    driverName?: string;
    remarks?: string;
    maintenanceNotes?: string;
    actionItems?: string;
    tripSheet?: unknown;
  }): VehicleTripSheetPayload {
  if (
    legacy.tripSheet &&
    isRecord(legacy.tripSheet) &&
    Object.keys(legacy.tripSheet).length > 0
  ) {
    return normalizeTripSheet(legacy.tripSheet);
  }
  const t = emptyTripSheet();
  t.vehicleDetails.vehicleNo = legacy.vehicleNumber ?? "";
  t.vehicleDetails.driverName = legacy.driverName ?? "";
  t.miscExpenses = [
    {
      remark: [legacy.remarks, legacy.maintenanceNotes, legacy.actionItems]
        .filter(Boolean)
        .join(" | "),
      amount: "",
    },
  ];
  return t;
}
