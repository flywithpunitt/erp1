"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { API_BASE_URL } from "@/lib/config";
import {
  computeTripSheetTotals,
  emptyTripSheet,
  formatInr,
  normalizeTripSheet,
  type CashAdvanceRow,
  type DieselLogRow,
  type MiscExpenseRow,
  type VehicleTripSheetPayload,
} from "@/lib/vehicleTripSheet";

const inputClass =
  "w-full mt-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 transition focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400";
const computedClass =
  "w-full mt-1 rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold tabular-nums text-slate-700";
const labelClass = "block text-[10px] font-semibold uppercase tracking-wide text-slate-500";

function SectionCard({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
      {children}
    </section>
  );
}

function SectionTitle({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-800">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-sm ring-1 ring-slate-200"
        aria-hidden
      >
        {icon}
      </span>
      <span>{children}</span>
    </h3>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  fileId: string;
  vehicleNumber: string;
};

export default function VehicleTripSheetModal({ open, onClose, fileId, vehicleNumber }: Props) {
  const router = useRouter();
  const [tripSheet, setTripSheet] = useState<VehicleTripSheetPayload>(() => emptyTripSheet());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [downloadType, setDownloadType] = useState<"excel" | "pdf" | "gsheet">("excel");

  const totals = useMemo(() => computeTripSheetTotals(tripSheet), [tripSheet]);

  const load = useCallback(async () => {
    if (!fileId || !vehicleNumber) return;
    setLoading(true);
    setMessage("");
    try {
      const q = encodeURIComponent(vehicleNumber);
      const res = await fetch(
        `${API_BASE_URL}/api/excel/${fileId}/vehicle-form?vehicle=${q}`,
        { credentials: "include", cache: "no-store" }
      );
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          typeof errBody.message === "string" ? errBody.message : `Load failed (${res.status})`
        );
      }
      const data = await res.json();
      if (data.form) {
        const next = normalizeTripSheet(data.form.tripSheet);
        if (!next.vehicleDetails.vehicleNo.trim()) {
          next.vehicleDetails.vehicleNo = vehicleNumber;
        }
        setTripSheet(next);
        setUpdatedAt(
          data.form.updatedAt ? new Date(data.form.updatedAt).toLocaleString() : null
        );
      } else {
        const empty = emptyTripSheet();
        empty.vehicleDetails.vehicleNo = vehicleNumber;
        setTripSheet(empty);
        setUpdatedAt(null);
      }
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Could not load saved sheet."
      );
      setTripSheet(() => {
        const e = emptyTripSheet();
        e.vehicleDetails.vehicleNo = vehicleNumber;
        return e;
      });
    } finally {
      setLoading(false);
    }
  }, [fileId, vehicleNumber, router]);

  useEffect(() => {
    if (!open || !fileId || !vehicleNumber) return;
    load();
  }, [open, fileId, vehicleNumber, load]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  async function handleSave() {
    if (!fileId || !vehicleNumber) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/excel/${fileId}/vehicle-form`, {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleNumber,
          tripSheet: {
            ...tripSheet,
            vehicleDetails: {
              ...tripSheet.vehicleDetails,
              vehicleNo: tripSheet.vehicleDetails.vehicleNo || vehicleNumber,
            },
          },
        }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(
          typeof data.message === "string" ? data.message : `Save failed (${res.status})`
        );
        return;
      }
      if (data.form?.tripSheet) {
        setTripSheet(normalizeTripSheet(data.form.tripSheet));
      }
      if (data.form?.updatedAt) {
        setUpdatedAt(new Date(data.form.updatedAt).toLocaleString());
      }
      setMessage("Saved.");
    } catch {
      setMessage("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function updateCashAdvanceRow(index: number, field: keyof CashAdvanceRow, value: string) {
    setTripSheet((t) => {
      const rows = [...t.cashAdvances];
      rows[index] = { ...rows[index], [field]: value };
      return { ...t, cashAdvances: rows };
    });
  }
  function addCashAdvanceRow() {
    setTripSheet((t) => ({
      ...t,
      cashAdvances: [...t.cashAdvances, { date: "", amount: "" }],
    }));
  }
  function removeCashAdvanceRow(index: number) {
    setTripSheet((t) => {
      if (t.cashAdvances.length <= 1) return t;
      return { ...t, cashAdvances: t.cashAdvances.filter((_, i) => i !== index) };
    });
  }
  function updateDieselRow(index: number, field: keyof DieselLogRow, value: string) {
    setTripSheet((t) => {
      const rows = [...t.dieselLog];
      rows[index] = { ...rows[index], [field]: value };
      return { ...t, dieselLog: rows };
    });
  }
  function addDieselRow() {
    setTripSheet((t) => ({
      ...t,
      dieselLog: [...t.dieselLog, { date: "", place: "", litres: "", amount: "" }],
    }));
  }
  function removeDieselRow(index: number) {
    setTripSheet((t) => {
      if (t.dieselLog.length <= 1) return t;
      return { ...t, dieselLog: t.dieselLog.filter((_, i) => i !== index) };
    });
  }
  function updateMiscRow(index: number, field: keyof MiscExpenseRow, value: string) {
    setTripSheet((t) => {
      const rows = [...t.miscExpenses];
      rows[index] = { ...rows[index], [field]: value };
      return { ...t, miscExpenses: rows };
    });
  }
  function addMiscRow() {
    setTripSheet((t) => ({
      ...t,
      miscExpenses: [...t.miscExpenses, { remark: "", amount: "" }],
    }));
  }
  function removeMiscRow(index: number) {
    setTripSheet((t) => {
      if (t.miscExpenses.length <= 1) return t;
      return { ...t, miscExpenses: t.miscExpenses.filter((_, i) => i !== index) };
    });
  }

  function buildExportRows() {
    return [
      { Section: "Basic", Field: "Vehicle Number", Value: tripSheet.vehicleDetails.vehicleNo },
      { Section: "Basic", Field: "Date", Value: tripSheet.vehicleDetails.date },
      { Section: "Basic", Field: "Driver Name", Value: tripSheet.vehicleDetails.driverName },
      { Section: "Basic", Field: "Driver No", Value: tripSheet.vehicleDetails.driverPhone },
      { Section: "Basic", Field: "Origin", Value: tripSheet.vehicleDetails.origin },
      { Section: "Basic", Field: "Destination 1", Value: tripSheet.vehicleDetails.destination1 },
      { Section: "Basic", Field: "Destination 2", Value: tripSheet.vehicleDetails.destination2 },
      ...tripSheet.cashAdvances.map((r, i) => ({
        Section: "Cash Advance",
        Field: `Row ${i + 1} (${r.date || "-"})`,
        Value: r.amount,
      })),
      { Section: "Cash Advance", Field: "Total Advance", Value: totals.totalAdvance },
      ...tripSheet.dieselLog.map((r, i) => ({
        Section: "Diesel",
        Field: `Row ${i + 1} (${r.date || "-"} / ${r.place || "-"})`,
        Value: `Ltr: ${r.litres || 0}, Amount: ${r.amount || 0}`,
      })),
      { Section: "Diesel", Field: "Total Litres", Value: totals.totalLitres },
      { Section: "Diesel", Field: "Total Diesel", Value: totals.totalDieselAmount },
      ...tripSheet.miscExpenses.map((r, i) => ({
        Section: "Misc",
        Field: `Row ${i + 1} (${r.remark || "-"})`,
        Value: r.amount,
      })),
      { Section: "Misc", Field: "Total Misc", Value: totals.totalMiscExpenses },
      { Section: "Toll", Field: "FBD to HWR", Value: tripSheet.tolls.fromFbdToHwr },
      { Section: "Toll", Field: "HWR to FBD", Value: tripSheet.tolls.fromHwrToFbd },
      { Section: "Toll", Field: "Total Toll", Value: totals.totalToll },
      { Section: "Running", Field: "Total KM", Value: tripSheet.kmRunning.totalKm },
      { Section: "Running", Field: "MT KM", Value: tripSheet.kmRunning.mtKm },
      { Section: "Running", Field: "MT Rate", Value: tripSheet.kmRunning.mtRatePerKm },
      { Section: "Running", Field: "MT Total", Value: totals.mtCharges },
      { Section: "Running", Field: "Load KM", Value: tripSheet.kmRunning.loadKm },
      { Section: "Running", Field: "Load Rate", Value: tripSheet.kmRunning.loadRatePerKm },
      { Section: "Running", Field: "Load Total", Value: totals.loadCharges },
      { Section: "Settlement", Field: "Any Deduction", Value: tripSheet.deductions.anyDeduction },
      { Section: "Settlement", Field: "Trip Amount", Value: tripSheet.tripSummary.tripAmount },
      { Section: "Settlement", Field: "TTE", Value: tripSheet.tripSummary.tteAmount },
      { Section: "Settlement", Field: "Total Expenditure", Value: totals.totalTripExpenditure },
      { Section: "Settlement", Field: "Driver Payout", Value: totals.driverBalance },
    ];
  }

  function getSafeVehicleName() {
    return (tripSheet.vehicleDetails.vehicleNo || vehicleNumber || "vehicle").replace(/[^\w-]+/g, "_");
  }

  function downloadExcel() {
    const rows = buildExportRows();
    const sheet = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Trip Settlement");
    XLSX.writeFile(wb, `${getSafeVehicleName()}_trip_settlement.xlsx`);
  }

  function downloadGoogleSheetFile() {
    const rows = buildExportRows();
    const sheet = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(sheet);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${getSafeVehicleName()}_trip_settlement_google_sheets.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPdf() {
    const rows = buildExportRows();
    const htmlRows = rows
      .map(
        (r) =>
          `<tr><td style="border:1px solid #ddd;padding:6px">${r.Section}</td><td style="border:1px solid #ddd;padding:6px">${r.Field}</td><td style="border:1px solid #ddd;padding:6px">${String(r.Value ?? "")}</td></tr>`
      )
      .join("");
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Trip Settlement</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 16px; color: #111; }
            h1 { font-size: 18px; margin: 0 0 12px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
          </style>
        </head>
        <body>
          <h1>Trip Settlement - ${tripSheet.vehicleDetails.vehicleNo || vehicleNumber}</h1>
          <table>
            <thead><tr><th style="border:1px solid #ddd;padding:6px;text-align:left">Section</th><th style="border:1px solid #ddd;padding:6px;text-align:left">Field</th><th style="border:1px solid #ddd;padding:6px;text-align:left">Value</th></tr></thead>
            <tbody>${htmlRows}</tbody>
          </table>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
  }

  function handleDownload() {
    if (downloadType === "excel") {
      downloadExcel();
      return;
    }
    if (downloadType === "pdf") {
      downloadPdf();
      return;
    }
    downloadGoogleSheetFile();
  }

  if (!open || !vehicleNumber) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vehicle-trip-sheet-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/35 backdrop-blur-[1px]"
        aria-label="Close dialog"
        onClick={() => {
          onClose();
          setMessage("");
        }}
      />
      <div
        className="relative flex h-[min(92vh,880px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <h2
              id="vehicle-trip-sheet-title"
              className="text-sm font-semibold tracking-tight text-slate-900"
            >
              Vehicle trip sheet
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              <span className="text-slate-500">Vehicle</span>{" "}
              <span className="font-semibold text-slate-700">{vehicleNumber}</span>
              {updatedAt && (
                <span className="mt-1 block text-[10px] text-slate-400">
                  Last saved · {updatedAt}
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              setMessage("");
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close"
          >
            <span className="text-xl leading-none">&times;</span>
          </button>
        </div>

        <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
          <div className="space-y-3 pb-2">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500" />
                  <p className="text-xs text-slate-500">Loading trip sheet…</p>
                </div>
              </div>
            ) : (
              <>
                <SectionCard>
                  <SectionTitle icon="🧾">Basic details</SectionTitle>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className={labelClass}>
                      Vehicle number
                      <input className={inputClass} value={tripSheet.vehicleDetails.vehicleNo} onChange={(e) => setTripSheet((t) => ({ ...t, vehicleDetails: { ...t.vehicleDetails, vehicleNo: e.target.value } }))} />
                    </label>
                    <label className={labelClass}>
                      Date
                      <input type="date" className={`${inputClass} [color-scheme:dark]`} value={tripSheet.vehicleDetails.date} onChange={(e) => setTripSheet((t) => ({ ...t, vehicleDetails: { ...t.vehicleDetails, date: e.target.value } }))} />
                    </label>
                    <label className={labelClass}>
                      Driver name
                      <input className={inputClass} value={tripSheet.vehicleDetails.driverName} onChange={(e) => setTripSheet((t) => ({ ...t, vehicleDetails: { ...t.vehicleDetails, driverName: e.target.value } }))} />
                    </label>
                    <label className={labelClass}>
                      Driver no.
                      <input className={inputClass} value={tripSheet.vehicleDetails.driverPhone} onChange={(e) => setTripSheet((t) => ({ ...t, vehicleDetails: { ...t.vehicleDetails, driverPhone: e.target.value } }))} />
                    </label>
                    <label className={labelClass}>
                      Origin
                      <input className={inputClass} value={tripSheet.vehicleDetails.origin} onChange={(e) => setTripSheet((t) => ({ ...t, vehicleDetails: { ...t.vehicleDetails, origin: e.target.value } }))} />
                    </label>
                    <label className={labelClass}>
                      Destination 1
                      <input className={inputClass} value={tripSheet.vehicleDetails.destination1} onChange={(e) => setTripSheet((t) => ({ ...t, vehicleDetails: { ...t.vehicleDetails, destination1: e.target.value } }))} />
                    </label>
                    <label className={labelClass}>
                      Destination 2
                      <input className={inputClass} value={tripSheet.vehicleDetails.destination2} onChange={(e) => setTripSheet((t) => ({ ...t, vehicleDetails: { ...t.vehicleDetails, destination2: e.target.value } }))} />
                    </label>
                  </div>
                </SectionCard>

                <SectionCard>
                  <SectionTitle icon="💸">Cash advance</SectionTitle>
                  <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Date</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Amount ₹</th>
                          <th className="w-10 px-1" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {tripSheet.cashAdvances.map((row, i) => (
                          <tr key={i} className="bg-white">
                            <td className="px-2 py-2"><input type="date" className={`${inputClass} mt-0 !py-1.5 text-xs`} value={row.date} onChange={(e) => updateCashAdvanceRow(i, "date", e.target.value)} /></td>
                            <td className="px-2 py-2"><input inputMode="decimal" className={`${inputClass} mt-0 !py-1.5 text-xs`} value={row.amount} onChange={(e) => updateCashAdvanceRow(i, "amount", e.target.value)} /></td>
                            <td className="px-1 py-2"><button type="button" onClick={() => removeCashAdvanceRow(i)} disabled={tripSheet.cashAdvances.length <= 1} className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25">×</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button type="button" onClick={addCashAdvanceRow} className="mt-2 text-[11px] font-medium text-slate-600 transition hover:text-slate-900">+ Add advance row</button>
                  <div className="mt-4">
                    <label className={labelClass}>Total cash advance (auto)</label>
                    <div className={computedClass}>{formatInr(totals.totalAdvance)}</div>
                  </div>
                </SectionCard>

                <SectionCard>
                  <SectionTitle icon="⛽">Diesel</SectionTitle>
                  <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Date</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Place</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Ltr</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Amount ₹</th>
                          <th className="w-10 px-1" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {tripSheet.dieselLog.map((row, i) => (
                          <tr key={i} className="bg-white">
                            <td className="px-2 py-2"><input type="date" className={`${inputClass} mt-0 !py-1.5 text-xs`} value={row.date} onChange={(e) => updateDieselRow(i, "date", e.target.value)} /></td>
                            <td className="px-2 py-2"><input className={`${inputClass} mt-0 !py-1.5 text-xs`} value={row.place} onChange={(e) => updateDieselRow(i, "place", e.target.value)} /></td>
                            <td className="px-2 py-2"><input inputMode="decimal" className={`${inputClass} mt-0 !py-1.5 text-xs`} value={row.litres} onChange={(e) => updateDieselRow(i, "litres", e.target.value)} /></td>
                            <td className="px-2 py-2"><input inputMode="decimal" className={`${inputClass} mt-0 !py-1.5 text-xs`} value={row.amount} onChange={(e) => updateDieselRow(i, "amount", e.target.value)} /></td>
                            <td className="px-1 py-2"><button type="button" onClick={() => removeDieselRow(i)} disabled={tripSheet.dieselLog.length <= 1} className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25">×</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button type="button" onClick={addDieselRow} className="mt-2 text-[11px] font-medium text-slate-600 transition hover:text-slate-900">+ Add diesel row</button>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div><label className={labelClass}>Total litres (auto)</label><div className={computedClass}>{totals.totalLitres.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div></div>
                    <div><label className={labelClass}>Total diesel (auto)</label><div className={computedClass}>{formatInr(totals.totalDieselAmount)}</div></div>
                  </div>
                </SectionCard>

                <SectionCard>
                  <SectionTitle icon="🧾">Misc. & toll</SectionTitle>
                  <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Remark</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Amount ₹</th>
                          <th className="w-10 px-1" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {tripSheet.miscExpenses.map((row, i) => (
                          <tr key={i} className="bg-white">
                            <td className="px-2 py-2"><input className={`${inputClass} mt-0 !py-1.5 text-xs`} value={row.remark} onChange={(e) => updateMiscRow(i, "remark", e.target.value)} /></td>
                            <td className="px-2 py-2"><input inputMode="decimal" className={`${inputClass} mt-0 !py-1.5 text-xs`} value={row.amount} onChange={(e) => updateMiscRow(i, "amount", e.target.value)} /></td>
                            <td className="px-1 py-2"><button type="button" onClick={() => removeMiscRow(i)} disabled={tripSheet.miscExpenses.length <= 1} className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25">×</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button type="button" onClick={addMiscRow} className="mt-2 text-[11px] font-medium text-slate-600 transition hover:text-slate-900">+ Add misc row</button>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelClass}>Toll FBD → HWR ₹</label>
                      <input inputMode="decimal" className={inputClass} value={tripSheet.tolls.fromFbdToHwr} onChange={(e) => setTripSheet((t) => ({ ...t, tolls: { ...t.tolls, fromFbdToHwr: e.target.value } }))} />
                    </div>
                    <div>
                      <label className={labelClass}>Toll HWR → FBD ₹</label>
                      <input inputMode="decimal" className={inputClass} value={tripSheet.tolls.fromHwrToFbd} onChange={(e) => setTripSheet((t) => ({ ...t, tolls: { ...t.tolls, fromHwrToFbd: e.target.value } }))} />
                    </div>
                    <div><label className={labelClass}>Total misc (auto)</label><div className={computedClass}>{formatInr(totals.totalMiscExpenses)}</div></div>
                    <div><label className={labelClass}>Total toll (auto)</label><div className={computedClass}>{formatInr(totals.totalToll)}</div></div>
                  </div>
                </SectionCard>

                <SectionCard>
                  <SectionTitle icon="🚚">Running & payout</SectionTitle>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className={labelClass}>Total running KM<input inputMode="decimal" className={inputClass} value={tripSheet.kmRunning.totalKm} onChange={(e) => setTripSheet((t) => ({ ...t, kmRunning: { ...t.kmRunning, totalKm: e.target.value } }))} /></label>
                    <div />
                    <label className={labelClass}>MT running KM<input inputMode="decimal" className={inputClass} value={tripSheet.kmRunning.mtKm} onChange={(e) => setTripSheet((t) => ({ ...t, kmRunning: { ...t.kmRunning, mtKm: e.target.value } }))} /></label>
                    <label className={labelClass}>MT rate / KM ₹<input inputMode="decimal" className={inputClass} value={tripSheet.kmRunning.mtRatePerKm} onChange={(e) => setTripSheet((t) => ({ ...t, kmRunning: { ...t.kmRunning, mtRatePerKm: e.target.value } }))} /></label>
                    <label className={labelClass}>Load running KM<input inputMode="decimal" className={inputClass} value={tripSheet.kmRunning.loadKm} onChange={(e) => setTripSheet((t) => ({ ...t, kmRunning: { ...t.kmRunning, loadKm: e.target.value } }))} /></label>
                    <label className={labelClass}>Load rate / KM ₹<input inputMode="decimal" className={inputClass} value={tripSheet.kmRunning.loadRatePerKm} onChange={(e) => setTripSheet((t) => ({ ...t, kmRunning: { ...t.kmRunning, loadRatePerKm: e.target.value } }))} /></label>
                    <div><label className={labelClass}>MT running total (auto)</label><div className={computedClass}>{formatInr(totals.mtCharges)}</div></div>
                    <div><label className={labelClass}>Load running total (auto)</label><div className={computedClass}>{formatInr(totals.loadCharges)}</div></div>
                    <label className={labelClass}>Any deduction ₹<input inputMode="decimal" className={inputClass} value={tripSheet.deductions.anyDeduction} onChange={(e) => setTripSheet((t) => ({ ...t, deductions: { anyDeduction: e.target.value } }))} /></label>
                    <label className={labelClass}>Trip amount ₹<input inputMode="decimal" className={inputClass} value={tripSheet.tripSummary.tripAmount} onChange={(e) => setTripSheet((t) => ({ ...t, tripSummary: { ...t.tripSummary, tripAmount: e.target.value } }))} /></label>
                    <div><label className={labelClass}>Total trip expenditure (auto)</label><div className={computedClass}>{formatInr(totals.totalTripExpenditure)}</div></div>
                    <div><label className={labelClass}>Driver payout (auto)</label><div className={computedClass}>{formatInr(totals.driverBalance)}</div></div>
                    <label className={labelClass}>TTE ₹<input inputMode="decimal" className={inputClass} value={tripSheet.tripSummary.tteAmount} onChange={(e) => setTripSheet((t) => ({ ...t, tripSummary: { ...t.tripSummary, tteAmount: e.target.value } }))} /></label>
                  </div>
                </SectionCard>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div className="min-h-[1.25rem] text-xs">
            {message && (
              <span
                className={
                  message.startsWith("Saved") ? "font-medium text-emerald-600" : "text-amber-600"
                }
              >
                {message}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={downloadType}
              onChange={(e) => setDownloadType(e.target.value as "excel" | "pdf" | "gsheet")}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              <option value="excel">Download Excel (.xlsx)</option>
              <option value="pdf">Download PDF</option>
              <option value="gsheet">Download Google Sheet (.csv)</option>
            </select>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              Download
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="inline-flex min-w-[100px] items-center justify-center rounded-md bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
