/** Fire-and-forget mit Nachverfolgung: Fehler werden geloggt, Tests können `idle()` abwarten. */
export type Background = {
  run(p: Promise<unknown>): void;
  idle(): Promise<void>;
};

export function createBackground(log: (e: unknown) => void = (e) => console.error("[background]", e)): Background {
  const pending = new Set<Promise<unknown>>();
  return {
    run(p) {
      const t: Promise<unknown> = p.catch(log).finally(() => pending.delete(t));
      pending.add(t);
    },
    async idle() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}
