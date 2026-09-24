import { z } from "zod";
import { type Field, fieldSchema, SourceDocument } from "./provenance.ts";

/**
 * Clinical IR v0 for a prescription: what a prescription says, in the terms
 * a prescription uses, with nothing about FHIR in it. The composer turns this
 * into an ABDM PrescriptionRecord bundle, and the extractor fills it in.
 *
 * Two rules shaped it:
 *
 * - Required here means required to build a conformant bundle. The 6.5.0
 *   profiles demand an identifier on every Patient, Practitioner and
 *   Organization, so the IR does too. A printed prescription often has none
 *   for the patient; the gap then shows up in review, where a person can fill
 *   it, instead of inside the composer.
 * - Values stay as written wherever normalising them needs knowledge the IR
 *   does not have. Names are single strings, because splitting Indian names
 *   into given and family is often wrong. Strength is text, because
 *   "500 mg + 125 mg" is not a quantity. Coding them is terminology's job.
 */

export const IR_VERSION = "0";

// ---- Values -----------------------------------------------------------------

/** `YYYY-MM-DD`, optionally with a time, which then needs a UTC offset. */
export type DateTime = string;
/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Birth dates are often partial. */
export type PartialDate = string;

export type Gender = "male" | "female" | "other" | "unknown";

export interface Quantity {
  readonly value: number;
  /** As written: `tab`, `ml`, `puff`. */
  readonly unit: string;
}

export interface Duration {
  readonly value: number;
  readonly unit: "d" | "wk" | "mo";
}

export interface Age {
  readonly value: number;
  readonly unit: "a" | "mo" | "wk" | "d";
}

/**
 * How often a medication is taken.
 *
 * - `times-of-day` is the Indian `1-0-1` and `1-1-1-1` notation: how many
 *   dose units at each point in the day.
 * - `every` covers `OD`, `BD`, `TDS`, `QID` and `q8h`: `times` doses per
 *   `period` of `unit`. `BD` is 2 per 1 d; `q8h` is 1 per 8 h.
 * - `as-written` keeps a frequency the extractor could read but not
 *   normalise, rather than guessing at it.
 */
export type Frequency =
  | {
      readonly kind: "times-of-day";
      readonly morning: number;
      readonly afternoon: number;
      readonly evening?: number;
      readonly night: number;
    }
  | {
      readonly kind: "every";
      readonly times: number;
      readonly period: number;
      readonly unit: "h" | "d" | "wk" | "mo";
    }
  | { readonly kind: "as-written"; readonly text: string };

export type FoodRelation = "before-food" | "after-food" | "with-food" | "empty-stomach";

export type EncounterKind = "outpatient" | "inpatient" | "emergency" | "virtual";

// ---- Identifiers --------------------------------------------------------------

/**
 * `issuer` names who assigned the value when the kind does not imply it: the
 * state medical council for a registration number, the hospital for an MRN.
 */
export interface Identifier<Kind extends string> {
  readonly kind: Kind;
  readonly value: Field<string>;
  readonly issuer?: Field<string>;
}

export type PatientIdentifierKind = "abha-number" | "abha-address" | "mrn" | "other";
export type PractitionerIdentifierKind = "medical-registration" | "hpr-id" | "other";
export type OrganizationIdentifierKind = "hfr-id" | "other";

// ---- Participants ---------------------------------------------------------------

export interface Patient {
  readonly name: Field<string>;
  readonly identifiers: readonly Identifier<PatientIdentifierKind>[];
  readonly gender?: Field<Gender>;
  readonly birthDate?: Field<PartialDate>;
  /** Printed prescriptions usually give an age, not a date of birth. */
  readonly age?: Field<Age>;
  readonly phone?: Field<string>;
  readonly address?: Field<string>;
}

export interface Practitioner {
  readonly name: Field<string>;
  readonly identifiers: readonly Identifier<PractitionerIdentifierKind>[];
  /** As printed under the name: `MBBS`, `MD (Medicine)`. */
  readonly qualifications?: readonly Field<string>[];
  readonly phone?: Field<string>;
}

export interface Organization {
  readonly name: Field<string>;
  readonly identifiers: readonly Identifier<OrganizationIdentifierKind>[];
  readonly phone?: Field<string>;
  readonly address?: Field<string>;
}

export interface Encounter {
  readonly kind: Field<EncounterKind>;
  readonly date?: Field<DateTime>;
  /** The OPD or visit number, when the prescription prints one. */
  readonly identifier?: Field<string>;
}

// ---- Medications ------------------------------------------------------------------

