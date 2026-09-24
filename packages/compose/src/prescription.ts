import {
  type Encounter as EncounterIR,
  type Field,
  type Organization as OrganizationIR,
  type Patient as PatientIR,
  type Practitioner as PractitionerIR,
  type PrescriptionIR,
  PrescriptionIR as PrescriptionIRSchema,
} from "@nuskha/core";
import {
  type DocumentBundle,
  datatypes,
  type Encounter,
  type MedicationRequest,
  type Organization,
  type Patient,
  PROFILES,
  type Practitioner,
  type PrescriptionRecord,
} from "@nuskha/ig";
import { toDosages } from "./dosage.ts";
import { toIdentifier } from "./identifiers.ts";
import { NUSKHA_NAMESPACE, uuidV5 } from "./uuid.ts";

export interface ComposeOptions {
  /**
   * `Bundle.identifier`: the document's id in the system that issues it,
   * usually the HIP. Every resource id is derived from it, so the same IR and
   * identifier always compose to the same bundle.
   */
  readonly identifier: { readonly system: string; readonly value: string };
  /** `Bundle.timestamp`, an instant with a UTC offset. Given, never read from a clock. */
  readonly timestamp: string;
}

/** Something in the IR that the bundle does not carry, and why. */
export interface Omission {
  readonly path: string;
  readonly reason: string;
}

export interface ComposeResult {
  readonly bundle: DocumentBundle;
  readonly omitted: readonly Omission[];
}

/** The input could not be composed. Carries the schema's issues when there are any. */
export class ComposeError extends Error {
  readonly issues: readonly { readonly path: string; readonly message: string }[];
  constructor(message: string, issues: ComposeError["issues"] = []) {
    super(
      issues.length
        ? `${message}:\n  ${issues.map((i) => `${i.path}: ${i.message}`).join("\n  ")}`
        : message,
    );
    this.name = "ComposeError";
    this.issues = issues;
  }
}

const SNOMED = "http://snomed.info/sct" as const;
const PRESCRIPTION_RECORD = {
  system: SNOMED,
  code: "440545006",
  display: "Prescription record",
} as const;
const ACT_CODE = "http://terminology.hl7.org/CodeSystem/v3-ActCode";

/** A reference to a bundle entry, as the profiles require: always resolvable. */
interface EntryReference {
  reference: string;
  display: string;
}

const ENCOUNTER_CLASS: Readonly<
  Record<EncounterIR["kind"]["value"], { system: string; code: string; display: string }>
> = {
  outpatient: { system: ACT_CODE, code: "AMB", display: "ambulatory" },
  inpatient: { system: ACT_CODE, code: "IMP", display: "inpatient encounter" },
  emergency: { system: ACT_CODE, code: "EMER", display: "emergency" },
  virtual: { system: ACT_CODE, code: "VR", display: "virtual" },
};

const meta = (profile: keyof typeof PROFILES) => ({ profile: [PROFILES[profile].url] });

function hasProvenance(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if ("provenance" in value && (value as Field<unknown>).provenance !== undefined) return true;
  return Object.values(value).some(hasProvenance);
}

function patient(id: string, p: PatientIR): Patient {
  return {
    resourceType: "Patient",
    id,
    meta: meta("Patient"),
    identifier: p.identifiers.map(toIdentifier),
    name: [{ text: p.name.value }],
    ...(p.phone ? { telecom: [{ system: "phone", value: p.phone.value }] } : {}),
    ...(p.gender ? { gender: p.gender.value } : {}),
    ...(p.birthDate ? { birthDate: p.birthDate.value } : {}),
    ...(p.address ? { address: [{ text: p.address.value }] } : {}),
  };
}

function practitioner(id: string, p: PractitionerIR): Practitioner {
  return {
    resourceType: "Practitioner",
    id,
    meta: meta("Practitioner"),
    identifier: p.identifiers.map(toIdentifier),
    name: [{ text: p.name.value }],
    ...(p.phone ? { telecom: [{ system: "phone", value: p.phone.value }] } : {}),
    ...(p.qualifications
      ? { qualification: p.qualifications.map((q) => ({ code: { text: q.value } })) }
      : {}),
  };
}

function organization(id: string, o: OrganizationIR): Organization {
  return {
    resourceType: "Organization",
    id,
    meta: meta("Organization"),
    // The profile needs a system on every identifier. The IR requires one on
    // `other`, and every other kind maps to a known system, so this is a
    // guard against the two drifting apart, not a path real input takes.
    identifier: o.identifiers.map((i) => {
      const out = toIdentifier(i);
      if (!out.system) throw new ComposeError(`organization identifier ${i.kind} has no system`);
      return { ...out, system: out.system };
    }),
    name: o.name.value,
    ...(o.phone ? { telecom: [{ system: "phone", value: o.phone.value }] } : {}),
    ...(o.address ? { address: [{ text: o.address.value }] } : {}),
  };
}

