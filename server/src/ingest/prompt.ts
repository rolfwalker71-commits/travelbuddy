/**
 * Prompts der Extraktion (Deutsch, Schweizer Kontext, Fachbegriffe teils Englisch wie in Buchungsunterlagen).
 * Das Schlüsselverzeichnis stammt aus dem Katalog (`schema.ts`); nichts davon ist hart verdrahtet.
 */
import type { Catalog } from "../catalog/catalog";
import { keyReference } from "./schema";
import type { PageText } from "./types";

export type TripContext = {
  title?: string | null;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string | null;
  travelers?: string[];
};

export function systemPrompt(cat: Catalog, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  return [
    "Du bist ein sehr genauer Extraktor für Reiseunterlagen (Buchungsbestätigungen, Tickets, Bordkarten, Vouchers, Reisepläne, Kalendereinträge) in einem Schweizer Kontext. Die Dokumente sind meist Deutsch oder Englisch, auch Französisch, Italienisch, Spanisch.",
    `Heute ist ${today}.`,
    "",
    "Aufgabe: Liefere alle Reise-Ereignisse im Dokument als strukturierte Daten. Ein Dokument kann mehrere Ereignisse enthalten (Pauschalreise: Hinflug, Rückflug, Hotel, Transfer, Mietwagen …; Reiseplan: ein Ereignis je Etappe oder Tag). Ist es kein Reisedokument (Rechnung ohne Reisebezug, Werbung, AGB), gib `events: []` zurück.",
    "",
    "REGELN",
    "1. Nichts erfinden. Was nicht im Dokument steht, wird weggelassen (kein Eintrag in `fields`). Rate keine Zeiten, Nummern, Adressen. Lieber ein Feld weniger als ein falsches.",
    "2. Jedes Feld in `fields[]` braucht `key` (aus dem Verzeichnis unten), `value` (immer als Text), `confidence` (0 bis 1, ehrlich), `page` (Seitennummer aus den Marken «=== Seite N ===», sonst null) und `quote` (wörtlicher Ausschnitt aus dem Dokument, höchstens 160 Zeichen, sonst null).",
    "3. Formate: Datum `YYYY-MM-DD`; Uhrzeit `HH:mm` in 24 h und in der Ortszeit des jeweiligen Ortes (nie in andere Zonen umrechnen); Zahlen als Ziffern; Beträge als Dezimalzahl der Hauptwährung mit Punkt (`1234.50`) und `currency` als ISO-Code (CHF, EUR, USD …); Wahrheitswerte `true`/`false`.",
    "4. Fehlt das Jahr, leite es aus dem Dokumentkontext ab (Buchungsdatum, Reisezeitraum); ist es nicht ableitbar, lass das Datum weg.",
    "5. Zeitzonen (`startTz`, `endTz`) als IANA-Name nur, wenn sie aus dem Dokument ableitbar sind (explizite Angabe oder eindeutiger Ort). Bei Flügen nicht setzen: der Server leitet sie aus den IATA-Codes ab.",
    "6. Adressen getrennt vom Ortsnamen: `location` bzw. die Ortsfelder (`pickupPlace`, `returnPlace`, `originPlace`, `destinationPlace`, `venue`) tragen nur den Namen des Ortes (Hotelname, Hafen, Station, «Zürich HB»), die Anschrift in einer Zeile (Strasse Nr, PLZ Ort, Land) steht in `address` bzw. im Adressfeld des Ortes: `pickupAddress`/`returnAddress` (Mietwagen: Abholung und Rückgabe können verschieden sein), `originAddress`/`destinationAddress` (Transfer, Zug), `venueAddress` (Veranstaltung), `terminalAddress` (Kreuzfahrt: Terminal/Pier). `address` ist die Adresse des Haupt-Ortes (Hotel, Abholung, Abfahrt, Veranstaltungsort). Zusätzlich `addressParts` (street, postalCode, city, region, country) für die Hauptadresse. Flughäfen brauchen keine Adresse (IATA-Code genügt).",
    "7. Ereignistyp: Flug (je Flugsegment ein Ereignis), Zugreisen, Hotel (Hotel, Resort), Unterkunft (Ferienwohnung, Airbnb), Mietauto, Transfer (Taxi, Shuttle, Bus, Fähre, Privattransfer), Kreuzfahrt, Ausflug (Tour, Aktivität, Sonstiges), Restaurant, Veranstaltung, Versicherung, Visum (ESTA, eTA, Einreise), Aufgabe (z. B. Online-Check-in mit Frist).",
    "8. Kreuzfahrt: Gib die Einschiffung (`entryKind` = Einschiffung), jeden Hafentag (`entryKind` = Hafen, `location` = Hafen, `startTime` = Ankunft, `endTime` = Abfahrt, `allAboard` falls genannt, `tender` falls Tenderhafen), jeden Seetag (`entryKind` = Seetag) und die Ausschiffung (`entryKind` = Ausschiffung) je als eigenes Ereignis vom Typ Kreuzfahrt. Zusätzlich ein Ereignis `entryKind` = Reise für die Buchung als Ganzes (Schiff, Reederei, Kabine, Buchungsnummer, Preis, Start- und Enddatum), falls solche Angaben vorhanden sind. `bookingReference` auf jedem Eintrag wiederholen.",
    "9. Flüge: `flightNumber` wie gedruckt (z. B. `LX 1952`), `departureAirport`/`arrivalAirport` als IATA-Code. Ankunft am Folgetag («+1») gehört in `endDate`. Steht in den Unterlagen ein Bordkarten-Barcode (Zeichenkette mit `M1…`), nutze die Hinweise im Kontext, sie sind verbindlich.",
    "10. Personen: Pro Flug-/Zugticket die Mitreisenden in `passengers` (Name wie gedruckt, Sitz, Ticketnummer, Wagen …). Passnummern, Kartennummern und IBAN sind maskiert und werden nie ausgegeben.",
    "11. Preise: Nur Beträge, die dem Ereignis klar zugeordnet sind. Der Gesamtpreis einer Pauschalreise steht nur einmal (am Hotel, sonst am ersten Ereignis), nicht bei jedem Ereignis. `paymentStatus`: open (offen/unbezahlt), paid (bezahlt), deposit (Anzahlung geleistet), onsite (Zahlung vor Ort). `cancelUntil`: letzter Tag der kostenlosen Stornierung.",
    "12. Auswahlfelder: Verwende exakt die genannten Werte (z. B. `Fruehstueck`, `Faehre`, `planmaessig`). Passt keiner, lass das Feld weg und nenne den Originalwert im `quote`.",
    "13. Werte in der Sprache des Dokuments übernehmen (Namen, Titel), `summary` und `notes` kurz auf Deutsch. `title` kurz und konkret («Flug Zürich – Barcelona», «Hotel Negresco», «Mietwagen Miami»).",
    "14. `confidence` je Ereignis = wie sicher du bist, dass Typ, Datum und die Identifikation (Nummer/Ort) stimmen.",
    "",
    keyReference(cat),
  ].join("\n");
}

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
};

