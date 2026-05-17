import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getNextVoucherNo, incrementVoucherNo, updateVoucherSequence, getAccountBalance, getAccountSummary } from "../db/database";
import { formatCurrency, cn } from "../lib/utils";
import { format } from "date-fns";
import { 
  Plus, 
  Filter, 
  Download, 
  Trash2, 
  ArrowUpRight, 
  ArrowDownLeft,
  Search,
  MoreVertical,
  X,
  Pencil,
  Upload,
  Printer,
  RefreshCw
} from "lucide-react";
import { Transaction, TransactionType } from "../types";
import Papa from "papaparse";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface TransactionsListProps {
  accountId?: number;
  isAddingExternal?: boolean;
  onCloseExternal?: () => void;
  variant?: "default" | "ledger";
}

export default function TransactionsList({ accountId, isAddingExternal, onCloseExternal, variant = "default" }: TransactionsListProps) {
  const [isAdding, setIsAdding] = useState(false);

  React.useEffect(() => {
    if (isAddingExternal) {
      setIsAdding(true);
    }
  }, [isAddingExternal]);

  const handleClose = () => {
    setIsAdding(false);
    setEditingTransaction(null);
    if (onCloseExternal) onCloseExternal();
  };
  // Handle back button for modals
  React.useEffect(() => {
    const handlePop = (e: any) => {
      const state = e.detail;
      if (!state.isModal) {
        setIsAdding(false);
        setEditingTransaction(null);
      }
    };
    window.addEventListener("app-popstate" as any, handlePop);
    return () => window.removeEventListener("app-popstate" as any, handlePop);
  }, []);

  const openAddModal = () => {
    const currentState = window.history.state;
    window.history.pushState({ ...currentState, isModal: true, modalType: "transaction" }, "");
    setIsAdding(true);
  };

  const closeModals = () => {
    if (window.history.state.isModal) {
      window.history.back();
    } else {
      setIsAdding(false);
      setEditingTransaction(null);
      if (onCloseExternal) onCloseExternal();
    }
  };

  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [txType, setTxType] = useState<TransactionType>("EXPENSE");
  const [selectedVoucherType, setSelectedVoucherType] = useState<string>("PV");
  const [nextVoucherNo, setNextVoucherNo] = useState<number>(0);

  const settings = useLiveQuery(() => db.settings.get("app-settings"));

  React.useEffect(() => {
    async function updateNextVoucher() {
      if (isAdding && !editingTransaction) {
        const vNo = await getNextVoucherNo(selectedVoucherType as any);
        setNextVoucherNo(vNo);
      } else if (editingTransaction) {
        setNextVoucherNo(editingTransaction.voucherNo || 0);
      }
    }
    updateNextVoucher();
  }, [isAdding, selectedVoucherType, editingTransaction]);

  // Advanced Filters
  const [filterVoucherType, setFilterVoucherType] = useState<string>("ALL");
  const [filterAccountId, setFilterAccountId] = useState<number | null>(accountId || null);
  const [filterStartDate, setFilterStartDate] = useState<string>(settings?.startDate ? format(settings.startDate, "yyyy-MM-dd") : "");
  const [filterEndDate, setFilterEndDate] = useState<string>(settings?.endDate ? format(settings.endDate, "yyyy-MM-dd") : "");
  const [showFilters, setShowFilters] = useState(false);

  React.useEffect(() => {
    if (settings?.startDate && !filterStartDate) {
      setFilterStartDate(format(settings.startDate, "yyyy-MM-dd"));
    }
    if (settings?.endDate && !filterEndDate) {
      setFilterEndDate(format(settings.endDate, "yyyy-MM-dd"));
    }
  }, [settings]);

  React.useEffect(() => {
    if (!editingTransaction) {
      const vType = txType === "INCOME" ? "RV" : txType === "EXPENSE" ? "PV" : "JV";
      setSelectedVoucherType(vType);
    } else {
      setSelectedVoucherType(editingTransaction.voucherType || "JV");
    }
  }, [txType, editingTransaction]);

  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const accounts = useLiveQuery(() => db.accounts.where("isDeleted").equals(0).toArray());
  const accountMap = React.useMemo(() => new Map((accounts || []).map(a => [a.id, a])), [accounts]);
  const getAccountName = React.useCallback((id: number) => accountMap.get(id)?.name || "Unknown", [accountMap]);
  
  const transactions = useLiveQuery(async () => {
    let collection: any;
    
    const start = filterStartDate ? new Date(filterStartDate).getTime() : (settings?.startDate || 0);
    const end = filterEndDate ? new Date(filterEndDate).getTime() + 86399999 : (settings?.endDate || Date.now());

    // Primary index should be date for report periods
    collection = db.transactions
      .where("date")
      .between(start, end, true, true)
      .and(t => t.isDeleted === 0);

    let txs = await collection.toArray();
    
    // Chronological sort: oldest to newest
    txs.sort((a, b) => {
      if (a.date !== b.date) return a.date - b.date;
      return (a.voucherNo || 0) - (b.voucherNo || 0);
    });

    if (filterAccountId) {
      txs = txs.filter(t => t.fromAccountId === filterAccountId || t.toAccountId === filterAccountId);
    } else if (accountId) {
      txs = txs.filter(t => t.fromAccountId === accountId || t.toAccountId === accountId);
    }

    if (filterVoucherType !== "ALL") {
      txs = txs.filter(t => t.voucherType === filterVoucherType);
    }

    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      txs = txs.filter(t => 
        t.note?.toLowerCase().includes(lowerQuery)
      );
    }
    
    return txs;
  }, [searchQuery, accountId, settings, filterAccountId, filterVoucherType, filterStartDate, filterEndDate]);

  const summary = useLiveQuery(async () => {
    if (!accountId) return null;
    const account = accountMap.get(accountId);
    if (!account) return null;
    
    const prevTxBalance = await getAccountBalance(accountId, (settings?.startDate || 0) - 1);
    const openingBalance = (account.initialBalance || 0) + prevTxBalance;
    
    const periodSummary = await getAccountSummary(accountId, settings?.endDate, settings?.startDate);
    
    const closingTxSurplus = await getAccountBalance(accountId, settings?.endDate);
    const closingBalance = (account.initialBalance || 0) + closingTxSurplus;

    return { openingBalance, dr: periodSummary.debit, cr: periodSummary.credit, closingBalance };
  }, [accountId, settings, accountMap]);

  const handleDelete = async () => {
    if (transactionToDelete?.id) {
      await db.transactions.update(transactionToDelete.id, { isDeleted: 1, updatedAt: Date.now(), syncStatus: "pending" });
      setTransactionToDelete(null);
    }
  };

  const handleExportCSV = () => {
    if (!transactions || transactions.length === 0) return;

    const data = transactions.map(tx => ({
      Date: format(tx.date, "yyyy-MM-dd"),
      Voucher: tx.voucherType && tx.voucherNo ? `${tx.voucherType}-${String(tx.voucherNo).padStart(3, "0")}` : "N/A",
      From: getAccountName(tx.fromAccountId),
      To: getAccountName(tx.toAccountId),
      Amount: tx.amount,
      Note: tx.note || "",
      Type: tx.type
    }));

    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `transactions_${format(new Date(), "yyyy-MM-dd")}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const rows = results.data as any[];
          const accountNames = new Map((accounts || []).map(a => [a.name.toLowerCase(), a.id]));

          for (const row of rows) {
            const dateStr = row.Date || row.date;
            const fromName = row.From || row.from;
            const toName = row.To || row.to;
            const amount = parseFloat(row.Amount || row.amount);
            const note = row.Note || row.note || "";
            const type = (row.Type || row.type || "EXPENSE").toUpperCase() as TransactionType;

            if (!fromName || !toName || isNaN(amount)) continue;

            const fromId = accountNames.get(fromName.toLowerCase());
            const toId = accountNames.get(toName.toLowerCase());

            if (fromId !== undefined && toId !== undefined) {
              const vType = type === "INCOME" ? "RV" : type === "EXPENSE" ? "PV" : "JV";
              const vNo = await incrementVoucherNo(vType as any);

              await db.transactions.add({
                amount,
                fromAccountId: fromId,
                toAccountId: toId,
                note,
                type,
                voucherType: vType as any,
                voucherNo: vNo,
                date: dateStr ? new Date(dateStr).getTime() : Date.now(),
                createdAt: Date.now(),
                updatedAt: Date.now(),
                syncStatus: "pending",
                isDeleted: 0
              });
            }
          }
          alert("Import completed successfully!");
        } catch (err) {
          console.error("Import failed", err);
          alert("Import failed. Please check the console for details.");
        } finally {
          setIsImporting(false);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      },
      error: (err) => {
        console.error("CSV Parsing Error", err);
        alert("Error parsing CSV file.");
        setIsImporting(false);
      }
    });
  };

  const renderVoucherContent = (doc: any, tx: Transaction) => {
    const voucherLabel = tx.voucherType && tx.voucherNo 
      ? `${tx.voucherType}-${String(tx.voucherNo).padStart(4, "0")}`
      : "N/A";

    const profileName = settings?.profileName || "AL-BAQARAH DYEING AND PRINTING INDUSTRY LTD";
    const voucherTitle = 
      tx.voucherType === "RV" ? "RECEIPT VOUCHER" : 
      tx.voucherType === "PV" ? "PAYMENT VOUCHER" :
      tx.voucherType === "JV" ? "JOURNAL VOUCHER" : "CONTRA VOUCHER";

    // 1. Company Header
    doc.setFontSize(16);
    doc.setTextColor(30, 41, 59);
    doc.setFont("helvetica", "bold");
    doc.text(profileName, 105, 20, { align: "center" });
    
    doc.setFontSize(14);
    doc.text(voucherTitle, 105, 30, { align: "center" });
    
    doc.setLineWidth(0.3);
    doc.setDrawColor(200);
    doc.line(14, 34, 196, 34);

    // 2. Voucher Metadata Section
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    
    const leftMargin = 14;
    const rightSideX = 130;
    let currentY = 44;

    // Voucher Number & Date Row
    doc.setFont("helvetica", "bold");
    doc.text(`Voucher No : ${voucherLabel}`, leftMargin, currentY);
    doc.text(`Date : ${format(tx.date, "dd-MMM-yyyy")}`, rightSideX, currentY);
    
    currentY += 10;
    
    // Account Details
    // RV: Receipt Source = fromAccountId (Credit), Dest = toAccountId (Debit/Cash)
    // PV: Payment Source = fromAccountId (Credit/Cash), Dest = toAccountId (Debit/Expense)
    
    const cashBankLabel = tx.voucherType === "RV" ? "Receipt Cash/Bank A/c :" : "Payment Cash/Bank A/c :";
    const cashBankAccount = tx.voucherType === "RV" ? tx.toAccountId : tx.fromAccountId;
    
    const partyLabel = tx.voucherType === "RV" ? "Received From :" : "Paid To :";
    const partyAccount = tx.voucherType === "RV" ? tx.fromAccountId : tx.toAccountId;

    doc.setFont("helvetica", "normal");
    doc.text(cashBankLabel, leftMargin, currentY);
    doc.setFont("helvetica", "bold");
    doc.text(getAccountName(cashBankAccount), leftMargin, currentY + 5);

    doc.setFont("helvetica", "normal");
    doc.text(partyLabel, rightSideX, currentY);
    doc.setFont("helvetica", "bold");
    doc.text(getAccountName(partyAccount), rightSideX, currentY + 5);

    currentY += 15;

    // Transaction Details / Note
    if (tx.note) {
      doc.setFont("helvetica", "normal");
      doc.text("Narration / Description :", leftMargin, currentY);
      doc.setFont("helvetica", "italic");
      const lines = doc.splitTextToSize(tx.note, 180);
      doc.text(lines, leftMargin, currentY + 5);
      currentY += (lines.length * 5) + 10;
    } else {
      currentY += 5;
    }

    doc.setDrawColor(220);
    doc.line(14, currentY - 5, 196, currentY - 5);

    // 3. GL Accounts Table
    autoTable(doc, {
      startY: currentY,
      head: [["SL#", "GL Account Head / Description", "Debit (DR)", "Credit (CR)"]],
      body: [
        ["1", getAccountName(tx.toAccountId), formatCurrency(tx.amount), ""],
        ["2", getAccountName(tx.fromAccountId), "", formatCurrency(tx.amount)],
      ],
      foot: [
        ["", "Grand Total", formatCurrency(tx.amount), formatCurrency(tx.amount)]
      ],
      theme: "grid",
      headStyles: { 
        fillColor: [241, 245, 249], 
        textColor: [30, 41, 59], 
        fontStyle: "bold",
        lineWidth: 0.1
      },
      styles: { 
        fontSize: 8,
        cellPadding: 3,
      },
      columnStyles: {
        0: { cellWidth: 15 },
        1: { cellWidth: 110 },
        2: { halign: "right", fontStyle: "bold" },
        3: { halign: "right", fontStyle: "bold" }
      },
      footStyles: {
        fillColor: [248, 250, 252],
        textColor: [30, 41, 59],
        fontStyle: "bold"
      }
    });

    // 4. Signature Section (Footer)
    const tableFinalY = (doc as any).lastAutoTable.finalY || currentY + 30;
    const sigY = Math.max(tableFinalY + 40, 270);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    
    // Left
    doc.line(14, sigY, 60, sigY);
    doc.text("Prepared By", 14, sigY + 4);
    
    // Center
    doc.line(82, sigY, 128, sigY);
    doc.text("Cashier / Checked By", 82, sigY + 4);
    
    // Right
    doc.line(150, sigY, 196, sigY);
    doc.text("Authorised Signatory", 150, sigY + 4);

    // Disclaimer
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.setFont("helvetica", "italic");
    doc.text("This is computer generated documents, does not require any signature", 105, 290, { align: "center" });
  };

  const handlePrintVoucher = (tx: Transaction) => {
    const doc = new jsPDF() as any;
    renderVoucherContent(doc, tx);
    const voucherLabel = tx.voucherType && tx.voucherNo 
      ? `${tx.voucherType}-${String(tx.voucherNo).padStart(4, "0")}`
      : "N/A";
    doc.save(`Voucher_${voucherLabel}.pdf`);
  };

  const [isPrintingBulk, setIsPrintingBulk] = useState(false);

  const handleBulkPrintVouchers = async () => {
    if (!transactions || transactions.length === 0) {
      alert("No transactions found in current filtered view to print.");
      return;
    }

    const typeToPrint = filterVoucherType;
    let txsToPrint = [...transactions];
    
    if (typeToPrint === "ALL") {
      const confirmAll = confirm(`You are about to print ALL ${transactions.length} vouchers in the current list. Continue?`);
      if (!confirmAll) return;
    } else {
      txsToPrint = transactions.filter(tx => tx.voucherType === typeToPrint);
      if (txsToPrint.length === 0) {
        alert(`No ${typeToPrint} vouchers found in the current list.`);
        return;
      }
    }

    setIsPrintingBulk(true);
    
    // Small delay to allow UI to update if we had a loading spinner
    await new Promise(r => setTimeout(r, 100));

    try {
      // Sort by voucher number (ascending) for logical order in PDF
      txsToPrint.sort((a, b) => {
        if (a.voucherType !== b.voucherType) return (a.voucherType || "").localeCompare(b.voucherType || "");
        return (a.voucherNo || 0) - (b.voucherNo || 0);
      });

      const doc = new jsPDF() as any;
      
      for (let i = 0; i < txsToPrint.length; i++) {
        if (i > 0) doc.addPage();
        renderVoucherContent(doc, txsToPrint[i]);
      }
      
      const fileName = typeToPrint === "ALL" ? "All_Vouchers" : `${typeToPrint}_Vouchers`;
      doc.save(`${fileName}_${format(new Date(), "yyyyMMdd_HHmm")}.pdf`);
    } catch (error) {
      console.error("Bulk print failed", error);
      alert("An error occurred during bulk printing.");
    } finally {
      setIsPrintingBulk(false);
    }
  };


  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="Search ledger notes..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm w-full md:w-64 focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "p-2 rounded-lg border transition-all flex items-center gap-2 text-sm font-medium",
              showFilters ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            <Filter size={16} />
            <span className="hidden sm:inline">Filters</span>
          </button>
          {summary && (
            <div className="hidden lg:flex items-center gap-4 p-2 bg-white border border-slate-200 rounded-xl px-4">
               <div>
                 <p className="text-[10px] text-slate-400 font-bold uppercase">Opening</p>
                 <p className="text-xs font-bold">{formatCurrency(summary.openingBalance)}</p>
               </div>
               <div className="w-px h-6 bg-slate-100" />
               <div>
                 <p className="text-[10px] text-slate-400 font-bold uppercase">Closing</p>
                 <p className="text-xs font-black text-blue-600">{formatCurrency(summary.closingBalance)}</p>
               </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImportCSV} 
            accept=".csv" 
            className="hidden" 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
            title="Import Transactions from CSV"
          >
            <Upload size={16} />
            <span className="hidden sm:inline">Import</span>
          </button>
          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm"
            title="Export Transactions to CSV"
          >
            <Download size={16} />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button 
            onClick={handleBulkPrintVouchers}
            disabled={isPrintingBulk}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
            title="Bulk Print Vouchers as PDF"
          >
            {isPrintingBulk ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : (
              <Printer size={16} />
            )}
            <span className="hidden sm:inline">{isPrintingBulk ? "Printing..." : "Bulk Print"}</span>
          </button>
          <button 
            onClick={openAddModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus size={16} />
            New Entry
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm animate-in slide-in-from-top-2 duration-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Voucher Type</label>
            <select 
              value={filterVoucherType}
              onChange={(e) => setFilterVoucherType(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Vouchers</option>
              <option value="RV">Receipt (RV)</option>
              <option value="PV">Payment (PV)</option>
              <option value="JV">Journal (JV)</option>
              <option value="CV">Contra (CV)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Account / Ledger</label>
            <select 
              value={filterAccountId || ""}
              onChange={(e) => setFilterAccountId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{accountId ? "Viewing Current Ledger" : "All Accounts"}</option>
              {["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"].map(group => {
                const groupAccounts = accounts?.filter(a => a.type === group);
                if (!groupAccounts?.length) return null;
                return (
                  <optgroup key={group} label={group}>
                    {groupAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Start Date</label>
            <input 
              type="date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">End Date</label>
            <div className="flex items-center gap-2">
              <input 
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 flex-1"
              />
              <button 
                onClick={() => {
                  setSearchQuery("");
                  setFilterVoucherType("ALL");
                  setFilterAccountId(accountId || null);
                  setFilterStartDate(settings?.startDate ? format(settings.startDate, "yyyy-MM-dd") : "");
                  setFilterEndDate(settings?.endDate ? format(settings.endDate, "yyyy-MM-dd") : "");
                }}
                className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                title="Clear Filters"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unified Professional Statement List Layout */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Statement Header - Desktop Only */}
        <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</div>
          <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Voucher</div>
          <div className="col-span-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Description & Accounts</div>
          <div className="col-span-2 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Debit (+)</div>
          <div className="col-span-2 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Credit (-)</div>
        </div>

        <div className="divide-y divide-slate-100">
          {(transactions || []).map((tx) => {
            const voucherLabel = tx.voucherType && tx.voucherNo 
              ? `${tx.voucherType}-${String(tx.voucherNo).padStart(3, "0")}`
              : "N/A";
            const isDebit = tx.toAccountId === accountId;
            
            return (
              <div 
                key={tx.id} 
                className={cn(
                  "p-4 md:px-6 md:py-4 hover:bg-slate-50/50 transition-all group relative",
                  transactionToDelete?.id === tx.id && "bg-red-50"
                )}
              >
                {/* Desktop View (Grid) */}
                <div className="hidden md:grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-1 text-xs font-bold text-slate-500">
                    {format(tx.date, "dd MMM, yy")}
                  </div>
                  
                  <div className="col-span-2">
                    <span className="text-[10px] font-black px-2 py-1 bg-slate-100 rounded text-slate-500 tracking-tighter">
                      {voucherLabel}
                    </span>
                  </div>

                  <div className="col-span-5 flex flex-col min-w-0">
                    <span className="text-sm font-bold text-slate-900 truncate">
                      {accountId 
                        ? (isDebit ? `From: ${getAccountName(tx.fromAccountId)}` : `To: ${getAccountName(tx.toAccountId)}`)
                        : `${getAccountName(tx.fromAccountId)} ➔ ${getAccountName(tx.toAccountId)}`
                      }
                    </span>
                    <span className="text-[11px] text-slate-400 italic truncate">{tx.note || "No description"}</span>
                  </div>

                  <div className="col-span-2 text-right">
                    {(!accountId || isDebit) && (
                      <span className={cn("text-base font-black", accountId && isDebit ? "text-emerald-600" : "text-slate-800")}>
                        {formatCurrency(tx.amount)}
                      </span>
                    )}
                  </div>

                  <div className="col-span-2 text-right">
                    {(!accountId || !isDebit) && (
                      <span className={cn("text-base font-black", accountId && !isDebit ? "text-red-500" : "text-slate-800")}>
                        {formatCurrency(tx.amount)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Mobile View (Stacked List) */}
                <div className="md:hidden">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">{format(tx.date, "dd MMM, yyyy")}</span>
                      <span className="text-[10px] font-black px-1.5 py-0.5 bg-slate-100 rounded text-slate-500">{voucherLabel}</span>
                    </div>
                    <div className="text-right">
                       <p className={cn(
                        "text-sm font-black",
                        accountId ? (isDebit ? "text-emerald-600" : "text-red-600") : "text-slate-900"
                      )}>
                        {isDebit ? "+" : "-"}{formatCurrency(tx.amount)}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-slate-900 truncate">
                    {isDebit ? getAccountName(tx.fromAccountId) : getAccountName(tx.toAccountId)}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate italic mt-0.5">{tx.note || "No notes"}</p>
                </div>

                {/* Actions Overlay (Hover Desktop, All-time Mobile) */}
                <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1 bg-white/90 backdrop-blur-sm p-1 rounded-lg border shadow-sm md:flex hidden">
                  <button 
                    onClick={() => handlePrintVoucher(tx)}
                    className="p-1.5 text-slate-600 hover:bg-slate-50 rounded-md transition-colors"
                  >
                    <Printer size={14} />
                  </button>
                  <button onClick={() => { setEditingTransaction(tx); setTxType(tx.type); openAddModal(); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"><Pencil size={14} /></button>
                  <button onClick={() => setTransactionToDelete(tx)} className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-md transition-all">
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Mobile Actions (Small dots or slide indicator would be better but let's keep it simple and accessible) */}
                <div className="flex md:hidden items-center gap-3 mt-4 pt-3 border-t border-slate-50">
                  <button onClick={() => handlePrintVoucher(tx)} className="flex-1 py-1.5 bg-slate-50 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1"><Printer size={12} /> Print</button>
                  <button onClick={() => { setEditingTransaction(tx); setTxType(tx.type); openAddModal(); }} className="flex-1 py-1.5 bg-slate-50 text-blue-600 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1"><Pencil size={12} /> Edit</button>
                  <button onClick={() => setTransactionToDelete(tx)} className="flex-1 py-1.5 bg-slate-50 text-slate-400 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1">
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Summary - Always Show Professional Totals */}
        {summary && (
          <div className="bg-slate-900 overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-12 items-center">
               <div className="md:col-span-8 p-6 md:p-8 flex flex-col md:flex-row gap-8">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Opening Balance</span>
                    <span className="text-sm font-bold text-slate-300">{formatCurrency(summary.openingBalance)}</span>
                  </div>
                  <div className="flex gap-12">
                     <div className="flex flex-col">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Debit</span>
                        <span className="text-base font-black text-emerald-400">+{formatCurrency(summary.dr)}</span>
                     </div>
                     <div className="flex flex-col">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Credit</span>
                        <span className="text-base font-black text-red-500">-{formatCurrency(summary.cr)}</span>
                     </div>
                  </div>
               </div>
               <div className="md:col-span-4 p-6 md:p-8 bg-slate-800 md:h-full flex flex-col justify-center text-right border-t md:border-t-0 border-slate-700">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Closing Ledger Balance</span>
                  <span className="text-3xl md:text-4xl font-black tracking-tighter text-blue-400">{formatCurrency(summary.closingBalance)}</span>
               </div>
            </div>
          </div>
        )}

        {(transactions || []).length === 0 && (
          <div className="py-20 text-center bg-white text-slate-400 italic text-sm">
            No accounting entries recorded for this period.
          </div>
        )}
      </div>


      {/* Confirmation Modal */}
      {transactionToDelete && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200 border border-slate-100">
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-black text-slate-900 mb-2">Confirm Deletion</h3>
              <p className="text-slate-500 text-sm leading-relaxed mb-6">
                Are you sure you want to delete this <span className="font-black text-slate-900">
                  {transactionToDelete.voucherType}-{String(transactionToDelete.voucherNo).padStart(4, "0")}
                </span> transaction of <span className="font-black text-red-600">{formatCurrency(transactionToDelete.amount)}</span>? 
                This action is irreversible.
              </p>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => setTransactionToDelete(null)}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleDelete}
                  className="flex-1 px-4 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-200"
                >
                  Yes, Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {isAdding && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-lg">{editingTransaction ? "Edit Entry" : "New Double-Entry"}</h3>
              <button 
                onClick={closeModals} 
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="px-6 pt-6">
              <div className="flex bg-slate-100 p-1 rounded-xl">
                {(["EXPENSE", "INCOME", "TRANSFER"] as TransactionType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => !editingTransaction && setTxType(t)}
                    disabled={!!editingTransaction}
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                      txType === t ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700",
                      editingTransaction && txType !== t ? "opacity-30" : ""
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const amount = Number(formData.get("amount"));
              const fromId = Number(formData.get("fromAccountId"));
              const toId = Number(formData.get("toAccountId"));
              const note = formData.get("note") as string;
              const dateVal = formData.get("date") as string;
              const vType = formData.get("voucherType") as "PV" | "RV" | "JV" | "CV";
              const vNoInput = Number(formData.get("voucherNo"));
              
              const transactionDate = dateVal ? new Date(dateVal).getTime() : Date.now();
              
              if (editingTransaction) {
                await db.transactions.update(editingTransaction.id!, {
                  amount,
                  fromAccountId: fromId,
                  toAccountId: toId,
                  note,
                  date: transactionDate,
                  voucherType: vType,
                  voucherNo: vNoInput,
                  updatedAt: Date.now(),
                  syncStatus: "pending"
                });
                await updateVoucherSequence(vType, vNoInput);
              } else {
                // Fetch fresh vNo and increment atomically to prevent collisions and reuse
                const vNo = await incrementVoucherNo(vType);

                await db.transactions.add({
                  amount,
                  fromAccountId: fromId,
                  toAccountId: toId,
                  note,
                  type: txType,
                  voucherType: vType,
                  voucherNo: vNo,
                  date: transactionDate,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  syncStatus: "pending",
                  isDeleted: 0
                });
              }
              closeModals();
            }} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-widest leading-none">Date</label>
                  <input 
                    name="date" 
                    type="date" 
                    required 
                    defaultValue={editingTransaction ? format(editingTransaction.date, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd")}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-widest leading-none">Voucher Type</label>
                  <select 
                    name="voucherType" 
                    required 
                    value={selectedVoucherType}
                    onChange={(e) => setSelectedVoucherType(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold bg-white"
                  >
                    <option value="PV">Payment (PV)</option>
                    <option value="RV">Receipt (RV)</option>
                    <option value="JV">Journal (JV)</option>
                    <option value="CV">Contra (CV)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700">Amount</label>
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 rounded-md border border-slate-200">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Voucher No:</span>
                    <span className="text-xs font-bold text-slate-600">
                      {selectedVoucherType}-{String(nextVoucherNo).padStart(3, "0")}
                    </span>
                    <input type="hidden" name="voucherNo" value={nextVoucherNo} />
                  </div>
                </div>
                <input 
                  name="amount" 
                  type="number" 
                  required 
                  step="0.01"
                  autoFocus
                  defaultValue={editingTransaction?.amount}
                  placeholder="0.00"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-2xl font-bold"
                />
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">
                    {txType === "EXPENSE" ? "Source (From Account)" : 
                     txType === "INCOME" ? "Source (Income Category)" : 
                     "Source (From Account)"}
                  </label>
                  <select 
                    name="fromAccountId" 
                    required 
                    defaultValue={editingTransaction?.fromAccountId}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="">Select Source Account</option>
                    {["ASSET", "LIABILITY", "INCOME", "EXPENSE", "EQUITY"].map(type => {
                      const typedAccounts = (accounts || []).filter(a => a.type === type);
                      if (typedAccounts.length === 0) return null;
                      return (
                        <optgroup key={type} label={type}>
                          {typedAccounts.map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">
                    {txType === "EXPENSE" ? "Destination (Expense Category)" : 
                     txType === "INCOME" ? "Destination (To Account)" : 
                     "Destination (To Account)"}
                  </label>
                  <select 
                    name="toAccountId" 
                    required 
                    defaultValue={editingTransaction?.toAccountId}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="">Select Destination Account</option>
                    {["ASSET", "LIABILITY", "INCOME", "EXPENSE", "EQUITY"].map(type => {
                      const typedAccounts = (accounts || []).filter(a => a.type === type);
                      if (typedAccounts.length === 0) return null;
                      return (
                        <optgroup key={type} label={type}>
                          {typedAccounts.map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Note</label>
                <textarea 
                  name="note" 
                  rows={2}
                  defaultValue={editingTransaction?.note}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  placeholder="What was this for?"
                />
              </div>

              <div className="flex gap-3 mt-4">
                <button 
                  type="button"
                  onClick={closeModals}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-600 font-bold rounded-lg hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-[2] bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 transition-colors shadow-md"
                >
                  {editingTransaction ? "Save Changes" : "Record Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
