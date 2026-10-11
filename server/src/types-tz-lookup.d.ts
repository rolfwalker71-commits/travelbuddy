declare module "tz-lookup" {
  /** Zeitzone (IANA) für Koordinaten. Wirft bei ungültigen Koordinaten. */
  export default function tzlookup(lat: number, lon: number): string;
}
