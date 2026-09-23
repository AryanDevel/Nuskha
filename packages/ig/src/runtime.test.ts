import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  checkChoice,
  checkSlicing,
  deepEqual,
  getPath,
  matchesPattern,
  type SlicingSpec,
} from "./runtime.ts";

describe("getPath", () => {
  it("flattens arrays at every step, as FHIRPath navigation does", () => {
    const value = { coding: [{ code: "a" }, { code: "b" }, { system: "s" }] };
    expect(getPath(value, ["coding", "code"])).toEqual(["a", "b"]);
  });

  it("returns the value itself for an empty path", () => {
    expect(getPath({ a: 1 }, [])).toEqual([{ a: 1 }]);
  });
});

describe("deepEqual", () => {
  it("ignores key order", () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
  });

  it("treats an extra key as a difference", () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe("matchesPattern", () => {
  const pattern = { coding: [{ system: "http://snomed.info/sct", code: "440545006" }] };

  it("lets the value carry properties the pattern leaves out", () => {
    const value = {
      text: "Prescription",
      coding: [
        { system: "http://loinc.org", code: "57833-6" },
        { system: "http://snomed.info/sct", code: "440545006", display: "Prescription record" },
      ],
    };
    expect(matchesPattern(value, pattern)).toBe(true);
  });

  it("requires every pattern array item to be matched by some value item", () => {
    expect(matchesPattern({ coding: [{ system: "http://snomed.info/sct" }] }, pattern)).toBe(false);
  });
});

describe("checkChoice", () => {
  const schema = z.looseObject({}).superRefine((v, ctx) => {
    checkChoice(v, ctx, "Observation.value[x]", ["valueString", "valueQuantity"], true);
  });

  it("rejects two variants of one choice element", () => {
    expect(schema.safeParse({ valueString: "x", valueQuantity: { value: 1 } }).success).toBe(false);
  });

  it("rejects a required choice with no variant", () => {
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("accepts exactly one", () => {
    expect(schema.safeParse({ valueString: "x" }).success).toBe(true);
  });
});

describe("checkSlicing", () => {
  const spec: SlicingSpec = {
    element: "Composition.section.entry",
    closed: true,
    slices: [
      {
        name: "MedicationRequest",
        min: 1,
        max: null,
        predicates: [{ kind: "fixed", path: ["type"], value: "MedicationRequest" }],
      },
      {
        name: "Binary",
        min: 0,
        max: 1,
        predicates: [{ kind: "fixed", path: ["type"], value: "Binary" }],
        schema: z.object({ reference: z.string().startsWith("urn:uuid:") }),
      },
    ],
  };
  const schema = z.looseObject({}).superRefine((v, ctx) => {
    checkSlicing(v, ctx, "entry", spec);
  });
  const entry = (type: string, reference = "urn:uuid:1") => ({ type, reference });
  const messages = (value: unknown) =>
    schema.safeParse(value).error?.issues.map((i) => i.message) ?? [];

  it("accepts entries that fit the slices", () => {
    expect(messages({ entry: [entry("MedicationRequest"), entry("Binary")] })).toEqual([]);
  });

  it("enforces a slice's minimum", () => {
    expect(messages({ entry: [entry("Binary")] })).toEqual([
      "Composition.section.entry:MedicationRequest needs at least 1, found 0",
    ]);
  });

  it("enforces a slice's maximum", () => {
    expect(
      messages({ entry: [entry("MedicationRequest"), entry("Binary"), entry("Binary")] }),
    ).toEqual(["Composition.section.entry:Binary allows at most 1, found 2"]);
  });

  it("applies a slice's own constraints to its members", () => {
    const [message] = messages({ entry: [entry("MedicationRequest"), entry("Binary", "x")] });
    expect(message).toMatch(/^Composition\.section\.entry:Binary: /);
  });

  it("rejects an item that fits no slice when slicing is closed", () => {
    expect(messages({ entry: [entry("MedicationRequest"), entry("Observation")] })).toEqual([
      "Composition.section.entry is closed: item 1 matches none of its slices",
    ]);
  });
});
