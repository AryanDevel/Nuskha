import { HI_TYPES, IG_PACKAGE } from "@nuskha/core";
import { describe, expect, it } from "vitest";
import example from "./__fixtures__/prescription-composition.json" with { type: "json" };
import { datatypes, HI_TYPE_PROFILES, PACKAGE, PROFILES, PROFILES_BY_URL } from "./index.ts";
import * as preview from "./preview.ts";

/**
 * The regen self-check already proves the schemas accept every example the IG
 * ships. These tests prove the other half: that they reject the faults a
 * composer bug would actually produce. The fixture is the Composition from
 * the IG's own Bundle-Prescription-example-06 (CC0).
 */

const schema = PROFILES.PrescriptionRecord.schema;
// biome-ignore lint/suspicious/noExplicitAny: the tests deliberately write values no type allows
type Loose = Record<string, any>;
const mutate = (change: (c: Loose) => void) => {
  const copy = structuredClone(example) as Loose;
  change(copy);
  return copy;
};
const issues = (value: unknown) =>
  schema.safeParse(value).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`) ?? [];

describe("the generated PrescriptionRecord schema", () => {
  it("accepts the IG's own example", () => {
    expect(issues(example)).toEqual([]);
  });

  it("rejects a missing required element", () => {
    expect(issues(mutate((c) => delete c.subject))).toEqual([expect.stringMatching(/^subject: /)]);
  });

  it("rejects the wrong fixed SNOMED code for the document type", () => {
    const found = issues(mutate((c) => (c.type.coding[0].code = "371530004")));
    expect(found).toEqual([expect.stringMatching(/^type\.coding\.0\.code: /)]);
  });

  it("rejects an element the profile does not define", () => {
    expect(issues(mutate((c) => (c.priority = "urgent")))).not.toEqual([]);
  });

  it("rejects the wrong resource type", () => {
    expect(issues(mutate((c) => (c.resourceType = "Bundle")))).toEqual([
      expect.stringMatching(/^resourceType: /),
    ]);
  });

  it("rejects a date in a format FHIR does not allow", () => {
    expect(issues(mutate((c) => (c.date = "27-05-2017")))).toEqual([
      expect.stringMatching(/^date: /),
    ]);
  });

  it("rejects a scalar where FHIR JSON requires an array", () => {
    expect(issues(mutate((c) => (c.author = c.author[0])))).toEqual([
      expect.stringMatching(/^author: /),
    ]);
  });

  it("rejects an empty array, which FHIR JSON forbids", () => {
    expect(issues(mutate((c) => (c.section[0].entry = [])))).not.toEqual([]);
  });

  it("enforces the section's entry slicing", () => {
    // The example already carries one Binary, the most the slice allows.
    const binary = { reference: "urn:uuid:b", type: "Binary" };
    const found = issues(mutate((c) => c.section[0].entry.push(binary)));
    expect(found).toContain(
      "section.0.entry: Composition.section.entry:Binary allows at most 1, found 2",
    );
  });

  it("rejects a section entry of a type the closed slicing does not allow", () => {
    const observation = { reference: "urn:uuid:o", type: "Observation" };
    expect(issues(mutate((c) => c.section[0].entry.push(observation)))).toEqual([
      "section.0.entry.3: Composition.section.entry is closed: item 3 matches none of its slices",
    ]);
  });
});

describe("generated datatypes", () => {
  it("reject two variants of a choice element", () => {
    const extension = { url: "http://example.org/x", valueString: "a", valueBoolean: true };
    expect(datatypes.Extension.safeParse(extension).success).toBe(false);
  });
});

describe("the profile registry", () => {
  it("is generated from the IG version core pins", () => {
    expect(PACKAGE.version).toBe(IG_PACKAGE.version);
    expect(PACKAGE.status).toBe("release");
  });

  it("resolves a profile by the canonical URL an instance declares", () => {
    const [url] = example.meta.profile;
    expect(PROFILES_BY_URL.get(url as string)).toBe(PROFILES.PrescriptionRecord);
  });

  it("records what the schema leaves to the HL7 validator", () => {
    const reasons = PROFILES.PrescriptionRecord.unchecked.map((u) => u.reason);
    expect(reasons).toContain(
      "required binding http://hl7.org/fhir/ValueSet/composition-status|4.0.1",
    );
    expect(reasons.some((r) => r.startsWith("invariant "))).toBe(true);
  });
});

describe("HI_TYPE_PROFILES", () => {
  it("maps every health information type to a Composition profile", () => {
    for (const hi of HI_TYPES) {
      expect(PROFILES[HI_TYPE_PROFILES[hi]].type).toBe("Composition");
    }
  });

  it("maps OPConsultation to the profile the IG calls OPConsultRecord", () => {
    expect(HI_TYPE_PROFILES.OPConsultation).toBe("OPConsultRecord");
  });
});

describe("the 7.0.0 preview target", () => {
  it("is generated from the preview build and marked as such", () => {
    expect(preview.PACKAGE).toMatchObject({ version: "7.0.0", status: "preview" });
  });

  it("uses the same hiType mapping", () => {
    expect(preview.HI_TYPE_PROFILES).toEqual(HI_TYPE_PROFILES);
  });

  it("also accepts the 6.5.0 prescription example", () => {
    expect(preview.PROFILES.PrescriptionRecord.schema.safeParse(example).success).toBe(true);
  });
});