export interface Medication {
  /** As written, brand and form included: `Tab. Dolo 650`. */
  readonly name: Field<string>;
  /** As written: `650 mg`, `500 mg + 125 mg`. */
  readonly strength?: Field<string>;
  /** As written: `tablet`, `syrup`, `inhaler`. */
  readonly form?: Field<string>;
  /** One administration: `1 tab`, `5 ml`, `0.5 tab`. */
  readonly dose?: Field<Quantity>;
  readonly frequency?: Field<Frequency>;
  readonly foodRelation?: Field<FoodRelation>;
  /** `SOS`, or "if needed". */
  readonly asNeeded?: Field<boolean>;
  readonly route?: Field<string>;
  readonly duration?: Field<Duration>;
  /** Total to dispense. */
  readonly quantity?: Field<Quantity>;
  /** Anything else the prescriber wrote about this medication, as written. */
  readonly instructions?: Field<string>;
}

// ---- The document -------------------------------------------------------------------

export interface PrescriptionIR {
  readonly irVersion: typeof IR_VERSION;
  readonly hiType: "Prescription";
  /** The document the provenance spans refer to, when there is one. */
  readonly source?: SourceDocument;
  /** When the prescription was written. */
  readonly date: Field<DateTime>;
  readonly patient: Patient;
  readonly practitioner: Practitioner;
  readonly organization?: Organization;
  readonly encounter?: Encounter;
  readonly medications: readonly Medication[];
}

// ---- Schemas ------------------------------------------------------------------------

const opt = z.exactOptional;
/** Non-blank, and kept exactly as given: parsing never rewrites what was written. */
const text = z.string().refine((v) => v.trim().length > 0, { message: "must not be blank" });
const positive = z.number().positive();
const count = z.number().min(0);

function isCalendarDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-](0\d|1[0-4]):[0-5]\d))?$/;

export const DateTime: z.ZodType<DateTime> = z.string().refine(
  (s) => {
    const m = DATE_TIME.exec(s);
    return !!m && isCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
  },
  { message: "expected YYYY-MM-DD, optionally with a time and UTC offset" },
);

export const PartialDate: z.ZodType<PartialDate> = z.string().refine(
  (s) => {
    const m = /^(\d{4})(-(\d{2})(-(\d{2}))?)?$/.exec(s);
    if (!m) return false;
    const month = m[3] === undefined ? 1 : Number(m[3]);
    if (month < 1 || month > 12) return false;
    return m[5] === undefined || isCalendarDate(Number(m[1]), month, Number(m[5]));
  },
  { message: "expected YYYY, YYYY-MM or YYYY-MM-DD" },
);

export const Quantity: z.ZodType<Quantity> = z.strictObject({ value: positive, unit: text });
export const Duration: z.ZodType<Duration> = z.strictObject({
  value: positive,
  unit: z.enum(["d", "wk", "mo"]),
});
export const Age: z.ZodType<Age> = z.strictObject({
  value: z.number().min(0).max(150),
  unit: z.enum(["a", "mo", "wk", "d"]),
});

export const Frequency: z.ZodType<Frequency> = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("times-of-day"),
      morning: count,
      afternoon: count,
      evening: opt(count),
      night: count,
    })
    .refine((f) => f.morning + f.afternoon + (f.evening ?? 0) + f.night > 0, {
      message: "a times-of-day frequency of 0-0-0 means no doses at all",
    }),
  z.strictObject({
    kind: z.literal("every"),
    times: z.int().positive(),
    period: positive,
    unit: z.enum(["h", "d", "wk", "mo"]),
  }),
  z.strictObject({ kind: z.literal("as-written"), text }),
]);

/** Structural checks on ABDM identifiers whose format is published. */
const IDENTIFIER_FORMAT: Readonly<Record<string, { pattern: RegExp; message: string }>> = {
  "abha-number": {
    pattern: /^\d{2}-?\d{4}-?\d{4}-?\d{4}$/,
    message: "an ABHA number has 14 digits, often written 91-1234-5678-9012",
  },
  "abha-address": {
    pattern: /^[A-Za-z0-9._]+@(abdm|sbx)$/,
    message: "an ABHA address looks like name@abdm (or name@sbx in the sandbox)",
  },
};

function identifierSchema<K extends string>(kinds: readonly [K, ...K[]]): z.ZodType<Identifier<K>> {
  return z
    .strictObject({
      kind: z.enum(kinds),
      value: fieldSchema(text),
      issuer: opt(fieldSchema(text)),
    })
    .superRefine((id, ctx) => {
      const format = IDENTIFIER_FORMAT[id.kind];
      if (format && !format.pattern.test(id.value.value)) {
        ctx.addIssue({ code: "custom", message: format.message, path: ["value", "value"] });
      }
    }) as unknown as z.ZodType<Identifier<K>>;
}

