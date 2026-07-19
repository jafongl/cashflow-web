import Dexie, { type Table } from 'dexie';

export type TxType = 'income' | 'expense';

export interface Category {
  id?: number;
  name: string;
  type: TxType;
  color: string;
}

export interface Transaction {
  id?: number;
  type: TxType;
  amount: number;
  categoryId?: number;
  date: string; // YYYY-MM-DD
  vendor?: string;
  note?: string;
  receipt?: string; // dataURL de la imagen
  invoiceNumber?: string;
  createdAt: string;
}

export interface Budget {
  id: string; // `${month}:${categoryId}`
  categoryId: number;
  month: string; // YYYY-MM
  amount: number;
}

class CashFlowDB extends Dexie {
  categories!: Table<Category, number>;
  transactions!: Table<Transaction, number>;
  budgets!: Table<Budget, string>;

  constructor() {
    super('cashflow-web');

    this.version(1).stores({
      categories: '++id, type, name',
      transactions: '++id, type, date, categoryId, createdAt',
      budgets: 'id, categoryId, month',
    });

    this.on('populate', async (tx: any) => {
      const expenseCategories = [
        'Comida',
        'Transporte',
        'Vivienda',
        'Servicios',
        'Salud',
        'Educación',
        'Entretenimiento',
        'Ropa',
        'Impuestos',
        'Otros gastos',
      ];

      const incomeCategories = [
        'Salario',
        'Ventas',
        'Freelance',
        'Inversiones',
        'Otros ingresos',
      ];

      await tx.table('categories').bulkAdd(
        expenseCategories.map((name: string) => ({
          name,
          type: 'expense' as TxType,
          color: '#EF4444',
        }))
      );

      await tx.table('categories').bulkAdd(
        incomeCategories.map((name: string) => ({
          name,
          type: 'income' as TxType,
          color: '#22C55E',
        }))
      );
    });
  }
}

export const db = new CashFlowDB();

export function todayLocalISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function currentMonthLocal(): string {
  return todayLocalISO().slice(0, 7);
}

export async function saveTransaction(tx: Transaction) {
  if (tx.id) {
    return db.transactions.put(tx);
  }

  return db.transactions.add(tx);
}

export async function removeTransaction(id: number) {
  return db.transactions.delete(id);
}

export async function upsertBudget(
  categoryId: number,
  month: string,
  amount: number
) {
  const id = `${month}:${categoryId}`;

  await db.budgets.put({
    id,
    categoryId,
    month,
    amount,
  });
}

