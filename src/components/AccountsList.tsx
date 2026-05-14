import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getAccountBalance } from "../db/database";
import { formatCurrency, cn, savePDF } from "../lib/utils";
import { Plus, Wallet, CreditCard, Banknote, Landmark, Trash2, X, ArrowUpRight, ArrowDownLeft, Pencil, Download, ExternalLink, ArrowLeftRight, Loader2, ChevronRight } from "lucide-react";
import TransactionsList from "./TransactionsList";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";

interface AccountsListProps {
  isAddingExternal?: boolean;
  onCloseExternal?: () => void;
}

export default function AccountsList({ isAddingExternal, onCloseExternal }: AccountsListProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingBulk, setIsGeneratingBulk] = useState(false);

  React.useEffect(() => {
    if (isAddingExternal) {
      setIsAdding(true);
    }
  }, [isAddingExternal]);

  const handleClose = () => {
    setIsAdding(false);
    setEditingAccount(null);
    if (onCloseExternal) onCloseExternal();
  };
  const [editingAccount, setEditingAccount] = useState<any>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  // Handle back button for modals and drill-down
  React.useEffect(() => {
    const handlePop = (e: any) => {
      const state = e.detail;
      if (!state.isModal) {
        setIsAdding(false);
        setEditingAccount(null);
        setSelectedAccountId(null);
      } else if (state.modalType !== "ledger-detail") {
        setSelectedAccountId(null);
      }
    };
    window.addEventListener("app-popstate" as any, handlePop);
    return () => window.removeEventListener("app-popstate" as any, handlePop);
  }, []);

  const openAddModal = () => {
    const currentState = window.history.state;
    window.history.pushState({ ...currentState, isModal: true, modalType: "account" }, "");
    setIsAdding(true);
  };

  const openLedgerDetail = (id: number) => {
    const currentState = window.history.state;
    window.history.pushState({ ...currentState, isModal: true, modalType: "ledger-detail", ledgerId: id }, "");
    setSelectedAccountId(id);
  };

  const closeModals = () => {
    if (window.history.state.isModal) {
      window.history.back();
    } else {
      setIsAdding(false);
      setEditingAccount(null);
      setSelectedAccountId(null);
    }
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const settings = useLiveQuery(() => db.settings.get("app-settings"));

  const accounts = useLiveQuery(async () => {
    const list = await db.accounts.where("isDeleted").equals(0).toArray();
    const accountsWithBalance = await Promise.all(
      list.map(async (acc) => {
        const balance = (acc.initialBalance || 0) + await getAccountBalance(acc.id!, settings?.endDate);
        let effectiveType = acc.type;
        if (acc.type === "ASSET" || acc.type === "LIABILITY") {
          effectiveType = balance >= 0 ? "ASSET" : "LIABILITY";
        }
        return {
          ...acc,
          currentBalance: balance,
          effectiveType
        };
      })
    );
    return accountsWithBalance;
  }, [settings]);

  const handleDelete = async (id: number) => {
    const account = accounts?.find(a => a.id === id);
    if (!account) return;

    if (Math.abs(account.currentBalance) > 0.001) {
      setErrorMessage(`Cannot delete ledger "${account.name}". It must have a zero balance first (Current: ${formatCurrency(account.currentBalance)}). Please delete its transactions first.`);
      return;
    }

    if (confirmDeleteId === id) {
      await db.accounts.update(id, { isDeleted: 1, updatedAt: Date.now(), syncStatus: "pending" });
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
    }
  };

  const icons: Record<string, any> = {
    ASSET: Banknote,
    LIABILITY: Landmark,
    EQUITY: Wallet,
    INCOME: ArrowUpRight,
    EXPENSE: ArrowDownLeft,
  };

  const generateLedgerTableData = async (account: any) => {
    let txsQuery = db.transactions
      .where("isDeleted").equals(0)
      .filter(t => t.fromAccountId === account.id || t.toAccountId === account.id);
    
    // Calculate Opening Balance from transactions before startDate
    let openingBalanceFromTx = 0;
    if (settings) {
      const prevTxs = await db.transactions
        .where("isDeleted").equals(0)
        .filter(t => (t.fromAccountId === account.id || t.toAccountId === account.id) && t.date < settings.startDate)
        .toArray();
      
      const isAssetOrExpense = account.type === "ASSET" || account.type === "EXPENSE";
      prevTxs.forEach(tx => {
        const isDebit = tx.toAccountId === account.id;
        const debitVal = isDebit ? tx.amount : 0;
        const creditVal = !isDebit ? tx.amount : 0;
        
        // Universal Ledger: Balance = Dr - Cr
        openingBalanceFromTx += debitVal - creditVal;
      });

      txsQuery = txsQuery.filter(t => t.date >= settings.startDate && t.date <= settings.endDate);
    }

    const txs = await txsQuery.sortBy("date");
    
    let runningBalance = (account.initialBalance || 0) + openingBalanceFromTx;
    const isAssetOrExpense = account.type === "ASSET" || account.type === "EXPENSE";

    const body: any[] = [
      ["-", "-", "OPENING BALANCE", "Accumulated balance before period", "-", "-", formatCurrency(runningBalance)]
    ];

    let totalPeriodDebit = 0;
    let totalPeriodCredit = 0;

    txs.forEach((tx, index) => {
      const isDebit = tx.toAccountId === account.id;
      const debitVal = isDebit ? tx.amount : 0;
      const creditVal = !isDebit ? tx.amount : 0;

      totalPeriodDebit += debitVal;
      totalPeriodCredit += creditVal;

      // Universal Ledger: Balance = Opening + Dr - Cr
      runningBalance += debitVal - creditVal;

      const voucherLabel = tx.voucherType && tx.voucherNo 
        ? `${tx.voucherType}-${String(tx.voucherNo).padStart(3, "0")}`
        : "N/A";

      body.push([
        index + 1,
        format(tx.date, "yyyy-MM-dd"),
        voucherLabel,
        tx.note || "-",
        debitVal > 0 ? formatCurrency(debitVal) : "-",
        creditVal > 0 ? formatCurrency(creditVal) : "-",
        formatCurrency(runningBalance)
      ]);
    });

    // Summary Row
    body.push([
      { content: "SUMMARY FOR PERIOD", colSpan: 4, styles: { fontStyle: "bold", halign: "right", fillColor: [248, 250, 252] } },
      { content: formatCurrency(totalPeriodDebit), styles: { fontStyle: "bold", halign: "right", fillColor: [248, 250, 252], textColor: [37, 99, 235] } },
      { content: formatCurrency(totalPeriodCredit), styles: { fontStyle: "bold", halign: "right", fillColor: [248, 250, 252], textColor: [71, 85, 105] } },
      { content: formatCurrency(runningBalance), styles: { fontStyle: "bold", halign: "right", fillColor: [241, 245, 249], textColor: [15, 23, 42] } }
    ]);

    return { body, closingBalance: runningBalance };
  };

  const handleDownloadSingleLedger = async (account: any) => {
    setIsGenerating(true);
    try {
      const doc = new jsPDF();
      const { body } = await generateLedgerTableData(account);
      
      doc.setFontSize(22);
      doc.setTextColor(59, 130, 246);
      doc.text(settings?.profileName || "Universal Ledger", 14, 20);
      
      doc.setFontSize(14);
      doc.setTextColor(51, 65, 85);
      doc.text(`Ledger: ${account.name}`, 14, 28);
      
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Type: ${account.type} | Current Balance: ${formatCurrency(account.currentBalance)}`, 14, 34);
      doc.text(`Period: ${settings ? format(settings.startDate, "PP") : ""} - ${settings ? format(settings.endDate, "PP") : ""}`, 14, 40);
      doc.text(`Generated: ${format(new Date(), "PPpp")}`, 14, 46);
      doc.line(14, 50, 196, 50);

      autoTable(doc, {
        head: [["SL", "Date", "Voucher", "Details/Purpose", "Debit", "Credit", "Balance"]],
        body,
        startY: 55,
        theme: "striped",
        headStyles: { fillColor: [59, 130, 246] },
        styles: { fontSize: 8 },
        columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 25 }, 2: { cellWidth: 25 }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } }
      });

      await savePDF(doc, `Ledger_${account.name}_${format(new Date(), "yyyyMMdd")}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadAllLedgers = async () => {
    if (!accounts) return;
    setIsGeneratingBulk(true);
    try {
      const doc = new jsPDF("l", "mm", "a4"); // Landscape for better fit
      let currentY = 20;

      doc.setFontSize(22);
      doc.setTextColor(59, 130, 246);
      doc.text(settings?.profileName || "Bulk Ledger Report", 14, currentY);
      currentY += 10;

      doc.setFontSize(14);
      doc.setTextColor(51, 65, 85);
      doc.text("Complete Ledger Reconcilation", 14, currentY);
      currentY += 10;
      
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Period: ${settings ? format(settings.startDate, "PP") : ""} - ${settings ? format(settings.endDate, "PP") : ""}`, 14, currentY);
      currentY += 5;
      doc.text(`Generated: ${format(new Date(), "PPpp")}`, 14, currentY);
      currentY += 5;
      doc.line(14, currentY, 282, currentY);
      currentY += 10;

      const summaryBody = accounts.map(a => [
        a.name,
        a.type,
        formatCurrency(a.currentBalance)
      ]);

      autoTable(doc, {
        head: [["Ledger Name", "Type", "Balance"]],
        body: summaryBody,
        startY: currentY,
        theme: "grid",
        headStyles: { fillColor: [51, 65, 85] }
      });

      for (const account of accounts) {
        doc.addPage();
        doc.setFontSize(16);
        doc.setTextColor(0);
        doc.text(`Ledger Statement: ${account.name}`, 14, 20);
        doc.setFontSize(10);
        doc.text(`Type: ${account.type}`, 14, 26);
        
        const { body } = await generateLedgerTableData(account);

        autoTable(doc, {
          head: [["SL", "Date", "Voucher", "Details/Purpose", "Debit", "Credit", "Balance"]],
          body,
          startY: 32,
          theme: "striped",
          headStyles: { fillColor: [59, 130, 246] },
          styles: { fontSize: 8 },
          columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 30 }, 2: { cellWidth: 30 }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } }
        });
      }

      await savePDF(doc, `Complete_Ledger_Report_${format(new Date(), "yyyyMMdd")}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setIsGeneratingBulk(false);
    }
  };

  const selectedAccountDetails = accounts?.find(a => a.id === selectedAccountId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-900">Chart of Accounts</h3>
          <p className="text-sm text-slate-500">Manage your ledger accounts and tracking categories.</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleDownloadAllLedgers}
            disabled={isGeneratingBulk}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            {isGeneratingBulk ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {isGeneratingBulk ? "Wait..." : "Bulk PDF"}
          </button>
          <button 
            onClick={openAddModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus size={16} />
            Add Account
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Table Header - Desktop Only */}
        <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="col-span-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Account / Ledger Name</div>
          <div className="col-span-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Category</div>
          <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Balance</div>
          <div className="col-span-2 text-right"></div>
        </div>

        {errorMessage && (
          <div className="bg-red-50 border-b border-red-100 p-4 flex items-center justify-between text-red-600 text-sm animate-in slide-in-from-top-2">
            <p>{errorMessage}</p>
            <button onClick={() => setErrorMessage(null)} className="p-1 hover:bg-red-100 rounded">
              <X size={16} />
            </button>
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {(accounts || []).map((account) => {
            const Icon = icons[account.type] || Wallet;
            return (
              <div 
                key={account.id} 
                onClick={() => openLedgerDetail(account.id)}
                className="grid grid-cols-12 gap-4 px-4 md:px-6 py-4 hover:bg-slate-50/50 transition-all group cursor-pointer items-center relative"
              >
                {/* Account Name & Icon */}
                <div className="col-span-9 md:col-span-5 flex items-center gap-4">
                  <div 
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm"
                    style={{ backgroundColor: account.color || "#3b82f6" }}
                  >
                    <Icon size={20} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-slate-900 truncate">{account.name}</h4>
                    <div className="flex md:hidden items-center gap-2 mt-0.5">
                      <span className={cn(
                        "text-[9px] font-black uppercase tracking-tight",
                        account.effectiveType === "ASSET" ? "text-blue-500" :
                        account.effectiveType === "LIABILITY" ? "text-amber-500" :
                        account.effectiveType === "INCOME" ? "text-emerald-500" :
                        account.effectiveType === "EXPENSE" ? "text-red-500" :
                        "text-slate-400"
                      )}>
                        {account.effectiveType}{account.effectiveType !== account.type && " *"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Category Label - Desktop */}
                <div className="hidden md:flex col-span-3 justify-center">
                  <span className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest",
                    account.effectiveType === "ASSET" ? "bg-blue-50 text-blue-600 border border-blue-100" :
                    account.effectiveType === "LIABILITY" ? "bg-amber-50 text-amber-600 border border-amber-100" :
                    account.effectiveType === "INCOME" ? "bg-emerald-50 text-emerald-600 border border-emerald-100" :
                    account.effectiveType === "EXPENSE" ? "bg-red-50 text-red-600 border border-red-100" :
                    "bg-slate-50 text-slate-500 border border-slate-200"
                  )}>
                    {account.effectiveType}
                    {account.effectiveType !== account.type && " *"}
                  </span>
                </div>

                {/* Balance */}
                <div className="col-span-3 md:col-span-2 text-right">
                  <span className="text-base md:text-lg font-black text-slate-900 tracking-tight">
                    {formatCurrency(account.currentBalance)}
                  </span>
                </div>

                {/* Actions Overlay / Row Actions */}
                <div className="hidden md:flex col-span-2 justify-end items-center gap-1">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingAccount(account);
                      openAddModal();
                    }}
                    className="p-1.5 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                  >
                    <Pencil size={16} /> 
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      account.id && handleDelete(account.id);
                    }}
                    className={cn(
                      "p-1.5 rounded-lg transition-all",
                      confirmDeleteId === account.id 
                        ? "bg-red-600 text-white" 
                        : "text-slate-300 hover:text-red-600 hover:bg-red-50"
                    )}
                  >
                    {confirmDeleteId === account.id ? <span className="text-[10px] font-black px-1">CONFIRM</span> : <Trash2 size={16} />}
                  </button>
                  {confirmDeleteId === account.id && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                      }}
                      className="p-1 text-slate-400 hover:text-slate-600"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Indicators */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex md:hidden">
                   <ChevronRight size={16} className="text-slate-300" />
                </div>
              </div>
            );
          })}
        </div>
        {(accounts || []).length === 0 && (
          <div className="p-20 text-center bg-white">
            <p className="text-slate-400 text-sm italic">No ledger accounts found. Create your first ledger to get started.</p>
          </div>
        )}
      </div>

      {/* Ledger Transactions Drill-down */}
      {selectedAccountDetails && (
        <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center p-0 md:p-8 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-slate-50 w-full max-w-5xl md:h-[85vh] h-[95vh] rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-8 duration-300">
            <div 
              className="p-6 md:p-8 text-white relative overflow-hidden"
              style={{ backgroundColor: selectedAccountDetails.color || "#3b82f6" }}
            >
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-widest opacity-80">{selectedAccountDetails.effectiveType}</span>
                    {selectedAccountDetails.effectiveType !== selectedAccountDetails.type && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 bg-black/20 rounded">Transferred from {selectedAccountDetails.type}</span>
                    )}
                  </div>
                  <button 
                    onClick={closeModals}
                    className="p-2 bg-black/10 hover:bg-black/20 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
                <h2 className="text-3xl font-black mb-1">{selectedAccountDetails.name}</h2>
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div className="text-4xl font-black tracking-tighter">
                    {formatCurrency(selectedAccountDetails.currentBalance)}
                  </div>
                  <button 
                    onClick={() => handleDownloadSingleLedger(selectedAccountDetails)}
                    disabled={isGenerating}
                    className="flex items-center gap-2 px-6 py-3 bg-white text-slate-900 rounded-2xl text-sm font-black hover:bg-slate-100 transition-all shadow-xl shadow-black/10 w-fit disabled:opacity-50"
                  >
                    {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                    {isGenerating ? "Generating..." : "Statement PDF"}
                  </button>
                </div>
              </div>
              {/* Decorative Background Icon */}
              <Wallet className="absolute -right-8 -bottom-8 w-48 h-48 opacity-10 rotate-12" />
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-8">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                  <ArrowLeftRight size={20} className="text-slate-400" />
                  Transaction History
                </h3>
              </div>
              <TransactionsList accountId={selectedAccountId!} />
            </div>
          </div>
        </div>
      )}

      {isAdding && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-lg">{editingAccount ? "Edit Account" : "Create New Account"}</h3>
              <button onClick={closeModals} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const name = formData.get("name") as string;
              const type = formData.get("type") as any;
              const balance = Number(formData.get("balance"));
              const color = formData.get("color") as string;

              // Universal Ledger: Debit is positive, Credit is negative
              // Assets and Expenses are typically Debits (stored as positive)
              // Liabilities, Equity, and Income are typically Credits (stored as negative)
              let adjustedBalance = balance;
              if (type === "LIABILITY" || type === "EQUITY" || type === "INCOME") {
                // If user entered a positive number for a credit account, store it as negative
                if (adjustedBalance > 0) adjustedBalance = -adjustedBalance;
              }

              if (editingAccount) {
                await db.accounts.update(editingAccount.id, {
                  name,
                  type,
                  initialBalance: adjustedBalance,
                  color,
                  updatedAt: Date.now(),
                  syncStatus: "pending"
                });
              } else {
                await db.accounts.add({
                  name,
                  type,
                  initialBalance: adjustedBalance,
                  color,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  syncStatus: "pending",
                  isDeleted: 0
                });
              }
              handleClose();
            }} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Account / Ledger Name</label>
                <input 
                  name="name" 
                  type="text" 
                  required 
                  autoFocus
                  defaultValue={editingAccount?.name}
                  placeholder="e.g. Bank Account, Food Expense"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Type</label>
                  <select 
                    name="type" 
                    defaultValue={editingAccount?.type || "ASSET"}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="ASSET">Asset (Cash/Bank)</option>
                    <option value="LIABILITY">Liability (Credit Card/Loan)</option>
                    <option value="INCOME">Income Category</option>
                    <option value="EXPENSE">Expense Category</option>
                    <option value="EQUITY">Equity</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Initial Balance</label>
                  <input 
                    name="balance" 
                    type="number" 
                    required 
                    defaultValue={editingAccount?.initialBalance || 0}
                    step="0.01"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Label Color</label>
                <input 
                  name="color" 
                  type="color" 
                  defaultValue={editingAccount?.color || "#3b82f6"}
                  className="w-full h-10 border border-slate-300 rounded-lg p-1 outline-none cursor-pointer"
                />
              </div>

              <button 
                type="submit"
                className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 transition-colors shadow-md mt-4"
              >
                {editingAccount ? "Update Account" : "Create Account"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
