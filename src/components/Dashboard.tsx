import React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getTotalNetWorth, getAccountBalance } from "../db/database";
import { cn, formatCurrency } from "../lib/utils";
import { 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  ArrowUpRight, 
  ArrowDownLeft,
  Clock
} from "lucide-react";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { format, subDays, startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { Filter, ChevronDown } from "lucide-react";

type Period = "7d" | "30d" | "thisMonth" | "lastMonth" | "custom";

export default function Dashboard() {
  const [period, setPeriod] = React.useState<Period>("thisMonth");
  const settings = useLiveQuery(() => db.settings.get("app-settings"));
  
  const getPeriodDates = React.useCallback(() => {
    const now = new Date();
    switch (period) {
      case "7d":
        return { start: startOfDay(subDays(now, 6)).getTime(), end: endOfDay(now).getTime() };
      case "30d":
        return { start: startOfDay(subDays(now, 29)).getTime(), end: endOfDay(now).getTime() };
      case "thisMonth":
        return { start: startOfMonth(now).getTime(), end: endOfMonth(now).getTime() };
      case "lastMonth":
        const lastMonth = subMonths(now, 1);
        return { start: startOfMonth(lastMonth).getTime(), end: endOfMonth(lastMonth).getTime() };
      case "custom":
      default:
        return { start: settings?.startDate || 0, end: settings?.endDate || Date.now() };
    }
  }, [period, settings]);

  const { start, end } = getPeriodDates();

  const accountsData = useLiveQuery(() => db.accounts.where("isDeleted").equals(0).toArray());
  const accountMap = React.useMemo(() => new Map((accountsData || []).map(a => [a.id, a])), [accountsData]);

  const getAccountName = React.useCallback((id: number) => accountMap.get(id)?.name || "Unknown", [accountMap]);

  const netWorth = useLiveQuery(async () => {
    if (!accountsData) return 0;
    let total = 0;
    for (const account of accountsData) {
      if (account.id) {
        const balance = await getAccountBalance(account.id, end);
        const currentBalance = (account.initialBalance || 0) + balance;
        
        // Sum ASSET and LIABILITY accounts for Net Worth
        if (account.type === "ASSET" || account.type === "LIABILITY") {
          total += currentBalance;
        }
      }
    }
    return total;
  }, [accountsData, end]);

  const recentTransactions = useLiveQuery(async () => {
    return await db.transactions
      .where("date")
      .between(start, end, true, true)
      .and(t => t.isDeleted === 0)
      .reverse()
      .limit(5)
      .toArray();
  }, [start, end]);

  const stats = useLiveQuery(async () => {
    const txs = await db.transactions
      .where("date")
      .between(start, end, true, true)
      .and(t => t.isDeleted === 0)
      .toArray();

    if (!accountMap.size) return { income: 0, expense: 0 };

    let income = 0;
    let expense = 0;
    txs.forEach(t => {
      const fromAcc = accountMap.get(t.fromAccountId);
      const toAcc = accountMap.get(t.toAccountId);
      
      if (fromAcc?.type === "INCOME") income += t.amount;
      if (toAcc?.type === "EXPENSE") expense += t.amount;
    });
    return { income, expense };
  }, [start, end, accountMap]);

  const chartData = useLiveQuery(async () => {
    const txs = await db.transactions
      .where("date")
      .between(start, end, true, true)
      .and(t => t.isDeleted === 0)
      .toArray();

    if (!accountMap.size) return [];

    // Calculate days between start and end
    const dayCount = Math.min(Math.ceil((end - start) / (1000 * 60 * 60 * 24)), 31);
    
    const data = Array.from({ length: dayCount }, (_, i) => {
      const date = subDays(new Date(end), i);
      return {
        date: format(date, "MMM dd"),
        rawDate: startOfDay(date).getTime(),
        income: 0,
        expense: 0
      };
    }).reverse();

    txs.forEach(t => {
      const tDate = startOfDay(new Date(t.date)).getTime();
      const day = data.find(d => d.rawDate === tDate);
      if (day) {
        const fromAcc = accountMap.get(t.fromAccountId);
        const toAcc = accountMap.get(t.toAccountId);
        if (fromAcc?.type === "INCOME") day.income += t.amount;
        if (toAcc?.type === "EXPENSE") day.expense += t.amount;
      }
    });

    return data;
  }, [start, end, accountMap]);

  const categoryData = useLiveQuery(async () => {
    const txs = await db.transactions
      .where("date")
      .between(start, end, true, true)
      .and(t => t.isDeleted === 0)
      .toArray();

    if (!accountMap.size) return [];

    const categories: Record<string, number> = {};
    txs.forEach(t => {
      const toAcc = accountMap.get(t.toAccountId);
      if (toAcc?.type === "EXPENSE") {
        categories[toAcc.name] = (categories[toAcc.name] || 0) + t.amount;
      }
    });
    return Object.entries(categories).map(([name, value]) => ({ name, value }));
  }, [start, end, accountMap]);


  const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

  return (
    <div className="space-y-6">
      {/* Period Filter */}
      <div className="flex items-center justify-between gap-4 overflow-x-auto pb-2 scrollbar-hide">
        <div className="flex bg-white rounded-xl p-1 border border-slate-200 shadow-sm">
          {(["7d", "30d", "thisMonth", "lastMonth", "custom"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-4 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap",
                period === p ? "bg-blue-600 text-white shadow-md shadow-blue-100" : "text-slate-500 hover:bg-slate-50"
              )}
            >
              {p === "7d" && "7 Days"}
              {p === "30d" && "30 Days"}
              {p === "thisMonth" && "This Month"}
              {p === "lastMonth" && "Last Month"}
              {p === "custom" && "Custom Setting"}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Wallet size={80} />
          </div>
          <p className="text-slate-500 text-sm font-medium mb-1">Total Assets</p>
          <h3 className="text-3xl font-bold">{formatCurrency(netWorth || 0)}</h3>
        </div>
        
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-500 text-sm font-medium">Income Movements</p>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
              <ArrowUpRight size={18} />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-emerald-600">{formatCurrency(stats?.income || 0)}</h3>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-500 text-sm font-medium">Expense Movements</p>
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-red-600">
              <ArrowDownLeft size={18} />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-red-600">-{formatCurrency(stats?.expense || 0)}</h3>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[350px]">
          <h4 className="font-semibold mb-6 flex items-center gap-2 text-slate-800">
            <TrendingUp size={18} className="text-blue-500" />
            {period === "custom" ? "Custom Period" : period === "7d" ? "7-Day" : period === "30d" ? "30-Day" : "Monthly"} Ledger Volume
          </h4>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData || []}>
              <defs>
                <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#94a3b8" }} dy={10} />
              <YAxis hide />
              <Tooltip 
                contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
              />
              <Area type="monotone" dataKey="income" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorIncome)" />
              <Area type="monotone" dataKey="expense" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorExpense)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[350px]">
          <h4 className="font-semibold mb-6 text-slate-800">Expense Allocation</h4>
          <div className="flex h-full pb-8">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryData || []}
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {(categoryData || []).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col justify-center gap-2 pr-4 min-w-[140px]">
              {(categoryData || []).slice(0, 5).map((entry, index) => (
                <div key={entry.name} className="flex items-center gap-2 text-xs text-slate-600">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                  <span className="truncate max-w-[90px]">{entry.name}</span>
                  <span className="font-semibold ml-auto">{formatCurrency(entry.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Entries */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h4 className="font-semibold text-slate-800">Latest Ledger Entries</h4>
          <div className="hidden sm:flex items-center gap-2 text-slate-400 text-xs font-mono">
            <Clock size={12} />
            SYNCED
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {(recentTransactions || []).map((tx) => (
            <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors gap-4">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center bg-slate-100 text-slate-600 hidden xs:flex">
                  <ArrowUpRight size={18} className="opacity-50" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded whitespace-nowrap">{getAccountName(tx.toAccountId)}</span>
                    <span className="text-slate-400 text-[10px]">←</span>
                    <span className="text-[10px] font-black text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded whitespace-nowrap">{getAccountName(tx.fromAccountId)}</span>
                  </div>
                  <p className="font-bold text-slate-900 leading-tight text-sm truncate">
                    {tx.note || "Ledger Entry"}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5 uppercase">{format(tx.date, "MMM dd")}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-black text-slate-900 text-sm">
                  {formatCurrency(tx.amount)}
                </p>
                <p className="text-[9px] text-slate-400 uppercase tracking-tighter">Double-Entry</p>
              </div>
            </div>
          ))}
          {(recentTransactions || []).length === 0 && (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-2">
              <Clock size={32} strokeWidth={1.5} />
              <p>No recent activity</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
