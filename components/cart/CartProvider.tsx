"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
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

type CartState = {
  items: CartItem[];
  ready: boolean;
  add: (item: Omit<CartItem, "key">) => void;
  remove: (key: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
  count: number;
  total: number;
};

const CartContext = createContext<CartState | null>(null);
const STORAGE_KEY = "cart:v1";

function itemKey(item: Omit<CartItem, "key">) {
  const options = item.options
    .map((option) => option.slug)
    .sort()
    .join(",");
  return `${item.seriesId}|${item.carLabel}|${item.colorName}|${options}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  // Поки кошик не піднявся з localStorage, лічильник не показуємо —
  // інакше на першому кадрі блимає нуль.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw) as CartItem[]);
    } catch {
      // Пошкоджений або недоступний storage не має ламати сторінку.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Приватний режим — просто працюємо без збереження.
    }
  }, [items, ready]);

  const add = useCallback((item: Omit<CartItem, "key">) => {
    const key = itemKey(item);
    setItems((current) => {
      const existing = current.find((entry) => entry.key === key);
      if (existing) {
        return current.map((entry) =>
          entry.key === key
            ? { ...entry, quantity: entry.quantity + item.quantity }
            : entry,
        );
      }
      return [...current, { ...item, key }];
    });
  }, []);

  const remove = useCallback((key: string) => {
    setItems((current) => current.filter((entry) => entry.key !== key));
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setItems((current) =>
      current.map((entry) =>
        entry.key === key
          ? { ...entry, quantity: Math.max(1, Math.min(20, quantity)) }
          : entry,
      ),
    );
  }, []);

  const clear = useCallback(() => setItems([]), []);

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
