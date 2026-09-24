import { field, type PrescriptionIR } from "@nuskha/core";
import { PROFILES, PROFILES_BY_URL } from "@nuskha/ig";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.ts";
import { ComposeError, composePrescription } from "./index.ts";

/**
 * Every fixture must compose to a bundle the generated IG schemas accept, the
 * bundle and each entry against the profile it declares, and must match its
 * checked-in golden. The HL7 validator run is in validator.test.ts.
 */

const issues = (schema: { safeParse(v: unknown): { error?: { issues: unknown[] } } }, v: unknown) =>
  schema.safeParse(v).error?.issues ?? [];

describe("composePrescription, over the hand-written fixtures", () => {
  it("has the twenty fixtures 0.5 asks for", () => {
    expect(fixtures).toHaveLength(20);
  });

  for (const { name, ir, options } of fixtures) {
    describe(name, () => {
      const { bundle } = composePrescription(ir, options);

      it("passes the DocumentBundle schema", () => {
        expect(issues(PROFILES.DocumentBundle.schema, bundle)).toEqual([]);
      });

      it("passes the schema of the profile each entry declares", () => {
        for (const entry of bundle.entry ?? []) {
          const resource = entry.resource as { meta?: { profile?: string[] } };
          const [url] = resource.meta?.profile ?? [];
          const profile = PROFILES_BY_URL.get(url as string);
          expect(profile, `no generated profile for ${url}`).toBeDefined();
          expect(issues(profile?.schema ?? PROFILES.DocumentBundle.schema, resource)).toEqual([]);
        }
      });

      it("matches its golden", async () => {
        await expect(`${JSON.stringify(bundle, null, 2)}\n`).toMatchFileSnapshot(
          `./__goldens__/prescriptions/${name}.bundle.json`,
        );
      });

      it("is deterministic", () => {
        expect(composePrescription(ir, options)).toStrictEqual(composePrescription(ir, options));
      });
    });
  }
});

// biome-ignore lint/suspicious/noExplicitAny: assertions reach into composed JSON by path
type Json = any;
const minimal = fixtures.find((f) => f.name === "01-minimal") as (typeof fixtures)[number];
const resourcesOf = (ir: PrescriptionIR) =>
  (composePrescription(ir, minimal.options).bundle.entry ?? []).map(
    (e) => e.resource as Record<string, Json>,
  );

describe("what the composer decides", () => {
  it("puts the Composition first, as a document bundle requires", () => {
    expect(resourcesOf(minimal.ir)[0]?.resourceType).toBe("Composition");
  });

  it("gives an unequal 1-0-2 pattern one Dosage per time of day", () => {
    const glycomet = fixtures.find((f) => f.name === "03-unequal-times-of-day");
    const request = resourcesOf(glycomet?.ir as PrescriptionIR).find(
      (r) => r.resourceType === "MedicationRequest",
    );
    expect(
      request?.dosageInstruction.map((d: Json) => [
        d.timing.repeat.when,
        d.doseAndRate[0].doseQuantity,
      ]),
    ).toEqual([
      [["MORN"], { value: 1, unit: "tab" }],
      [["NIGHT"], { value: 2, unit: "tab" }],
    ]);
  });

  it("keeps strength and form in the medication text rather than dropping them", () => {
    const amox = fixtures.find((f) => f.name === "05-every-eight-hours");
    const request = resourcesOf(amox?.ir as PrescriptionIR).find(
      (r) => r.resourceType === "MedicationRequest",
    );
    expect(request?.medicationCodeableConcept).toEqual({
      text: "Cap. Amoxycillin 500 (500 mg, capsule)",
    });
  });

  it("follows the IG examples' identifier conventions", () => {
    const [, patient] = resourcesOf(fixtures[1]?.ir as PrescriptionIR);
    expect(patient?.identifier).toEqual([
      {
        type: {
          coding: [
            {
              system: "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-identifier-type-code",
              code: "ABHA",
              display: "Ayushman Bharat Health Account (ABHA) ID",
            },
          ],
        },
        system: "https://healthid.ndhm.gov.in",
        value: "91-1111-2222-3333",
      },
    ]);
  });

  it("reports what the bundle cannot carry instead of dropping it silently", () => {
    const extracted = fixtures.find((f) => f.name === "20-extracted-with-provenance");
    const { omitted } = composePrescription(extracted?.ir as PrescriptionIR, minimal.options);
    expect(omitted.map((o) => o.path)).toEqual(["patient.age", "provenance"]);
  });

  it("changes every id when the document identifier changes", () => {
    const a = composePrescription(minimal.ir, minimal.options).bundle;
    const b = composePrescription(minimal.ir, {
      ...minimal.options,
      identifier: { ...minimal.options.identifier, value: "another-document" },
    }).bundle;
    const ids = (x: typeof a) => (x.entry ?? []).map((e) => e.fullUrl);
    expect(ids(a).filter((id) => ids(b).includes(id))).toEqual([]);
  });
});

describe("what the composer refuses", () => {
  it("rejects an invalid IR with the IR's own messages", () => {
    const bad = { ...minimal.ir, medications: [] };
    expect(() => composePrescription(bad, minimal.options)).toThrow(ComposeError);
    expect(() => composePrescription(bad, minimal.options)).toThrow(
      /medications: a prescription prescribes something/,
    );
  });

  it("rejects a timestamp that is not a FHIR instant", () => {
    expect(() =>
      composePrescription(minimal.ir, { ...minimal.options, timestamp: "2026-09-21" }),
    ).toThrow(/not a FHIR instant/);
  });

  it("accepts an IR built in code", () => {
    const ir: PrescriptionIR = {
      ...minimal.ir,
      medications: [{ name: field("Tab. Shelcal 500"), dose: field({ value: 1, unit: "tab" }) }],
    };
    expect(composePrescription(ir, minimal.options).bundle.type).toBe("document");
  });
});
