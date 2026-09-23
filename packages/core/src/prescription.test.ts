import { describe, expect, it } from "vitest";
import extracted from "./__fixtures__/prescription-extracted.json" with { type: "json" };
import supplied from "./__fixtures__/prescription-supplied.json" with { type: "json" };
import { field, IR_VERSION, type PrescriptionIR, PrescriptionIR as schema } from "./index.ts";

/**
 * The fixtures are synthetic: an OPD prescription as an EMR would supply it,
 * and the same prescription as an extractor would read it from a photo, with
 * provenance on the fields it found and one value it could not ground.
 */

// biome-ignore lint/suspicious/noExplicitAny: the tests deliberately write values no type allows
type Loose = any;
const mutate = (base: unknown, change: (ir: Loose) => void) => {
  const copy = structuredClone(base) as Loose;
  change(copy);
  return copy;
};
const issues = (value: unknown) =>
  schema.safeParse(value).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`) ?? [];

describe("the prescription IR round-trips through Zod", () => {
  for (const [name, fixture] of [
    ["supplied", supplied],
    ["extracted", extracted],
  ] as const) {
    it(`preserves the ${name} fixture exactly, through JSON and back`, () => {
      const parsed = schema.parse(fixture);
      expect(parsed).toStrictEqual(fixture);
      expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toStrictEqual(parsed);
    });
  }

  it("accepts an IR built in code with the field helper", () => {
    const ir: PrescriptionIR = {
      irVersion: IR_VERSION,
      hiType: "Prescription",
      date: field("2026-09-21"),
      patient: {
        name: field("Ravi Kumar"),
        identifiers: [{ kind: "abha-address", value: field("ravi.kumar@sbx") }],
      },
      practitioner: {
        name: field("Dr. S. Iyer"),
        identifiers: [{ kind: "medical-registration", value: field("TNMC 11223") }],
      },
      medications: [{ name: field("Tab. Pan 40"), instructions: field("before breakfast") }],
    };
    expect(schema.parse(ir)).toStrictEqual(ir);
  });
});

describe("parsing never rewrites a value", () => {
  it("keeps text exactly as written, whitespace included", () => {
    const ir = mutate(supplied, (x) => (x.medications[0].name.value = " Tab.  Dolo 650 "));
    expect(schema.parse(ir).medications[0]?.name.value).toBe(" Tab.  Dolo 650 ");
  });

  it("still rejects a blank value", () => {
    expect(issues(mutate(supplied, (x) => (x.patient.name.value = "   ")))).toEqual([
      "patient.name.value: must not be blank",
    ]);
  });
});

describe("provenance", () => {
  it("can say a value was extracted with nothing on the page to support it", () => {
    const quantity = schema.parse(extracted).medications[1]?.quantity;
    expect(quantity?.provenance).toEqual({ confidence: 0.41, spans: [] });
  });

  it("rejects a span on a page the source document does not have", () => {
    const ir = mutate(extracted, (x) => {
      x.patient.name.provenance.spans[0].page = 2;
    });
    expect(issues(ir)).toEqual([
      "patient.name.provenance.spans.0.page: page 2 is beyond the source document's 1 pages",
    ]);
  });

  it("requires the source document once any span points at a page", () => {
    expect(issues(mutate(extracted, (x) => delete x.source))).toEqual([
      "source: provenance spans point at pages, so the source document must be given",
    ]);
  });

  it("rejects a bounding box that runs off the page", () => {
    const ir = mutate(extracted, (x) => {
      x.date.provenance.spans[0].box.x = 0.9;
    });
    expect(issues(ir)).toEqual(["date.provenance.spans.0.box: the box extends beyond the page"]);
  });

  it("rejects a confidence outside 0 to 1", () => {
    const ir = mutate(extracted, (x) => {
      x.date.provenance.confidence = 97;
    });
    expect(issues(ir)).toEqual([expect.stringMatching(/^date\.provenance\.confidence: /)]);
  });
});

describe("what a conformant bundle needs", () => {
  it("rejects a patient with no identifier", () => {
    expect(issues(mutate(supplied, (x) => (x.patient.identifiers = [])))).toEqual([
      "patient.identifiers: the ABDM Patient profile requires at least one identifier",
    ]);
  });

  it("rejects a practitioner with no identifier", () => {
    expect(issues(mutate(supplied, (x) => (x.practitioner.identifiers = [])))).toEqual([
      "practitioner.identifiers: the ABDM Practitioner profile requires at least one identifier",
    ]);
  });

  it("rejects a medication with nothing to build a dosage from", () => {
    const ir = mutate(supplied, (x) => {
      x.medications[0] = { name: { value: "Tab. Dolo 650" }, strength: { value: "650 mg" } };
    });
    expect(issues(ir)).toEqual([expect.stringMatching(/^medications\.0: a medication needs/)]);
  });

  it("rejects a prescription with no medications", () => {
    expect(issues(mutate(supplied, (x) => (x.medications = [])))).toEqual([
      "medications: a prescription prescribes something",
    ]);
  });
});

describe("values", () => {
  it("rejects a date that is not on the calendar", () => {
    expect(issues(mutate(supplied, (x) => (x.date.value = "2026-02-30")))).toEqual([
      "date.value: expected YYYY-MM-DD, optionally with a time and UTC offset",
    ]);
  });

  it("rejects a time with no UTC offset, which FHIR cannot represent", () => {
    expect(issues(mutate(supplied, (x) => (x.date.value = "2026-09-21T10:42:00")))).toHaveLength(1);
  });

  it("accepts a partial birth date", () => {
    expect(issues(mutate(supplied, (x) => (x.patient.birthDate = { value: "1992" })))).toEqual([]);
  });

  it("rejects a malformed ABHA number with a message that says what one looks like", () => {
    const ir = mutate(supplied, (x) => {
      x.patient.identifiers[0].value.value = "91-1111-2222";
    });
    expect(issues(ir)).toEqual([
      "patient.identifiers.0.value.value: an ABHA number has 14 digits, often written 91-1234-5678-9012",
    ]);
  });

  it("rejects a 0-0-0 frequency", () => {
    const ir = mutate(supplied, (x) => {
      x.medications[0].frequency.value = {
        kind: "times-of-day",
        morning: 0,
        afternoon: 0,
        night: 0,
      };
    });
    expect(issues(ir)).toEqual([expect.stringMatching(/^medications\.0\.frequency\.value: /)]);
  });

  it("keeps a frequency it cannot normalise as written", () => {
    const ir = mutate(supplied, (x) => {
      x.medications[0].frequency.value = { kind: "as-written", text: "alt days" };
    });
    expect(issues(ir)).toEqual([]);
  });
});

describe("the contract is closed", () => {
  it("rejects a property the IR does not define", () => {
    expect(issues(mutate(supplied, (x) => (x.patient.bloodGroup = { value: "B+" })))).toEqual([
      expect.stringMatching(/^patient: /),
    ]);
  });

  it("rejects a different IR version", () => {
    expect(issues(mutate(supplied, (x) => (x.irVersion = "1")))).toEqual([
      expect.stringMatching(/^irVersion: /),
    ]);
  });
});
