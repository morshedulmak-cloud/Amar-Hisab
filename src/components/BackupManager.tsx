import React, { useState } from "react";
import { 
  Download, 
  Upload, 
  AlertTriangle, 
  CheckCircle2, 
  Database,
  RefreshCw
} from "lucide-react";
import { db } from "../db/database";
import { cn, formatCurrency } from "../lib/utils";
import { format } from "date-fns";

interface BackupData {
  version: number;
  exportDate: number;
  accounts: any[];
  transactions: any[];
  settings: any[];
  sequences: any[];
}

const BackupManager: React.FC = () => {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setStatus({ type: "info", message: "Preparing backup data..." });

    try {
      const accounts = await db.accounts.toArray();
      const transactions = await db.transactions.toArray();
      const settings = await db.settings.toArray();
      const sequences = await db.sequences.toArray();

      const backup: BackupData = {
        version: 1,
        exportDate: Date.now(),
        accounts,
        transactions,
        settings,
        sequences
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `UniversalLedger_Backup_${format(new Date(), "yyyyMMdd_HHmm")}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setStatus({ type: "success", message: "Backup file generated and download started." });
    } catch (error) {
      console.error("Export failed", error);
      setStatus({ type: "error", message: "Failed to export data." });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const confirmImport = confirm(
      "WARNING: Importing a backup will overwrite all your current local data. This action cannot be undone. Do you want to proceed?"
    );
    if (!confirmImport) {
      event.target.value = "";
      return;
    }

    setIsImporting(true);
    setStatus({ type: "info", message: "Importing data... Please do not close the browser." });

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const content = e.target?.result as string;
          const data = JSON.parse(content) as BackupData;

          // Simple validation
          if (!data.accounts || !data.transactions) {
            throw new Error("Invalid backup file format.");
          }

          // Execute in transaction
          await db.transaction("rw", [db.accounts, db.transactions, db.settings, db.sequences], async () => {
            // Clear current data
            await db.accounts.clear();
            await db.transactions.clear();
            await db.settings.clear();
            await db.sequences.clear();

            // Bulk add
            if (data.accounts.length > 0) await db.accounts.bulkAdd(data.accounts);
            if (data.transactions.length > 0) await db.transactions.bulkAdd(data.transactions);
            if (data.settings.length > 0) await db.settings.bulkAdd(data.settings);
            if (data.sequences.length > 0) await db.sequences.bulkAdd(data.sequences);
          });

          setStatus({ type: "success", message: "Data imported successfully! The application will refresh now." });
          setTimeout(() => window.location.reload(), 2000);
        } catch (err: any) {
          console.error("Import processing error", err);
          setStatus({ type: "error", message: `Import failed: ${err.message}` });
          setIsImporting(false);
        }
      };
      reader.onerror = () => {
        setStatus({ type: "error", message: "Error reading the file." });
        setIsImporting(false);
      };
      reader.readAsText(file);
    } catch (error) {
      console.error("Import initiation error", error);
      setStatus({ type: "error", message: "Failed to start import." });
      setIsImporting(false);
    }
  };

  return (
    <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-3 bg-indigo-100 text-indigo-600 rounded-2xl">
          <Database size={24} />
        </div>
        <div>
          <h3 className="text-xl font-black text-slate-900">Data Backup & Restore</h3>
          <p className="text-slate-500 text-sm">Save your data locally or restore from a previous backup</p>
        </div>
      </div>

      {status && (
        <div className={cn(
          "p-4 rounded-2xl flex items-start gap-3 text-sm font-medium border",
          status.type === "success" ? "bg-green-50 border-green-100 text-green-700" :
          status.type === "error" ? "bg-red-50 border-red-100 text-red-700" :
          "bg-blue-50 border-blue-100 text-blue-700"
        )}>
          {status.type === "success" && <CheckCircle2 size={18} className="mt-0.5" />}
          {status.type === "error" && <AlertTriangle size={18} className="mt-0.5" />}
          {status.type === "info" && <RefreshCw size={18} className="mt-0.5 animate-spin" />}
          <p>{status.message}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={handleExport}
          disabled={isExporting || isImporting}
          className="flex flex-col items-center justify-center gap-3 p-6 bg-slate-50 border border-slate-200 rounded-2xl hover:bg-slate-100 transition-all text-center disabled:opacity-50"
        >
          <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center text-indigo-600">
            <Download size={24} />
          </div>
          <div>
            <span className="block font-bold text-slate-900">Export Backup</span>
            <span className="text-xs text-slate-500">Download data as .json file</span>
          </div>
        </button>

        <label className="flex flex-col items-center justify-center gap-3 p-6 bg-slate-50 border border-slate-200 rounded-2xl hover:bg-slate-100 transition-all text-center cursor-pointer disabled:opacity-50">
          <input
            type="file"
            accept=".json"
            onChange={handleImport}
            disabled={isExporting || isImporting}
            className="hidden"
          />
          <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center text-amber-600">
            <Upload size={24} />
          </div>
          <div>
            <span className="block font-bold text-slate-900">Import Data</span>
            <span className="text-xs text-slate-500">Restore from local .json file</span>
          </div>
        </label>
      </div>

      <div className="bg-amber-50 p-4 rounded-2xl flex items-start gap-3 border border-amber-100">
        <AlertTriangle size={18} className="text-amber-600 mt-1 shrink-0" />
        <div className="text-xs text-amber-700 leading-relaxed font-medium">
          <strong>Note:</strong> Data is stored entirely in your browser's private storage (IndexedDB). Periodic backups are highly recommended as clearing browser data or changing computers will result in data loss.
        </div>
      </div>
    </div>
  );
};

export default BackupManager;
