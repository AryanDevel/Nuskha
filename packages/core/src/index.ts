/**
 * The ABDM FHIR Implementation Guide this build targets.
 *
 * Pinned on purpose. `@nuskha/ig` regenerates its types from exactly this
 * package, so moving the pin is a regenerate plus a golden diff somebody reads,
 * never a quiet change in what "conformant" means.
 *
 * This is 6.5.0, the newest release in the FHIR package registry. NRCeS also
 * serves a 7.0.0 build, but only from its preview site and marked
 * `notForPublication`, so it can change without a version bump. `@nuskha/ig`
 * generates it alongside as a preview target, with a diff against this one,
 * and the pin moves when 7.0.0 is actually released.
 *
 * @see https://nrces.in/ndhm/fhir/r4/index.html
 */
export const IG_PACKAGE = {
  id: "ndhm.in",
  version: "6.5.0",
  fhirVersion: "4.0.1",
} as const;

export type IgPackage = typeof IG_PACKAGE;

/**
 * The eight health information types ABDM defines. Each one is a FHIR Bundle of
 * type `document` whose first entry is a Composition profiled by the IG above.
 * This list is the compiler's target surface: one composer per member.
 *
 * These are the `hiType` values the gateway and consent artefacts use. Note
 * that the IG's Composition profiles do not always share the spelling — the
 * profile behind `OPConsultation` is named `OPConsultRecord`. The IG never
 * states the mapping between the two vocabularies, so `@nuskha/ig` declares it
 * once and its generator checks it against every IG target, because getting it
 * wrong is a silent conformance failure.
 */
export const HI_TYPES = [
  "DiagnosticReport",
  "DischargeSummary",
  "HealthDocumentRecord",
  "ImmunizationRecord",
  "Invoice",
  "OPConsultation",
  "Prescription",
  "WellnessRecord",
] as const;

export type HiType = (typeof HI_TYPES)[number];

/** Narrows an arbitrary string to a known ABDM health information type. */
export function isHiType(value: string): value is HiType {
  return (HI_TYPES as readonly string[]).includes(value);
}
