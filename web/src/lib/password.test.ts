import { describe, expect, it } from "vitest";
import { checkNewPassword, generatePassword } from "./password";

describe("generatePassword", () => {
  it("erzeugt die gewünschte Länge aus erlaubten Zeichen", () => {
    const p = generatePassword(20);
    expect(p).toHaveLength(20);
    expect(p).toMatch(/^[a-km-zA-HJ-NP-Z2-9]+$/);
  });
  it("ist zufällig", () => {
    expect(generatePassword(16)).not.toBe(generatePassword(16));
  });
  it("verwirft Bytes ausserhalb des gleichverteilten Bereichs", () => {
    // 255 liegt über dem Limit (256 - 256 % 57 = 228) und darf nicht verwendet werden
    let calls = 0;
    const rnd = (n: number) => {
      calls++;
      return new Uint8Array(n).fill(calls === 1 ? 255 : 0);
    };
    expect(generatePassword(4, rnd)).toBe("aaaa");
  });
});

describe("checkNewPassword", () => {
  it("prüft Länge und Wiederholung", () => {
    expect(checkNewPassword("kurz")).toEqual({ ok: false, error: "Mindestens 12 Zeichen" });
    expect(checkNewPassword("langgenug1234", "anders")).toEqual({ ok: false, error: "Die Wiederholung stimmt nicht überein" });
    expect(checkNewPassword("langgenug1234", "langgenug1234")).toEqual({ ok: true });
  });
});
