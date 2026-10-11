import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

type Options = { title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean };
type Pending = Options & { resolve: (ok: boolean) => void };

const Ctx = createContext<((o: Options) => Promise<boolean>) | null>(null);

/** Bestätigungen als Sheet statt `window.confirm`. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<Pending | null>(null);

  const confirm = useCallback(
    (o: Options) =>
      new Promise<boolean>((resolve) => {
        const p = { ...o, resolve };
        ref.current = p;
        setPending(p);
      }),
    []
  );
  const close = (ok: boolean) => {
    ref.current?.resolve(ok);
    ref.current = null;
    setPending(null);
  };
  const value = useMemo(() => confirm, [confirm]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Sheet
        open={pending !== null}
        onClose={() => close(false)}
        title={pending?.title ?? ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              Abbrechen
            </Button>
            <Button variant={pending?.danger ? "danger" : "primary"} onClick={() => close(true)}>
              {pending?.confirmLabel ?? "Bestätigen"}
            </Button>
          </>
        }
      >
        {pending?.message ? <p>{pending.message}</p> : null}
      </Sheet>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const c = useContext(Ctx);
  if (!c) throw new Error("ConfirmProvider fehlt");
  return c;
}
