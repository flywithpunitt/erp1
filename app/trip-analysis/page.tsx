"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL } from "@/lib/config";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import VehicleTripSheetModal from "@/components/VehicleTripSheetModal";

interface ExcelFile {
  id: string;
  name: string;
  headers: string[];
  rows: Record<string, any>[];
}

interface VehicleSummary {
  totalTrips: number;
  statusCounts: Record<string, number>;
  projectCounts: Record<string, number>;
  firstDate?: string;
  lastDate?: string;
}

interface MonthTripSummary {
  month: string;
  totalTrips: number;
}

interface TypeMoveSummary {
  typeMove: string;
  count: number;
}

interface CustomerSummary {
  customer: string;
  count: number;
}

interface TripDetail {
  date: string;
  typeMove: string;
}

interface TripChainEntry {
  tripNo: number;
  date: string;
  onLocation: string;
  offLocation: string;
  connected: boolean;
  typeMove: string;
  // DONE when the very next trip's ON location matches this trip's OFF location,
  // meaning the vehicle picked up from where it dropped. Otherwise ACTIVE.
  status: "ACTIVE" | "DONE";
}

interface RouteSummary {
  routeKey: string;
  origin: string;
  destination: string;
  count: number;
  trips: TripDetail[];
}

interface TimeAnalysis {
  factorySamples: number;
  avgFactoryStayHours?: number;
  destSamples: number;
  avgDestUnloadHours?: number;
}

interface DistanceAnalysis {
  samples: number;
  totalTripKm?: number;
  totalGpsKm?: number;
  totalApprovalKm?: number;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[\s._-]+/g, " ").trim();
}

function findHeader(headers: string[], candidates: string[]): string | undefined {
  const norm = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  for (const c of candidates) {
    const target = c.toLowerCase();
    const match = norm.find((h) => h.norm.includes(target));
    if (match) return match.raw;
  }
  return undefined;
}

function parseDate(value: unknown): Date | undefined {
  const v = normalizeUiValue(value);
  if (!v) return undefined;
  if (v instanceof Date) return v;
  const str = String(v).trim();
  if (!str) return undefined;
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  return undefined;
}

function normalizeUiValue(value: unknown): string | number | Date {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("w" in obj && obj.w !== undefined && obj.w !== null) {
      return String(obj.w);
    }
    if ("v" in obj && obj.v !== undefined && obj.v !== null) {
      return normalizeUiValue(obj.v);
    }
    if (typeof obj.text === "string") return obj.text;
    if ("result" in obj) return normalizeUiValue(obj.result);
    if (Array.isArray(obj.richText)) {
      return obj.richText
        .map((part) =>
          typeof part === "object" && part && "text" in part
            ? String((part as { text?: unknown }).text ?? "")
            : ""
        )
        .join("");
    }
    try {
      return JSON.stringify(obj);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatCellForUi(value: unknown): string {
  const v = normalizeUiValue(value);
  if (v instanceof Date) return v.toISOString();
  if (v === null || v === undefined) return "";
  return String(v);
}

function sanitizeRowsForUi(rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return {};
    const src = row as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      out[k] = normalizeUiValue(v);
    }
    return out;
  });
}