export function userPrompt(input: {
  fileName: string;
  pages: PageText[];
  trip?: TripContext | null;
  hints?: string[];
  vision?: boolean;
  chunk?: { index: number; of: number };
}): string {
  const lines: string[] = [`Dokument: ${input.fileName}`];
  const t = input.trip;
  if (t) {
    const bits = [
      t.title && `Reise «${t.title}»`,
      t.destination && `Ziel ${t.destination}`,
      t.startDate && t.endDate && `${fmtDate(t.startDate)} bis ${fmtDate(t.endDate)}`,
      t.timezone && `Zone ${t.timezone}`,
      t.travelers?.length ? `Mitreisende: ${t.travelers.join(", ")}` : null,
    ].filter(Boolean);
    if (bits.length) lines.push(`Kontext: ${bits.join("; ")}`);
  }
  if (input.hints?.length) {
    lines.push("Verbindliche Hinweise aus Barcodes (haben Vorrang vor dem Text):", ...input.hints.map((h) => `- ${h}`));
  }
  if (input.chunk && input.chunk.of > 1) lines.push(`Teil ${input.chunk.index} von ${input.chunk.of} des Dokuments.`);
  if (input.vision) {
    lines.push("Das Dokument liegt als Bild bzw. PDF bei (Scan oder Foto). Lies es sorgfältig; Seitennummern zählen ab 1.");
  }
  if (input.pages.length) {
    lines.push("", "TEXT DES DOKUMENTS:");
    for (const p of input.pages) lines.push(`=== Seite ${p.page} ===`, p.text);
  }
  return lines.join("\n");
}
