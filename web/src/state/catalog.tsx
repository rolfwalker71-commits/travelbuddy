import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { meta } from "../api/endpoints";
import { BUNDLED_CATALOG, parseCatalog, type Catalog } from "../lib/catalog";
import { tokenStore } from "../api/client";

const Ctx = createContext<Catalog>(BUNDLED_CATALOG);

/**
 * Ereignis-Katalog: sofort die gebündelte Kopie von `shared/event-types.json`, danach die Fassung des Servers
 * (`GET /v1/meta/event-types`), falls sie brauchbar ist. So funktioniert das Formular auch offline.
 */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog>(BUNDLED_CATALOG);
  useEffect(() => {
    if (!tokenStore.get()) return;
    let alive = true;
    meta
      .eventTypes()
      .then((raw) => {
        const c = parseCatalog(raw);
        if (alive && c) setCatalog(c);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return <Ctx.Provider value={catalog}>{children}</Ctx.Provider>;
}

export function useCatalog(): Catalog {
  return useContext(Ctx);
}
