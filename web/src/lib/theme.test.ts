import { describe, expect, it } from "vitest";
import { isThemePreference, resolveTheme } from "./theme";

describe("theme", () => {
  it("erkennt gültige Einstellungen", () => {
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("auto")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
  it("löst System über die Geräteeinstellung auf, Dunkel und Hell bleiben fest", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
  });
});
