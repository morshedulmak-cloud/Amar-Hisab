export type TransactionType = "INCOME" | "EXPENSE" | "TRANSFER";

export interface Account {
  id?: number;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
  initialBalance: number;
  description?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
  syncStatus: "synced" | "pending" | "error";
  isDeleted: number;
}

export interface Transaction {
  id?: number;
  fromAccountId: number; // Credit side
  toAccountId: number;   // Debit side
  amount: number;
  note?: string;
  type: TransactionType;
  voucherNo: number;
  voucherType: "RV" | "PV" | "JV";
  date: number;
  createdAt: number;
  updatedAt: number;
  syncStatus: "synced" | "pending" | "error";
  isDeleted: number;
}
