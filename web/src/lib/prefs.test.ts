import { describe, expect, it } from "vitest";
import { eventImageVisible } from "./prefs";

describe("Ereignisbild sichtbar", () => {
  it("erzeugte Bilder folgen der Einstellung, eigene bleiben immer sichtbar", () => {
    expect(eventImageVisible("generated", true)).toBe(true);
    expect(eventImageVisible("generated", false)).toBe(false);
    expect(eventImageVisible("imported", false)).toBe(false);
    expect(eventImageVisible("uploaded", false)).toBe(true);
    expect(eventImageVisible(null, false)).toBe(false);
  });
});
