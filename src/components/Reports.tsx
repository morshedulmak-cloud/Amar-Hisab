import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getAccountBalance, getAccountSummary } from "../db/database";
import { formatCurrency, cn, savePDF } from "../lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, startOfMonth, endOfMonth, eachMonthOfInterval, subMonths } from "date-fns";
import { FileText, PieChart, Landmark, Scale, TrendingUp, ChevronRight, Download, Loader2, ArrowDownRight, ArrowUpLeft, RefreshCw } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type ReportTab = "charts" | "trial-balance" | "income-statement" | "balance-sheet" | "receipt-payment" | "cash-flow";

export default function Reports() {
  const [activeTab, setActiveTab] = useState<ReportTab>("charts");
  const [isGenerating, setIsGenerating] = useState(false);

  const settings = useLiveQuery(() => db.settings.get("app-settings"));
  const accountsData = useLiveQuery(() => db.accounts.where("isDeleted").equals(0).toArray());

  const reportsData = useLiveQuery(async () => {
    if (!accountsData) return null;
    
    const accountBalances = await Promise.all(
      accountsData.map(async (acc) => {
        // For Profit/Loss (Income/Expense), we usually want the net change within the period
        // For Balance Sheet items, we want the cumulative balance including opening
        const isIncomeExpense = acc.type === "INCOME" || acc.type === "EXPENSE";
        
        // 1. Opening Balance (Before period start)
        const prevTxBalance = await getAccountBalance(acc.id!, (settings?.startDate || 0) - 1);
        const openingBalance = (acc.initialBalance || 0) + prevTxBalance;
        
        // 2. Period Activity (Summary of Dr/Cr in the range)
        const summary = await getAccountSummary(acc.id!, settings?.endDate, settings?.startDate);
        
        // 3. Closing Balance (Total as of end period) - Raw Universal Balance
        const cumulativeTx = await getAccountBalance(acc.id!, settings?.endDate);
        const rawClosingBalance = (acc.initialBalance || 0) + cumulativeTx;

        // Dynamic Re-categorization Logic for Assets & Liabilities
        let effectiveType = acc.type;
        let presentationBalance = rawClosingBalance;

        if (acc.type === "ASSET" || acc.type === "LIABILITY") {
          if (rawClosingBalance >= 0) {
            effectiveType = "ASSET";
            presentationBalance = rawClosingBalance;
          } else {
            effectiveType = "LIABILITY";
            presentationBalance = rawClosingBalance * -1;
          }
        } else {
          // Standard logic for Income, Expense, Equity
          if (acc.type === "INCOME" || acc.type === "EXPENSE" || acc.type === "EQUITY") {
            presentationBalance = rawClosingBalance * -1;
          }
        }

        // For Profit/Loss items, we look at the period activity (summary.net) instead of cumulative
        if (isIncomeExpense) {
          presentationBalance = summary.net * -1;
        }

        return {
          ...acc,
          effectiveType,
          openingBalance,
          periodDebit: summary.debit,
          periodCredit: summary.credit,
          closingBalance: rawClosingBalance,
          balance: presentationBalance
        };
      })
    );

    const totalIncome = accountBalances
      .filter(a => a.type === "INCOME")
      .reduce((sum, a) => sum + a.balance, 0);

    const totalExpense = Math.abs(accountBalances
      .filter(a => a.type === "EXPENSE")
      .reduce((sum, a) => sum + a.balance, 0));

    const netProfit = totalIncome - totalExpense;

    const totalAssets = accountBalances
      .filter(a => a.effectiveType === "ASSET")
      .reduce((sum, a) => sum + a.balance, 0);

    const totalLiabilities = accountBalances
      .filter(a => a.effectiveType === "LIABILITY")
      .reduce((sum, a) => sum + a.balance, 0);

    const totalEquity = accountBalances
      .filter(a => a.type === "EQUITY")
      .reduce((sum, a) => sum + a.balance, 0);

    // Opening and Closing Cash/Bank restricted to ASSETS
    const openingCash = accountBalances
      .filter(a => a.type === "ASSET")
      .reduce((sum, s) => sum + s.openingBalance, 0);

    const closingCash = accountBalances
      .filter(a => a.type === "ASSET")
      .reduce((sum, s) => sum + s.closingBalance, 0);

    return {
      accountBalances,
      totalIncome,
      totalExpense,
      netProfit,
      totalAssets,
      totalLiabilities,
      totalEquity,
      openingCash,
      closingCash
    };
  }, [accountsData]);

  const handleDownloadPDF = async () => {
    if (!reportsData) return;
    setIsGenerating(true);
    
    try {
      const doc = new jsPDF();
      const dateStr = format(new Date(), "yyyy-MM-dd-HHmm");
      let title = "Report";
      
      // Add header
      doc.setFontSize(22);
      doc.setTextColor(59, 130, 246); // blue-600
      doc.text(settings?.profileName || "Universal Ledger", 14, 20);
      
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Period: ${settings ? format(settings.startDate, "MMMM dd, yyyy") : ""} - ${settings ? format(settings.endDate, "MMMM dd, yyyy") : ""}`, 14, 28);
      doc.text(`Generated on: ${format(new Date(), "MMMM dd, yyyy HH:mm")}`, 14, 34);
      doc.line(14, 38, 196, 38);

      if (activeTab === "trial-balance") {
        title = "Trial_Balance";
        doc.setFontSize(16);
        doc.setTextColor(0);
        doc.text("Trial Balance", 14, 45);
        
        const body = reportsData.accountBalances.map(acc => [
          acc.name,
          formatCurrency(acc.openingBalance),
          formatCurrency(acc.periodDebit),
          formatCurrency(acc.periodCredit),
          formatCurrency(acc.closingBalance)
        ]);

        autoTable(doc, {
          head: [["Ledger Name", "Opening", "Total Debit", "Total Credit", "Closing Balance"]],
          body,
          startY: 50,
          theme: "striped",
          headStyles: { fillColor: [59, 130, 246] },
          foot: [["Total", 
            formatCurrency(reportsData.accountBalances.reduce((s, a) => s + a.openingBalance, 0)),
            formatCurrency(reportsData.accountBalances.reduce((s, a) => s + a.periodDebit, 0)),
            formatCurrency(reportsData.accountBalances.reduce((s, a) => s + a.periodCredit, 0)),
            formatCurrency(reportsData.accountBalances.reduce((s, a) => s + a.closingBalance, 0))
          ]],
          footStyles: { fillColor: [241, 245, 249], textColor: [0, 0, 0], fontStyle: "bold" }
        });

      } else if (activeTab === "income-statement") {
        title = "Income_Statement";
        doc.setFontSize(16);
        doc.setTextColor(0);
        doc.text("Income Statement (P&L)", 14, 45);

        const incomeBody = reportsData.accountBalances.filter(a => a.type === "INCOME").map(acc => [acc.name, formatCurrency(acc.balance)]);
        const expenseBody = reportsData.accountBalances.filter(a => a.type === "EXPENSE").map(acc => [acc.name, formatCurrency(Math.abs(acc.balance))]);

        autoTable(doc, {
          head: [["Revenue / Income", "Amount"]],
          body: [...incomeBody, [{ content: "Total Income", styles: { fontStyle: "bold" } }, { content: formatCurrency(reportsData.totalIncome), styles: { fontStyle: "bold" } }]],
          startY: 50,
          theme: "plain",
          headStyles: { textColor: [16, 185, 129], fontStyle: "bold" }
        });

        autoTable(doc, {
          head: [["Operating Expenses", "Amount"]],
          body: [...expenseBody, [{ content: "Total Expenses", styles: { fontStyle: "bold" } }, { content: formatCurrency(reportsData.totalExpense), styles: { fontStyle: "bold", textColor: [239, 68, 68] } }]],
          startY: (doc as any).lastAutoTable.finalY + 10,
          theme: "plain",
          headStyles: { textColor: [239, 68, 68], fontStyle: "bold" }
        });

        const netY = (doc as any).lastAutoTable.finalY + 15;
        doc.setFillColor(15, 23, 42); // slate-900
        doc.rect(14, netY, 182, 15, "F");
        doc.setTextColor(255);
        doc.setFontSize(12);
        doc.text("Net Profit / (Loss)", 20, netY + 10);
        doc.text(formatCurrency(reportsData.netProfit), 190, netY + 10, { align: "right" });

      } else if (activeTab === "balance-sheet") {
        title = "Balance_Sheet";
        doc.setFontSize(16);
        doc.setTextColor(0);
        doc.text("Balance Sheet", 14, 45);

        const assetBody = reportsData.accountBalances.filter(a => a.effectiveType === "ASSET").map(acc => [acc.name, formatCurrency(acc.balance)]);
        const liabBody = reportsData.accountBalances.filter(a => a.effectiveType === "LIABILITY").map(acc => [acc.name, formatCurrency(acc.balance)]);
        const equityBody = reportsData.accountBalances.filter(a => a.type === "EQUITY").map(acc => [acc.name, formatCurrency(acc.balance)]);

        autoTable(doc, {
          head: [["Assets", "Value"]],
          body: [...assetBody, [{ content: "Total Assets", styles: { fontStyle: "bold", fontSize: 11 } }, { content: formatCurrency(reportsData.totalAssets), styles: { fontStyle: "bold", fontSize: 11 } }]],
          startY: 50,
          theme: "plain",
          headStyles: { textColor: [59, 130, 246], fontStyle: "bold" }
        });

        autoTable(doc, {
          head: [["Liabilities & Equity", "Value"]],
          body: [
            ...liabBody,
            ...equityBody,
            ["Current Year Earnings (P&L)", formatCurrency(reportsData.netProfit)],
            [{ content: "Total Liabilities & Equity", styles: { fontStyle: "bold", fontSize: 11 } }, { content: formatCurrency(reportsData.totalLiabilities + reportsData.totalEquity + reportsData.netProfit), styles: { fontStyle: "bold", fontSize: 11 } }]
          ],
          startY: (doc as any).lastAutoTable.finalY + 10,
          theme: "plain",
          headStyles: { textColor: [0, 0, 0], fontStyle: "bold" }
        });

        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text("Balanced: Total Assets = Total Liabilities + Total Equity", 105, (doc as any).lastAutoTable.finalY + 15, { align: "center" });

      } else if (activeTab === "receipt-payment") {
        title = "Receipt_Payment_Statement";
        doc.setFontSize(16);
        doc.setTextColor(0);
        doc.text("Receipt & Payment Statement", 14, 45);

        const receiptBody = reportsData.accountBalances.filter(a => a.type === "INCOME").map(acc => [acc.name, formatCurrency(acc.balance)]);
        const paymentBody = reportsData.accountBalances.filter(a => a.type === "EXPENSE").map(acc => [acc.name, formatCurrency(Math.abs(acc.balance))]);

        autoTable(doc, {
          head: [["Opening Cash & Bank Balance", formatCurrency(reportsData.openingCash)]],
          body: [],
          startY: 50,
          theme: "plain",
          headStyles: { fillColor: [248, 250, 252], textColor: [0, 0, 0] }
        });

        autoTable(doc, {
          head: [["Receipts (Inflows)", "Amount"]],
          body: [...receiptBody, [{ content: "Total Receipts", styles: { fontStyle: "bold" } }, { content: formatCurrency(reportsData.totalIncome), styles: { fontStyle: "bold" } }]],
          startY: (doc as any).lastAutoTable.finalY + 5,
          theme: "plain",
          headStyles: { textColor: [16, 185, 129], fontStyle: "bold" }
        });

        autoTable(doc, {
          head: [["Payments (Outflows)", "Amount"]],
          body: [...paymentBody, [{ content: "Total Payments", styles: { fontStyle: "bold" } }, { content: formatCurrency(reportsData.totalExpense), styles: { fontStyle: "bold" } }]],
          startY: (doc as any).lastAutoTable.finalY + 5,
          theme: "plain",
          headStyles: { textColor: [239, 68, 68], fontStyle: "bold" }
        });

        autoTable(doc, {
          head: [["Closing Cash & Bank Balance", formatCurrency(reportsData.closingCash)]],
          body: [],
          startY: (doc as any).lastAutoTable.finalY + 10,
          theme: "plain",
          headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: "bold" }
        });

      } else if (activeTab === "cash-flow") {
        title = "Cash_Flow_Statement";
        doc.setFontSize(16);
        doc.setTextColor(0);
        doc.text("Statement of Cash Flows", 14, 45);

        const opFlow = reportsData.totalIncome - reportsData.totalExpense;
        const invFlow = reportsData.accountBalances
          .filter(a => a.type === "ASSET" && (a.name.toLowerCase().includes("fixed") || a.name.toLowerCase().includes("invest")))
          .reduce((sum, a) => sum + (a.openingBalance - a.closingBalance), 0);
        const finFlow = reportsData.accountBalances
          .filter(a => a.type === "LIABILITY" || a.type === "EQUITY")
          .reduce((sum, a) => sum + (a.closingBalance - a.openingBalance), 0);

        autoTable(doc, {
          head: [["Cash Flow Activity", "Net Amount"]],
          body: [
            ["Cash Flow from Operating Activities", formatCurrency(opFlow)],
            ["Cash Flow from Investing Activities", formatCurrency(invFlow)],
            ["Cash Flow from Financing Activities", formatCurrency(finFlow)],
            [{ content: "Net Increase/Decrease in Cash", styles: { fontStyle: "bold" } }, { content: formatCurrency(opFlow + invFlow + finFlow), styles: { fontStyle: "bold" } }],
            ["Cash at Beginning of Period", formatCurrency(reportsData.openingCash)],
            [{ content: "Cash at End of Period", styles: { fontStyle: "bold" } }, { content: formatCurrency(reportsData.closingCash), styles: { fontStyle: "bold" } }]
          ],
          startY: 50,
          theme: "striped"
        });

      } else {
        // Charts tab
        title = "Monthly_Summary";
        doc.setFontSize(16);
        doc.setTextColor(0);
        doc.text("Monthly Financial Summary", 14, 45);
        
        const body = (monthlyData || []).map(d => [
          d.month,
          formatCurrency(d.income),
          formatCurrency(d.expense),
          formatCurrency(d.profit)
        ]);

        autoTable(doc, {
          head: [["Month", "Income", "Expense", "Net Profit"]],
          body,
          startY: 50,
          theme: "grid"
        });
      }

      await savePDF(doc, `${title}_${dateStr}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  const monthlyData = useLiveQuery(async () => {
    let collection = db.transactions.where("isDeleted").equals(0);
    
    if (settings) {
      collection = collection.filter(t => t.date >= settings.startDate && t.date <= settings.endDate);
    }

    const txs = await collection.toArray();
    if (!accountsData) return [];
    const accountMap = new Map((accountsData || []).map(a => [a.id, a]));
    
    // Last 6 months
    const now = new Date();
    const interval = eachMonthOfInterval({
      start: subMonths(now, 5),
      end: now
    });

    return interval.map(month => {
      const start = startOfMonth(month).getTime();
      const end = endOfMonth(month).getTime();
      
      let income = 0;
      let expense = 0;

      txs.forEach(t => {
        if (t.date >= start && t.date <= end) {
          const fromAcc = accountMap.get(t.fromAccountId);
          const toAcc = accountMap.get(t.toAccountId);
          if (fromAcc?.type === "INCOME") income += t.amount;
          if (toAcc?.type === "EXPENSE") expense += t.amount;
        }
      });

      return {
        month: format(month, "MMM yyyy"),
        income,
        expense,
        profit: income - expense
      };
    });
  });

  const categoryMix = useLiveQuery(async () => {
    let collection = db.transactions.where("isDeleted").equals(0);
    
    if (settings) {
      collection = collection.filter(t => t.date >= settings.startDate && t.date <= settings.endDate);
    }

    const txs = await collection.toArray();
    if (!accountsData) return [];
    const accountMap = new Map((accountsData || []).map(a => [a.id, a]));
    const categories: Record<string, { income: number, expense: number }> = {};
    
    txs.forEach(t => {
      const fromAcc = accountMap.get(t.fromAccountId);
      const toAcc = accountMap.get(t.toAccountId);

      if (toAcc?.type === "EXPENSE") {
        if (!categories[toAcc.name]) categories[toAcc.name] = { income: 0, expense: 0 };
        categories[toAcc.name].expense += t.amount;
      }
      if (fromAcc?.type === "INCOME") {
        if (!categories[fromAcc.name]) categories[fromAcc.name] = { income: 0, expense: 0 };
        categories[fromAcc.name].income += t.amount;
      }
    });

    return Object.entries(categories)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => (b.expense + b.income) - (a.expense + a.income))
      .slice(0, 10);
  });

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold">Financial Reports</h3>
          <p className="text-slate-500 text-sm">Comprehensive ledger analysis and statements</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleDownloadPDF}
            disabled={isGenerating}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-800 transition-colors shadow-lg shadow-slate-200 disabled:opacity-50"
          >
            {isGenerating ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Download size={16} />
            )}
            {isGenerating ? "Generating..." : "Download PDF"}
          </button>
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button 
              onClick={() => setActiveTab("charts")}
              className={cn(
                "px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2",
                activeTab === "charts" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-900"
              )}
            >
              <PieChart size={16} /> Dashboard
            </button>
            <button 
              onClick={() => setActiveTab("trial-balance")}
              className={cn(
                "px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2",
                activeTab === "trial-balance" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-900"
              )}
            >
              <FileText size={16} /> Trial Balance
            </button>
            <button 
              onClick={() => setActiveTab("income-statement")}
              className={cn(
                "px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2",
                activeTab === "income-statement" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-900"
              )}
            >
              <TrendingUp size={16} /> P&L
            </button>
            <button 
              onClick={() => setActiveTab("balance-sheet")}
              className={cn(
                "px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2",
                activeTab === "balance-sheet" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-900"
              )}
            >
              <Scale size={16} /> Balance Sheet
            </button>
            <button 
              onClick={() => setActiveTab("receipt-payment")}
              className={cn(
                "px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2",
                activeTab === "receipt-payment" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-900"
              )}
            >
              <ArrowDownRight size={16} /> Receipts & Payments
            </button>
            <button 
              onClick={() => setActiveTab("cash-flow")}
              className={cn(
                "px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2",
                activeTab === "cash-flow" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-900"
              )}
            >
              <RefreshCw size={16} /> Cash Flow
            </button>
          </div>
        </div>
      </div>

      {activeTab === "charts" && (
        <>
          {/* Monthly Summary Chart */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <h4 className="font-semibold mb-6">Income vs Expense (Last 6 Months)</h4>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#94a3b8" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0" }}
                  />
                  <Legend verticalAlign="top" height={36}/>
                  <Bar dataKey="income" name="Income" fill="#10b981" radius={[4, 4, 0, 0]} barSize={32} />
                  <Bar dataKey="expense" name="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h4 className="font-semibold mb-6">Monthly Performance</h4>
              <div className="space-y-4">
                {(monthlyData || []).slice().reverse().map(data => (
                  <div key={data.month} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div>
                      <p className="font-bold text-slate-900">{data.month}</p>
                      <p className="text-xs text-slate-500">Net Surplus/Deficit</p>
                    </div>
                    <div className={cn(
                      "text-lg font-bold",
                      data.profit >= 0 ? "text-emerald-600" : "text-red-600"
                    )}>
                      {formatCurrency(data.profit)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h4 className="font-semibold mb-6">Top Categories by Volume</h4>
              <div className="space-y-1">
                {(categoryMix || []).map(cat => {
                  const total = cat.income + cat.expense;
                  return (
                    <div key={cat.name} className="py-3 group">
                      <div className="flex justify-between text-sm mb-2">
                        <span className="font-medium text-slate-700">{cat.name}</span>
                        <span className="font-bold text-slate-900">{formatCurrency(total)}</span>
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
                        <div 
                          className="bg-emerald-500 h-full transition-all" 
                          style={{ width: `${(cat.income / total) * 100}%` }} 
                        />
                        <div 
                          className="bg-red-500 h-full transition-all" 
                          style={{ width: `${(cat.expense / total) * 100}%` }} 
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === "trial-balance" && reportsData && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 bg-slate-50">
            <h4 className="font-bold text-lg">Trial Balance</h4>
            <p className="text-xs text-slate-500 uppercase tracking-wider mt-1">As of {format(new Date(), "MMMM dd, yyyy")}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[700px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider border-b border-slate-100">
                  <th className="px-6 py-4 font-bold">Ledger Name</th>
                  <th className="px-6 py-4 font-bold text-right">Opening</th>
                  <th className="px-6 py-4 font-bold text-right">Period Debit</th>
                  <th className="px-6 py-4 font-bold text-right">Period Credit</th>
                  <th className="px-6 py-4 font-bold text-right">Closing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reportsData.accountBalances.map(acc => {
                  return (
                    <tr key={acc.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="font-bold text-slate-900">{acc.name}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase">
                          {acc.effectiveType} {acc.effectiveType !== acc.type && `(Original: ${acc.type})`}
                        </p>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-slate-500">
                        {formatCurrency(acc.openingBalance)}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-blue-600 font-bold">
                        {formatCurrency(acc.periodDebit)}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-slate-600 font-bold">
                        {formatCurrency(acc.periodCredit)}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm font-black text-slate-900 bg-slate-50/50">
                        {formatCurrency(acc.closingBalance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-black border-t-2 border-slate-200 text-slate-900 uppercase text-[10px]">
                  <td className="px-6 py-4">Total Summary</td>
                  <td className="px-6 py-4 text-right font-mono">
                    {formatCurrency(reportsData.accountBalances.reduce((s, a) => s + a.openingBalance, 0))}
                  </td>
                  <td className="px-6 py-4 text-right font-mono">
                    {formatCurrency(reportsData.accountBalances.reduce((s, a) => s + a.periodDebit, 0))}
                  </td>
                  <td className="px-6 py-4 text-right font-mono">
                    {formatCurrency(reportsData.accountBalances.reduce((s, a) => s + a.periodCredit, 0))}
                  </td>
                  <td className="px-6 py-4 text-right font-mono">
                    {formatCurrency(reportsData.accountBalances.reduce((s, a) => s + a.closingBalance, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {activeTab === "income-statement" && reportsData && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 bg-emerald-50">
            <h4 className="font-bold text-lg text-emerald-900">Income Statement (Profit & Loss)</h4>
            <p className="text-xs text-emerald-600 uppercase tracking-wider mt-1">For the period ending {format(new Date(), "MMMM dd, yyyy")}</p>
          </div>
          <div className="p-8 space-y-10">
            {/* Income Section */}
            <section>
              <h5 className="text-sm font-bold text-emerald-600 uppercase tracking-widest mb-4 border-b pb-2">Revenue / Income</h5>
              <div className="space-y-4">
                {reportsData.accountBalances.filter(a => a.type === "INCOME").map(acc => (
                  <div key={acc.id} className="flex justify-between items-center text-slate-700">
                    <span>{acc.name}</span>
                    <span className="font-mono">{formatCurrency(acc.balance)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-4 border-t border-slate-100 font-bold text-slate-900">
                  <span>Total Income</span>
                  <span className="font-mono">{formatCurrency(reportsData.totalIncome)}</span>
                </div>
              </div>
            </section>

            {/* Expense Section */}
            <section>
              <h5 className="text-sm font-bold text-red-600 uppercase tracking-widest mb-4 border-b pb-2">Operating Expenses</h5>
              <div className="space-y-4">
                {reportsData.accountBalances.filter(a => a.type === "EXPENSE").map(acc => (
                  <div key={acc.id} className="flex justify-between items-center text-slate-700">
                    <span>{acc.name}</span>
                    <span className="font-mono text-red-600">{formatCurrency(Math.abs(acc.balance))}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-4 border-t border-slate-100 font-bold text-slate-900">
                  <span>Total Expenses</span>
                  <span className="font-mono text-red-600">{formatCurrency(reportsData.totalExpense)}</span>
                </div>
              </div>
            </section>

            {/* Net Profit Section */}
            <section className="bg-slate-900 text-white p-6 rounded-xl flex justify-between items-center">
              <div>
                <h5 className="font-bold text-lg">Net Profit / (Loss)</h5>
                <p className="text-xs text-slate-400">Calculated as Total Income - Total Expenses</p>
              </div>
              <div className={cn(
                "text-2xl font-bold font-mono",
                reportsData.netProfit >= 0 ? "text-emerald-400" : "text-red-400"
              )}>
                {formatCurrency(reportsData.netProfit)}
              </div>
            </section>
          </div>
        </div>
      )}

      {activeTab === "balance-sheet" && reportsData && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 bg-blue-50 text-center">
            <h4 className="font-bold text-lg text-blue-900">Balance Sheet</h4>
            <p className="text-xs text-blue-600 uppercase tracking-wider mt-1 text-center">As at {format(new Date(), "MMMM dd, yyyy")}</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
            {/* Left Side: Assets */}
            <div className="p-8 space-y-8">
              <h5 className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-4 border-b pb-2">Assets</h5>
              <div className="space-y-4">
                {reportsData.accountBalances.filter(a => a.effectiveType === "ASSET").map(acc => (
                  <div key={acc.id} className="flex justify-between items-center text-slate-700">
                    <div className="flex flex-col">
                      <span>{acc.name}</span>
                      {acc.type !== acc.effectiveType && <span className="text-[8px] text-slate-400 uppercase font-black tracking-tighter leading-none">{acc.type} Transferred</span>}
                    </div>
                    <span className="font-mono">{formatCurrency(acc.balance)}</span>
                  </div>
                ))}
                <div className="pt-8 flex justify-between items-center border-t-2 border-slate-900 font-black text-slate-900 text-lg">
                  <span>Total Assets</span>
                  <span className="font-mono">{formatCurrency(reportsData.totalAssets)}</span>
                </div>
              </div>
            </div>

            {/* Right Side: Liabilities & Equity */}
            <div className="p-8 space-y-8 bg-slate-50/30">
              <div>
                <h5 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4 border-b pb-2">Liabilities</h5>
                <div className="space-y-4">
                  {reportsData.accountBalances.filter(a => a.effectiveType === "LIABILITY").map(acc => (
                    <div key={acc.id} className="flex justify-between items-center text-slate-700">
                      <div className="flex flex-col">
                        <span>{acc.name}</span>
                        {acc.type !== acc.effectiveType && <span className="text-[8px] text-slate-400 uppercase font-black tracking-tighter leading-none">{acc.type} Transferred</span>}
                      </div>
                      <span className="font-mono">{formatCurrency(acc.balance)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h5 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4 border-b pb-2">Equity</h5>
                <div className="space-y-4">
                  {reportsData.accountBalances.filter(a => a.type === "EQUITY").map(acc => (
                    <div key={acc.id} className="flex justify-between items-center text-slate-700">
                      <span>{acc.name}</span>
                      <span className="font-mono">{formatCurrency(acc.balance)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center text-emerald-700 bg-emerald-50 p-2 rounded-lg border border-emerald-100 italic text-sm">
                    <span>Current Year Earnings (P&L)</span>
                    <span className="font-mono font-bold">{formatCurrency(reportsData.netProfit)}</span>
                  </div>
                </div>
              </div>

              <div className="pt-8 flex justify-between items-center border-t-2 border-slate-900 font-black text-slate-900 text-lg">
                <span>Total Liab. & Equity</span>
                <span className="font-mono">{formatCurrency(reportsData.totalLiabilities + reportsData.totalEquity + reportsData.netProfit)}</span>
              </div>
            </div>
          </div>
          
          <div className="p-4 bg-slate-900 text-slate-400 text-[10px] text-center uppercase tracking-[0.2em]">
            This statement is balanced when Total Assets = Total Liabilities + Total Equity
          </div>
        </div>
      )}

      {activeTab === "receipt-payment" && reportsData && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div>
              <h4 className="font-bold text-lg text-slate-900">Receipt & Payment Statement</h4>
              <p className="text-xs text-slate-500 uppercase tracking-wider mt-1">Cash basis summary for the period</p>
            </div>
            <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm text-right">
              <span className="text-[10px] font-black text-slate-400 uppercase block leading-none mb-1">Opening Balance</span>
              <span className="text-lg font-black text-slate-900">{formatCurrency(reportsData.openingCash)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
            <div className="p-8">
              <h5 className="flex items-center gap-2 text-sm font-black text-emerald-600 uppercase tracking-widest mb-6 border-b pb-2">
                <ArrowDownRight size={16} /> Receipts (Cash Inflows)
              </h5>
              <div className="space-y-4">
                {reportsData.accountBalances.filter(a => a.type === "INCOME").map(acc => (
                  <div key={acc.id} className="flex justify-between items-center">
                    <span className="text-slate-600 text-sm font-medium">{acc.name}</span>
                    <span className="font-mono text-emerald-600 font-bold">{formatCurrency(acc.balance)}</span>
                  </div>
                ))}
                {reportsData.accountBalances.filter(a => a.type === "INCOME").length === 0 && (
                  <p className="text-slate-400 italic text-sm">No receipts recorded</p>
                )}
                <div className="pt-4 mt-4 border-t border-slate-100 flex justify-between items-center font-black text-slate-900">
                  <span className="text-sm">Total Receipts</span>
                  <span className="font-mono text-emerald-600">{formatCurrency(reportsData.totalIncome)}</span>
                </div>
              </div>
            </div>

            <div className="p-8 bg-slate-50/20">
              <h5 className="flex items-center gap-2 text-sm font-black text-red-600 uppercase tracking-widest mb-6 border-b pb-2">
                <ArrowUpLeft size={16} /> Payments (Cash Outflows)
              </h5>
              <div className="space-y-4">
                {reportsData.accountBalances.filter(a => a.type === "EXPENSE").map(acc => (
                  <div key={acc.id} className="flex justify-between items-center">
                    <span className="text-slate-600 text-sm font-medium">{acc.name}</span>
                    <span className="font-mono text-red-600 font-bold">{formatCurrency(Math.abs(acc.balance))}</span>
                  </div>
                ))}
                {reportsData.accountBalances.filter(a => a.type === "EXPENSE").length === 0 && (
                  <p className="text-slate-400 italic text-sm">No payments recorded</p>
                )}
                <div className="pt-4 mt-4 border-t border-slate-100 flex justify-between items-center font-black text-slate-900">
                  <span className="text-sm">Total Payments</span>
                  <span className="font-mono text-red-600">{formatCurrency(reportsData.totalExpense)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-8 bg-slate-900 text-white flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-400 font-black uppercase tracking-widest">Ending Ledger Integrity</p>
              <h5 className="text-xl font-black">Net Cash & Bank Balance</h5>
            </div>
            <div className="text-right">
              <span className="text-3xl font-black tracking-tighter text-blue-400">{formatCurrency(reportsData.closingCash)}</span>
              <p className="text-[10px] text-slate-500 mt-1">Verified against {reportsData.accountBalances.filter(a => a.type === "ASSET").length} cash/bank ledgers</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === "cash-flow" && reportsData && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 bg-blue-50">
            <h4 className="font-bold text-lg text-blue-900">Statement of Cash Flows</h4>
            <p className="text-xs text-blue-600 uppercase tracking-wider mt-1">Categorized by Operating, Investing, and Financing activities</p>
          </div>

          <div className="p-8 space-y-8">
            {/* Operating */}
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest">Operating Activities</h5>
                <span className="font-black text-slate-900">{formatCurrency(reportsData.totalIncome - reportsData.totalExpense)}</span>
              </div>
              <div className="pl-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Cash received from Revenue</span>
                  <span className="text-emerald-600 font-bold">+{formatCurrency(reportsData.totalIncome)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Cash paid for Expenses</span>
                  <span className="text-red-500 font-bold">-{formatCurrency(reportsData.totalExpense)}</span>
                </div>
              </div>
            </div>

            {/* Investing - Placeholder logic based on asset name keywords since we don't have sub-categories yet */}
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest">Investing Activities</h5>
                <span className="font-black text-slate-900">
                  {formatCurrency(reportsData.accountBalances
                    .filter(a => a.type === "ASSET" && (a.name.toLowerCase().includes("fixed") || a.name.toLowerCase().includes("invest")))
                    .reduce((sum, a) => sum + (a.openingBalance - a.closingBalance), 0)
                  )}
                </span>
              </div>
              <div className="pl-4 space-y-3">
                {reportsData.accountBalances
                  .filter(a => a.type === "ASSET" && (a.name.toLowerCase().includes("fixed") || a.name.toLowerCase().includes("invest")))
                  .map(acc => {
                    const diff = acc.openingBalance - acc.closingBalance;
                    return (
                      <div key={acc.id} className="flex justify-between text-sm">
                        <span className="text-slate-600">{diff > 0 ? `Disposal of ${acc.name}` : `Purchase of ${acc.name}`}</span>
                        <span className={cn("font-bold", diff > 0 ? "text-emerald-600" : "text-red-500")}>
                          {diff > 0 ? "+" : ""}{formatCurrency(diff)}
                        </span>
                      </div>
                    );
                  })}
                {reportsData.accountBalances.filter(a => a.type === "ASSET" && (a.name.toLowerCase().includes("fixed") || a.name.toLowerCase().includes("invest"))).length === 0 && (
                  <p className="text-slate-400 italic text-xs pl-4">No investing activities detected (e.g. Fixed Assets)</p>
                )}
              </div>
            </div>

            {/* Financing */}
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest">Financing Activities</h5>
                <span className="font-black text-slate-900">
                  {formatCurrency(reportsData.accountBalances
                    .filter(a => a.type === "LIABILITY" || a.type === "EQUITY")
                    .reduce((sum, a) => sum + (a.closingBalance - a.openingBalance), 0)
                  )}
                </span>
              </div>
              <div className="pl-4 space-y-3">
                {reportsData.accountBalances
                  .filter(a => a.type === "LIABILITY" || a.type === "EQUITY")
                  .map(acc => {
                    const diff = acc.closingBalance - acc.openingBalance;
                    if (diff === 0) return null;
                    return (
                      <div key={acc.id} className="flex justify-between text-sm">
                        <span className="text-slate-600">{diff > 0 ? `Proceeds from ${acc.name}` : `Repayment of ${acc.name}`}</span>
                        <span className={cn("font-bold", diff > 0 ? "text-emerald-600" : "text-red-500")}>
                          {diff > 0 ? "+" : ""}{formatCurrency(diff)}
                        </span>
                      </div>
                    );
                  })}
                {reportsData.accountBalances.filter(a => (a.type === "LIABILITY" || a.type === "EQUITY") && (a.closingBalance !== a.openingBalance)).length === 0 && (
                  <p className="text-slate-400 italic text-xs pl-4">No major financing activities (Equity/Loans) this period</p>
                )}
              </div>
            </div>

            {/* Reconciliation */}
            <div className="mt-12 pt-8 border-t-2 border-slate-900 space-y-4">
              <div className="flex justify-between items-center text-lg font-black bg-slate-50 p-4 rounded-xl">
                <span>Net Cash Movement</span>
                <span className="text-blue-600">{formatCurrency(reportsData.closingCash - reportsData.openingCash)}</span>
              </div>
              <div className="flex justify-between items-center px-4 text-sm text-slate-500 font-bold">
                <span>Cash at Beginning</span>
                <span>{formatCurrency(reportsData.openingCash)}</span>
              </div>
              <div className="flex justify-between items-center px-4 py-4 text-xl font-black text-white bg-slate-900 rounded-xl">
                <span>Cash at End of Period</span>
                <span className="text-blue-400">{formatCurrency(reportsData.closingCash)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
