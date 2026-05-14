import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getNextVoucherNo, getAccountBalance, getAccountSummary } from "../db/database";
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
  Pencil
} from "lucide-react";
import { Transaction, TransactionType } from "../types";

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
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const accounts = useLiveQuery(() => db.accounts.where("isDeleted").equals(0).toArray());
  const accountMap = React.useMemo(() => new Map((accounts || []).map(a => [a.id, a])), [accounts]);
  const getAccountName = React.useCallback((id: number) => accountMap.get(id)?.name || "Unknown", [accountMap]);
  
  const settings = useLiveQuery(() => db.settings.get("app-settings"));
  
  const transactions = useLiveQuery(async () => {
    let collection: any;
    
    const start = settings?.startDate || 0;
    const end = settings?.endDate || Date.now();

    // Primary index should be date for report periods
    collection = db.transactions
      .where("date")
      .between(start, end, true, true)
      .and(t => t.isDeleted === 0);

    let txs = await collection.toArray();
    
    // Reverse sort by date
    txs.sort((a, b) => b.date - a.date);

    if (accountId) {
      txs = txs.filter(t => t.fromAccountId === accountId || t.toAccountId === accountId);
    }

    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      txs = txs.filter(t => 
        t.note?.toLowerCase().includes(lowerQuery)
      );
    }
    
    return txs;
  }, [searchQuery, accountId, settings]);

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

  const handleDelete = React.useCallback(async (id: number) => {
    if (confirmDeleteId === id) {
      await db.transactions.update(id, { isDeleted: 1, updatedAt: Date.now(), syncStatus: "pending" });
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
    }
  }, [confirmDeleteId]);

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
          <button 
            onClick={openAddModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus size={16} />
            New Entry
          </button>
        </div>
      </div>

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
                  confirmDeleteId === tx.id && "bg-red-50"
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
                  <button onClick={() => { setEditingTransaction(tx); setTxType(tx.type); openAddModal(); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"><Pencil size={14} /></button>
                  <button onClick={() => tx.id && handleDelete(tx.id)} className={cn("p-1.5 rounded-md transition-all", confirmDeleteId === tx.id ? "bg-red-600 text-white" : "text-slate-300 hover:text-red-600 hover:bg-red-50")}>{confirmDeleteId === tx.id ? <span className="text-[10px] font-black px-1 uppercase">Delete?</span> : <Trash2 size={14} />}</button>
                </div>

                {/* Mobile Actions (Small dots or slide indicator would be better but let's keep it simple and accessible) */}
                <div className="flex md:hidden items-center gap-3 mt-4 pt-3 border-t border-slate-50">
                  <button onClick={() => { setEditingTransaction(tx); setTxType(tx.type); openAddModal(); }} className="flex-1 py-1.5 bg-slate-50 text-blue-600 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1"><Pencil size={12} /> Edit</button>
                  <button onClick={() => tx.id && handleDelete(tx.id)} className={cn("flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1", confirmDeleteId === tx.id ? "bg-red-600 text-white" : "bg-slate-50 text-slate-400")}><Trash2 size={12} /> {confirmDeleteId === tx.id ? "Confirm?" : "Delete"}</button>
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
              
              if (editingTransaction) {
                await db.transactions.update(editingTransaction.id!, {
                  amount,
                  fromAccountId: fromId,
                  toAccountId: toId,
                  note,
                  updatedAt: Date.now(),
                  syncStatus: "pending"
                });
              } else {
                const vType = txType === "INCOME" ? "RV" : txType === "EXPENSE" ? "PV" : "JV";
                const vNo = await getNextVoucherNo(vType);

                await db.transactions.add({
                  amount,
                  fromAccountId: fromId,
                  toAccountId: toId,
                  note,
                  type: txType,
                  voucherType: vType,
                  voucherNo: vNo,
                  date: Date.now(),
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  syncStatus: "pending",
                  isDeleted: 0
                });
              }
              closeModals();
            }} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Amount</label>
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

              <button 
                type="submit"
                className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 transition-colors shadow-md mt-4"
              >
                {editingTransaction ? "Save Changes" : "Record Entry"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
