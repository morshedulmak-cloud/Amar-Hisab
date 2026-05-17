import Dexie, { Table } from "dexie";
import { Account, Transaction } from "../types";

export class UniversalLedgerDB extends Dexie {
  accounts!: Table<Account>;
  transactions!: Table<Transaction>;
  settings!: Table<AppSettings>;
  sequences!: Table<Sequence>;

  constructor() {
    super("UniversalLedgerDB");
    
    this.version(6).stores({
      accounts: "++id, name, type, syncStatus, isDeleted",
      transactions: "++id, fromAccountId, toAccountId, type, voucherType, voucherNo, date, syncStatus, isDeleted",
      settings: "id",
      sequences: "type"
    });
  }
}

export interface Sequence {
  type: string;
  lastNo: number;
}

export interface AppSettings {
  id: string;
  profileName: string;
  startDate: number; // timestamp
  endDate: number;   // timestamp
}

export const db = new UniversalLedgerDB();

export async function getNextVoucherNo(type: "RV" | "PV" | "JV" | "CV") {
  const seq = await db.sequences.get(type);
  if (seq) {
    return seq.lastNo + 1;
  }

  const lastTx = await db.transactions
    .where("voucherType")
    .equals(type)
    .toArray();
  
  const currentMax = lastTx.length > 0 ? Math.max(...lastTx.map(t => t.voucherNo || 0)) : 0;
  
  // Initialize sequence
  await db.sequences.put({ type, lastNo: currentMax });
  
  return currentMax + 1;
}

export async function updateVoucherSequence(type: string, voucherNo: number) {
  const seq = await db.sequences.get(type);
  if (!seq || voucherNo > seq.lastNo) {
    await db.sequences.put({ type, lastNo: voucherNo });
  }
}

// Test the connection and check if IndexedDB is available
export async function checkDatabaseAvailability() {
  try {
    if (typeof window === "undefined" || !window.indexedDB) {
      return { available: false, error: "IndexedDB is not supported in this environment. Please try a standard browser window." };
    }
    
    // Attempt to open the database explicitly
    await db.open();
    
    // Check if we can actually read/write (optional but safer)
    await db.accounts.count();
    
    return { available: true };
  } catch (err: any) {
    console.error("Dexie Database Open Error:", err);
    
    // Handle specific Dexie error types if needed
    let errorMessage = "Unknown database error.";
    if (err.name === "SecurityError") {
      errorMessage = "Browser security settings are blocking database access (often in Incognito mode or third-party iframes).";
    } else if (err.message) {
      errorMessage = err.message;
    } else {
      errorMessage = String(err);
    }
    
    return { available: false, error: errorMessage };
  }
}

// Helper to get total balance for an account
// In double entry: Balance = Sum(Debits) - Sum(Credits)
// For Assets: Balance = Initial + Debits - Credits
export async function getAccountBalance(accountId: number, endDate?: number, startDate?: number) {
  const account = await db.accounts.get(accountId);
  if (!account) return 0;

  let debitsQuery = db.transactions
    .where("toAccountId")
    .equals(accountId)
    .and(t => t.isDeleted === 0);

  let creditsQuery = db.transactions
    .where("fromAccountId")
    .equals(accountId)
    .and(t => t.isDeleted === 0);

  if (endDate !== undefined) {
    debitsQuery = debitsQuery.and(t => t.date <= endDate);
    creditsQuery = creditsQuery.and(t => t.date <= endDate);
  }
  
  if (startDate !== undefined) {
    debitsQuery = debitsQuery.and(t => t.date >= startDate);
    creditsQuery = creditsQuery.and(t => t.date >= startDate);
  }

  const debits = await debitsQuery.toArray();
  const credits = await creditsQuery.toArray();

  const totalDebits = debits.reduce((sum, t) => sum + t.amount, 0);
  const totalCredits = credits.reduce((sum, t) => sum + t.amount, 0);

  // Return the net transaction contribution: Total Debit - Total Credit
  return totalDebits - totalCredits;
}

export async function getAccountSummary(accountId: number, endDate?: number, startDate?: number) {
  const account = await db.accounts.get(accountId);
  if (!account) return { debit: 0, credit: 0, net: 0 };

  let debitsQuery = db.transactions
    .where("toAccountId")
    .equals(accountId)
    .and(t => t.isDeleted === 0);

  let creditsQuery = db.transactions
    .where("fromAccountId")
    .equals(accountId)
    .and(t => t.isDeleted === 0);

  if (endDate !== undefined) {
    debitsQuery = debitsQuery.and(t => t.date <= endDate);
    creditsQuery = creditsQuery.and(t => t.date <= endDate);
  }
  
  if (startDate !== undefined) {
    debitsQuery = debitsQuery.and(t => t.date >= startDate);
    creditsQuery = creditsQuery.and(t => t.date >= startDate);
  }

  const debits = await debitsQuery.toArray();
  const credits = await creditsQuery.toArray();

  const totalDebits = debits.reduce((sum, t) => sum + t.amount, 0);
  const totalCredits = credits.reduce((sum, t) => sum + t.amount, 0);

  const net = totalDebits - totalCredits;

  return { debit: totalDebits, credit: totalCredits, net };
}

export async function getTotalNetWorth() {
  const accounts = await db.accounts.where("isDeleted").equals(0).toArray();
  let total = 0;
  for (const account of accounts) {
    if (account.id) {
      const txSurplus = await getAccountBalance(account.id);
      const balance = (account.initialBalance || 0) + txSurplus;
      // In Universal Ledger, Assets are positive and Liabilities are negative
      if (account.type === "ASSET" || account.type === "LIABILITY") {
        total += balance;
      }
    }
  }
  return total;
}
