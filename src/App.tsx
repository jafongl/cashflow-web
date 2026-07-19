import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  saveTransaction,
  removeTransaction,
  upsertBudget,
  todayLocalISO,
  currentMonthLocal,
  type Budget,
  type Category,
  type Transaction,
  type TxType,
} from './db';
import { fileToCompressedDataUrl } from './image';
import { extractInvoiceFromFile } from './ocr';

type Tab = 'resumen' | 'movimientos' | 'nuevo' | 'presupuestos';

const money = (value: number) => `$${value.toFixed(2)}`;

export default function App() {
  const [tab, setTab] = useState<Tab>('resumen');
  const [month, setMonth] = useState(currentMonthLocal());

  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];

  const transactions =
    useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), []) ??
    [];

  const budgets =
    useLiveQuery(() => db.budgets.where('month').equals(month).toArray(), [
      month,
    ]) ?? [];

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Flujo de Efectivo</h1>
          <p>Registra ingresos, gastos y presupuestos</p>
        </div>

        <label className="month-picker">
          <span>Mes</span>
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
      </header>

      <nav className="tabs">
        <button
          className={tab === 'resumen' ? 'active' : ''}
          onClick={() => setTab('resumen')}
        >
          Resumen
        </button>

        <button
          className={tab === 'movimientos' ? 'active' : ''}
          onClick={() => setTab('movimientos')}
        >
          Movimientos
        </button>

        <button
          className={tab === 'nuevo' ? 'active' : ''}
          onClick={() => setTab('nuevo')}
        >
          Nuevo
        </button>

        <button
          className={tab === 'presupuestos' ? 'active' : ''}
          onClick={() => setTab('presupuestos')}
        >
          Presupuestos
        </button>
      </nav>

      <main className="main">
        {tab === 'resumen' && (
          <Dashboard
            transactions={transactions}
            categories={categories}
            budgets={budgets}
            month={month}
          />
        )}

        {tab === 'movimientos' && (
          <Transactions
            transactions={transactions}
            categories={categories}
            month={month}
          />
        )}

        {tab === 'nuevo' && (
          <AddTransaction
            categories={categories}
            onSaved={() => setTab('movimientos')}
          />
        )}

        {tab === 'presupuestos' && (
          <Budgets
            categories={categories}
            transactions={transactions}
            budgets={budgets}
            month={month}
          />
        )}
      </main>
    </div>
  );
}

