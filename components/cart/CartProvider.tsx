"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type CartItem = {
  /** Унікальний ключ позиції: серія + авто + колір + опції */
  key: string;
  seriesId: number;
  seriesSlug: string;
  seriesName: string;
  carLabel: string;
  carModelId: number | null;
  colorName: string;
  colorHex: string;
  colorInsertHex: string;
  colorThreadHex: string;
  quilting: boolean;
  options: { slug: string; name: string; price: number }[];
  unitPrice: number;
  quantity: number;
  productionDays: number;
};

const STORAGE_KEY = "cart:v1";
const EMPTY: CartItem[] = [];

// Кошик живе в localStorage, тобто це зовнішнє сховище щодо React.
// useSyncExternalStore — штатний спосіб з ним працювати: він коректно
// поводиться при гідратації й сам синхронізує кошик між вкладками.
let snapshot: CartItem[] | null = null;
const listeners = new Set<() => void>();

function readCart(): CartItem[] {
  if (snapshot) return snapshot;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    snapshot = raw ? (JSON.parse(raw) as CartItem[]) : EMPTY;
  } catch {
    // Пошкоджений або недоступний storage не має ламати сторінку.
    snapshot = EMPTY;
  }
  return snapshot;
}

function writeCart(items: CartItem[]) {
  snapshot = items;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Приватний режим — просто працюємо без збереження.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    snapshot = null;
    for (const item of listeners) item();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const serverSnapshot = () => EMPTY;
const clientReady = () => true;
const serverReady = () => false;

type CartState = {
  items: CartItem[];
  /** false, поки кошик не піднявся зі сховища — щоб лічильник не блимав нулем */
  ready: boolean;
  add: (item: Omit<CartItem, "key">) => void;
  remove: (key: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
  count: number;
  total: number;
};

const CartContext = createContext<CartState | null>(null);

function itemKey(item: Omit<CartItem, "key">) {
  const options = item.options
    .map((option) => option.slug)
    .sort()
    .join(",");
  return `${item.seriesId}|${item.carLabel}|${item.colorName}|${options}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const items = useSyncExternalStore(subscribe, readCart, serverSnapshot);
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);

  const add = useCallback((item: Omit<CartItem, "key">) => {
    const key = itemKey(item);
    const current = readCart();
    const existing = current.find((entry) => entry.key === key);

    writeCart(
      existing
        ? current.map((entry) =>
            entry.key === key
              ? { ...entry, quantity: entry.quantity + item.quantity }
              : entry,
          )
        : [...current, { ...item, key }],
    );
  }, []);

  const remove = useCallback((key: string) => {
    writeCart(readCart().filter((entry) => entry.key !== key));
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    writeCart(
      readCart().map((entry) =>
        entry.key === key
          ? { ...entry, quantity: Math.max(1, Math.min(20, quantity)) }
          : entry,
      ),
    );
  }, []);

  const clear = useCallback(() => writeCart(EMPTY), []);

  const value = useMemo<CartState>(() => {
    const count = items.reduce((sum, item) => sum + item.quantity, 0);
    const total = items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    return { items, ready, add, remove, setQuantity, clear, count, total };
  }, [items, ready, add, remove, setQuantity, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart потрібно викликати всередині CartProvider");
  }
  return context;
}
