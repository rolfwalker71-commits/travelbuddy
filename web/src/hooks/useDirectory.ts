import { useEffect, useState } from "react";
import { currencies, users } from "../api/endpoints";
import { tokenStore } from "../api/client";
import type { Currency, DirectoryUser } from "../api/types";

let directoryCache: Promise<DirectoryUser[]> | null = null;

/** Benutzerverzeichnis zum Verknüpfen von Teilnehmern mit Konten (einmal je Sitzung geladen). */
export function useDirectory(enabled = true): DirectoryUser[] {
  const [list, setList] = useState<DirectoryUser[]>([]);
  useEffect(() => {
    if (!enabled) return;
    directoryCache ??= users.directory().catch(() => {
      directoryCache = null;
      return [] as DirectoryUser[];
    });
    let alive = true;
    void directoryCache.then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return list;
}

export function resetDirectoryCache(): void {
  directoryCache = null;
}

/** Rückfall, falls `/v1/currencies` nicht erreichbar ist oder kein Konto vorliegt (Gast-Link). */
export const FALLBACK_CURRENCIES: Currency[] = [
  ["CHF", "Schweizer Franken"],
  ["EUR", "Euro"],
  ["USD", "US-Dollar"],
  ["GBP", "Britisches Pfund"],
  ["JPY", "Japanischer Yen"],
  ["CAD", "Kanadischer Dollar"],
  ["AUD", "Australischer Dollar"],
  ["SEK", "Schwedische Krone"],
  ["NOK", "Norwegische Krone"],
  ["DKK", "Dänische Krone"],
  ["PLN", "Polnischer Zloty"],
  ["CZK", "Tschechische Krone"],
  ["HUF", "Ungarischer Forint"],
  ["TRY", "Türkische Lira"],
  ["THB", "Thailändischer Baht"],
].map(([code, name]) => ({ code: code!, name: name!, exponent: code === "JPY" ? 0 : 2 }));

let currencyCache: Promise<Currency[]> | null = null;

/**
 * Währungsliste für Auswahlfelder. Ohne `load` über das Konto (`/v1/currencies`), mit `load` über die
 * Quelle des Aufrufers (Gast: `/v1/guest/:token/currencies`). Bei Fehlern gilt die statische Liste.
 */
export function useCurrencies(load?: () => Promise<Currency[]>): Currency[] {
  const [list, setList] = useState<Currency[]>(FALLBACK_CURRENCIES);
  useEffect(() => {
    let source: Promise<Currency[]>;
    if (load) {
      source = load().catch(() => FALLBACK_CURRENCIES);
    } else {
      if (!tokenStore.get()) return;
      currencyCache ??= currencies.list().catch(() => {
        currencyCache = null;
        return FALLBACK_CURRENCIES;
      });
      source = currencyCache;
    }
    let alive = true;
    void source.then((l) => alive && l.length > 0 && setList(l));
    return () => {
      alive = false;
    };
    // `load` ist je Gast-Link stabil; ein neuer Aufrufer lädt neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return list;
}