function encounter(id: string, e: EncounterIR, subject: EntryReference): Encounter {
  return {
    resourceType: "Encounter",
    id,
    meta: meta("Encounter"),
    ...(e.identifier ? { identifier: [{ value: e.identifier.value }] } : {}),
    // A prescription is written at the end of the consultation it records.
    status: "finished",
    class: ENCOUNTER_CLASS[e.kind.value],
    subject,
    ...(e.date ? { period: { start: e.date.value } } : {}),
  };
}

/**
 * Compose an ABDM PrescriptionRecord document bundle from a prescription IR.
 *
 * Pure: the same IR and options always give the same bundle, byte for byte.
 * The IR is parsed first, so an input that cannot make a conformant bundle
 * fails here with the IR's own messages, not later in the validator.
 */
export function composePrescription(input: PrescriptionIR, options: ComposeOptions): ComposeResult {
  const parsed = PrescriptionIRSchema.safeParse(input);
  if (!parsed.success) {
    throw new ComposeError(
      "the prescription IR is invalid",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  if (!datatypes.P.instant.safeParse(options.timestamp).success) {
    throw new ComposeError(`timestamp ${options.timestamp} is not a FHIR instant`);
  }
  const ir = parsed.data;

  const seed = `${options.identifier.system}|${options.identifier.value}`;
  const id = (role: string) => uuidV5(NUSKHA_NAMESPACE, `${seed}|${role}`);
  const ref = (uuid: string, display: string): EntryReference => ({
    reference: `urn:uuid:${uuid}`,
    display,
  });

  const ids = {
    composition: id("composition"),
    patient: id("patient"),
    practitioner: id("practitioner"),
    organization: id("organization"),
    encounter: id("encounter"),
  };
  const subject = ref(ids.patient, ir.patient.name.value);
  const requester = ref(ids.practitioner, ir.practitioner.name.value);
  const encounterRef = ir.encounter ? ref(ids.encounter, "Encounter") : undefined;

  const medicationRequests: MedicationRequest[] = ir.medications.map((m, i) => {
    const described = [m.strength?.value, m.form?.value].filter((v) => v !== undefined);
    return {
      resourceType: "MedicationRequest",
      id: id(`medication/${i}`),
      meta: meta("MedicationRequest"),
      status: "active",
      intent: "order",
      // Uncoded until terminology lands. Strength and form ride along in the
      // text so they are not lost: "Tab. Dolo 650 (650 mg, tablet)".
      medicationCodeableConcept: {
        text: described.length ? `${m.name.value} (${described.join(", ")})` : m.name.value,
      },
      subject,
      ...(encounterRef ? { encounter: encounterRef } : {}),
      authoredOn: ir.date.value,
      requester,
      dosageInstruction: toDosages(m),
      ...(m.quantity
        ? {
            dispenseRequest: {
              quantity: { value: m.quantity.value.value, unit: m.quantity.value.unit },
            },
          }
        : {}),
    };
  });

  const composition: PrescriptionRecord = {
    resourceType: "Composition",
    id: ids.composition,
    meta: meta("PrescriptionRecord"),
    status: "final",
    type: { coding: [PRESCRIPTION_RECORD], text: PRESCRIPTION_RECORD.display },
    subject,
    ...(encounterRef ? { encounter: encounterRef } : {}),
    date: ir.date.value,
    author: [requester],
    title: PRESCRIPTION_RECORD.display,
    ...(ir.organization ? { custodian: ref(ids.organization, ir.organization.name.value) } : {}),
    section: [
      {
        title: PRESCRIPTION_RECORD.display,
        code: { coding: [PRESCRIPTION_RECORD] },
        entry: medicationRequests.map((r) => ({
          reference: `urn:uuid:${r.id}`,
          type: "MedicationRequest",
        })),
      },
    ],
  };

  const resources: { id?: string; resourceType: string }[] = [
    composition,
    patient(ids.patient, ir.patient),
    practitioner(ids.practitioner, ir.practitioner),
    ...(ir.organization ? [organization(ids.organization, ir.organization)] : []),
    ...(ir.encounter ? [encounter(ids.encounter, ir.encounter, subject)] : []),
    ...medicationRequests,
  ];

  const bundle: DocumentBundle = {
    resourceType: "Bundle",
    id: uuidV5(NUSKHA_NAMESPACE, `${seed}|bundle`),
    meta: { versionId: "1", lastUpdated: options.timestamp, ...meta("DocumentBundle") },
    identifier: { system: options.identifier.system, value: options.identifier.value },
    type: "document",
    timestamp: options.timestamp,
    entry: resources.map((r) => ({ fullUrl: `urn:uuid:${r.id}`, resource: { ...r } })),
  };

  const omitted: Omission[] = [];
  if (ir.patient.age) {
    omitted.push({
      path: "patient.age",
      reason: "FHIR R4 Patient has no element for age, and a birth date is not invented from one",
    });
  }
  if (hasProvenance(ir)) {
    omitted.push({
      path: "provenance",
      reason: "provenance is not yet emitted as FHIR Provenance resources",
    });
  }
  return { bundle, omitted };
}