/** The profiles need at least one identifier on each participant. */
const identifiers = <K extends string>(kinds: readonly [K, ...K[]], who: string) =>
  z.array(identifierSchema(kinds)).min(1, {
    message: `the ABDM ${who} profile requires at least one identifier`,
  });

export const Patient: z.ZodType<Patient> = z.strictObject({
  name: fieldSchema(text),
  identifiers: identifiers(["abha-number", "abha-address", "mrn", "other"], "Patient"),
  gender: opt(fieldSchema(z.enum(["male", "female", "other", "unknown"]))),
  birthDate: opt(fieldSchema(PartialDate)),
  age: opt(fieldSchema(Age)),
  phone: opt(fieldSchema(text)),
  address: opt(fieldSchema(text)),
});

export const Practitioner: z.ZodType<Practitioner> = z.strictObject({
  name: fieldSchema(text),
  identifiers: identifiers(["medical-registration", "hpr-id", "other"], "Practitioner"),
  qualifications: opt(z.array(fieldSchema(text)).min(1)),
  phone: opt(fieldSchema(text)),
});

export const Organization: z.ZodType<Organization> = z.strictObject({
  name: fieldSchema(text),
  identifiers: identifiers(["hfr-id", "other"], "Organization"),
  phone: opt(fieldSchema(text)),
  address: opt(fieldSchema(text)),
});

export const Encounter: z.ZodType<Encounter> = z.strictObject({
  kind: fieldSchema(z.enum(["outpatient", "inpatient", "emergency", "virtual"])),
  date: opt(fieldSchema(DateTime)),
  identifier: opt(fieldSchema(text)),
});

/** What the composer can turn into a Dosage, which the profile requires. */
const DOSAGE_KEYS = [
  "dose",
  "frequency",
  "foodRelation",
  "asNeeded",
  "route",
  "duration",
  "instructions",
] as const;

export const Medication: z.ZodType<Medication> = z
  .strictObject({
    name: fieldSchema(text),
    strength: opt(fieldSchema(text)),
    form: opt(fieldSchema(text)),
    dose: opt(fieldSchema(Quantity)),
    frequency: opt(fieldSchema(Frequency)),
    foodRelation: opt(
      fieldSchema(z.enum(["before-food", "after-food", "with-food", "empty-stomach"])),
    ),
    asNeeded: opt(fieldSchema(z.boolean())),
    route: opt(fieldSchema(text)),
    duration: opt(fieldSchema(Duration)),
    quantity: opt(fieldSchema(Quantity)),
    instructions: opt(fieldSchema(text)),
  })
  .refine((m) => DOSAGE_KEYS.some((k) => m[k] !== undefined), {
    message: `a medication needs at least one of ${DOSAGE_KEYS.join(", ")}: the profile requires a dosage instruction`,
  });

/** Every provenance span in the IR, with where it sits. */
function* spans(
  value: unknown,
  path: (string | number)[] = [],
): Generator<{
  path: (string | number)[];
  page: number;
}> {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) yield* spans(item, [...path, i]);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "provenance" && child && typeof child === "object") {
      const list = (child as { spans?: { page: number }[] }).spans ?? [];
      for (const [i, s] of list.entries()) {
        yield { path: [...path, key, "spans", i, "page"], page: s.page };
      }
    } else {
      yield* spans(child, [...path, key]);
    }
  }
}

export const PrescriptionIR: z.ZodType<PrescriptionIR> = z
  .strictObject({
    irVersion: z.literal(IR_VERSION),
    hiType: z.literal("Prescription"),
    source: opt(SourceDocument),
    date: fieldSchema(DateTime),
    patient: Patient,
    practitioner: Practitioner,
    organization: opt(Organization),
    encounter: opt(Encounter),
    medications: z.array(Medication).min(1, { message: "a prescription prescribes something" }),
  })
  .superRefine((ir, ctx) => {
    const pages = ir.source?.pageCount;
    let any = false;
    for (const s of spans(ir)) {
      any = true;
      if (pages !== undefined && s.page > pages) {
        ctx.addIssue({
          code: "custom",
          message: `page ${s.page} is beyond the source document's ${pages} pages`,
          path: s.path,
        });
      }
    }
    if (any && pages === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "provenance spans point at pages, so the source document must be given",
        path: ["source"],
      });
    }
  });
