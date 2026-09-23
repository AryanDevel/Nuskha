import { describe, expect, it } from "vitest";
import { HI_TYPES, IG_PACKAGE, isHiType } from "./index.js";

describe("IG_PACKAGE", () => {
  // A tripwire, not a tautology. Bumping the pin should break this test and
  // force the regenerate-and-diff conversation rather than sliding through.
  it("pins the implementation guide this build targets", () => {
    expect(IG_PACKAGE).toStrictEqual({
      id: "ndhm.in",
      version: "7.0.0",
      fhirVersion: "4.0.1",
    });
  });
});

describe("HI_TYPES", () => {
  it("covers all eight ABDM health information types", () => {
    expect(HI_TYPES).toHaveLength(8);
  });

  it("contains no duplicates", () => {
    expect(new Set(HI_TYPES).size).toBe(HI_TYPES.length);
  });

  it("uses the gateway spelling, not the IG profile name", () => {
    expect(HI_TYPES).toContain("OPConsultation");
    expect(HI_TYPES).not.toContain("OPConsultRecord");
  });
});

describe("isHiType", () => {
  it("accepts a known type", () => {
    expect(isHiType("Prescription")).toBe(true);
  });

  it("rejects one ABDM does not define", () => {
    expect(isHiType("RadiologyReport")).toBe(false);
  });
});
