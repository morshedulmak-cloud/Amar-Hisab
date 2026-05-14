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
}

export default function TransactionsList({ accountId, isAddingExternal, onCloseExternal }: TransactionsListProps) {
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

      {/* Mobile Card Layout */}
      <div className="md:hidden space-y-4">
        {(transactions || []).map((tx) => {
          const voucherLabel = tx.voucherType && tx.voucherNo 
            ? `${tx.voucherType}-${String(tx.voucherNo).padStart(3, "0")}`
            : "N/A";
          return (
            <div key={tx.id} className={cn("p-4 bg-white rounded-xl border border-slate-200 shadow-sm transition-all", confirmDeleteId === tx.id && "bg-red-50 ring-1 ring-red-200")}>
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center",
                    tx.type === "INCOME" ? "bg-emerald-50 text-emerald-600" :
                    tx.type === "EXPENSE" ? "bg-red-50 text-red-600" :
                    "bg-blue-50 text-blue-600"
                  )}>
                    {tx.type === "INCOME" ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{voucherLabel}</p>
                    <p className="text-xs text-slate-500 font-medium">{format(tx.date, "MMM dd, yyyy")}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-900">{formatCurrency(tx.amount)}</p>
                  {accountId && (
                    <span className={cn(
                      "text-[9px] font-bold px-1.5 py-0.5 rounded uppercase",
                      tx.toAccountId === accountId ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                    )}>
                      {tx.toAccountId === accountId ? "Debit" : "Credit"}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3 py-2 border-y border-slate-50">
                <div>
                  <p className="text-[9px] text-slate-400 uppercase font-black">From</p>
                  <p className="text-xs font-semibold text-slate-700 truncate">{getAccountName(tx.fromAccountId)}</p>
                </div>
                <div>
                  <p className="text-[9px] text-slate-400 uppercase font-black">To</p>
                  <p className="text-xs font-semibold text-slate-700 truncate">{getAccountName(tx.toAccountId)}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500 italic truncate flex-1">{tx.note || "No notes"}</p>
                <div className="flex items-center gap-1">
                  <button onClick={() => { setEditingTransaction(tx); setTxType(tx.type); openAddModal(); }} className="p-2 text-blue-600 bg-blue-50 rounded-lg"><Pencil size={14} /></button>
                  <button onClick={() => tx.id && handleDelete(tx.id)} className={cn("p-2 rounded-lg", confirmDeleteId === tx.id ? "bg-red-600 text-white" : "text-red-600 bg-red-50")}><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          );
        })}
        {(transactions || []).length === 0 && <div className="py-10 text-center text-slate-400 text-sm">No entries found</div>}
      </div>

      {/* Desktop Table Layout */}
      <div className="hidden md:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Voucher</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">From (Cr)</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">To (Dr)</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Purpose</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Amount</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(transactions || []).map((tx) => {
                const voucherLabel = tx.voucherType && tx.voucherNo 
                  ? `${tx.voucherType}-${String(tx.voucherNo).padStart(3, "0")}`
                  : "N/A";
                return (
                  <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4 text-sm text-slate-600 whitespace-nowrap">
                      {format(tx.date, "MMM dd, yyyy")}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[10px] font-bold px-2 py-1 bg-slate-100 rounded text-slate-600">{voucherLabel}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-slate-900">{getAccountName(tx.fromAccountId)}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-slate-900">{getAccountName(tx.toAccountId)}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500 max-w-[200px] truncate">
                      {tx.note || "-"}
                      {accountId && (
                        <span className={cn(
                          "ml-2 text-[10px] font-bold px-1 rounded",
                          tx.toAccountId === accountId ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                        )}>
                          {tx.toAccountId === accountId ? "DEBIT" : "CREDIT"}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-right whitespace-nowrap text-slate-900">
                      {formatCurrency(tx.amount)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button 
                          onClick={() => {
                            setEditingTransaction(tx);
                            setTxType(tx.type);
                            openAddModal();
                          }}
                          className="p-1.5 text-slate-300 hover:text-blue-500 transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
                        >
                          <Pencil size={16} />
                        </button>
                        <button 
                          onClick={() => tx.id && handleDelete(tx.id)}
                          className={cn(
                            "p-1.5 transition-all text-sm font-bold rounded-lg",
                            confirmDeleteId === tx.id 
                              ? "bg-red-600 text-white px-2 py-1" 
                              : "text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-100 md:opacity-0 md:group-hover:opacity-100"
                          )}
                        >
                          {confirmDeleteId === tx.id ? "Delete?" : <Trash2 size={16} />}
                        </button>
                        {confirmDeleteId === tx.id && (
                          <button 
                            onClick={() => setConfirmDeleteId(null)}
                            className="p-1 text-slate-400 hover:text-slate-600"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {summary && (
              <tfoot>
                <tr className="bg-slate-50 font-bold border-t-2 border-slate-200">
                  <td colSpan={5} className="px-6 py-4 text-xs uppercase tracking-wider text-slate-500">
                    <div className="flex items-center gap-8">
                      <span>Total Debit Period: <span className="text-blue-600">{formatCurrency(summary.dr)}</span></span>
                      <span>Total Credit Period: <span className="text-slate-600">{formatCurrency(summary.cr)}</span></span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right text-lg font-black text-slate-900">
                    {formatCurrency(summary.closingBalance)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
          {(transactions || []).length === 0 && (
            <div className="py-20 text-center text-slate-400">No ledger entries found</div>
          )}
        </div>
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
