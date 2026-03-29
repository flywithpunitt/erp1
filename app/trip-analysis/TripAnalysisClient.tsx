"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL } from "@/lib/config";
import { useCurrentUser } from "@/hooks/useCurrentUser";

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

interface RouteSummary {
  routeKey: string;
  origin: string;
  destination: string;
  count: number;
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
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const str = String(value).trim();
  if (!str) return undefined;
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  return undefined;
}

export default function TripAnalysisClient({ fileId }: { fileId: string | null }) {
  const router = useRouter();
  const { user } = useCurrentUser();

  const [file, setFile] = useState<ExcelFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState<string>("");

  useEffect(() => {
    if (!fileId) {
      const dashboardPath =
        user?.role === "ADMIN" ? "/admin/dashboard" : "/manager/dashboard";
      router.push(dashboardPath);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);
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
        setFile(data.file as ExcelFile);
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
          };
        }
        byRoute[routeKey].count += 1;
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
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-300">Vehicle</label>
                <select
                  value={selectedVehicle}
                  onChange={(e) => setSelectedVehicle(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100"
                >
                  {vehicleOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
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

        <section className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    Trips by month
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    How many trips this vehicle runs each month.
                  </p>
                </div>
              </div>
              {tripsByMonth.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Not enough data to draw a monthly chart.
                </p>
              ) : (
                <div className="space-y-2">
                  {tripsByMonth.map((m) => (
                    <div key={m.month} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-200">
                          {m.month || "Unknown month"}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {m.totalTrips} trip{m.totalTrips === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="h-3 rounded-md bg-slate-800 overflow-hidden flex">
                        <div
                          className="h-full bg-cyan-500/80 transition-all"
                          style={{
                            width: `${(m.totalTrips / maxTripCount) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    Trips by movement type
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Split between DRY / TRIP (or similar Type‑Moves values).
                  </p>
                </div>
              </div>
              {typeMoveSummary.length === 0 ? (
                <p className="text-xs text-slate-400">
                  No Type‑Moves column found for this sheet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {typeMoveSummary.map((t) => (
                    <div
                      key={t.typeMove}
                      className="px-3 py-2 rounded-lg bg-slate-950/40 border border-slate-800 text-xs text-slate-100 flex items-center gap-2"
                    >
                      <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-cyan-500/15 border border-cyan-500/40 text-[10px] text-cyan-300 font-semibold">
                        {t.count}
                      </span>
                      <span className="font-medium">
                        {t.typeMove || "Unknown"}
                      </span>
                      <span className="text-slate-400 text-[11px]">
                        trip{t.count === 1 ? "" : "s"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    Top customers
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Based on the &quot;Current Project&quot; / customer column.
                  </p>
                </div>
              </div>
              {customerSummary.length === 0 ? (
                <p className="text-xs text-slate-400">
                  No customer / project column found for this sheet.
                </p>
              ) : (
                <div className="space-y-2">
                  {customerSummary.map((c) => (
                    <div
                      key={c.customer}
                      className="px-3 py-2 rounded-lg bg-slate-950/40 border border-slate-800 text-xs text-slate-100 flex items-center justify-between gap-2"
                    >
                      <span className="truncate max-w-[180px]">{c.customer}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-cyan-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                        {c.count} trip{c.count === 1 ? "" : "s"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    Common routes
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Origin → Destination pairs this vehicle runs most often.
                  </p>
                </div>
              </div>
              {topRoutes.length === 0 ? (
                <p className="text-xs text-slate-400">
                  No origin / destination columns found for this sheet.
                </p>
              ) : (
                <div className="space-y-2">
                  {topRoutes.map((r) => (
                    <div
                      key={r.routeKey}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-950/40 border border-slate-800 text-xs text-slate-100"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {r.origin} → {r.destination}
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        {r.count} trip{r.count === 1 ? "" : "s"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    Factory & destination timings
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Average hours inside factory and at destination.
                  </p>
                </div>
              </div>
              {(!timeAnalysis.avgFactoryStayHours &&
                !timeAnalysis.avgDestUnloadHours) ? (
                <p className="text-xs text-slate-400">
                  Not enough timing data to calculate averages.
                </p>
              ) : (
                <div className="space-y-2 text-xs text-slate-200">
                  <div>
                    <p className="text-slate-400 mb-0.5">
                      Average time inside factory
                    </p>
                    <p className="text-sm font-semibold text-cyan-400">
                      {timeAnalysis.avgFactoryStayHours
                        ? `${timeAnalysis.avgFactoryStayHours.toFixed(1)} hrs`
                        : "—"}
                    </p>
                    {timeAnalysis.factorySamples > 0 && (
                      <p className="text-[11px] text-slate-500">
                        Over {timeAnalysis.factorySamples} trip
                        {timeAnalysis.factorySamples === 1 ? "" : "s"}.
                      </p>
                    )}
                  </div>
                  <div className="pt-1 border-t border-slate-800/80 mt-1">
                    <p className="text-slate-400 mb-0.5">
                      Avg unloading time at destination
                    </p>
                    <p className="text-sm font-semibold text-emerald-400">
                      {timeAnalysis.avgDestUnloadHours
                        ? `${timeAnalysis.avgDestUnloadHours.toFixed(1)} hrs`
                        : "—"}
                    </p>
                    {timeAnalysis.destSamples > 0 && (
                      <p className="text-[11px] text-slate-500">
                        Over {timeAnalysis.destSamples} trip
                        {timeAnalysis.destSamples === 1 ? "" : "s"}.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    Distance overview
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Total Trip KM vs GPS KM vs Approval KM.
                  </p>
                </div>
              </div>
              {!distanceAnalysis.totalTripKm &&
              !distanceAnalysis.totalGpsKm &&
              !distanceAnalysis.totalApprovalKm ? (
                <p className="text-xs text-slate-400">
                  Not enough distance data to calculate totals.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
                    <p className="text-slate-400 mb-1">Total Trip KM</p>
                    <p className="text-lg font-semibold text-cyan-400">
                      {distanceAnalysis.totalTripKm?.toFixed(0) ?? "—"}
                    </p>
                  </div>
                  <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
                    <p className="text-slate-400 mb-1">Total GPS KM</p>
                    <p className="text-lg font-semibold text-indigo-400">
                      {distanceAnalysis.totalGpsKm?.toFixed(0) ?? "—"}
                    </p>
                  </div>
                  <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
                    <p className="text-slate-400 mb-1">Total Approval KM</p>
                    <p className="text-lg font-semibold text-emerald-400">
                      {distanceAnalysis.totalApprovalKm?.toFixed(0) ?? "—"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
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
                        {String(row[h] ?? "")}
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

