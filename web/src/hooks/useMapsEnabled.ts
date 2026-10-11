import { useEffect, useState } from "react";
import { mapsEnabled } from "../lib/mapkit";

/** `null` = noch unbekannt, `true` = Apple Karten eingerichtet, `false` = nicht eingerichtet oder nicht erreichbar. */
export function useMapsEnabled(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    mapsEnabled()
      .then((v) => alive && setOn(v))
      .catch(() => alive && setOn(false));
    return () => {
      alive = false;
    };
  }, []);
  return on;
}
