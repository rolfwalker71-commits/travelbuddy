import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

type Tone = "success" | "error" | "info";
type ToastItem = { id: number; message: string; tone: Tone };

const Ctx = createContext<{ show: (message: string, tone?: Tone) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const show = useCallback((message: string, tone: Tone = "success") => {
    const id = next.current++;
    setItems((cur) => [...cur.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), tone === "error" ? 6000 : 3500);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`toast glass glass--strong toast--${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
            <Icon name={t.tone === "error" ? "alert" : t.tone === "info" ? "info" : "check-circle"} size={18} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("ToastProvider fehlt");
  return c.show;
}