export default function TripAnalysisPage() {
  const router = useRouter();
  const { user } = useCurrentUser();

  const [file, setFile] = useState<ExcelFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState<string>("");
  const [fileId, setFileId] = useState<string | null>(null);

  const [vehicleNotesModalOpen, setVehicleNotesModalOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setFileId(params.get("id"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);
        if (!fileId) {
          throw new Error("Missing sheet id in URL");
        }
        const res = await fetch(`${API_BASE_URL}/api/excel/${fileId}`, {
          credentials: "include",
        });
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 401) {
            router.push("/login");
            return;
          }
          throw new Error("Failed to load sheet");
        }
        const data = await res.json();
        if (!data.file) throw new Error("File not found");
        const incoming = data.file as ExcelFile;
        setFile({
          ...incoming,
          headers: Array.isArray(incoming.headers) ? incoming.headers : [],
          rows: sanitizeRowsForUi(incoming.rows),
        });
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load sheet");
        setFile(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [fileId, router, user?.role]);

  const {
    vehicleHeader,
    statusHeader,
    projectHeader,
    dateHeader,
    vehicleOptions,
    filteredRows,
    summary,
    tripsByMonth,
    typeMoveSummary,
    maxTripCount,
    customerSummary,
    topRoutes,
    timeAnalysis,
    distanceAnalysis,
    tripChain,
  } = useMemo(() => {
    if (!file) {
      return {
        vehicleHeader: undefined,
        statusHeader: undefined,
        projectHeader: undefined,
        dateHeader: undefined,
        vehicleOptions: [] as string[],
        filteredRows: [] as Record<string, any>[],
        summary: undefined as VehicleSummary | undefined,
        tripsByMonth: [] as MonthTripSummary[],
        typeMoveSummary: [] as TypeMoveSummary[],
        maxTripCount: 0,
        customerSummary: [] as CustomerSummary[],
        topRoutes: [] as RouteSummary[],
        timeAnalysis: {
          factorySamples: 0,
          destSamples: 0,
        } as TimeAnalysis,
        distanceAnalysis: {
          samples: 0,
        } as DistanceAnalysis,
        tripChain: [] as TripChainEntry[],
      };
    }

    const headers = Array.isArray(file.headers) ? file.headers : [];
    const vehicleHeader = findHeader(headers, ["vehicle no", "vehicle", "truck", "vehicle number"]);
    const statusHeader = findHeader(headers, ["current status", "status"]);
    const projectHeader = findHeader(headers, ["current project", "project", "customer"]);
    const dateHeader = findHeader(headers, ["placement date", "date", "trip date"]);

    const monthHeader = findHeader(headers, ["month"]);
    const originHeader = findHeader(headers, ["origin", "from"]);
    const destinationHeader = findHeader(headers, ["destination", "to"]);
    const typeMovesHeader = findHeader(headers, [
      "type -moves (dry/trip)",
      "type -moves",
      "type moves",
      "moves (dry/trip)",
      "moves",
    ]);
    const factoryReachHeader = findHeader(headers, [
      "factory reach date & time",
      "factory reach",
      "plant in",
    ]);
    const factoryOutHeader = findHeader(headers, [
      "factory out date & time",
      "factory out",
      "plant out",
    ]);
    const destReachHeader = findHeader(headers, [
      "reached date & time at dest",
      "dest reach",
      "destination reach",
    ]);
    const destUnloadHeader = findHeader(headers, [
      "unloading date & time dest",
      "unloading date & time",
      "dest unload",
    ]);
    const tripStartKmHeader = findHeader(headers, ["trip start km", "start km"]);
    const tripEndKmHeader = findHeader(headers, ["trip end km", "end km"]);
    const tripKmHeader = findHeader(headers, ["trip km", "total trip km"]);
    const gpsKmHeader = findHeader(headers, ["gps km"]);
    const approvalKmHeader = findHeader(headers, ["approval km", "approved km"]);

    const rows = Array.isArray(file.rows) ? file.rows : [];

    const vehicleSet = new Set<string>();
    rows.forEach((row) => {
      if (vehicleHeader && row[vehicleHeader]) {
        vehicleSet.add(String(row[vehicleHeader]).trim());
      }
    });
    const vehicleOptions = Array.from(vehicleSet).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );

    const activeVehicle =
      selectedVehicle && vehicleOptions.includes(selectedVehicle)
        ? selectedVehicle
        : vehicleOptions[0];

    const filteredRows = activeVehicle
      ? rows.filter(
          (row) =>
            vehicleHeader &&
            String(row[vehicleHeader] ?? "").trim() === activeVehicle
        )
      : rows;

    let summary: VehicleSummary | undefined;
    if (filteredRows.length > 0) {
      const statusCounts: Record<string, number> = {};
      const projectCounts: Record<string, number> = {};
      let firstDate: Date | undefined;
      let lastDate: Date | undefined;

      filteredRows.forEach((row) => {
        if (statusHeader) {
          const s = String(row[statusHeader] ?? "").trim();
          if (s) statusCounts[s] = (statusCounts[s] || 0) + 1;
        }
        if (projectHeader) {
          const p = String(row[projectHeader] ?? "").trim();
          if (p) projectCounts[p] = (projectCounts[p] || 0) + 1;
        }
        if (dateHeader) {
          const d = parseDate(row[dateHeader]);
          if (d) {
            if (!firstDate || d < firstDate) firstDate = d;
            if (!lastDate || d > lastDate) lastDate = d;
          }
        }
      });

      summary = {
        totalTrips: filteredRows.length,
        statusCounts,
        projectCounts,
        firstDate: firstDate?.toLocaleString(),
        lastDate: lastDate?.toLocaleString(),
      };
    }

    const byMonth: Record<string, MonthTripSummary> = {};
    const byTypeMove: Record<string, TypeMoveSummary> = {};
    const byCustomer: Record<string, CustomerSummary> = {};
    const byRoute: Record<string, RouteSummary> = {};
    let maxTripCount = 0;

    let factorySamples = 0;
    let factoryHoursTotal = 0;
    let destSamples = 0;
    let destHoursTotal = 0;
    let distanceSamples = 0;
    let totalTripKm = 0;
    let totalGpsKm = 0;
    let totalApprovalKm = 0;

    const toNumber = (v: unknown): number | undefined => {
      if (v === undefined || v === null) return undefined;
      const n = Number(String(v).replace(/,/g, "").trim());
      return Number.isFinite(n) ? n : undefined;
    };

    filteredRows.forEach((row) => {
      let key = "Unknown";
      if (monthHeader) {
        const m = String(row[monthHeader] ?? "").trim();
        if (m) key = m;
      } else if (dateHeader) {
        const d = parseDate(row[dateHeader]);
        if (d) {
          const monthLabel = d.toLocaleString("default", { month: "short", year: "2-digit" });
          key = monthLabel;
        }
      }
      if (!byMonth[key]) {
        byMonth[key] = { month: key, totalTrips: 0 };
      }
      byMonth[key].totalTrips += 1;
      maxTripCount = Math.max(maxTripCount, byMonth[key].totalTrips);

      if (typeMovesHeader) {
        const raw = String(row[typeMovesHeader] ?? "").trim();
        const label = raw || "Unknown";
        if (!byTypeMove[label]) {
          byTypeMove[label] = { typeMove: label, count: 0 };
        }
        byTypeMove[label].count += 1;
      }

      if (projectHeader) {
        const rawCustomer = String(row[projectHeader] ?? "").trim();
        const customerLabel = rawCustomer || "Unknown";
        if (!byCustomer[customerLabel]) {
          byCustomer[customerLabel] = { customer: customerLabel, count: 0 };
        }
        byCustomer[customerLabel].count += 1;
      }

      if (originHeader || destinationHeader) {
        const o = originHeader ? String(row[originHeader] ?? "").trim() : "";
        const d = destinationHeader ? String(row[destinationHeader] ?? "").trim() : "";
        const routeKey = `${o || "Unknown"} → ${d || "Unknown"}`;
        if (!byRoute[routeKey]) {
          byRoute[routeKey] = {
            routeKey,
            origin: o || "Unknown",
            destination: d || "Unknown",
            count: 0,
            trips: [],
          };
        }
        byRoute[routeKey].count += 1;
        const tripDate = dateHeader ? String(row[dateHeader] ?? "").trim() : "";
        const tripMove = typeMovesHeader ? String(row[typeMovesHeader] ?? "").trim() : "";
        byRoute[routeKey].trips.push({
          date: tripDate || "—",
          typeMove: tripMove || "—",
        });
      }

      if (factoryReachHeader && factoryOutHeader) {
        const inD = parseDate(row[factoryReachHeader]);
        const outD = parseDate(row[factoryOutHeader]);
        if (inD && outD && outD > inD) {
          const hours = (outD.getTime() - inD.getTime()) / (1000 * 60 * 60);
          factoryHoursTotal += hours;
          factorySamples += 1;
        }
      }

      if (destReachHeader && destUnloadHeader) {
        const reachD = parseDate(row[destReachHeader]);
        const unloadD = parseDate(row[destUnloadHeader]);
        if (reachD && unloadD && unloadD > reachD) {
          const hours = (unloadD.getTime() - reachD.getTime()) / (1000 * 60 * 60);
          destHoursTotal += hours;
          destSamples += 1;
        }
      }

      if (tripKmHeader || (tripStartKmHeader && tripEndKmHeader) || gpsKmHeader || approvalKmHeader) {
        distanceSamples += 1;
        if (tripKmHeader) {
          const v = toNumber(row[tripKmHeader]);
          if (v !== undefined) totalTripKm += v;
        } else if (tripStartKmHeader && tripEndKmHeader) {
          const start = toNumber(row[tripStartKmHeader]);
          const end = toNumber(row[tripEndKmHeader]);
          if (start !== undefined && end !== undefined && end >= start) {
            totalTripKm += end - start;
          }
        }
        if (gpsKmHeader) {
          const v = toNumber(row[gpsKmHeader]);
          if (v !== undefined) totalGpsKm += v;
        }
        if (approvalKmHeader) {
          const v = toNumber(row[approvalKmHeader]);
          if (v !== undefined) totalApprovalKm += v;
        }
      }
    });

    const tripsByMonth = Object.values(byMonth).sort((a, b) =>
      a.month.localeCompare(b.month, undefined, { numeric: true })
    );
    const typeMoveSummary = Object.values(byTypeMove).sort(
      (a, b) => b.count - a.count
    );
    const customerSummary = Object.values(byCustomer)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    const topRoutes = Object.values(byRoute)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Build trip ON/OFF chain sorted by date
    const sortedTrips = [...filteredRows].sort((a, b) => {
      const da = dateHeader ? parseDate(a[dateHeader]) : undefined;
      const db = dateHeader ? parseDate(b[dateHeader]) : undefined;
      if (da && db) return da.getTime() - db.getTime();
      return 0;
    });

    // ── Build raw entries first (status determined in a second pass) ──────────
    interface RawEntry {
      tripNo: number; date: string; onLocation: string;
      offLocation: string; connected: boolean; typeMove: string;
    }
    const rawEntries: RawEntry[] = [];

    sortedTrips
      .filter(() => originHeader || destinationHeader)
      .forEach((row, idx, arr) => {
        const origin = originHeader ? String(row[originHeader] ?? "").trim() : "";
        const dest   = destinationHeader ? String(row[destinationHeader] ?? "").trim() : "";
        const prevDest = idx > 0
          ? (destinationHeader ? String(arr[idx - 1][destinationHeader] ?? "").trim() : "")
          : "";
        const connected =
          idx > 0 &&
          prevDest !== "" &&
          origin !== "" &&
          prevDest.toLowerCase() === origin.toLowerCase();

        rawEntries.push({
          tripNo: idx + 1,
          date: dateHeader ? String(row[dateHeader] ?? "").trim() || "—" : "—",
          onLocation: origin || "—",
          offLocation: dest || "—",
          connected,
          typeMove: typeMovesHeader ? String(row[typeMovesHeader] ?? "").trim() || "—" : "—",
        });
      });

    // ── Status rule: a trip is DONE when the next trip's ON = this trip's OFF ─
    // (vehicle was picked up from where it was dropped → leg is closed)
    // Last trip always stays ACTIVE (no next trip to confirm delivery).
    const tripChain: TripChainEntry[] = rawEntries.map((entry, i) => {
      const next = rawEntries[i + 1];
      const offNorm = entry.offLocation.toLowerCase();
      const status: "ACTIVE" | "DONE" =
        next &&
        entry.offLocation !== "—" &&
        next.onLocation !== "—" &&
        next.onLocation.toLowerCase() === offNorm
          ? "DONE"
          : "ACTIVE";
      return { ...entry, status };
    });

    return {
      vehicleHeader,
      statusHeader,
      projectHeader,
      dateHeader,
      vehicleOptions,
      filteredRows,
      summary,
      tripsByMonth,
      typeMoveSummary,
      maxTripCount,
      customerSummary,
      topRoutes,
      tripChain,
      timeAnalysis: {
        factorySamples,
        avgFactoryStayHours:
          factorySamples > 0 ? factoryHoursTotal / factorySamples : undefined,
        destSamples,
        avgDestUnloadHours:
          destSamples > 0 ? destHoursTotal / destSamples : undefined,
      },
      distanceAnalysis: {
        samples: distanceSamples,
        totalTripKm: distanceSamples > 0 ? totalTripKm : undefined,
        totalGpsKm: distanceSamples > 0 ? totalGpsKm : undefined,
        totalApprovalKm: distanceSamples > 0 ? totalApprovalKm : undefined,
      },
    };
  }, [file, selectedVehicle]);

  useEffect(() => {
    if (!selectedVehicle && vehicleOptions.length > 0) {
      setSelectedVehicle(vehicleOptions[0]);
    }
  }, [vehicleOptions, selectedVehicle]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4" />
          <p className="text-slate-400">Loading trip analysis...</p>
        </div>
      </div>
    );
  }

  if (!file) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-red-400">{error || "Sheet not found"}</p>
          <Link
            href={user?.role === "ADMIN" ? "/admin/dashboard" : "/manager/dashboard"}
            className="inline-flex px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-medium hover:bg-cyan-600"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="border-b border-slate-800 bg-slate-900/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link
              href={user?.role === "ADMIN" ? "/admin/dashboard" : "/manager/dashboard"}
              className="text-sm text-slate-400 hover:text-slate-200"
            >
              ← Back
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-100">
                Trip analysis
              </h1>
              <p className="text-xs text-slate-400">
                {file.name}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/40 text-xs text-red-300">
            {error}
          </div>
        )}

        <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 justify-between">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-100">
                Select vehicle for analysis
              </h2>
              {!vehicleHeader && (
                <p className="text-xs text-amber-300/90">
                  Could not find a column like &quot;Vehicle No&quot; – showing all rows.
                </p>
              )}
            </div>
            {vehicleOptions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-300">Vehicle</label>
                  <select
                    value={selectedVehicle}
                    onChange={(e) => setSelectedVehicle(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100 min-w-[140px]"
                  >
                    {vehicleOptions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedVehicle && (
                  <button
                    type="button"
                    onClick={() => setVehicleNotesModalOpen(true)}
                    className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/50 text-xs font-medium text-cyan-300 hover:bg-cyan-500/25"
                  >
                    Vehicle notes
                  </button>
                )}
              </div>
            )}
          </div>

          {summary ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Total trips</p>
                <p className="text-2xl font-semibold text-cyan-400">
                  {summary.totalTrips}
                </p>
              </div>
              <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Status breakdown</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(summary.statusCounts).map(([status, count]) => (
                    <span
                      key={status}
                      className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-100"
                    >
                      {status}:{" "}
                      <span className="ml-1 text-cyan-300 font-medium">
                        {count}
                      </span>
                    </span>
                  ))}
                  {Object.keys(summary.statusCounts).length === 0 && (
                    <span className="text-xs text-slate-500">No status column</span>
                  )}
                </div>
              </div>
              <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3 space-y-1">
                <p className="text-xs text-slate-400 mb-1">Trip window</p>
                <p className="text-xs text-slate-200">
                  {summary.firstDate ? summary.firstDate : "No dates found"}
                </p>
                {summary.lastDate && summary.lastDate !== summary.firstDate && (
                  <p className="text-xs text-slate-400">
                    to {summary.lastDate}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              No rows found for this vehicle.
            </p>
          )}
        </section>

        {vehicleNotesModalOpen && selectedVehicle && fileId && (
          <VehicleTripSheetModal
            open={vehicleNotesModalOpen}
            onClose={() => setVehicleNotesModalOpen(false)}
            fileId={fileId}
            vehicleNumber={selectedVehicle}
          />
        )}

        <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Common routes</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                All trips with route, date and move type.
              </p>
            </div>
            {topRoutes.length > 0 && (
              <span className="text-[11px] text-slate-400">
                {topRoutes.reduce((s, r) => s + r.trips.length, 0)} trip
                {topRoutes.reduce((s, r) => s + r.trips.length, 0) === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {topRoutes.length === 0 ? (
            <p className="px-4 py-6 text-xs text-slate-400">
              No origin / destination columns found for this sheet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-800/80">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-300 whitespace-nowrap">Route</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-300 whitespace-nowrap">Trip Date</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-300 whitespace-nowrap">Type / Move</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {topRoutes.map((r) =>
                    r.trips.map((t, i) => (
                      <tr key={`${r.routeKey}-${i}`} className="hover:bg-slate-800/60 transition-colors">
                        <td className="px-3 py-2 text-slate-100 whitespace-nowrap font-medium">
                          {r.origin}
                          <span className="mx-1 text-slate-500">→</span>
                          {r.destination}
                        </td>
                        <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{t.date}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border ${
                            t.typeMove.toUpperCase().includes("DRY")
                              ? "bg-amber-500/10 border-amber-500/40 text-amber-300"
                              : t.typeMove === "—"
                              ? "bg-slate-800 border-slate-700 text-slate-400"
                              : "bg-cyan-500/10 border-cyan-500/40 text-cyan-300"
                          }`}>
                            {t.typeMove}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Trip ON / OFF sequence</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Consecutive trips — if the next trip&apos;s ON location matches the previous OFF, they are linked.
              </p>
            </div>
            {tripChain.length > 0 && (
              <span className="text-[11px] text-slate-400">{tripChain.length} trip{tripChain.length === 1 ? "" : "s"}</span>
            )}
          </div>

          {tripChain.length === 0 ? (
            <p className="px-4 py-6 text-xs text-slate-400">
              No origin / destination data found for this vehicle.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-800/80">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-300 whitespace-nowrap">#</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-300 whitespace-nowrap">Date</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-300 whitespace-nowrap">ON (Origin)</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-300 whitespace-nowrap">OFF (Destination)</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-300 whitespace-nowrap">Type / Move</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-300 whitespace-nowrap">Trip Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {tripChain.map((t, idx) => (
                    <tr
                      key={idx}
                      className={`transition-colors ${
                        t.status === "DONE"
                          ? "bg-emerald-950/20 hover:bg-emerald-950/40"
                          : "hover:bg-slate-800/50"
                      }`}
                    >
                      <td className="px-3 py-2 text-slate-400 font-mono">{t.tripNo}</td>
                      <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{t.date}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-100">
                          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0" />
                          {t.onLocation}
                        </span>
                        {!t.connected && (
                          <span className="ml-2 text-[10px] text-cyan-500 font-semibold tracking-wide">BASE</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-100">
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${t.status === "DONE" ? "bg-emerald-400" : "bg-rose-400"}`} />
                          {t.offLocation}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border ${
                          t.typeMove.toUpperCase().includes("DRY")
                            ? "bg-amber-500/10 border-amber-500/40 text-amber-300"
                            : t.typeMove === "—"
                            ? "bg-slate-800 border-slate-700 text-slate-400"
                            : "bg-cyan-500/10 border-cyan-500/40 text-cyan-300"
                        }`}>
                          {t.typeMove}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {t.status === "DONE" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-none" />
                            DONE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/40 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                            ACTIVE
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">
              Trip rows
            </h3>
            <p className="text-xs text-slate-400">
              Showing {filteredRows.length} row{filteredRows.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-800/80">
                <tr>
                  {file.headers.map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left font-semibold text-slate-200 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredRows.map((row, idx) => (
                  <tr
                    key={idx}
                    className="hover:bg-slate-800/70 transition-colors"
                  >
                    {file.headers.map((h) => (
                      <td
                        key={h}
                        className="px-3 py-1.5 text-slate-200 whitespace-nowrap"
                      >
                        {formatCellForUi(row[h])}
                      </td>
                    ))}
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={file.headers.length || 1}
                      className="px-3 py-4 text-center text-slate-400"
                    >
                      No rows to display.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