function Dashboard({
  transactions,
  categories,
  budgets,
  month,
}: {
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  month: string;
}) {
  const allIncome = transactions
    .filter((tx) => tx.type === 'income')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const allExpense = transactions
    .filter((tx) => tx.type === 'expense')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const balance = allIncome - allExpense;

  const monthTransactions = transactions.filter((tx) =>
    tx.date.startsWith(month)
  );

  const monthIncome = monthTransactions
    .filter((tx) => tx.type === 'income')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const monthExpense = monthTransactions
    .filter((tx) => tx.type === 'expense')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const monthNet = monthIncome - monthExpense;

  const expenseCategories = categories.filter(
    (category): category is Category & { id: number } =>
      category.type === 'expense' && category.id != null
  );

  const budgetRows = expenseCategories
    .map((category) => {
      const budget =
        budgets.find((item) => item.categoryId === category.id)?.amount ?? 0;

      const spent = monthTransactions
        .filter(
          (tx) => tx.type === 'expense' && tx.categoryId === category.id
        )
        .reduce((sum, tx) => sum + tx.amount, 0);

      const remaining = budget - spent;
      const percent = budget > 0 ? (spent / budget) * 100 : 0;

      return {
        id: category.id,
        name: category.name,
        budget,
        spent,
        remaining,
        percent,
      };
    })
    .filter((row) => row.budget > 0 || row.spent > 0)
    .sort((a, b) => b.spent - a.spent);

  return (
    <section className="section">
      <div className="cards">
        <article className="card">
          <h3>Saldo histórico</h3>
          <p className={balance >= 0 ? 'positive' : 'negative'}>
            {money(balance)}
          </p>
        </article>

        <article className="card">
          <h3>Ingresos del mes</h3>
          <p className="positive">{money(monthIncome)}</p>
        </article>

        <article className="card">
          <h3>Gastos del mes</h3>
          <p className="negative">{money(monthExpense)}</p>
        </article>

        <article className="card">
          <h3>Flujo del mes</h3>
          <p className={monthNet >= 0 ? 'positive' : 'negative'}>
            {money(monthNet)}
          </p>
        </article>
      </div>

      <h2 className="section-title">Presupuesto del mes</h2>

      {budgetRows.length === 0 ? (
        <div className="empty">
          Todavía no hay presupuestos ni gastos para este mes.
        </div>
      ) : (
        <div className="budget-list">
          {budgetRows.map((row) => {
            const status =
              row.percent >= 100
                ? 'danger'
                : row.percent >= 70
                ? 'warning'
                : 'success';

            return (
              <article key={row.id ?? row.name} className="budget-item">
                <div className="budget-item-header">
                  <strong>{row.name}</strong>
                  <span>{row.percent.toFixed(0)}%</span>
                </div>

                <div className="progress">
                  <div
                    className={`progress-bar ${status}`}
                    style={{
                      width: `${Math.min(row.percent, 100)}%`,
                    }}
                  />
                </div>

                <div className="budget-detail">
                  <span>Gastado: {money(row.spent)}</span>
                  <span>Presupuesto: {money(row.budget)}</span>
                  <span>
                    Disponible:{' '}
                    <strong
                      className={row.remaining >= 0 ? 'positive' : 'negative'}
                    >
                      {money(row.remaining)}
                    </strong>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Transactions({
  transactions,
  categories,
  month,
}: {
  transactions: Transaction[];
  categories: Category[];
  month: string;
}) {
  const [receipt, setReceipt] = useState<string | null>(null);

  const monthTransactions = transactions.filter((tx) =>
    tx.date.startsWith(month)
  );

  const categoryName = (categoryId?: number) =>
    categories.find((category) => category.id === categoryId)?.name ??
    'Sin categoría';

  return (
    <section className="section">
      <h2 className="section-title">Movimientos del mes</h2>

      {monthTransactions.length === 0 ? (
        <div className="empty">No hay movimientos para este mes.</div>
      ) : (
        <div className="transaction-list">
          {monthTransactions.map((tx) => (
            <article
              key={tx.id ?? tx.createdAt}
              className={
                tx.type === 'income'
                  ? 'transaction-item income'
                  : 'transaction-item expense'
              }
            >
              <div className="transaction-info">
                <strong>{tx.vendor || categoryName(tx.categoryId)}</strong>

                <div className="muted">
                  {tx.date} · {categoryName(tx.categoryId)}
                  {tx.note ? ` · ${tx.note}` : ''}
                </div>

                {tx.receipt && (
                  <button
                    className="link-button"
                    onClick={() => setReceipt(tx.receipt ?? null)}
                  >
                    Ver factura
                  </button>
                )}
              </div>

              <div className="transaction-actions">
                <span
                  className={
                    tx.type === 'income'
                      ? 'amount positive'
                      : 'amount negative'
                  }
                >
                  {tx.type === 'income' ? '+' : '-'}
                  {money(tx.amount)}
                </span>

                <button
                  className="danger-button"
                  onClick={async () => {
                    const confirmed = window.confirm(
                      '¿Eliminar este movimiento?'
                    );

                    if (!confirmed) return;

                    if (tx.id) {
                      await removeTransaction(tx.id);
                    }
                  }}
                >
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {receipt && (
        <div className="modal" onClick={() => setReceipt(null)}>
          <img src={receipt} alt="Factura" />
        </div>
      )}
    </section>
  );
}

function AddTransaction({
  categories,
  onSaved,
}: {
  categories: Category[];
  onSaved: () => void;
}) {
  const [type, setType] = useState<TxType>('expense');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayLocalISO());
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [vendor, setVendor] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [message, setMessage] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const visibleCategories = categories.filter(
    (category) => category.type === type
  );

  useEffect(() => {
    const cats = categories.filter((category) => category.type === type);

    const stillValid = cats.some((category) => category.id === categoryId);

    if (!stillValid) {
      setCategoryId(cats[0]?.id ?? '');
    }
  }, [type, categories, categoryId]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    setMessage('Procesando imagen...');
    setOcrLoading(true);

    try {
      const compressedReceipt = await fileToCompressedDataUrl(file);

      setReceipt(compressedReceipt);
      setType('expense');

      const extracted = await extractInvoiceFromFile(file);

      if (extracted.total) {
        setAmount(String(extracted.total));
      }

      if (extracted.date) {
        setDate(extracted.date);
      }

      if (extracted.vendor) {
        setVendor(extracted.vendor);
      }

      if (extracted.suggestedCategory) {
        const match = categories.find(
          (category) =>
            category.type === 'expense' &&
            category.name.toLowerCase() ===
              extracted.suggestedCategory?.toLowerCase()
        );

        if (match?.id) {
          setType('expense');
          setCategoryId(match.id);
        }
      }

      setMessage(
        extracted.total
          ? 'Factura analizada. Revisa los datos antes de guardar.'
          : 'OCR completado. Completa o corrige los datos manualmente.'
      );
    } catch (error) {
      console.error(error);
      setMessage(
        'No se pudo analizar la imagen. Puedes ingresar los datos manualmente.'
      );
    } finally {
      setOcrLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const parsedAmount = parseFloat(amount);

    if (!parsedAmount || parsedAmount <= 0) {
      window.alert('Ingresa un monto válido.');
      return;
    }

    if (!date) {
      window.alert('Selecciona una fecha.');
      return;
    }

    await saveTransaction({
      type,
      amount: parsedAmount,
      categoryId: categoryId ? Number(categoryId) : undefined,
      date,
      vendor: vendor.trim() || undefined,
      note: note.trim() || undefined,
      receipt: receipt || undefined,
      createdAt: new Date().toISOString(),
    });

    setAmount('');
    setDate(todayLocalISO());
    setVendor('');
    setNote('');
    setReceipt('');
    setMessage('');

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    onSaved();
  }

  return (
    <section className="section">
      <h2 className="section-title">Nuevo movimiento</h2>

      <form className="form" onSubmit={handleSubmit}>
        <div className="type-buttons">
          <button
            type="button"
            className={type === 'expense' ? 'active expense' : ''}
            onClick={() => setType('expense')}
          >
            Gasto
          </button>

          <button
            type="button"
            className={type === 'income' ? 'active income' : ''}
            onClick={() => setType('income')}
          >
            Ingreso
          </button>
        </div>

        <label className="field">
          <span>Monto</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
          />
        </label>

        <label className="field">
          <span>Fecha</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>

        <label className="field">
          <span>Categoría</span>
          <select
            value={categoryId}
            onChange={(event) =>
              setCategoryId(event.target.value ? Number(event.target.value) : '')
            }
          >
            {visibleCategories.map((category) => (
              <option key={category.id ?? category.name} value={category.id ?? ''}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Proveedor / Comercio</span>
          <input
            value={vendor}
            onChange={(event) => setVendor(event.target.value)}
            placeholder="Nombre del comercio"
          />
        </label>

        <label className="field">
          <span>Nota</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Nota opcional"
          />
        </label>

        <label className="field">
          <span>Foto de factura</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
          />
        </label>

        {ocrLoading && <p className="muted">Analizando factura...</p>}

        {message && <p className="muted">{message}</p>}

        {receipt && (
          <img src={receipt} alt="Preview de factura" className="preview" />
        )}

        <button type="submit" className="primary-button">
          Guardar movimiento
        </button>
      </form>
    </section>
  );
}

function Budgets({
  categories,
  transactions,
  budgets,
  month,
}: {
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  month: string;
}) {
  const expenseCategories = categories.filter(
    (category): category is Category & { id: number } =>
      category.type === 'expense' && category.id != null
  );

  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};

    expenseCategories.forEach((category) => {
      const budget = budgets.find(
        (item) => item.categoryId === category.id
      );

      next[String(category.id)] = budget ? String(budget.amount) : '';
    });

    setValues(next);
  }, [categories, budgets, month, expenseCategories]);

  const monthExpenses = transactions.filter(
    (tx) => tx.date.startsWith(month) && tx.type === 'expense'
  );

  const spentByCategory = (categoryId?: number) =>
    monthExpenses
      .filter((tx) => tx.categoryId === categoryId)
      .reduce((sum, tx) => sum + tx.amount, 0);

  async function handleSave() {
    await Promise.all(
      expenseCategories.map(async (category) => {
        const raw = values[String(category.id)] ?? '';
        const parsed = parseFloat(raw);

        await upsertBudget(
          Number(category.id),
          month,
          Number.isNaN(parsed) ? 0 : parsed
        );
      })
    );

    window.alert('Presupuestos guardados.');
  }

  return (
    <section className="section">
      <h2 className="section-title">Presupuestos de {month}</h2>

      <div className="budget-form-list">
        {expenseCategories.map((category) => {
          const spent = spentByCategory(category.id);
          const budgetValue = parseFloat(
            values[String(category.id)] ?? '0'
          );

          const remaining =
            (Number.isNaN(budgetValue) ? 0 : budgetValue) - spent;

          return (
            <article
              key={category.id ?? category.name}
              className="budget-form-item"
            >
              <div>
                <strong>{category.name}</strong>
                <div className="muted">
                  Gastado: {money(spent)} · Disponible: {money(remaining)}
                </div>
              </div>

              <input
                type="number"
                step="0.01"
                min="0"
                value={values[String(category.id)] ?? ''}
                onChange={(event) =>
                  setValues((prev) => ({
                    ...prev,
                    [String(category.id)]: event.target.value,
                  }))
                }
                placeholder="Presupuesto"
              />
            </article>
          );
        })}
      </div>

      <button className="primary-button" onClick={handleSave}>
        Guardar presupuestos
      </button>
    </section>
  );
}
