import React, { useState, useEffect, ReactNode, ErrorInfo, Component } from "react";
import { 
  LayoutDashboard, 
  ArrowLeftRight, 
  Wallet, 
  FileText, 
  Settings as SettingsIcon,
  Plus,
  Search,
  Menu,
  X,
  PlusCircle,
  AlertTriangle,
  RefreshCw,
  User,
  Calendar
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { motion, AnimatePresence } from "motion/react";
import { db, getTotalNetWorth, checkDatabaseAvailability } from "./db/database";
import { cn, formatCurrency } from "./lib/utils";
import { startOfYear, endOfYear, format } from "date-fns";

// Views
import Dashboard from "./components/Dashboard";
import TransactionsList from "./components/TransactionsList";
import AccountsList from "./components/AccountsList";
import Reports from "./components/Reports";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Global Error Caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 text-center font-sans">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-red-100">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle size={32} />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Application Error</h1>
            <p className="text-slate-500 mb-6 font-medium">
              We encountered an obstacle while rendering the ledger.
            </p>
            <div className="p-4 bg-slate-50 text-slate-700 rounded-xl text-sm mb-6 font-mono text-left break-all max-h-48 overflow-auto border border-slate-200">
              {this.state.error?.message || String(this.state.error)}
            </div>
            <div className="space-y-3">
              <button 
                onClick={() => window.location.reload()}
                className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw size={20} />
                Reload Application
              </button>
              <button 
                onClick={async () => {
                   if (confirm("This will erase all your local ledger data and settings. Proceed?")) {
                     await db.delete();
                     window.location.reload();
                   }
                }}
                className="w-full text-slate-400 hover:text-red-500 text-xs font-medium py-2"
              >
                Reset Database entirely
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

type View = "dashboard" | "transactions" | "accounts" | "reports" | "settings";

function AppContent() {
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [dbError, setDbError] = useState<string | null>(null);
  const [forceAddTransaction, setForceAddTransaction] = useState(false);
  const [forceAddAccount, setForceAddAccount] = useState(false);
  
  const settings = useLiveQuery(() => db.settings.get("app-settings"));

  // Initialize sample data and settings if empty
  useEffect(() => {
    const initData = async () => {
      try {
        const availability = await checkDatabaseAvailability();
        if (!availability.available) {
          setDbError(availability.error || "Database is unavailable.");
          return;
        }

        const accountCount = await db.accounts.count();
        if (accountCount === 0) {
          // No seeding anymore as per user request
          console.log("No accounts found. Start by adding your first ledger.");
        }

        const settingsExist = await db.settings.get("app-settings");
        if (!settingsExist) {
          await db.settings.put({
            id: "app-settings",
            profileName: "Global Ledger",
            startDate: startOfYear(new Date()).getTime(),
            endDate: endOfYear(new Date()).getTime()
          });
        }
      } catch (err: any) {
        console.error("Initialization error:", err);
        setDbError(err?.message || String(err));
      }
    };
    initData();
  }, []);

  const handleUpdateSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const profileName = formData.get("profileName") as string;
    const startDate = new Date(formData.get("startDate") as string).getTime();
    const endDate = new Date(formData.get("endDate") as string).getTime();

    await db.settings.put({
      id: "app-settings",
      profileName,
      startDate,
      endDate
    });
    alert("Configuration updated!");
  };

  if (dbError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 text-center">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-amber-100 font-sans">
          <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <Wallet size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Storage Error</h1>
          <p className="text-slate-500 mb-6 font-medium">
            Universal Ledger requires IndexedDB to function offline. 
          </p>
          <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm mb-6 font-mono text-left break-all">
            {dbError}
          </div>
          <p className="text-slate-400 text-xs mb-6">
            If you are in Incognito mode or your browser blocks storage, please try a different browser or enable storage.
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-slate-900 text-white font-bold py-3 rounded-lg hover:bg-slate-800 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
    { id: "accounts", label: "Accounts", icon: Wallet },
    { id: "reports", label: "Reports", icon: FileText },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900 pb-20">
      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">
              {settings?.profileName?.[0] || "L"}
            </div>
            <div>
              <h2 className="text-[10px] font-black tracking-tight text-slate-400 uppercase leading-none mb-0.5">
                {settings?.profileName || "Universal Ledger"}
              </h2>
              <h2 className="text-lg font-bold tracking-tight capitalize leading-none">{activeView}</h2>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {settings && (
              <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full text-[10px] font-black text-slate-500">
                <Calendar size={12} />
                {format(settings.startDate, "MMM d, yyyy")} - {format(settings.endDate, "MMM d, yyyy")}
              </div>
            )}
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Search ledger..." 
                className="pl-10 pr-4 py-1.5 bg-slate-100 border-none rounded-full text-sm focus:ring-2 focus:ring-blue-500 w-64 outline-none"
              />
            </div>
            <button className="p-2 text-slate-500 hover:bg-slate-100 rounded-full transition-colors">
               <PlusCircle size={24} className="text-blue-600" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="max-w-6xl mx-auto"
            >
              {activeView === "dashboard" && <Dashboard />}
              {activeView === "transactions" && (
                <TransactionsList 
                  isAddingExternal={forceAddTransaction} 
                  onCloseExternal={() => setForceAddTransaction(false)} 
                />
              )}
              {activeView === "accounts" && (
                <AccountsList 
                  isAddingExternal={forceAddAccount} 
                  onCloseExternal={() => setForceAddAccount(false)} 
                />
              )}
              {activeView === "reports" && <Reports />}
              {activeView === "settings" && (
                <div className="max-w-2xl mx-auto space-y-8 pb-12">
                  <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-8">
                      <div className="p-3 bg-blue-100 text-blue-600 rounded-2xl">
                        <User size={24} />
                      </div>
                      <div>
                        <h3 className="text-xl font-black text-slate-900">Enterprise Profile</h3>
                        <p className="text-slate-500 text-sm">Update your company name and reporting period</p>
                      </div>
                    </div>

                    <form onSubmit={handleUpdateSettings} className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">Organization Name</label>
                        <input 
                          name="profileName"
                          defaultValue={settings?.profileName}
                          required
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-lg font-bold"
                          placeholder="e.g. Acme Corp"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">Reporting Start Date</label>
                          <input 
                            name="startDate"
                            type="date"
                            defaultValue={settings ? format(settings.startDate, "yyyy-MM-dd") : ""}
                            required
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">Reporting End Date</label>
                          <input 
                            name="endDate"
                            type="date"
                            defaultValue={settings ? format(settings.endDate, "yyyy-MM-dd") : ""}
                            required
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                          />
                        </div>
                      </div>

                      <button 
                        type="submit"
                        className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
                      >
                        Save Configuration
                      </button>
                    </form>
                  </div>

                  <div className="bg-red-50 p-6 rounded-3xl border border-red-100">
                    <h4 className="text-red-900 font-bold mb-2">Danger Zone</h4>
                    <p className="text-red-600 text-xs mb-4">Deleting local data is irreversible. All transactions and ledgers will be wiped.</p>
                    <button 
                      onClick={async () => {
                        if (confirm("Are you SURE? This will delete all your local accounting data!")) {
                          await db.delete();
                          window.location.reload();
                        }
                      }}
                      className="px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-xl hover:bg-red-700 transition-colors"
                    >
                      Reset All Data
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Floating Action Button */}
      {["dashboard", "transactions", "accounts"].includes(activeView) && (
        <button
          onClick={() => {
            if (activeView === "dashboard" || activeView === "transactions") {
              setForceAddTransaction(true);
              if (activeView === "dashboard") {
                setActiveView("transactions");
              }
            } else if (activeView === "accounts") {
              setForceAddAccount(true);
            }
          }}
          className="fixed bottom-24 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-2xl shadow-blue-200 flex items-center justify-center hover:bg-blue-700 active:scale-95 transition-all z-[60]"
        >
          <Plus size={32} />
        </button>
      )}

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 h-20 bg-white border-t border-slate-200 flex items-center justify-around px-2 z-50">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id as View)}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 transition-all h-full",
                isActive ? "text-blue-600" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <div className={cn(
                "p-2 rounded-xl transition-colors",
                isActive ? "bg-blue-50" : "bg-transparent"
              )}>
                <Icon size={24} />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
