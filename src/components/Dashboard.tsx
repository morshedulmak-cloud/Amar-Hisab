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
import { format, subDays, startOfDay } from "date-fns";

export default function Dashboard() {
  const settings = useLiveQuery(() => db.settings.get("app-settings"));
  
  const netWorth = useLiveQuery(async () => {
    const accounts = await db.accounts.where("isDeleted").equals(0).toArray();
    let total = 0;
    for (const account of accounts) {
      if (account.id) {
        const balance = await getAccountBalance(account.id, settings?.endDate);
        const finalBalance = (account.initialBalance || 0) + balance;
        if (account.type === "ASSET" || account.type === "LIABILITY") {
          total += finalBalance;
        }
      }
    }
    return total;
  }, [settings]);

  const recentTransactions = useLiveQuery(async () => {
    let collection = db.transactions.where("isDeleted").equals(0);
    
    if (settings) {
      collection = collection.filter(t => t.date >= settings.startDate && t.date <= settings.endDate);
    }

    const items = await collection.toArray();
    return items.sort((a, b) => b.date - a.date).slice(0, 5);
  }, [settings]);

  const stats = useLiveQuery(async () => {
    let collection = db.transactions.where("isDeleted").equals(0);
    
    if (settings) {
      collection = collection.filter(t => t.date >= settings.startDate && t.date <= settings.endDate);
    }

    const txs = await collection.toArray();
    const accounts = await db.accounts.toArray();
    const accountMap = new Map(accounts.map(a => [a.id, a]));

    let income = 0;
    let expense = 0;
    txs.forEach(t => {
      const fromAcc = accountMap.get(t.fromAccountId);
      const toAcc = accountMap.get(t.toAccountId);
      
      if (fromAcc?.type === "INCOME") income += t.amount;
      if (toAcc?.type === "EXPENSE") expense += t.amount;
    });
    return { income, expense };
  }, [settings]);

  const chartData = useLiveQuery(async () => {
    let collection = db.transactions.where("isDeleted").equals(0);
    
    if (settings) {
      collection = collection.filter(t => t.date >= settings.startDate && t.date <= settings.endDate);
    }

    const txs = await collection.toArray();
    const accounts = await db.accounts.toArray();
    const accountMap = new Map(accounts.map(a => [a.id, a]));

    // If period is defined, try to show the full period in the chart
    // But if it's too long, stick to last 7 days or a reasonable resolution.
    // For now, let's just fix the dependency and keep the 7-day logic but make it respect today.
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = subDays(new Date(), i);
      return {
        date: format(date, "MMM dd"),
        rawDate: startOfDay(date).getTime(),
        income: 0,
        expense: 0
      };
    }).reverse();

    txs.forEach(t => {
      const tDate = startOfDay(new Date(t.date)).getTime();
      const day = last7Days.find(d => d.rawDate === tDate);
      if (day) {
        const fromAcc = accountMap.get(t.fromAccountId);
        const toAcc = accountMap.get(t.toAccountId);
        if (fromAcc?.type === "INCOME") day.income += t.amount;
        if (toAcc?.type === "EXPENSE") day.expense += t.amount;
      }
    });

    return last7Days;
  }, [settings]);

  const categoryData = useLiveQuery(async () => {
    let collection = db.transactions.where("isDeleted").equals(0);
    
    if (settings) {
      collection = collection.filter(t => t.date >= settings.startDate && t.date <= settings.endDate);
    }

    const txs = await collection.toArray();
    const accounts = await db.accounts.toArray();
    const accountMap = new Map(accounts.map(a => [a.id, a]));

    const categories: Record<string, number> = {};
    txs.forEach(t => {
      const toAcc = accountMap.get(t.toAccountId);
      if (toAcc?.type === "EXPENSE") {
        categories[toAcc.name] = (categories[toAcc.name] || 0) + t.amount;
      }
    });
    return Object.entries(categories).map(([name, value]) => ({ name, value }));
  }, [settings]);

  const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
  const accounts = useLiveQuery(() => db.accounts.toArray());
  const accountMap = new Map((accounts || []).map(a => [a.id, a]));

  const getAccountName = (id: number) => accountMap.get(id)?.name || "Unknown";

  return (
    <div className="space-y-8">
      {/* Period Indicator */}
      <div className="flex items-center justify-between bg-slate-900 text-white px-6 py-4 rounded-2xl shadow-lg ring-1 ring-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
            <Clock size={20} className="text-blue-400" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 leading-none mb-1">Active Reporting Period</p>
            <p className="font-semibold text-sm">
              {settings ? (
                <>
                  {format(settings.startDate, "MMM dd, yyyy")} — {format(settings.endDate, "MMM dd, yyyy")}
                </>
              ) : (
                "All Time"
              )}
            </p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-tight">Real-time sync</span>
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
          <h3 className="text-2xl font-bold text-red-600">{formatCurrency(stats?.expense || 0)}</h3>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[350px]">
          <h4 className="font-semibold mb-6 flex items-center gap-2 text-slate-800">
            <TrendingUp size={18} className="text-blue-500" />
            7-Day Ledger Volume
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
          <div className="flex items-center gap-2 text-slate-400 text-xs font-mono">
            <Clock size={12} />
            SYNCED
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {(recentTransactions || []).map((tx) => (
            <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-slate-100 text-slate-600">
                  <ArrowUpRight size={18} className="opacity-50" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{getAccountName(tx.toAccountId)}</span>
                    <span className="text-slate-400 text-[10px]">←</span>
                    <span className="text-xs font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{getAccountName(tx.fromAccountId)}</span>
                  </div>
                  <p className="font-medium text-slate-900 leading-tight">
                    {tx.note || "Ledger Entry"}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1 uppercase">{format(tx.date, "MMM dd, yyyy")}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-slate-900">
                  {formatCurrency(tx.amount)}
                </p>
                <p className="text-[10px] text-slate-400 uppercase tracking-tighter">Double-Entry</p>
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
