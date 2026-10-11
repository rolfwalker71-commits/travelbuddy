/** Grobe Typ-Erkennung aus Stichwörtern (nur für Kalendereinträge und Pässe ohne KI; die KI klassifiziert genauer). */

const RULES: Array<[type: string, re: RegExp]> = [
  ["Kreuzfahrt", /\b(kreuzfahrt|cruise|einschiffung|ausschiffung|embark|all aboard|seetag|sea day|msc|aida|costa|royal caribbean|norwegian)\b/i],
  ["Flug", /\b(flug|flight|vol|vuelo|abflug|departure flight|boarding|airline|airways|lufthansa|swiss|easyjet|edelweiss|ryanair)\b/i],
  ["Zugreisen", /\b(zug|train|bahn|sbb|db |ice|tgv|eurostar|railjet|intercity|bahnhof|gleis)\b/i],
  ["Mietauto", /\b(mietwagen|mietauto|rental car|car rental|car hire|avis|hertz|sixt|europcar|budget|enterprise|abholung fahrzeug)\b/i],
  ["Transfer", /\b(transfer|shuttle|taxi|bus|fähre|faehre|ferry|abholung)\b/i],
  ["Hotel", /\b(hotel|check-?in|check-?out|unterkunft|übernachtung|uebernachtung|accommodation|resort|airbnb|booking\.com|apartment|ferienwohnung)\b/i],
  ["Restaurant", /\b(restaurant|abendessen|mittagessen|dinner|lunch|frühstück|fruehstueck|reservation|reservierung|tisch)\b/i],
  ["Versicherung", /\b(versicherung|insurance|police)\b/i],
  ["Visum", /\b(visum|visa|esta|eta\b|einreise)\b/i],
  ["Veranstaltung", /\b(konzert|concert|ticket|museum|show|theater|musical|festival|event|spiel|match)\b/i],
];

export function guessTypeFromText(text: string): string {
  for (const [type, re] of RULES) if (re.test(text)) return type;
  return "Ausflug";
}
